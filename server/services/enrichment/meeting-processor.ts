import { queryOne, queryAll, runSql, saveDb } from '../../db';
import { claudeService } from '../claude-service';
import { ghlService } from '../ghl-service';
import { config } from '../../config';
import { wsServer } from '../../websocket/ws-server';
import { logEvent } from './helpers';


/**
 * Process a meeting transcript: Claude analysis → GHL sync → post-meeting follow-up
 */
export async function processMeetingTranscript(transcriptId: number): Promise<void> {
  const transcript = queryOne('SELECT * FROM meeting_transcripts WHERE id = ?', [transcriptId]);
  if (!transcript) {
    console.error(`[MeetingProcessor] Transcript ${transcriptId} not found`);
    return;
  }

  // Load lead data if available
  const lead = transcript.lead_id
    ? queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [transcript.lead_id])
    : null;

  // Load playbook
  const playbook = queryOne('SELECT * FROM company_playbooks WHERE company_id = ?', [transcript.company_id]);
  if (!playbook) {
    console.error(`[MeetingProcessor] No playbook for company ${transcript.company_id}`);
    return;
  }

  // Load prior email thread if lead exists
  const conversationHistory: { direction: string; body: string }[] = [];
  if (lead) {
    const thread = queryOne(
      'SELECT id FROM reply_threads WHERE enrichment_lead_id = ? ORDER BY updated_at DESC LIMIT 1',
      [lead.id]
    );
    if (thread) {
      const messages = queryAll(
        'SELECT direction, body FROM reply_messages WHERE thread_id = ? ORDER BY created_at ASC',
        [thread.id]
      );
      conversationHistory.push(...messages);
    }
  }

  // Parse enrichment data and tags
  let enrichmentData: any = {};
  let tags: string[] = [];
  if (lead) {
    try { enrichmentData = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : {}; } catch { enrichmentData = {}; }
    try { tags = lead.tags ? JSON.parse(lead.tags) : []; } catch { tags = []; }
  }

  // ── Step 1: Claude Analysis ──────────────────────────────
  console.log(`[MeetingProcessor] Analyzing transcript ${transcriptId}...`);

  const analysis = await claudeService.analyzeMeetingTranscript({
    transcriptText: transcript.transcript_text,
    leadData: {
      first_name: lead?.first_name || null,
      last_name: lead?.last_name || null,
      email: lead?.email || null,
      score: lead?.score || null,
      score_label: lead?.score_label || null,
      tags,
      enrichment_data: enrichmentData,
    },
    conversationHistory,
    playbook: {
      company_description: playbook.company_description,
      value_propositions: JSON.parse(playbook.value_propositions || '[]'),
      target_icp: playbook.target_icp,
      conversation_goals: JSON.parse(playbook.conversation_goals || '[]'),
    },
    meetingDate: transcript.meeting_date,
    durationMinutes: transcript.duration_minutes,
  });

  // ── Step 2: Store Analysis ───────────────────────────────
  runSql(
    `UPDATE meeting_transcripts SET analysis = ?, next_steps = ?, sequence_assigned = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      JSON.stringify(analysis),
      JSON.stringify(analysis.next_steps),
      analysis.sequence_recommendation,
      transcriptId,
    ]
  );
  saveDb();

  console.log(`[MeetingProcessor] Transcript ${transcriptId}: sentiment=${analysis.sentiment}, likelihood=${analysis.investment_likelihood}, sequence=${analysis.sequence_recommendation}`);

  // Log event
  if (lead) {
    runSql(
      'INSERT INTO enrichment_events (enrichment_lead_id, company_id, event_type, event_data) VALUES (?, ?, ?, ?)',
      [lead.id, transcript.company_id, 'meeting_analyzed', JSON.stringify({
        transcript_id: transcriptId,
        sentiment: analysis.sentiment,
        investment_likelihood: analysis.investment_likelihood,
        sequence: analysis.sequence_recommendation,
      })]
    );
  }

  // ── Step 3: GHL Sync ─────────────────────────────────────
  const ghlClient = ghlService.getClient(transcript.company_id);
  if (!ghlClient) {
    console.log(`[MeetingProcessor] No GHL client for company ${transcript.company_id}, skipping sync`);
    return;
  }

  const ghlContactId = transcript.ghl_contact_id || lead?.ghl_contact_id;
  if (!ghlContactId) {
    console.log(`[MeetingProcessor] No GHL contact ID for transcript ${transcriptId}, skipping sync`);
    return;
  }

  try {
    // Add note with analysis summary
    const noteBody = buildGhlNote(analysis, transcript);
    await ghlClient.createContactNote(ghlContactId, noteBody);

    // Add tags
    const ghlTags = buildGhlTags(analysis);
    await ghlClient.addContactTags(ghlContactId, ghlTags);

    // Create or move opportunity for high-likelihood prospects
    let opportunityId: string | null = lead?.ghl_opportunity_id || null;
    if (analysis.investment_likelihood >= 60) {
      if (opportunityId) {
        // Move existing opportunity to meeting_completed / qualified stage
        const pipelines = await ghlClient.getPipelines();
        const pipeline = pipelines?.pipelines?.[0];
        if (pipeline) {
          const stageName = analysis.sequence_recommendation === 'closing' ? 'qualified' : 'meeting_completed';
          const stage = pipeline.stages?.find((s: any) =>
            s.name?.toLowerCase().includes(stageName)
          ) || pipeline.stages?.find((s: any) =>
            s.name?.toLowerCase().includes('meeting')
          );
          if (stage) {
            await ghlClient.updateOpportunityStage(opportunityId, stage.id);
            console.log(`[MeetingProcessor] Moved existing opportunity ${opportunityId} → ${stage.name}`);
          }
        }
      } else {
        // No existing opportunity — create one
        const pipelines = await ghlClient.getPipelines();
        const pipeline = pipelines?.pipelines?.[0];
        if (pipeline) {
          const stageName = analysis.sequence_recommendation === 'closing' ? 'qualified' : 'nurture';
          const stage = pipeline.stages?.find((s: any) =>
            s.name?.toLowerCase().includes(stageName)
          ) || pipeline.stages?.[0];

          if (stage) {
            const opp = await ghlClient.createOpportunity({
              pipelineId: pipeline.id,
              stageId: stage.id,
              contactId: ghlContactId,
              name: `${lead?.first_name || 'Lead'} ${lead?.last_name || ''} — Opportunity`.trim(),
              status: 'open',
              monetaryValue: config.postMeeting.minimumInvestment,
            });
            opportunityId = opp?.id || opp || null;
            if (opportunityId && lead) {
              runSql('UPDATE enrichment_leads SET ghl_opportunity_id = ? WHERE id = ?', [opportunityId, lead.id]);
            }
          }
        }
      }
    }

    // Mark as synced
    runSql('UPDATE meeting_transcripts SET ghl_synced = 1 WHERE id = ?', [transcriptId]);
    saveDb();

    console.log(`[MeetingProcessor] GHL sync complete for transcript ${transcriptId}`);
  } catch (err: any) {
    console.error(`[MeetingProcessor] GHL sync error for transcript ${transcriptId}:`, err.message);
  }

  // ── Step 4: Post-Meeting Follow-Up Automation ──────────
  if (lead) {
    await schedulePostMeetingFollowUp({
      transcriptId,
      leadId: lead.id,
      companyId: transcript.company_id,
      email: lead.email,
      firstName: lead.first_name,
      lastName: lead.last_name,
      analysis,
    });
  }
}

/**
 * Route post-meeting follow-up based on investment likelihood:
 *   ≥60% → data room link + schedule follow-up call
 *   30-59% → additional materials + nurture sequence
 *   <30% → polite close + add to quarterly newsletter
 */
async function schedulePostMeetingFollowUp(params: {
  transcriptId: number;
  leadId: number;
  companyId: number;
  email: string;
  firstName: string;
  lastName: string;
  analysis: any;
}): Promise<void> {
  const { transcriptId, leadId, companyId, email, firstName, analysis } = params;
  const likelihood = analysis.investment_likelihood || 0;
  const personalizedFollowUp = analysis.personalized_follow_up || '';
  const nextSteps: string[] = analysis.next_steps || [];

  // Determine follow-up type based on likelihood
  let followupType: 'data_room' | 'nurture' | 'polite_close';
  let followUpBody: string;

  if (likelihood >= 60) {
    followupType = 'data_room';
    followUpBody = buildDataRoomFollowUp(firstName, personalizedFollowUp, nextSteps, companyId);
  } else if (likelihood >= 30) {
    followupType = 'nurture';
    followUpBody = buildNurtureFollowUp(firstName, personalizedFollowUp, nextSteps, companyId);
  } else {
    followupType = 'polite_close';
    followUpBody = buildPoliteCloseFollowUp(firstName, personalizedFollowUp, companyId);
  }

  // Schedule the follow-up email via the reply system
  const delayHours = config.postMeeting.followUpDelayHours;
  const scheduledAt = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();

  // Find or create a thread for this lead
  const existingThread = queryOne(
    `SELECT id FROM reply_threads WHERE enrichment_lead_id = ? AND thread_status IN ('active', 'paused') ORDER BY created_at DESC LIMIT 1`,
    [leadId]
  ) as { id: number } | null;

  let threadId: number;
  if (existingThread) {
    threadId = existingThread.id;
  } else {
    runSql(
      `INSERT INTO reply_threads (enrichment_lead_id, company_id, email) VALUES (?, ?, ?)`,
      [leadId, companyId, email]
    );
    saveDb();
    const newThread = queryOne(
      `SELECT id FROM reply_threads WHERE enrichment_lead_id = ? ORDER BY id DESC LIMIT 1`,
      [leadId]
    ) as { id: number };
    threadId = newThread.id;
  }

  // Insert the scheduled follow-up message
  runSql(
    `INSERT INTO reply_messages (thread_id, direction, body, sentiment, generated_by, strategy, scheduled_at, sent) VALUES (?, 'outbound', ?, 'positive', 'claude', ?, ?, 0)`,
    [threadId, followUpBody, `post_meeting_${followupType}`, scheduledAt]
  );

  // Update thread
  runSql(
    `UPDATE reply_threads SET message_count = message_count + 1, auto_reply_count = auto_reply_count + 1, last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    [threadId]
  );

  // Update lead status based on likelihood
  const newStatus = likelihood >= 60 ? 'post_meeting_hot' : likelihood >= 30 ? 'post_meeting_warm' : 'post_meeting_cold';
  runSql(`UPDATE enrichment_leads SET status = ? WHERE id = ?`, [newStatus, leadId]);

  // Track on transcript
  runSql(
    `UPDATE meeting_transcripts SET followup_status = 'scheduled', followup_type = ?, followup_thread_id = ?, followup_scheduled_at = ?, opportunity_value = ? WHERE id = ?`,
    [followupType, threadId, scheduledAt, likelihood >= 60 ? config.postMeeting.minimumInvestment : null, transcriptId]
  );

  saveDb();

  // Log event
  logEvent(leadId, companyId, 'post_meeting_followup_scheduled', {
    transcriptId,
    followupType,
    likelihood,
    threadId,
    scheduledAt,
    delayHours,
  });

  wsServer.broadcast({
    type: 'post_meeting_followup',
    leadId,
    companyId,
    followupType,
    likelihood,
    scheduledAt,
  });

  console.log(`[MeetingProcessor] Post-meeting follow-up scheduled: type=${followupType}, likelihood=${likelihood}, threadId=${threadId}, scheduledAt=${scheduledAt}`);
}

