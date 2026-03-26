// Rescore gatekeepers — evaluate as referral partners, not direct investors
// Tags: "gatekeeper", "referral_partner", "allocator_advisor", "not_useful"
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Anthropic = require('@anthropic-ai/sdk');

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');
const INPUT_FILE = path.join(dataDir, 'gatekeepers-to-rescore.json');
const PROGRESS_FILE = path.join(dataDir, 'gatekeeper-rescore-progress.json');
const OUTPUT_FILE = path.join(dataDir, 'gatekeepers-scored.json');

const BATCH_SIZE = 30;
const CONCURRENCY = 5;
const client = new Anthropic();

const SYSTEM_PROMPT = `You are evaluating companies as REFERRAL PARTNERS or GATEKEEPERS for Granite Park Capital, a $100M affordable housing Build-to-Rent (BTR) real estate fund.

These companies are NOT direct investors. Instead, they may be able to REFER family offices and UHNW investors to the fund. Your job is to score how valuable each company would be as a referral source or distribution partner.

Fund context:
- $100M BTR affordable housing fund
- Target LPs: family offices, UHNW individuals, institutional allocators
- $250K minimum, sweet spot $1M-$20M
- 506(c) offering — can publicly solicit but must verify accredited status

Score each company on GATEKEEPER VALUE (1-10):

HIGH VALUE (8-10):
- Multi-family offices (MFOs) that advise multiple family offices on allocations
- OCIO / outsourced CIO firms that make allocation decisions for clients
- Placement agents or capital raising firms focused on real estate funds
- Wealth advisors specifically serving UHNW clients who invest in RE
- Investment consultants who advise on alternative/RE allocations
- RIA firms with $1B+ AUM serving institutional or UHNW clients
- Fund of funds that allocate to RE funds
- Family office networks or associations (access to many FOs at once)

MODERATE VALUE (5-7):
- General wealth advisors serving HNW clients (not necessarily UHNW)
- Real estate brokers/advisors who know RE investors
- Investment advisory firms with alternatives practice
- Financial planning firms serving affluent clients
- Institutional consulting firms
- Family office service providers (accounting, legal, admin)

LOW VALUE (1-4):
- Generic tax/accounting firms with no clear FO/RE connection
- Insurance brokers
- Conference/event companies (one-time exposure, not ongoing referrals)
- Compliance-only firms
- Retail financial advisors
- Companies with no clear path to introducing LP investors

For each company, respond with ONLY a JSON array:
{
  "company": "exact company name",
  "gatekeeperScore": 1-10,
  "gatekeeperType": "mfo" | "ocio" | "placement_agent" | "wealth_advisor_uhnw" | "wealth_advisor_hnw" | "investment_consultant" | "ria" | "fo_network" | "re_broker" | "fo_services" | "fund_of_funds" | "conference" | "legal" | "accounting" | "not_useful",
  "referralPotential": "high" | "medium" | "low" | "none",
  "reasoning": "one sentence why"
}`;

async function scoreBatch(companies, batchIndex, totalBatches) {
  const companyList = companies.map((c, i) => {
    return `${i + 1}. "${c.company}" (original category: ${c.originalCategory}, FO/RE signals: ${c.foConnection.slice(0, 3).join(', ')})`;
  }).join('\n');

  const userPrompt = `Score these ${companies.length} companies as potential REFERRAL PARTNERS (batch ${batchIndex + 1}/${totalBatches}):\n\n${companyList}\n\nIMPORTANT: Return ONLY a raw JSON array. No markdown code blocks. No backticks. Just the raw [ ... ] array.`;

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
    return companies.map(c => ({
      company: c.company, gatekeeperScore: 0, gatekeeperType: 'parse_error',
      referralPotential: 'none', reasoning: 'No JSON in response',
    }));
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    let partial = jsonMatch[0];
    const lastObj = partial.lastIndexOf('},');
    if (lastObj > 0) {
      partial = partial.substring(0, lastObj + 1) + ']';
      try {
        const partialResults = JSON.parse(partial);
        const scored = new Set(partialResults.map(r => r.company));
        for (const c of companies) {
          if (!scored.has(c.company)) {
            partialResults.push({ company: c.company, gatekeeperScore: 0, gatekeeperType: 'parse_error', referralPotential: 'none', reasoning: 'Truncated' });
          }
        }
        return partialResults;
      } catch (e2) { /* fall through */ }
    }
    return companies.map(c => ({
      company: c.company, gatekeeperScore: 0, gatekeeperType: 'parse_error',
      referralPotential: 'none', reasoning: 'JSON parse error',
    }));
  }
}

async function main() {
  const companies = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  GATEKEEPER RESCORING`);
  console.log(`  ${companies.length} companies to evaluate as referral partners`);
  console.log(`  Batch size: ${BATCH_SIZE} | Concurrency: ${CONCURRENCY}`);
  console.log(`${'='.repeat(60)}\n`);

  let progressData = { completed: 0 };
  let allResults = [];
  if (fs.existsSync(PROGRESS_FILE)) {
    progressData = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    if (fs.existsSync(OUTPUT_FILE)) {
      allResults = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
    }
    console.log(`  Resuming from ${progressData.completed} (${allResults.length} results loaded)\n`);
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
      const eta = remainingCount > 0 ? Math.round(remainingCount / ((processedCount - progressData.completed) / elapsed)) : 0;
      console.log(` done (${processedCount}/${companies.length}, ~${eta}s remaining)`);
    } catch (err) {
      console.error(` ERROR: ${err.message}`);
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ completed: processedCount }));
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));
      console.log(`  Saved progress at ${processedCount}. Re-run to resume.`);
      process.exit(1);
    }
  }

  // === RESULTS ===
  console.log(`\n${'='.repeat(60)}`);
  console.log('  GATEKEEPER RESULTS');
  console.log(`${'='.repeat(60)}\n`);

  const scoreDist = { '8-10': 0, '5-7': 0, '1-4': 0 };
  for (const r of allResults) {
    const s = r.gatekeeperScore || 0;
    if (s >= 8) scoreDist['8-10']++;
    else if (s >= 5) scoreDist['5-7']++;
    else scoreDist['1-4']++;
  }
  console.log('  Gatekeeper Score Distribution:', scoreDist);

  const byType = {};
  for (const r of allResults) {
    byType[r.gatekeeperType] = (byType[r.gatekeeperType] || 0) + 1;
  }
  console.log('\n  By Type:');
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    console.log(`    ${t}: ${c}`);
  });

  const byPotential = {};
  for (const r of allResults) {
    byPotential[r.referralPotential] = (byPotential[r.referralPotential] || 0) + 1;
  }
  console.log('\n  By Referral Potential:', byPotential);

  // Top gatekeepers
  const topGatekeepers = allResults.filter(r => (r.gatekeeperScore || 0) >= 7).sort((a, b) => b.gatekeeperScore - a.gatekeeperScore);
  console.log(`\n  Top gatekeepers (score >= 7): ${topGatekeepers.length}`);
  topGatekeepers.slice(0, 15).forEach(g => {
    console.log(`    [${g.gatekeeperScore}] ${g.company} (${g.gatekeeperType}) — ${g.reasoning}`);
  });

  // Save final tagged list
  const taggedPath = path.join(dataDir, 'gatekeepers-final.json');
  fs.writeFileSync(taggedPath, JSON.stringify(allResults.sort((a, b) => (b.gatekeeperScore || 0) - (a.gatekeeperScore || 0)), null, 2));
  console.log(`\n  Saved: ${taggedPath}`);

  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  console.log('  Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
