const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, TableCell, TableRow, Table, WidthType, ShadingType } = require('docx');
const fs = require('fs');

async function main() {
  // Load the raw messages
  const allMessages = JSON.parse(fs.readFileSync('c:/Users/colby/Master Dashboard/ghl-all-messages-raw.json', 'utf8'));

  // Filter to only SMS (skip appointment activities)
  const smsMessages = allMessages.filter(m => m.type === 'TYPE_SMS');

  // Deduplicate SMS by content similarity
  function normalizeForGrouping(text) {
    return (text || '')
      .replace(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, '{NAME}')
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, '{DATE}')
      .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi, '{DAY}')
      .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi, '{MONTH}')
      .replace(/\b\d{1,2}:\d{2}\s*(AM|PM|am|pm)\b/g, '{TIME}')
      .substring(0, 200);
  }

  const templates = new Map();
  for (const msg of smsMessages) {
    const body = msg.bodyText || msg.body || '';
    if (!body || body.length < 10) continue;
    const key = normalizeForGrouping(body);
    if (!templates.has(key)) {
      templates.set(key, { ...msg, count: 1 });
    } else {
      templates.get(key).count++;
    }
  }

  // Categorize messages
  const bulkSms = [];
  const workflowSms = [];
  const manualSms = [];

  for (const [, msg] of templates) {
    const body = msg.bodyText || msg.body || '';
    if (body.length < 15) continue; // skip very short messages

    if (msg.source === 'bulk_actions') {
      bulkSms.push(msg);
    } else if (msg.source === 'workflow') {
      workflowSms.push(msg);
    } else {
      manualSms.push(msg);
    }
  }

  // Sort each by date
  const sortByDate = (a, b) => (a.dateAdded || '').localeCompare(b.dateAdded || '');
  bulkSms.sort(sortByDate);
  workflowSms.sort(sortByDate);
  manualSms.sort(sortByDate);

  // Helper: format date
  function fmtDate(iso) {
    if (!iso) return 'Unknown';
    try {
      return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return iso; }
  }

  // Helper: create styled message block
  function createMessageBlock(label, msg, idx) {
    const body = (msg.bodyText || msg.body || '').trim();
    const paras = [];

    paras.push(new Paragraph({
      spacing: { before: 300, after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' } },
      children: [
        new TextRun({ text: `${label} #${idx}`, bold: true, size: 24, font: 'Calibri' }),
        new TextRun({ text: `  |  Sent ${msg.count}x  |  Source: ${msg.source || 'unknown'}  |  ${fmtDate(msg.dateAdded)}`, size: 20, color: '666666', font: 'Calibri' }),
      ],
    }));

    // Split body into paragraphs
    const lines = body.split('\n');
    for (const line of lines) {
      paras.push(new Paragraph({
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text: line || ' ', size: 22, font: 'Calibri' })],
      }));
    }

    return paras;
  }

  // Build document sections
  const children = [];

  // ═══ TITLE PAGE ═══
  children.push(new Paragraph({ spacing: { before: 2000 }, children: [] }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'GRANITE PARK CAPITAL', bold: true, size: 48, font: 'Calibri', color: '1B3A5C' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: 'GoHighLevel Sequence & Copy Audit', size: 36, font: 'Calibri', color: '333333' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, size: 24, font: 'Calibri', color: '666666' })],
  }));

  // Stats
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: `Total Outbound Messages Scanned: ${allMessages.length}`, size: 22, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: `SMS Messages: ${smsMessages.length}`, size: 22, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: `Unique Message Templates: ${templates.size}`, size: 22, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [
      new TextRun({ text: `Automated (Workflow): ${workflowSms.length}`, size: 22, font: 'Calibri' }),
      new TextRun({ text: `  |  Bulk Sends: ${bulkSms.length}`, size: 22, font: 'Calibri' }),
      new TextRun({ text: `  |  Manual/App: ${manualSms.length}`, size: 22, font: 'Calibri' }),
    ],
  }));

  // ═══ TABLE OF CONTENTS ═══
  children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 300 },
    children: [new TextRun({ text: 'TABLE OF CONTENTS', bold: true, size: 32, font: 'Calibri', color: '1B3A5C' })],
  }));
  const tocItems = [
    '1. Pipeline & Stage Overview',
    '2. GHL Workflow Automated SMS Sequences (Full Copy)',
    '3. GHL Bulk SMS Campaigns (Full Copy)',
    '4. GHL Manual/App SMS Messages (Full Copy)',
    '5. Code-Based Email Templates (meeting-processor.ts)',
    '6. Code-Based Meeting Confirmation & Reminders (meeting-scheduler.ts)',
    '7. Sequence Trigger Map — What Fires When',
  ];
  for (const item of tocItems) {
    children.push(new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [new TextRun({ text: item, size: 24, font: 'Calibri' })],
    }));
  }

  // ═══ SECTION 1: PIPELINE OVERVIEW ═══
  children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
    children: [new TextRun({ text: '1. PIPELINE & STAGE OVERVIEW', bold: true, size: 32, font: 'Calibri', color: '1B3A5C' })],
  }));

  // Event Funnel Pipeline
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
    children: [new TextRun({ text: 'Event Funnel Pipeline', bold: true, size: 28, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Pipeline ID: GMqxElyHPSr2karweCGS', size: 20, color: '888888', font: 'Calibri' })],
  }));

  const eventStages = [
    { name: 'Contacted', desc: 'Initial outreach — leads enter here from Meta ads, event RSVPs, or manual import. Triggers first SMS touchpoint.' },
    { name: 'Engaged', desc: 'Lead has responded or interacted. Follow-up sequences activate.' },
    { name: 'Meeting Booked', desc: 'Calendar confirmed — triggers meeting confirmation SMS + 24h/1h reminders.' },
    { name: 'Meeting Completed', desc: 'Post-meeting analysis → triggers tier-based follow-up emails (data room / nurture / polite close).' },
    { name: 'Qualified', desc: 'High-likelihood investor (≥60%). Data room access sent, follow-up call scheduled.' },
    { name: 'Proposal Sent', desc: 'PPM / subscription docs delivered.' },
    { name: 'Closed Won', desc: 'Investor committed.' },
    { name: 'Closed Lost / Not Interested', desc: 'Added to quarterly newsletter list.' },
  ];

  for (const stage of eventStages) {
    children.push(new Paragraph({
      spacing: { before: 100, after: 40 },
      children: [
        new TextRun({ text: `→ ${stage.name}: `, bold: true, size: 22, font: 'Calibri' }),
        new TextRun({ text: stage.desc, size: 22, font: 'Calibri' }),
      ],
    }));
  }

  // Meta Lead Intake
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 150 },
    children: [new TextRun({ text: 'Meta Lead Intake Pipeline', bold: true, size: 28, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Pipeline ID: iJ5eS6fANsGVejDo6ubW', size: 20, color: '888888', font: 'Calibri' })],
  }));

  const metaStages = [
    { name: 'New Lead', desc: 'Facebook/Instagram ad leads land here via Meta integration.' },
    { name: 'Contacted', desc: 'Automated RSVP confirmation SMS fires.' },
    { name: 'Interested', desc: 'Lead expressed interest — enters event booking or follow-up sequences.' },
    { name: 'Meeting Set', desc: 'Transitioned to Event Funnel pipeline for meeting workflow.' },
    { name: 'Not Interested', desc: 'Removed from active sequences.' },
  ];

  for (const stage of metaStages) {
    children.push(new Paragraph({
      spacing: { before: 100, after: 40 },
      children: [
        new TextRun({ text: `→ ${stage.name}: `, bold: true, size: 22, font: 'Calibri' }),
        new TextRun({ text: stage.desc, size: 22, font: 'Calibri' }),
      ],
    }));
  }

  // ═══ SECTION 2: WORKFLOW SMS ═══
  children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
    children: [new TextRun({ text: '2. GHL WORKFLOW AUTOMATED SMS SEQUENCES', bold: true, size: 32, font: 'Calibri', color: '1B3A5C' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: 'These messages are sent automatically by GHL workflows triggered by form submissions, pipeline stage changes, or tags.', size: 22, font: 'Calibri', italics: true, color: '555555' })],
  }));

  let idx = 1;
  for (const msg of workflowSms) {
    createMessageBlock('WORKFLOW SMS', msg, idx++).forEach(p => children.push(p));
  }

  if (workflowSms.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'No workflow-triggered SMS found in this scan.', size: 22, font: 'Calibri', italics: true })],
    }));
  }

  // ═══ SECTION 3: BULK SMS ═══
  children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
    children: [new TextRun({ text: '3. GHL BULK SMS CAMPAIGNS', bold: true, size: 32, font: 'Calibri', color: '1B3A5C' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: 'These messages were sent as bulk blasts to contact lists from the GHL bulk actions feature.', size: 22, font: 'Calibri', italics: true, color: '555555' })],
  }));

  idx = 1;
  for (const msg of bulkSms) {
    createMessageBlock('BULK SMS', msg, idx++).forEach(p => children.push(p));
  }

  // ═══ SECTION 4: MANUAL/APP SMS ═══
  children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
    children: [new TextRun({ text: '4. GHL MANUAL / APP SMS MESSAGES', bold: true, size: 32, font: 'Calibri', color: '1B3A5C' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: 'These are individual messages sent manually through the GHL app or web interface. Included for completeness — shows the ad-hoc messaging patterns being used with prospects.', size: 22, font: 'Calibri', italics: true, color: '555555' })],
  }));

  idx = 1;
  for (const msg of manualSms) {
    createMessageBlock('MANUAL SMS', msg, idx++).forEach(p => children.push(p));
  }

  // ═══ SECTION 5: CODE-BASED EMAIL TEMPLATES ═══
  children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
    children: [new TextRun({ text: '5. CODE-BASED EMAIL TEMPLATES (Post-Meeting Follow-Ups)', bold: true, size: 32, font: 'Calibri', color: '1B3A5C' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Source: server/services/enrichment/meeting-processor.ts — These emails are generated by Claude AI after analyzing a meeting transcript. The template tier is selected based on investment likelihood score.', size: 22, font: 'Calibri', italics: true, color: '555555' })],
  }));

  // Tier 1: Data Room (≥60%)
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 150 },
    children: [new TextRun({ text: 'TIER 1: Data Room Follow-Up (Investment Likelihood ≥ 60%)', bold: true, size: 26, font: 'Calibri', color: '2E7D32' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Trigger: Meeting analyzed with investment_likelihood ≥ 60. Sent 4 hours after meeting.', size: 20, font: 'Calibri', color: '888888' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Lead Status: post_meeting_hot', size: 20, font: 'Calibri', color: '888888' })],
  }));

  const dataRoomEmail = `Hi {firstName},

Great speaking with you today. I really enjoyed our conversation and wanted to follow up while everything is fresh.

{Claude AI personalized follow-up based on meeting transcript analysis}

As discussed, I'd like to share our investor materials with you. You can access the data room here:
{dataRoomUrl from config}

Inside you'll find our PPM, subscription documents, and detailed fund performance materials.

A few items for follow-up:
{Next steps extracted from meeting analysis — bullet points}

Would you be available for a brief follow-up call this week to address any questions after you've had a chance to review?

Best,
Marc Menowitz
Granite Park Capital`;

  for (const line of dataRoomEmail.split('\n')) {
    children.push(new Paragraph({
      spacing: { before: 30, after: 30 },
      children: [new TextRun({
        text: line || ' ',
        size: 22,
        font: 'Calibri',
        ...(line.startsWith('{') ? { italics: true, color: '888888' } : {}),
      })],
    }));
  }

  // Tier 2: Nurture (30-59%)
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 150 },
    children: [new TextRun({ text: 'TIER 2: Nurture Follow-Up (Investment Likelihood 30-59%)', bold: true, size: 26, font: 'Calibri', color: 'F57F17' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Trigger: Meeting analyzed with investment_likelihood 30-59. Sent 4 hours after meeting.', size: 20, font: 'Calibri', color: '888888' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Lead Status: post_meeting_warm', size: 20, font: 'Calibri', color: '888888' })],
  }));

  const nurtureEmail = `Hi {firstName},

Thank you for taking the time to connect today. I enjoyed learning more about your investment approach.

{Claude AI personalized follow-up based on meeting transcript analysis}

I wanted to share a few additional resources about our approach to affordable housing:

• Our portfolio currently includes 5,500 units with Section 8 contracts, providing stable, government-backed income
• Fund I was fully subscribed at $50M — Fund II builds on that track record
• We target 7% preferred return with 12-16% net IRR and quarterly distributions

Based on our conversation, here are some next steps:
{Next steps from analysis — bullet points}

I'd be happy to share more detailed materials or schedule another call whenever you're ready to dive deeper.

Best,
Marc Menowitz
Granite Park Capital`;

  for (const line of nurtureEmail.split('\n')) {
    children.push(new Paragraph({
      spacing: { before: 30, after: 30 },
      children: [new TextRun({
        text: line || ' ',
        size: 22,
        font: 'Calibri',
        ...(line.startsWith('{') || line.startsWith('•') ? { italics: line.startsWith('{'), color: line.startsWith('{') ? '888888' : '000000' } : {}),
      })],
    }));
  }

  // Tier 3: Polite Close (<30%)
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 150 },
    children: [new TextRun({ text: 'TIER 3: Polite Close Follow-Up (Investment Likelihood < 30%)', bold: true, size: 26, font: 'Calibri', color: 'C62828' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Trigger: Meeting analyzed with investment_likelihood < 30. Sent 4 hours after meeting.', size: 20, font: 'Calibri', color: '888888' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Lead Status: post_meeting_cold', size: 20, font: 'Calibri', color: '888888' })],
  }));

  const politeCloseEmail = `Hi {firstName},

Thank you for taking the time to chat today. I appreciated learning about your investment priorities.

{Claude AI personalized follow-up based on meeting transcript analysis}

While the timing may not be right for Fund II, I'd love to keep you in the loop on our progress. We send quarterly updates on portfolio performance and new developments in the affordable housing space.

If your situation changes or you'd like to explore this further down the line, my door is always open.

Wishing you all the best,
Marc Menowitz
Granite Park Capital`;

  for (const line of politeCloseEmail.split('\n')) {
    children.push(new Paragraph({
      spacing: { before: 30, after: 30 },
      children: [new TextRun({
        text: line || ' ',
        size: 22,
        font: 'Calibri',
        ...(line.startsWith('{') ? { italics: true, color: '888888' } : {}),
      })],
    }));
  }

  // ═══ SECTION 6: MEETING CONFIRMATION & REMINDERS ═══
  children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
    children: [new TextRun({ text: '6. CODE-BASED MEETING CONFIRMATION & REMINDERS', bold: true, size: 32, font: 'Calibri', color: '1B3A5C' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Source: server/services/meeting-scheduler.ts — Sent automatically when a meeting is booked via the auto-reply system.', size: 22, font: 'Calibri', italics: true, color: '555555' })],
  }));

  // Confirmation Email
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
    children: [new TextRun({ text: 'Meeting Confirmation Email', bold: true, size: 26, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Subject: Confirmed: {slot.displayTime} — Granite Park Capital', bold: true, size: 22, font: 'Calibri' })],
  }));

  const confirmEmail = `Hi there,

This confirms your meeting with Marc Realty at {slot.displayTime} (30 minutes).

What to expect: A brief overview of Granite Park Capital Affordable Housing Fund II and how it may fit your portfolio. No prep needed on your end.

If you need to reschedule, just reply to this email and we'll find another time.

Looking forward to connecting,
Marc Realty
Granite Park Capital`;

  for (const line of confirmEmail.split('\n')) {
    children.push(new Paragraph({
      spacing: { before: 30, after: 30 },
      children: [new TextRun({ text: line || ' ', size: 22, font: 'Calibri' })],
    }));
  }

  // 24h Reminder SMS
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 150 },
    children: [new TextRun({ text: '24-Hour Reminder SMS', bold: true, size: 26, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Trigger: Automatically sent 24 hours before the scheduled meeting.', size: 20, color: '888888', font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Quick reminder — you have a call with Marc from Granite Park Capital tomorrow at {slot.displayTime}. Looking forward to it!', size: 22, font: 'Calibri' })],
  }));

  // 1h Reminder SMS
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 150 },
    children: [new TextRun({ text: '1-Hour Reminder SMS', bold: true, size: 26, font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Trigger: Automatically sent 1 hour before the scheduled meeting.', size: 20, color: '888888', font: 'Calibri' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: "Just a heads up — your call with Marc from Granite Park Capital starts in about an hour ({slot.displayTime}). Talk soon!", size: 22, font: 'Calibri' })],
  }));

  // ═══ SECTION 7: TRIGGER MAP ═══
  children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
    children: [new TextRun({ text: '7. SEQUENCE TRIGGER MAP — WHAT FIRES WHEN', bold: true, size: 32, font: 'Calibri', color: '1B3A5C' })],
  }));

  const triggerMap = [
    { trigger: 'Meta Ad Form Submission', action: 'Lead created in Meta Lead Intake → New Lead stage. RSVP confirmation SMS fires via workflow.' },
    { trigger: 'Event RSVP Form (HnDlGRwYsFifJ1Lh6bHa)', action: 'Workflow fires: "{Name} — you\'re confirmed for the Granite Park Capital mixer aboard TYCOON..." SMS' },
    { trigger: 'Bulk SMS Campaign (pre-event)', action: 'Manual bulk send to contact lists: event invitation with RSVP link or booking link' },
    { trigger: 'Day-of Event Reminder', action: 'Bulk SMS: "We are excited to host you this evening at the Tycoon yacht..." with location + time' },
    { trigger: 'Post-Event Follow-Up (Day 1)', action: 'Workflow SMS: "appreciate you joining us aboard Tycoon. We\'re opening a few private 1:1 sessions..." with Calendly link' },
    { trigger: 'Post-Event Follow-Up (Day 2)', action: 'Workflow SMS: "Quick follow-up — if a full diligence session isn\'t needed yet, we\'re also offering 30-min alignment calls..." with Calendly link' },
    { trigger: 'Post-Event Follow-Up (Day 3)', action: 'Workflow SMS: Portfolio update with unit count, Q2 distributions, personalized with contact name' },
    { trigger: 'Meeting Booked (code-based)', action: 'Confirmation email via GHL + 24h SMS reminder + 1h SMS reminder' },
    { trigger: 'Meeting Completed (code-based)', action: 'Claude AI analyzes transcript → routes to Tier 1 (data room), Tier 2 (nurture), or Tier 3 (polite close) email. Sent 4 hours post-meeting.' },
    { trigger: 'Investment Likelihood ≥ 60%', action: 'GHL opportunity created in pipeline, tags: meeting-completed, likelihood:high, sequence:closing. Data room email sent.' },
    { trigger: 'Investment Likelihood 30-59%', action: 'Tags: likelihood:medium. Nurture email with fund stats (5,500 units, $50M Fund I, 7% pref return).' },
    { trigger: 'Investment Likelihood < 30%', action: 'Tags: likelihood:low. Polite close email. Added to quarterly newsletter.' },
    { trigger: 'Booking Link Shared (manual)', action: 'Calendly links shared in manual SMS: calendly.com/colby-granitepark/granite-park-capital-follow-up or granite-park-1-on-1-on-yacht' },
  ];

  for (const item of triggerMap) {
    children.push(new Paragraph({
      spacing: { before: 200, after: 60 },
      children: [new TextRun({ text: `⚡ ${item.trigger}`, bold: true, size: 22, font: 'Calibri' })],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 100 },
      indent: { left: 400 },
      children: [new TextRun({ text: item.action, size: 22, font: 'Calibri' })],
    }));
  }

  // Build and save
  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const outPath = 'c:/Users/colby/Master Dashboard/GHL-Full-Sequence-Audit.docx';
  fs.writeFileSync(outPath, buffer);
  console.log(`Word document saved to: ${outPath}`);
  console.log(`  Workflow SMS: ${workflowSms.length}`);
  console.log(`  Bulk SMS: ${bulkSms.length}`);
  console.log(`  Manual SMS: ${manualSms.length}`);
  console.log(`  Code-based email templates: 3 tiers`);
  console.log(`  Meeting confirmation + reminders: 3 templates`);
}

main().catch(e => console.error('Error:', e));