/**
 * High likelihood (≥60%): Data room access + follow-up call scheduling
 */
function buildDataRoomFollowUp(firstName: string, personalizedFollowUp: string, nextSteps: string[], companyId: number): string {
  const dataRoomUrl = config.postMeetingByCompany[companyId]?.dataRoomUrl || config.postMeeting.dataRoomUrl;
  const name = firstName || 'there';
  const playbook = queryOne('SELECT company_name, sender_name FROM company_playbooks WHERE company_id = ?', [companyId]) as { company_name?: string; sender_name?: string } | null;
  const senderName = playbook?.sender_name || 'Our team';
  const companyName = playbook?.company_name || 'our team';

  const lines = [
    `Hi ${name},`,
    '',
    `Great speaking with you today. I really enjoyed our conversation and wanted to follow up while everything is fresh.`,
    '',
  ];

  // Use Claude's personalized follow-up if available
  if (personalizedFollowUp) {
    lines.push(personalizedFollowUp, '');
  }

  // Data room link
  if (dataRoomUrl) {
    lines.push(
      `As discussed, I'd like to share some materials with you. You can access them here:`,
      dataRoomUrl,
      '',
      `Inside you'll find detailed information about what we discussed.`,
      '',
    );
  }

  // Next steps from the analysis
  if (nextSteps.length > 0) {
    lines.push(`A few items for follow-up:`);
    for (const step of nextSteps) {
      lines.push(`• ${step}`);
    }
    lines.push('');
  }

  lines.push(
    `Would you be available for a brief follow-up call this week to address any questions after you've had a chance to review?`,
    '',
    `Best,`,
    senderName,
    companyName,
  );

  return lines.join('\n');
}

