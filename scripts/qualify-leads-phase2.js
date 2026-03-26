// Phase 2: Claude AI company scoring for Granite Park Capital fit
// Batches companies and asks Claude to classify each one
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Anthropic = require('@anthropic-ai/sdk');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');
const BATCH_SIZE = 25; // companies per API call (smaller to avoid token truncation)
const CONCURRENCY = 5; // parallel API calls
const PROGRESS_FILE = path.join(dataDir, 'phase2-progress.json');
const OUTPUT_FILE = path.join(dataDir, 'phase2-scored.json');

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an investment analyst screening potential LP investors for Granite Park Capital, a $100M affordable housing Build-to-Rent (BTR) real estate fund.

Fund details:
- $100M target raise for affordable/workforce housing BTR projects
- 8% preferred return, 19.2% projected IRR
- $250K minimum investment, sweet spot $1M-$20M checks
- Looking for LPs (limited partners), not co-GPs
- Real estate focused, specifically multifamily/BTR/affordable housing

Your job: Score each company on how likely they are to be a GOOD FIT as an LP investor.

GOOD FIT indicators:
- Family office (single or multi) that invests in real estate
- Real estate investment firm, REIT, or RE-focused fund
- Family office with history of being LP in real estate funds
- Wealth management firm serving UHNW clients who invest in RE
- Endowment, foundation, or pension with RE allocation
- Private equity firm with real estate or real assets focus
- Any firm explicitly focused on affordable/workforce housing

MODERATE FIT indicators:
- Generalist family office (invests across asset classes including alternatives)
- Multi-strategy investment firm that includes real estate
- Wealth advisory firm that allocates to alternative investments
- Private credit or debt fund (may do RE debt)

BAD FIT indicators:
- VC firm or tech-focused investment firm
- Crypto/blockchain/DeFi focused
- Biotech/pharma/healthcare-only investor
- Pure hedge fund (quantitative, L/S equity, macro)
- Insurance company or bank wealth management division
- Accounting/consulting firm's wealth practice
- Financial planning firm for retail clients
- Company that is NOT an investment firm at all (tech co, manufacturer, etc.)

For each company, respond with ONLY a JSON array. Each element:
{
  "company": "exact company name",
  "score": 1-10,
  "category": "family_office_re" | "family_office_general" | "re_investor" | "pe_re" | "wealth_mgmt" | "generalist_investor" | "vc_tech" | "hedge_fund" | "non_investor" | "unknown",
  "reasoning": "one sentence why"
}

Scoring guide:
- 9-10: Strong RE family office or RE-focused investor, very likely LP candidate
- 7-8: Family office or investor with likely RE interest
- 5-6: Generalist investor, could go either way
- 3-4: Unlikely fit but not impossible
- 1-2: Clearly wrong fit (VC, tech, non-investor)`;

async function scoreBatch(companies, batchIndex, totalBatches) {
  const companyList = companies.map((c, i) => {
    const titles = c.sampleTitles.slice(0, 2).join('; ');
    return `${i + 1}. "${c.company}" — titles: ${titles}`;
  }).join('\n');

  const userPrompt = `Score these ${companies.length} companies (batch ${batchIndex + 1}/${totalBatches}):\n\n${companyList}\n\nIMPORTANT: Return ONLY a raw JSON array. Do NOT wrap in markdown code blocks. No backticks. Just the raw [ ... ] array.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code blocks if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Extract JSON array
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error(`  Batch ${batchIndex + 1}: No JSON array found`);
    return companies.map(c => ({
      company: c.company,
      score: 0,
      category: 'parse_error',
      reasoning: 'No JSON array in AI response',
    }));
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    // Try to salvage partial JSON — find last complete object
    let partial = jsonMatch[0];
    const lastCompleteObj = partial.lastIndexOf('},');
    if (lastCompleteObj > 0) {
      partial = partial.substring(0, lastCompleteObj + 1) + ']';
      try {
        const partialResults = JSON.parse(partial);
        console.warn(`  Batch ${batchIndex + 1}: Salvaged ${partialResults.length}/${companies.length} from truncated JSON`);
        // Fill in missing companies with score 0
        const scored = new Set(partialResults.map(r => r.company));
        for (const c of companies) {
          if (!scored.has(c.company)) {
            partialResults.push({ company: c.company, score: 0, category: 'parse_error', reasoning: 'Truncated response' });
          }
        }
        return partialResults;
      } catch (e2) { /* fall through */ }
    }
    console.error(`  Batch ${batchIndex + 1}: JSON parse error: ${e.message}`);
    return companies.map(c => ({
      company: c.company,
      score: 0,
      category: 'parse_error',
      reasoning: 'JSON parse error',
    }));
  }
}

