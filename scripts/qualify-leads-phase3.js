// Phase 3: Web research — find company websites, analyze content, Claude re-scores
// Supports two modes:
//   1. SERPER_API_KEY in .env → uses Google Search API (2,500 free queries at serper.dev)
//   2. No API key → domain guessing + direct website scraping
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Anthropic = require('@anthropic-ai/sdk');
const cheerio = require('cheerio');
const axios = require('axios');
const dns = require('dns');
const { promisify } = require('util');

const dnsResolve = promisify(dns.resolve);

const dataDir = path.join(__dirname, '..', 'data', 'family-office-scrape');
const INPUT_FILE = path.join(dataDir, 'phase3-companies.json');
const OUTPUT_FILE = path.join(dataDir, 'phase3-researched.json');
const PROGRESS_FILE = path.join(dataDir, 'phase3-progress.json');

const CONCURRENCY = 3;
const SEARCH_DELAY_MS = 800;
const WEBSITE_TIMEOUT_MS = 8000;
const MAX_WEBSITE_CHARS = 3000;

const SERPER_API_KEY = process.env.SERPER_API_KEY || null;
const client = new Anthropic();

const SYSTEM_PROMPT = `You are a research analyst validating whether a company is a good fit as an LP investor for Granite Park Capital, a $100M affordable housing Build-to-Rent (BTR) real estate fund.

Fund: $100M target, affordable/workforce housing BTR, 8% pref, 19.2% IRR, $250K min, $1M-$20M sweet spot.

You are given the company name, initial AI assessment, and either Google search results or website content.

Based on the web evidence, provide a FINAL score and assessment.

SCORING:
- Web CONFIRMS company invests in real estate → 8-10
- Family office with diversified investments including RE → 7-8
- Legitimate family office or investment firm, no clear RE focus → 5-7
- NOT an investment firm (tech, services, etc.) → 1-3
- No useful web results → keep original score, note "unverified"
- Defunct or no web presence → 2-3

Respond with ONLY a JSON object (no markdown):
{
  "company": "exact company name",
  "webScore": 1-10,
  "webCategory": "confirmed_re_fo" | "confirmed_fo" | "confirmed_re_investor" | "confirmed_investor" | "unverified_likely" | "unverified_possible" | "not_investor" | "defunct",
  "website": "URL or null",
  "webEvidence": "1-2 sentence summary",
  "investmentFocus": "what they invest in or null",
  "estimatedAUM": "if mentioned or null"
}`;

// ══════════════════════════════════════════════════════════
// SEARCH STRATEGIES
// ══════════════════════════════════════════════════════════

