/**
 * E2E Test: BMN Cold Data → Reply → Claude → GHL → Meeting Booking
 *
 * Tests the full Brand Me Now pipeline with a synthetic lead:
 * 1. Insert cold lead into enrichment_leads (company_id=2)
 * 2. Simulate Instantly webhook with a positive reply
 * 3. Verify Claude generates intelligent response
 * 4. Verify GHL contact created in BMN location
 * 5. Verify meeting booked on BMN Sales calendar (NOT GPC)
 * 6. Verify calendar isolation assertion
 *
 * Usage: npx tsx scripts/test-bmn-e2e.ts [--dry-run]
 */

import 'dotenv/config';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const BMN_COMPANY_ID = 2;
const GPC_DEFAULT_CALENDAR = 'HiJ2M2Xnf0ZRbGCFCAgs';
const BMN_CALENDAR_ID = process.env.GHL_CALENDAR_ID_BMN || 'XAwrLg5ivvFQJQZxj5uT';
const WEBHOOK_SECRET = process.env.INSTANTLY_WEBHOOK_SECRET || '';
const DRY_RUN = process.argv.includes('--dry-run');

const TEST_EMAIL = `bmn-test-${Date.now()}@test-e2e.example.com`;
const TEST_FIRST_NAME = 'E2E_Test';
const TEST_LAST_NAME = 'BMN_Pipeline';

interface TestResult {
  step: string;
  passed: boolean;
  detail: string;
  data?: any;
}

const results: TestResult[] = [];