async function main() {
  // Load companies
  const companies = require(path.join(dataDir, 'phase2-companies.json'));
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PHASE 2: Claude AI Company Scoring`);
  console.log(`  ${companies.length} companies to score`);
  console.log(`  Batch size: ${BATCH_SIZE} | Concurrency: ${CONCURRENCY}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Load progress
  let progressData = { completed: 0 };
  let allResults = [];
  if (fs.existsSync(PROGRESS_FILE)) {
    progressData = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    // Load previously saved results
    if (fs.existsSync(OUTPUT_FILE)) {
      allResults = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
    }
    console.log(`  Resuming from company ${progressData.completed} (${allResults.length} results loaded)\n`);
  }

  const remaining = companies.slice(progressData.completed);
  const batches = [];
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    batches.push(remaining.slice(i, i + BATCH_SIZE));
  }

  const totalBatches = Math.ceil(companies.length / BATCH_SIZE);
  const startBatch = Math.floor(progressData.completed / BATCH_SIZE);
  let processedCount = progressData.completed;
  const startTime = Date.now();

  // Process in waves of CONCURRENCY
  for (let wave = 0; wave < batches.length; wave += CONCURRENCY) {
    const waveBatches = batches.slice(wave, wave + CONCURRENCY);
    const batchIndices = waveBatches.map((_, i) => startBatch + wave + i);

    const waveLabel = batchIndices.map(i => i + 1).join(', ');
    process.stdout.write(`  Batches ${waveLabel}/${totalBatches}...`);

    try {
      const promises = waveBatches.map((batch, i) =>
        scoreBatch(batch, batchIndices[i], totalBatches)
      );
      const results = await Promise.all(promises);

      for (const batchResults of results) {
        allResults.push(...batchResults);
      }

      processedCount += waveBatches.reduce((sum, b) => sum + b.length, 0);

      // Save progress
      progress = { completed: processedCount, results: allResults };
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ completed: processedCount }));
      // Append results incrementally to output file
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));

      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = companies.length - processedCount;
      const eta = remaining > 0 ? Math.round(remaining / (processedCount / elapsed)) : 0;

      console.log(` done (${processedCount}/${companies.length}, ~${eta}s remaining)`);
    } catch (err) {
      console.error(` ERROR: ${err.message}`);
      // Save what we have
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ completed: processedCount, results: [] }));
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));
      console.log(`  Saved progress at ${processedCount} companies. Re-run to resume.`);
      process.exit(1);
    }
  }

  // === FINAL OUTPUT ===
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));

  // Build company score map
  const scoreMap = new Map();
  for (const result of allResults) {
    scoreMap.set(result.company, result);
  }

  // Merge scores back to leads
  const qualifiedLeads = require(path.join(dataDir, 'phase1-qualified.json'));
  const scoredLeads = qualifiedLeads.map(lead => {
    const companyResult = scoreMap.get(lead.company) || { score: 0, category: 'not_scored', reasoning: '' };
    return {
      ...lead,
      aiScore: companyResult.score,
      aiCategory: companyResult.category,
      aiReasoning: companyResult.reasoning,
      combinedScore: (lead.totalScore || 0) + (companyResult.score * 3), // weight AI score heavily
    };
  });

  scoredLeads.sort((a, b) => b.combinedScore - a.combinedScore);

  // Score distribution
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  RESULTS');
  console.log(`${'═'.repeat(60)}\n`);

  const scoreDist = {};
  for (const r of allResults) {
    const bucket = r.score >= 9 ? '9-10 (Strong RE fit)' :
                   r.score >= 7 ? '7-8 (Likely fit)' :
                   r.score >= 5 ? '5-6 (Possible fit)' :
                   r.score >= 3 ? '3-4 (Unlikely fit)' :
                   '1-2 (Bad fit)';
    scoreDist[bucket] = (scoreDist[bucket] || 0) + 1;
  }

  console.log('  Company AI Score Distribution:');
  for (const [bucket, count] of Object.entries(scoreDist).sort()) {
    console.log(`    ${bucket}: ${count} companies`);
  }

  // Category distribution
  const catDist = {};
  for (const r of allResults) {
    catDist[r.category] = (catDist[r.category] || 0) + 1;
  }
  console.log('\n  Category Distribution:');
  for (const [cat, count] of Object.entries(catDist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count}`);
  }

  // Leads moving to Phase 3 (company AI score >= 5)
  const phase3Leads = scoredLeads.filter(l => l.aiScore >= 5);
  const phase3Companies = new Set(phase3Leads.map(l => l.company));
  console.log(`\n  Phase 3 candidates (AI score >= 5):`);
  console.log(`    ${phase3Leads.length} leads across ${phase3Companies.size} companies`);

  // Save scored leads
  const scoredPath = path.join(dataDir, 'phase2-scored-leads.json');
  fs.writeFileSync(scoredPath, JSON.stringify(scoredLeads, null, 2));
  console.log(`\n  Saved: ${scoredPath}`);

  // Save Phase 3 company list
  const phase3List = [...phase3Companies].map(co => {
    const result = scoreMap.get(co);
    const leads = scoredLeads.filter(l => l.company === co);
    return {
      company: co,
      aiScore: result ? result.score : 0,
      aiCategory: result ? result.category : 'unknown',
      aiReasoning: result ? result.reasoning : '',
      leadCount: leads.length,
      sampleLeads: leads.slice(0, 3).map(l => ({ name: `${l.firstName} ${l.lastName}`, title: l.title })),
      states: [...new Set(leads.map(l => l.state))],
    };
  }).sort((a, b) => b.aiScore - a.aiScore);

  const phase3Path = path.join(dataDir, 'phase3-companies.json');
  fs.writeFileSync(phase3Path, JSON.stringify(phase3List, null, 2));
  console.log(`  Saved: ${phase3Path} (${phase3List.length} companies for web research)`);

  // Cleanup progress file
  fs.unlinkSync(PROGRESS_FILE);
  console.log(`\n  Done! Total API calls: ~${Math.ceil(companies.length / BATCH_SIZE)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