/**
 * Medium likelihood (30-59%): Additional materials + nurture
 */
function buildNurtureFollowUp(firstName: string, personalizedFollowUp: string, nextSteps: string[], companyId: number): string {
  const name = firstName || 'there';
  const playbook = queryOne('SELECT company_name, sender_name, company_description FROM company_playbooks WHERE company_id = ?', [companyId]) as { company_name?: string; sender_name?: string; company_description?: string } | null;
  const senderName = playbook?.sender_name || 'Our team';
  const companyName = playbook?.company_name || 'our team';

  const lines = [
    `Hi ${name},`,
    '',
    `Thank you for taking the time to connect today. I enjoyed learning more about your priorities.`,
    '',
  ];

  if (personalizedFollowUp) {
    lines.push(personalizedFollowUp, '');
  }

  lines.push(
    `I wanted to share a few additional resources about what we're working on at ${companyName}. I think you'll find them relevant given our conversation.`,
    '',
  );

  if (nextSteps.length > 0) {
    lines.push(`Based on our conversation, here are some next steps:`);
    for (const step of nextSteps) {
      lines.push(`• ${step}`);
    }
    lines.push('');
  }

  lines.push(
    `I'd be happy to share more detailed materials or schedule another call whenever you're ready to dive deeper.`,
    '',
    `Best,`,
    senderName,
    companyName,
  );

  return lines.join('\n');
}