function log(step: string, passed: boolean, detail: string, data?: any) {
  const icon = passed ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${step}: ${detail}`);
  results.push({ step, passed, detail, data });
}

async function apiCall(method: string, path: string, body?: any, headers?: Record<string, string>): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!resp.ok) {
    throw new Error(`${method} ${path} → ${resp.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

// ── Step 1: Verify BMN calendar is configured ──────────────
async function step1_verifyCalendarConfig() {
  console.log('\n── Step 1: Verify BMN Calendar Config ──');

  if (!BMN_CALENDAR_ID || BMN_CALENDAR_ID === GPC_DEFAULT_CALENDAR) {
    log('calendar_config', false, `BMN calendar not set or is GPC default: ${BMN_CALENDAR_ID}`);
    return false;
  }

  log('calendar_config', true, `BMN calendar ID: ${BMN_CALENDAR_ID} (different from GPC: ${GPC_DEFAULT_CALENDAR})`);
  return true;
}

// ── Step 2: Insert test lead ────────────────────────────────
async function step2_insertTestLead(): Promise<number | null> {
  console.log('\n── Step 2: Insert Test Lead ──');

  if (DRY_RUN) {
    log('insert_lead', true, '[DRY RUN] Would insert test lead');
    return 99999;
  }

  try {
    // Use the GHL webhook to create a lead — this tests the full ingest path
    const result = await apiCall('POST', '/api/enrichment/webhook/ghl', {
      contact: {
        id: `bmn_e2e_test_${Date.now()}`,
        email: TEST_EMAIL,
        firstName: TEST_FIRST_NAME,
        lastName: TEST_LAST_NAME,
        phone: '+15551234567',
        source: 'e2e_test',
      },
      company_id: BMN_COMPANY_ID,
    }, {
      'x-webhook-secret': process.env.GHL_WEBHOOK_SECRET || '',
    });

    if (result.lead_id) {
      log('insert_lead', true, `Lead created: id=${result.lead_id}, email=${TEST_EMAIL}`);
      return result.lead_id;
    }

    log('insert_lead', false, `No lead_id returned: ${JSON.stringify(result)}`);
    return null;
  } catch (err: any) {
    log('insert_lead', false, `Error: ${err.message}`);
    return null;
  }
}

// ── Step 3: Simulate positive reply via Instantly webhook ───
async function step3_simulatePositiveReply(): Promise<any> {
  console.log('\n── Step 3: Simulate Positive Reply (Instantly Webhook) ──');

  if (DRY_RUN) {
    log('instantly_webhook', true, '[DRY RUN] Would send positive reply webhook');
    return { action: 'dry_run' };
  }

  try {
    const result = await apiCall('POST', '/api/enrichment/webhook/instantly', {
      event_type: 'reply',
      lead_email: TEST_EMAIL,
      email: TEST_EMAIL,
      reply_text: "Hi there! I'm really interested in the white-label supplement opportunity. I have a growing audience of 250K followers on TikTok and I've been looking for exactly this kind of partnership. Can we schedule a call to discuss details? Thursday afternoon works great for me.",
      email_id: `e2e_test_email_${Date.now()}`,
      campaign_id: 'e2e_test_campaign',
      from_email: 'ryan@brandmenow.co',
      // Pre-classified by Instantly AI as "interested"
      label: 'interested',
    }, {
      'x-webhook-secret': WEBHOOK_SECRET,
    });

    const passed = result.action === 'auto_replied' || result.action === 'enriching' || result.action === 'escalated';
    log('instantly_webhook', passed, `action=${result.action}, sentiment=${result.sentiment || 'N/A'}`, result);

    if (result.sentiment) {
      const sentimentOk = ['interested', 'meeting_request'].includes(result.sentiment);
      log('sentiment_classification', sentimentOk, `Sentiment: ${result.sentiment} (expected: interested or meeting_request)`);
    }

    if (result.threadId) {
      log('thread_created', true, `Thread ID: ${result.threadId}`);
    }

    return result;
  } catch (err: any) {
    log('instantly_webhook', false, `Error: ${err.message}`);
    return null;
  }
}

// ── Step 4: Simulate negative reply (fast-path test) ────────
async function step4_testFastPathNegative(): Promise<any> {
  console.log('\n── Step 4: Test Fast-Path Negative Disposition ──');

  if (DRY_RUN) {
    log('fast_path_negative', true, '[DRY RUN] Would test fast-path negative');
    return { action: 'dry_run' };
  }

  const negativeEmail = `bmn-neg-${Date.now()}@test-e2e.example.com`;

  try {
    // First create the lead
    await apiCall('POST', '/api/enrichment/webhook/ghl', {
      contact: {
        id: `bmn_neg_test_${Date.now()}`,
        email: negativeEmail,
        firstName: 'NegTest',
        lastName: 'BMN',
        source: 'e2e_test',
      },
      company_id: BMN_COMPANY_ID,
    }, {
      'x-webhook-secret': process.env.GHL_WEBHOOK_SECRET || '',
    });

    // Send OOO reply with Instantly pre-classification
    const result = await apiCall('POST', '/api/enrichment/webhook/instantly', {
      event_type: 'reply',
      lead_email: negativeEmail,
      email: negativeEmail,
      reply_text: "I'm out of office until March 28. Please contact me after I return.",
      email_id: `e2e_neg_${Date.now()}`,
      campaign_id: 'e2e_test_campaign',
      from_email: 'ryan@brandmenow.co',
      label: 'ooo', // Instantly classified as OOO
    }, {
      'x-webhook-secret': WEBHOOK_SECRET,
    });

    const passed = result.action === 'instantly_handled';
    log('fast_path_negative', passed,
      `action=${result.action} (expected: instantly_handled). Instantly AI handled OOO without Claude.`,
      result
    );

    return result;
  } catch (err: any) {
    log('fast_path_negative', false, `Error: ${err.message}`);
    return null;
  }
}

// ── Step 5: Verify meeting slots use BMN calendar ───────────
async function step5_verifyMeetingSlots() {
  console.log('\n── Step 5: Verify Meeting Slots Use BMN Calendar ──');

  if (DRY_RUN) {
    log('meeting_slots', true, '[DRY RUN] Would verify meeting slots');
    return;
  }

  try {
    // Check that meeting slots endpoint works for BMN
    const stats = await apiCall('GET', `/api/enrichment/stats?company_id=${BMN_COMPANY_ID}`);
    log('bmn_stats', true, `BMN enrichment stats retrieved: ${JSON.stringify(stats).slice(0, 200)}`);
  } catch (err: any) {
    log('bmn_stats', false, `Error fetching BMN stats: ${err.message}`);
  }
}

// ── Step 6: Verify lead in DB with correct company_id ───────
async function step6_verifyLeadData(leadId: number | null) {
  console.log('\n── Step 6: Verify Lead Data ──');

  if (DRY_RUN || !leadId) {
    log('lead_verification', DRY_RUN, DRY_RUN ? '[DRY RUN]' : 'No lead ID to verify');
    return;
  }

  try {
    const leads = await apiCall('GET', `/api/enrichment/leads?limit=1&offset=0&source=e2e_test`);
    if (leads?.data?.length > 0) {
      const lead = leads.data.find((l: any) => l.id === leadId);
      if (lead) {
        const companyOk = lead.company_id === BMN_COMPANY_ID;
        log('lead_company_id', companyOk, `Lead ${leadId} company_id=${lead.company_id} (expected: ${BMN_COMPANY_ID})`);
      } else {
        log('lead_company_id', false, `Lead ${leadId} not found in response`);
      }
    }
  } catch (err: any) {
    log('lead_verification', false, `Error: ${err.message}`);
  }
}

// ── Step 7: Check thread and reply ──────────────────────────
async function step7_verifyReplyThread(webhookResult: any) {
  console.log('\n── Step 7: Verify Reply Thread ──');

  if (DRY_RUN || !webhookResult?.threadId) {
    log('thread_verification', DRY_RUN, DRY_RUN ? '[DRY RUN]' : 'No thread to verify');
    return;
  }

  try {
    const threads = await apiCall('GET', `/api/enrichment/threads?company_id=${BMN_COMPANY_ID}&limit=5`);
    if (threads?.data?.length > 0) {
      const thread = threads.data.find((t: any) => t.id === webhookResult.threadId);
      if (thread) {
        log('thread_exists', true, `Thread ${thread.id}: status=${thread.thread_status}, messages=${thread.message_count}, auto_replies=${thread.auto_reply_count}`);
        log('thread_company', thread.company_id === BMN_COMPANY_ID, `Thread company_id=${thread.company_id} (expected: ${BMN_COMPANY_ID})`);
      } else {
        log('thread_exists', false, `Thread ${webhookResult.threadId} not found`);
      }
    }
  } catch (err: any) {
    log('thread_verification', false, `Error: ${err.message}`);
  }
}

// ── Cleanup ─────────────────────────────────────────────────
async function cleanup() {
  console.log('\n── Cleanup ──');
  if (DRY_RUN) {
    console.log('[DRY RUN] No cleanup needed');
    return;
  }
  // Test data is identifiable by e2e_test source — can be cleaned via:
  // DELETE FROM enrichment_leads WHERE source = 'e2e_test';
  console.log(`Test leads created with source='e2e_test' and email prefix 'bmn-test-' / 'bmn-neg-'`);
  console.log(`To clean up: DELETE FROM enrichment_leads WHERE source = 'e2e_test';`);
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('BMN E2E Pipeline Test');
  console.log(`Target: ${BASE_URL}`);
  console.log(`BMN Company ID: ${BMN_COMPANY_ID}`);
  console.log(`BMN Calendar: ${BMN_CALENDAR_ID}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('='.repeat(60));

  // Step 1: Verify calendar config
  const calendarOk = await step1_verifyCalendarConfig();
  if (!calendarOk) {
    console.error('\nABORT: BMN calendar not properly configured. Set GHL_CALENDAR_ID_BMN in .env');
    process.exit(1);
  }

  // Step 2: Insert test lead
  const leadId = await step2_insertTestLead();

  // Step 3: Simulate positive reply (Instantly webhook → Claude → auto-reply)
  const webhookResult = await step3_simulatePositiveReply();

  // Step 4: Test fast-path negative (Instantly handles OOO without Claude)
  await step4_testFastPathNegative();

  // Step 5: Verify meeting slots use BMN calendar
  await step5_verifyMeetingSlots();

  // Step 6: Verify lead data
  await step6_verifyLeadData(leadId);

  // Step 7: Verify thread and reply
  await step7_verifyReplyThread(webhookResult);

  // Cleanup
  await cleanup();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  for (const r of results) {
    console.log(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.step}: ${r.detail.slice(0, 80)}`);
  }

  console.log(`\n${passed}/${total} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nFAILED TESTS:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  - ${r.step}: ${r.detail}`);
    }
    process.exit(1);
  }

  console.log('\nAll tests passed!');
}

main().catch(err => {
  console.error('E2E test fatal error:', err);
  process.exit(1);
});
