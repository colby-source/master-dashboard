// Phase 2 for overflow leads — Claude AI scoring on NEW companies only
// Then merges results into existing phase2 outputs and regenerates phase3-companies.json
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Anthropic = require('@anthropic-ai/sdk');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');
const INPUT_FILE = path.join(dataDir, 'overflow-phase2-companies.json');
const PROGRESS_FILE = path.join(dataDir, 'overflow-phase2-progress.json');
const OUTPUT_FILE = path.join(dataDir, 'overflow-phase2-scored.json');

const BATCH_SIZE = 25;
const CONCURRENCY = 5;
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
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error(`  Batch ${batchIndex + 1}: No JSON array found`);
    return companies.map(c => ({
      company: c.company, score: 0, category: 'parse_error', reasoning: 'No JSON array in AI response',
    }));
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    let partial = jsonMatch[0];
    const lastCompleteObj = partial.lastIndexOf('},');
    if (lastCompleteObj > 0) {
      partial = partial.substring(0, lastCompleteObj + 1) + ']';
      try {
        const partialResults = JSON.parse(partial);
        console.warn(`  Batch ${batchIndex + 1}: Salvaged ${partialResults.length}/${companies.length} from truncated JSON`);
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
      company: c.company, score: 0, category: 'parse_error', reasoning: 'JSON parse error',
    }));
  }
}

async function main() {
  const companies = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  PHASE 2 (OVERFLOW): Claude AI Company Scoring`);
  console.log(`  ${companies.length} NEW companies to score`);
  console.log(`  Batch size: ${BATCH_SIZE} | Concurrency: ${CONCURRENCY}`);
  console.log(`${'='.repeat(60)}\n`);

  // Load progress
  let progressData = { completed: 0 };
  let allResults = [];
  if (fs.existsSync(PROGRESS_FILE)) {
    progressData = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
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

      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ completed: processedCount }));
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));

      const elapsed = (Date.now() - startTime) / 1000;
      const remainingCount = companies.length - processedCount;
      const eta = remainingCount > 0 ? Math.round(remainingCount / (processedCount / elapsed)) : 0;

      console.log(` done (${processedCount}/${companies.length}, ~${eta}s remaining)`);
    } catch (err) {
      console.error(` ERROR: ${err.message}`);
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ completed: processedCount }));
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));
      console.log(`  Saved progress at ${processedCount} companies. Re-run to resume.`);
      process.exit(1);
    }
  }

  // === MERGE WITH EXISTING PHASE 2 RESULTS ===
  console.log(`\n  Merging with existing Phase 2 results...`);

  const existingScored = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase2-scored.json'), 'utf-8'));
  const mergedScored = [...existingScored, ...allResults];
  fs.writeFileSync(path.join(dataDir, 'phase2-scored.json'), JSON.stringify(mergedScored, null, 2));
  console.log(`  Phase 2 scored: ${mergedScored.length} total (was ${existingScored.length}, +${allResults.length})`);

  // Merge company lists
  const existingP2Companies = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase2-companies.json'), 'utf-8'));
  const mergedP2Companies = [...existingP2Companies, ...companies];
  fs.writeFileSync(path.join(dataDir, 'phase2-companies.json'), JSON.stringify(mergedP2Companies, null, 2));

  // Rebuild Phase 3 companies list (score >= 5)
  const scoreMap = new Map();
  for (const result of mergedScored) {
    scoreMap.set(result.company, result);
  }

  const qualifiedLeads = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase1-qualified.json'), 'utf-8'));

  // Find NEW companies that qualify for Phase 3
  const existingP3 = JSON.parse(fs.readFileSync(path.join(dataDir, 'phase3-companies.json'), 'utf-8'));
  const existingP3Names = new Set(existingP3.map(c => c.company));

  const newP3Companies = [];
  for (const result of allResults) {
    if (result.score >= 5 && !existingP3Names.has(result.company)) {
      const leads = qualifiedLeads.filter(l => l.company === result.company);
      newP3Companies.push({
        company: result.company,
        aiScore: result.score,
        aiCategory: result.category,
        aiReasoning: result.reasoning,
        leadCount: leads.length,
        sampleLeads: leads.slice(0, 3).map(l => ({ name: `${l.firstName} ${l.lastName}`, title: l.title })),
        states: [...new Set(leads.map(l => l.state))],
      });
    }
  }

  // Append new companies to Phase 3 list
  const updatedP3 = [...existingP3, ...newP3Companies].sort((a, b) => b.aiScore - a.aiScore);
  fs.writeFileSync(path.join(dataDir, 'phase3-companies.json'), JSON.stringify(updatedP3, null, 2));

  // Score distribution for new companies
  const scoreDist = {};
  for (const r of allResults) {
    const bucket = r.score >= 9 ? '9-10' : r.score >= 7 ? '7-8' : r.score >= 5 ? '5-6' : r.score >= 3 ? '3-4' : '1-2';
    scoreDist[bucket] = (scoreDist[bucket] || 0) + 1;
  }

  console.log('\n  New Company AI Score Distribution:');
  for (const [bucket, count] of Object.entries(scoreDist).sort()) {
    console.log(`    ${bucket}: ${count}`);
  }

  console.log(`\n  NEW Phase 3 companies: ${newP3Companies.length}`);
  console.log(`  Total Phase 3 companies: ${updatedP3.length} (was ${existingP3.length})`);

  // Cleanup
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  console.log(`\n  Done! Phase 3 will need to re-run to pick up ${newP3Companies.length} new companies.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