/**
 * Low likelihood (<30%): Polite close + quarterly newsletter
 */
function buildPoliteCloseFollowUp(firstName: string, personalizedFollowUp: string, companyId: number): string {
  const name = firstName || 'there';
  const playbook = queryOne('SELECT company_name, sender_name FROM company_playbooks WHERE company_id = ?', [companyId]) as { company_name?: string; sender_name?: string } | null;
  const senderName = playbook?.sender_name || 'Our team';
  const companyName = playbook?.company_name || 'our team';

  const lines = [
    `Hi ${name},`,
    '',
    `Thank you for taking the time to chat today. I appreciated learning about your priorities.`,
    '',
  ];

  if (personalizedFollowUp) {
    lines.push(personalizedFollowUp, '');
  }

  lines.push(
    `I'd love to keep you in the loop on what we're doing at ${companyName}. We send periodic updates on our progress and new developments.`,
    '',
    `If your situation changes or you'd like to explore this further down the line, my door is always open.`,
    '',
    `Wishing you all the best,`,
    senderName,
    companyName,
  );

  return lines.join('\n');
}

function buildGhlNote(analysis: any, transcript: any): string {
  const lines = [
    `📋 Meeting Analysis — ${transcript.meeting_date}`,
    `Duration: ${transcript.duration_minutes || '?'} minutes`,
    '',
    `Sentiment: ${analysis.sentiment}`,
    `Conversion Likelihood: ${analysis.investment_likelihood}/100`,
    `Qualified: ${analysis.accredited_confirmed ? 'Yes' : 'Pending'}`,
    `Timeline: ${analysis.investment_timeline || 'Not specified'}`,
    `Sequence: ${analysis.sequence_recommendation}`,
    '',
    '--- Key Topics ---',
    ...analysis.key_topics.map((t: string) => `• ${t}`),
    '',
  ];

  if (analysis.objections.length > 0) {
    lines.push('--- Objections ---');
    lines.push(...analysis.objections.map((o: string) => `• ${o}`));
    lines.push('');
  }

  lines.push('--- Next Steps ---');
  lines.push(...analysis.next_steps.map((s: string, i: number) => `${i + 1}. ${s}`));

  if (analysis.personalized_follow_up) {
    lines.push('', '--- Draft Follow-Up ---', analysis.personalized_follow_up);
  }

  return lines.join('\n');
}

function buildGhlTags(analysis: any): string[] {
  const tags = ['meeting-completed'];

  tags.push(`sequence:${analysis.sequence_recommendation}`);

  if (analysis.investment_likelihood >= 70) {
    tags.push('likelihood:high');
  } else if (analysis.investment_likelihood >= 40) {
    tags.push('likelihood:medium');
  } else {
    tags.push('likelihood:low');
  }

  if (analysis.accredited_confirmed) {
    // "accredited" applies to GPC investors; for BMN creators this maps to "qualified-confirmed" generically
    tags.push('qualified-confirmed');
  }

  return tags;
}