async function searchSerper(query) {
  const response = await axios.post('https://google.serper.dev/search', {
    q: query,
    num: 5,
  }, {
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  const organic = response.data.organic || [];
  return organic.slice(0, 5).map(r => ({
    title: r.title,
    url: r.link,
    description: r.snippet || '',
  }));
}

function companyToDomains(companyName) {
  // Strip common suffixes
  const clean = companyName
    .replace(/\s*[-—–].*$/, '') // remove everything after dash
    .replace(/\s*(LLC|Inc\.?|Corp\.?|Ltd\.?|L\.?P\.?|LP|LLP|Co\.?|Group|Holdings?\s*$)/gi, '')
    .replace(/[,.'&]/g, '')
    .trim();

  const words = clean.split(/\s+/).filter(w => w.length > 0);
  const lower = words.map(w => w.toLowerCase());

  const domains = [];

  // Full name joined: vantageinvestmentpartners.com
  domains.push(lower.join('') + '.com');

  // With hyphens: vantage-investment-partners.com
  if (lower.length > 1) {
    domains.push(lower.join('-') + '.com');
  }

  // Initials: vip.com (skip — too generic for short ones)
  if (lower.length >= 3) {
    domains.push(lower.map(w => w[0]).join('') + 'capital.com');
    domains.push(lower.map(w => w[0]).join('') + '.com');
  }

  // First word + common suffixes
  if (lower.length >= 2) {
    domains.push(lower[0] + 'capital.com');
    domains.push(lower[0] + 'partners.com');
    domains.push(lower[0] + 'investments.com');
    domains.push(lower[0] + lower[1] + '.com');
  }

  // Abbreviations: drop generic words
  const meaningful = lower.filter(w =>
    !['the', 'of', 'and', 'group', 'management', 'advisors', 'advisory', 'investment', 'investments', 'capital', 'partners', 'family', 'office'].includes(w)
  );
  if (meaningful.length > 0 && meaningful.join('') !== lower.join('')) {
    domains.push(meaningful.join('') + '.com');
    if (meaningful.length > 1) {
      domains.push(meaningful.join('-') + '.com');
    }
  }

  // Deduplicate
  return [...new Set(domains)];
}

async function domainExists(domain) {
  try {
    await dnsResolve(domain);
    return true;
  } catch {
    return false;
  }
}

async function findCompanyWebsite(companyName) {
  const domains = companyToDomains(companyName);

  for (const domain of domains) {
    if (await domainExists(domain)) {
      return `https://${domain}`;
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════
// WEBSITE FETCHING
// ══════════════════════════════════════════════════════════

async function fetchWebsite(url) {
  try {
    const response = await axios.get(url, {
      timeout: WEBSITE_TIMEOUT_MS,
      maxRedirects: 3,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      maxContentLength: 500000,
    });

    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('text/html')) return null;

    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header, iframe, noscript').remove();

    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const h1 = $('h1').first().text().trim();
    const bodyText = $('main, article, .content, #content, body')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const combined = `Title: ${title}\nDescription: ${metaDesc}\nHeading: ${h1}\n\n${bodyText}`;
    return combined.substring(0, MAX_WEBSITE_CHARS);
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════
// RESEARCH ORCHESTRATION
// ══════════════════════════════════════════════════════════

async function researchCompany(company) {
  let searchContext = 'No search results available.';
  let websiteContent = null;
  let websiteUrl = null;

  if (SERPER_API_KEY) {
    // MODE 1: Google Search via Serper
    try {
      const cleanName = company.company
        .replace(/\s*(LLC|Inc\.?|Corp\.?|Ltd\.?|L\.?P\.?|LP|—.*$)/gi, '')
        .trim();
      const results = await searchSerper(`"${cleanName}" investment OR "family office" OR "real estate"`);

      if (results.length > 0) {
        searchContext = results.map((r, i) =>
          `${i + 1}. [${r.title}](${r.url})\n   ${r.description}`
        ).join('\n');

        // Find company website (skip aggregator sites)
        const companyWords = company.company.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const likelySite = results.find(r => {
          const u = r.url.toLowerCase();
          if (/linkedin|bloomberg|crunchbase|pitchbook|wikipedia|yelp|glassdoor|indeed|zoominfo|dnb|opencorporates/.test(u)) return false;
          return companyWords.some(w => u.includes(w));
        });

        if (likelySite) {
          websiteUrl = likelySite.url;
          websiteContent = await fetchWebsite(websiteUrl);
        }
      }
    } catch (err) {
      searchContext = `Search error: ${err.message}`;
    }
  } else {
    // MODE 2: Domain guessing + direct fetch
    websiteUrl = await findCompanyWebsite(company.company);
    if (websiteUrl) {
      websiteContent = await fetchWebsite(websiteUrl);
      if (websiteContent) {
        searchContext = `Found company website at ${websiteUrl}`;
      } else {
        // Website exists but couldn't fetch content
        searchContext = `Domain ${websiteUrl} resolves but content could not be fetched.`;
        websiteUrl = null;
      }
    } else {
      searchContext = 'No company website found via domain guessing.';
    }
  }

  // Ask Claude to analyze
  const userPrompt = `Company: "${company.company}"
Initial AI Score: ${company.aiScore}/10
Initial Category: ${company.aiCategory}
Initial Reasoning: ${company.aiReasoning}
Lead Count: ${company.leadCount}
States: ${company.states.join(', ')}
Sample Contacts: ${company.sampleLeads.map(l => `${l.name} (${l.title})`).join('; ')}

--- WEB EVIDENCE ---
${searchContext}

--- COMPANY WEBSITE CONTENT ---
${websiteContent || 'No website content available.'}

Based on all evidence, provide your final JSON assessment. Return ONLY raw JSON, no markdown.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text.trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return fallbackResult(company, 'No JSON in AI response');
  } catch (err) {
    return fallbackResult(company, `API error: ${err.message}`);
  }
}

function fallbackResult(company, reason) {
  return {
    company: company.company,
    webScore: company.aiScore,
    webCategory: 'unverified_possible',
    website: null,
    webEvidence: reason,
    investmentFocus: null,
    estimatedAUM: null,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

async function main() {
  const companies = require(INPUT_FILE);

  const mode = SERPER_API_KEY ? 'Google Search (Serper API)' : 'Domain Guessing (no API key)';
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  PHASE 3: Web Research & Company Validation');
  console.log(`  Mode: ${mode}`);
  console.log(`  ${companies.length} companies to research`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  if (!SERPER_API_KEY) {
    console.log('  TIP: Add SERPER_API_KEY to .env for Google Search (2,500 free at serper.dev)');
  }
  console.log(`${'═'.repeat(60)}\n`);

  // Load progress
  let allResults = [];
  let startIndex = 0;
  if (fs.existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    startIndex = progress.completed || 0;
    if (fs.existsSync(OUTPUT_FILE)) {
      allResults = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
    }
    console.log(`  Resuming from company ${startIndex} (${allResults.length} results loaded)\n`);
  }

  const remaining = companies.slice(startIndex);
  const startTime = Date.now();
  let processedCount = startIndex;

  // Process in waves
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const wave = remaining.slice(i, i + CONCURRENCY);

    const rangeStart = startIndex + i + 1;
    const rangeEnd = rangeStart + wave.length - 1;
    const names = wave.map(c => c.company.substring(0, 22)).join(' | ');
    process.stdout.write(`  [${rangeStart}-${rangeEnd}/${companies.length}] ${names}...`);

    try {
      const promises = wave.map((company, j) =>
        sleep(j * SEARCH_DELAY_MS).then(() => researchCompany(company))
      );
      const results = await Promise.all(promises);
      allResults.push(...results);

      processedCount += wave.length;

      // Save progress
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ completed: processedCount }));
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (processedCount - startIndex) / elapsed;
      const remainingCount = companies.length - processedCount;
      const eta = remainingCount > 0 ? Math.round(remainingCount / rate) : 0;
      const etaMin = Math.floor(eta / 60);
      const etaSec = eta % 60;

      const scores = results.map(r => r.webScore).join(',');
      const websites = results.filter(r => r.website).length;
      console.log(` [${scores}] ${websites > 0 ? `(${websites} site${websites > 1 ? 's' : ''})` : ''} ~${etaMin}m${etaSec}s`);
    } catch (err) {
      console.error(` ERROR: ${err.message}`);
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ completed: processedCount }));
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));
      console.log(`  Saved progress at ${processedCount}. Re-run to resume.`);
      process.exit(1);
    }
  }

  // ══════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  PHASE 3 RESULTS');
  console.log(`${'═'.repeat(60)}\n`);

  const scoreDist = {};
  for (const r of allResults) {
    const bucket = r.webScore >= 9 ? '9-10 (Confirmed strong)' :
                   r.webScore >= 7 ? '7-8 (Confirmed likely)' :
                   r.webScore >= 5 ? '5-6 (Possible fit)' :
                   r.webScore >= 3 ? '3-4 (Unlikely)' :
                   '1-2 (Bad fit)';
    scoreDist[bucket] = (scoreDist[bucket] || 0) + 1;
  }

  console.log('  Web Research Score Distribution:');
  for (const [bucket, count] of Object.entries(scoreDist).sort()) {
    console.log(`    ${bucket}: ${count}`);
  }

  const catDist = {};
  for (const r of allResults) {
    catDist[r.webCategory] = (catDist[r.webCategory] || 0) + 1;
  }
  console.log('\n  Category Distribution:');
  for (const [cat, count] of Object.entries(catDist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count}`);
  }

  const withWebsite = allResults.filter(r => r.website).length;
  console.log(`\n  Websites found: ${withWebsite}/${allResults.length}`);

  // Score changes from Phase 2
  const inputMap = new Map(companies.map(c => [c.company, c.aiScore]));
  let promoted = 0, demoted = 0, unchanged = 0;
  for (const r of allResults) {
    const original = inputMap.get(r.company) || 0;
    if (r.webScore > original) promoted++;
    else if (r.webScore < original) demoted++;
    else unchanged++;
  }
  console.log(`\n  Score changes vs Phase 2:`);
  console.log(`    Promoted: ${promoted} | Demoted: ${demoted} | Unchanged: ${unchanged}`);

  // ══════════════════════════════════════════════════════════
  // MERGE WITH LEADS → FINAL OUTPUT
  // ══════════════════════════════════════════════════════════
  const scoredLeads = require(path.join(dataDir, 'phase2-scored-leads.json'));
  const webMap = new Map(allResults.map(r => [r.company, r]));

  const finalLeads = scoredLeads.map(lead => {
    const webResult = webMap.get(lead.company);
    if (webResult) {
      return {
        ...lead,
        webScore: webResult.webScore,
        webCategory: webResult.webCategory,
        website: webResult.website,
        webEvidence: webResult.webEvidence,
        investmentFocus: webResult.investmentFocus,
        estimatedAUM: webResult.estimatedAUM,
        finalScore: (lead.totalScore || 0) + (webResult.webScore * 5),
      };
    }
    return {
      ...lead,
      webScore: null,
      webCategory: null,
      website: null,
      webEvidence: null,
      investmentFocus: null,
      estimatedAUM: null,
      finalScore: lead.combinedScore || 0,
    };
  });

  finalLeads.sort((a, b) => b.finalScore - a.finalScore);

  const finalPath = path.join(dataDir, 'phase3-final-leads.json');
  fs.writeFileSync(finalPath, JSON.stringify(finalLeads, null, 2));
  console.log(`\n  Saved: ${finalPath} (${finalLeads.length} leads)`);

  // Top leads for enrichment (web score >= 7 OR ai score >= 7 if no web research)
  const topLeads = finalLeads.filter(l => (l.webScore || l.aiScore || 0) >= 7);
  const topPath = path.join(dataDir, 'enrichment-candidates.json');
  fs.writeFileSync(topPath, JSON.stringify(topLeads, null, 2));
  const topCos = new Set(topLeads.map(l => l.company));
  console.log(`  Saved: ${topPath} (${topLeads.length} leads / ${topCos.size} companies — ready for PDL/Hunter)`);

  // Top 20 preview
  console.log('\n  TOP 20 LEADS:');
  for (const lead of finalLeads.slice(0, 20)) {
    const ws = lead.webScore ? `web:${lead.webScore}` : `ai:${lead.aiScore}`;
    console.log(`    [${lead.finalScore}] ${lead.firstName} ${lead.lastName} | ${lead.title} @ ${lead.company} (${ws})`);
  }

  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  console.log(`\n  Done! Researched ${allResults.length} companies.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
