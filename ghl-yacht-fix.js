/**
 * ghl-yacht-fix.js — Fix yacht mixer check-in contacts + audit attended stage
 *
 * 1. Finds contacts showing as "Yacht Mixer Check In" instead of real names
 * 2. Extracts real names from notes/form data and updates contacts
 * 3. Ensures form data (investor type, company) is on the contact card
 * 4. Audits the Attended stage for workflow/sequence info
 */

const https = require('https');

const API_KEY = 'pit-2e8c771d-5817-4826-94ee-285cada31671';
const LOCATION_ID = 'x8XBOACL6wOFcsQewWPw';
const PIPELINE_ID = 'GMqxElyHPSr2karweCGS';
const ATTENDED_STAGE = '7bff2aff-62ef-46aa-b1bb-1ed7c9c8d08c';
const BASE = 'services.leadconnectorhq.com';

function ghlRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== GHL YACHT MIXER FIX & AUDIT ===\n');

  // ── Step 1: Fetch pipeline stages ──
  console.log('1. Fetching pipeline info...');
  const pipelineData = await ghlRequest('GET',
    `/opportunities/pipelines?locationId=${LOCATION_ID}`);
  const pipelines = pipelineData.pipelines || [];
  const eventPipeline = pipelines.find(p => p.id === PIPELINE_ID);

  if (eventPipeline) {
    console.log(`   Pipeline: ${eventPipeline.name}`);
    console.log(`   Stages:`);
    for (const s of eventPipeline.stages || []) {
      console.log(`     - ${s.name} (${s.id})${s.id === ATTENDED_STAGE ? ' ← ATTENDED' : ''}`);
    }
  } else {
    console.log('   Event pipeline not found. Listing all pipelines:');
    for (const p of pipelines) {
      console.log(`   - ${p.name} (${p.id})`);
      for (const s of p.stages || []) {
        console.log(`     - ${s.name} (${s.id})`);
      }
    }
  }

  // ── Step 2: Fetch all opportunities in pipeline ──
  console.log('\n2. Fetching opportunities from Event Pipeline...');
  const oppsData = await ghlRequest('GET',
    `/opportunities/search?location_id=${LOCATION_ID}&pipeline_id=${PIPELINE_ID}&limit=100`);
  const allOpps = oppsData.opportunities || [];
  console.log(`   Total opportunities: ${allOpps.length}`);

  // Group by stage
  const byStage = {};
  for (const opp of allOpps) {
    const stageId = opp.pipelineStageId || opp.stageId;
    if (!byStage[stageId]) byStage[stageId] = [];
    byStage[stageId].push(opp);
  }

  for (const [stageId, opps] of Object.entries(byStage)) {
    const stageName = eventPipeline?.stages?.find(s => s.id === stageId)?.name || stageId;
    console.log(`   ${stageName}: ${opps.length} contacts`);
  }

  // ── Step 3: Identify contacts with wrong names ──
  const attendedOpps = byStage[ATTENDED_STAGE] || [];
  console.log(`\n3. Contacts in ATTENDED stage: ${attendedOpps.length}`);

  const contactsToFix = [];
  const allAttendedContacts = [];

  for (const opp of attendedOpps) {
    const contactId = opp.contact?.id || opp.contactId;
    if (!contactId) {
      console.log(`   WARN: Opportunity ${opp.id} has no contactId`);
      continue;
    }

    await sleep(200); // Rate limit
    const contact = await ghlRequest('GET', `/contacts/${contactId}`);
    const c = contact.contact || contact;

    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim();
    const nameLC = fullName.toLowerCase();
    const isWrongName = nameLC.includes('yacht') ||
                        nameLC.includes('mixer') ||
                        nameLC.includes('check') ||
                        nameLC === '' ||
                        nameLC === 'undefined undefined';

    allAttendedContacts.push({
      id: c.id,
      name: fullName,
      email: c.email,
      phone: c.phone,
      company: c.companyName,
      tags: c.tags || [],
      customFields: c.customField || c.customFields || [],
      source: c.source,
      oppName: opp.name,
      oppId: opp.id,
      isWrongName,
    });

    const marker = isWrongName ? ' *** NEEDS FIX ***' : '';
    console.log(`   - ${fullName || '(no name)'} | ${c.email || '(no email)'} | ${c.phone || '(no phone)'}${marker}`);

    if (isWrongName) {
      contactsToFix.push({ contact: c, opp });
    }
  }

  // ── Step 4: Fix wrong names using notes data ──
  if (contactsToFix.length > 0) {
    console.log(`\n4. Fixing ${contactsToFix.length} contacts with wrong names...`);

    for (const { contact: c, opp } of contactsToFix) {
      await sleep(200);
      const notesData = await ghlRequest('GET', `/contacts/${c.id}/notes`);
      const notes = notesData.notes || [];

      let realFirstName = null;
      let realLastName = null;
      let investorType = null;
      let company = null;

      // Try to extract real name from notes
      for (const note of notes) {
        const body = note.body || '';

        // Look for "Yacht Check-In" note format
        const investorMatch = body.match(/Investor Type:\s*(.+)/i);
        const companyMatch = body.match(/Company:\s*(.+)/i);

        if (investorMatch) investorType = investorMatch[1].trim();
        if (companyMatch && companyMatch[1].trim() !== 'N/A') company = companyMatch[1].trim();
      }

      // Try extracting name from the opportunity name (format: "FirstName LastName - Super Return Mixer")
      const oppNameMatch = (opp.name || '').match(/^(.+?)\s*-\s*Super Return Mixer/i);
      if (oppNameMatch) {
        const parts = oppNameMatch[1].trim().split(/\s+/);
        if (parts.length >= 2 && !parts[0].toLowerCase().includes('yacht')) {
          realFirstName = parts[0];
          realLastName = parts.slice(1).join(' ');
        }
      }

      // If opp name didn't help, try email-based name extraction
      if (!realFirstName && c.email) {
        const emailLocal = c.email.split('@')[0];
        const emailParts = emailLocal.split(/[._-]/);
        if (emailParts.length >= 2) {
          realFirstName = emailParts[0].charAt(0).toUpperCase() + emailParts[0].slice(1);
          realLastName = emailParts[1].charAt(0).toUpperCase() + emailParts[1].slice(1);
        }
      }

      console.log(`\n   Contact: ${c.id}`);
      console.log(`     Current name: "${c.firstName || ''} ${c.lastName || ''}"`);
      console.log(`     Email: ${c.email}`);
      console.log(`     Opp name: ${opp.name}`);
      console.log(`     Notes found: ${notes.length}`);
      if (notes.length > 0) {
        for (const n of notes) {
          console.log(`       Note: ${(n.body || '').substring(0, 150)}`);
        }
      }
      console.log(`     Extracted name: ${realFirstName || '?'} ${realLastName || '?'}`);
      console.log(`     Investor type: ${investorType || '(not found)'}`);
      console.log(`     Company: ${company || c.companyName || '(not found)'}`);

      // Build update payload
      const updates = {};
      if (realFirstName) updates.firstName = realFirstName;
      if (realLastName) updates.lastName = realLastName;
      if (company && !c.companyName) updates.companyName = company;

      if (Object.keys(updates).length > 0) {
        console.log(`     → Updating contact with:`, JSON.stringify(updates));
        await sleep(200);
        const result = await ghlRequest('PUT', `/contacts/${c.id}`, updates);
        console.log(`     → Result: ${result.contact ? 'SUCCESS' : JSON.stringify(result).substring(0, 200)}`);
      } else {
        console.log(`     → MANUAL FIX NEEDED: Could not determine real name from available data`);
      }
    }
  } else {
    console.log('\n4. No contacts with wrong names found.');
  }

  // ── Step 5: Ensure form data on contact cards ──
  console.log('\n5. Checking custom fields for form data (investor type, etc.)...');
  const customFieldsData = await ghlRequest('GET',
    `/locations/${LOCATION_ID}/customFields`);
  const customFields = customFieldsData.customFields || [];
  console.log(`   Existing custom fields: ${customFields.length}`);
  for (const cf of customFields) {
    console.log(`     - ${cf.name} (${cf.fieldKey}) [${cf.dataType}]`);
  }

  // Check if investor_type custom field exists
  let investorTypeCF = customFields.find(cf =>
    cf.name.toLowerCase().includes('investor') ||
    cf.fieldKey?.toLowerCase().includes('investor'));

  if (!investorTypeCF) {
    console.log('\n   Creating "Investor Type" custom field...');
    await sleep(200);
    investorTypeCF = await ghlRequest('POST',
      `/locations/${LOCATION_ID}/customFields`,
      { name: 'Investor Type', dataType: 'TEXT', placeholder: 'e.g. Accredited Investor' });
    console.log(`   Created: ${investorTypeCF?.customField?.id || JSON.stringify(investorTypeCF).substring(0, 200)}`);
  } else {
    console.log(`   ✓ Investor Type field exists: ${investorTypeCF.fieldKey}`);
  }

  // Check for event_attended custom field
  let eventAttendedCF = customFields.find(cf =>
    cf.name.toLowerCase().includes('event') && cf.name.toLowerCase().includes('attend'));

  if (!eventAttendedCF) {
    console.log('   Creating "Event Attended" custom field...');
    await sleep(200);
    eventAttendedCF = await ghlRequest('POST',
      `/locations/${LOCATION_ID}/customFields`,
      { name: 'Event Attended', dataType: 'TEXT', placeholder: 'e.g. Super Return Mixer 2026' });
    console.log(`   Created: ${eventAttendedCF?.customField?.id || JSON.stringify(eventAttendedCF).substring(0, 200)}`);
  }

  // Now update contacts with custom field data from notes
  console.log('\n   Updating contact cards with form data...');
  for (const ac of allAttendedContacts) {
    await sleep(200);
    const notesData = await ghlRequest('GET', `/contacts/${ac.id}/notes`);
    const notes = notesData.notes || [];

    let investorType = null;
    let company = null;

    for (const note of notes) {
      const body = note.body || '';
      const investorMatch = body.match(/Investor Type:\s*(.+)/i);
      const companyMatch = body.match(/Company:\s*(.+)/i);
      if (investorMatch) investorType = investorMatch[1].trim();
      if (companyMatch && companyMatch[1].trim() !== 'N/A') company = companyMatch[1].trim();
    }

    const updates = {};

    // Set custom fields
    if (investorType && investorTypeCF) {
      const cfKey = investorTypeCF.fieldKey || investorTypeCF.id ||
                    investorTypeCF.customField?.fieldKey || investorTypeCF.customField?.id;
      if (cfKey) updates.customField = { ...updates.customField, [cfKey]: investorType };
    }

    if (eventAttendedCF) {
      const cfKey = eventAttendedCF.fieldKey || eventAttendedCF.id ||
                    eventAttendedCF.customField?.fieldKey || eventAttendedCF.customField?.id;
      if (cfKey) updates.customField = { ...updates.customField, [cfKey]: 'Super Return Mixer - March 18, 2026' };
    }

    if (company && !ac.company) {
      updates.companyName = company;
    }

    if (Object.keys(updates).length > 0) {
      console.log(`   Updating ${ac.name || ac.email}: ${JSON.stringify(updates)}`);
      await sleep(200);
      await ghlRequest('PUT', `/contacts/${ac.id}`, updates);
    }
  }

  // ── Step 6: Audit attended stage — workflows/sequences ──
  console.log('\n\n=== ATTENDED STAGE AUDIT ===\n');
  console.log('Checking workflows active on attended contacts...\n');

  const workflowsData = await ghlRequest('GET',
    `/workflows/?locationId=${LOCATION_ID}`);
  const workflows = workflowsData.workflows || [];
  console.log(`Total workflows in location: ${workflows.length}`);
  for (const wf of workflows) {
    console.log(`  - ${wf.name} (${wf.id}) | Status: ${wf.status}`);
  }

  console.log('\n--- Per-Contact Workflow/Campaign/Sequence Status ---\n');

  for (const ac of allAttendedContacts) {
    console.log(`\n${ac.name || '(no name)'} — ${ac.email || '(no email)'}`);
    console.log(`  Tags: [${ac.tags.join(', ')}]`);
    console.log(`  Source: ${ac.source || 'unknown'}`);
    console.log(`  Opportunity: ${ac.oppName} (${ac.oppId})`);

    // Fetch tasks for this contact (tasks often show workflow steps)
    await sleep(200);
    const tasksData = await ghlRequest('GET', `/contacts/${ac.id}/tasks`);
    const tasks = tasksData.tasks || [];
    if (tasks.length > 0) {
      console.log(`  Tasks (${tasks.length}):`);
      for (const t of tasks) {
        console.log(`    - ${t.title || t.body} | Due: ${t.dueDate || 'none'} | Status: ${t.status || 'pending'}`);
      }
    } else {
      console.log('  Tasks: none');
    }

    // Check conversation/messages
    await sleep(200);
    const convoData = await ghlRequest('GET',
      `/conversations/search?locationId=${LOCATION_ID}&contactId=${ac.id}`);
    const conversations = convoData.conversations || [];
    if (conversations.length > 0) {
      console.log(`  Conversations: ${conversations.length}`);
      for (const conv of conversations.slice(0, 3)) {
        console.log(`    - Type: ${conv.type || 'unknown'} | Last: ${conv.lastMessageDate || conv.dateUpdated || 'unknown'} | Unread: ${conv.unreadCount || 0}`);
      }
    } else {
      console.log('  Conversations: none');
    }
  }

  // ── Step 7: Campaign check ──
  console.log('\n\n--- Campaign Enrollment ---\n');
  await sleep(200);
  const campaignsData = await ghlRequest('GET',
    `/locations/${LOCATION_ID}/campaigns`);
  const campaigns = campaignsData.campaigns || [];
  console.log(`Total campaigns: ${campaigns.length}`);
  for (const camp of campaigns) {
    console.log(`  - ${camp.name} (${camp.id}) | Status: ${camp.status}`);
  }

  console.log('\n=== AUDIT COMPLETE ===');
}

main().catch(console.error);
