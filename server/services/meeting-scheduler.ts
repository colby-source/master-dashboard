/**
 * meeting-scheduler.ts — Finds available 1-on-1 meeting slots on Wed/Thu/Fri,
 * checks GHL calendars for conflicts, and books via GHL.
 */

import { config } from '../config';
import { ghlService } from './ghl-service';
import { queryOne, queryAll, runSql, saveDb } from '../db';
import { wsServer } from '../websocket/ws-server';
import { recordOutcome } from './enrichment/ab-testing';

interface MeetingSlot {
  start: string;   // ISO 8601
  end: string;     // ISO 8601
  dayName: string;  // "Wednesday", "Thursday", "Friday"
  displayTime: string; // "Wednesday, March 18 at 10:00 AM ET"
}

interface BookMeetingResult {
  success: boolean;
  appointmentId?: string;
  slot?: MeetingSlot;
  error?: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Generate candidate time slots for the next N weeks, only on allowed meeting days.
 */
function generateCandidateSlots(): MeetingSlot[] {
  const { meetingDays, meetingStartHour, meetingEndHour, meetingDurationMinutes, lookAheadWeeks } = config.meetings;

  const slots: MeetingSlot[] = [];
  const now = new Date();

  // Start from tomorrow
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() + 1);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + lookAheadWeeks * 7);

  const current = new Date(startDate);
  while (current < endDate) {
    const dayOfWeek = current.getDay();

    // Only Wed (3), Thu (4), Fri (5)
    if (meetingDays.includes(dayOfWeek)) {
      for (let hour = meetingStartHour; hour < meetingEndHour; hour++) {
        for (let minute = 0; minute < 60; minute += meetingDurationMinutes) {
          // Skip if this slot would end after meetingEndHour
          const slotEndMinutes = hour * 60 + minute + meetingDurationMinutes;
          if (slotEndMinutes > meetingEndHour * 60) continue;

          const slotStart = new Date(current);
          slotStart.setHours(hour, minute, 0, 0);

          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + meetingDurationMinutes);

          // Skip past slots
          if (slotStart <= now) continue;

          const dayName = DAY_NAMES[dayOfWeek];
          const monthDay = slotStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
          const timeStr = slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

          slots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            dayName,
            displayTime: `${dayName}, ${monthDay} at ${timeStr} ET`,
          });
        }
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return slots;
}

/**
 * Check if a slot overlaps with any busy period.
 */
function isSlotBusy(slot: MeetingSlot, busySlots: { start: string; end: string }[]): boolean {
  const slotStart = new Date(slot.start).getTime();
  const slotEnd = new Date(slot.end).getTime();

  for (const busy of busySlots) {
    const busyStart = new Date(busy.start).getTime();
    const busyEnd = new Date(busy.end).getTime();

    // Overlap if: slot starts before busy ends AND slot ends after busy starts
    if (slotStart < busyEnd && slotEnd > busyStart) {
      return true;
    }
  }

  return false;
}

/**
 * Get available meeting slots on Wed/Thu/Fri that don't conflict with GHL calendars.
 * Returns up to `maxSlots` available time slots.
 */
export async function getAvailableSlots(companyId = 1, maxSlots = 6): Promise<MeetingSlot[]> {
  const candidates = generateCandidateSlots();
  if (candidates.length === 0) return [];

  const rangeStart = candidates[0].start;
  const rangeEnd = candidates[candidates.length - 1].end;

  // Get busy times from GHL calendars
  const allBusySlots: { start: string; end: string }[] = [];
  const ghlClient = ghlService.getClient(companyId);

  if (ghlClient) {
    try {
      const calendars = await ghlClient.getCalendars();
      for (const cal of calendars) {
        const events = await ghlClient.getAppointments(cal.id, rangeStart, rangeEnd);
        for (const evt of events) {
          if (evt.startTime && evt.endTime) {
            allBusySlots.push({ start: evt.startTime, end: evt.endTime });
          }
        }
      }
    } catch (err: any) {
      console.error('[MeetingScheduler] GHL calendar fetch error:', err.message);
    }
  }

  // Filter candidates against busy slots
  const available: MeetingSlot[] = [];
  for (const slot of candidates) {
    if (!isSlotBusy(slot, allBusySlots)) {
      available.push(slot);
      if (available.length >= maxSlots) break;
    }
  }

  return available;
}

/**
 * Format available slots as a human-readable list for email/chat.
 */
export function formatSlotsForMessage(slots: MeetingSlot[]): string {
  if (slots.length === 0) {
    return "I don't have any open slots this week, but let me check my calendar and get back to you.";
  }

  const lines = slots.map((s, i) => `${i + 1}. ${s.displayTime}`);
  return `Here are some times that work on my end:\n\n${lines.join('\n')}\n\nWould any of these work for a quick 30-minute call?`;
}

/**
 * Book a meeting for a contact at the specified slot.
 */
export async function bookMeeting(
  companyId: number,
  ghlContactId: string,
  slot: MeetingSlot,
  leadId?: number,
  notes?: string,
): Promise<BookMeetingResult> {
  const ghlClient = ghlService.getClient(companyId);
  if (!ghlClient) {
    return { success: false, error: 'No GHL client for company' };
  }

  try {
    // Get the first calendar (or the 1-on-1 meeting calendar)
    const calendars = await ghlClient.getCalendars();
    if (calendars.length === 0) {
      return { success: false, error: 'No GHL calendars found' };
    }

    // Prefer calendar with "1-1" or "meeting" in the name, fall back to first
    const targetCal = calendars.find((c: any) =>
      c.name?.toLowerCase().includes('1-1') ||
      c.name?.toLowerCase().includes('meeting') ||
      c.name?.toLowerCase().includes('1 on 1')
    ) || calendars[0];

    const appointment = await ghlClient.createAppointment({
      calendarId: targetCal.id,
      contactId: ghlContactId,
      startTime: slot.start,
      endTime: slot.end,
      title: '1-on-1 Meeting — Granite Park Capital',
      notes: notes || `Scheduled via auto-reply system\nSlot: ${slot.displayTime}`,
    });

    if (!appointment) {
      return { success: false, error: 'GHL appointment creation failed' };
    }

    // Update lead status if we have the lead ID
    if (leadId) {
      runSql(
        `UPDATE enrichment_leads SET status = 'meeting_set' WHERE id = ?`,
        [leadId]
      );

      // Log event
      runSql(
        `INSERT INTO enrichment_events (enrichment_lead_id, company_id, event_type, event_data) VALUES (?, ?, 'meeting_booked', ?)`,
        [leadId, companyId, JSON.stringify({ slot, appointmentId: appointment.id || appointment })]
      );

      saveDb();

      // Record meeting_booked outcome for A/B testing
      recordOutcome(leadId, 'meeting_booked');

      wsServer.broadcast({
        type: 'meeting_booked',
        leadId,
        companyId,
        slot,
      });

      // Send confirmation email via GHL
      sendMeetingConfirmation(companyId, ghlContactId, slot).catch(err => {
        console.error('[MeetingScheduler] Confirmation email failed:', err.message);
      });

      // SMS alert for meeting booked
      import('./sms-notifications').then(({ sendSms }) => {
        const lead = queryOne('SELECT first_name, last_name, email, company_name, score FROM enrichment_leads WHERE id = ?', [leadId]);
        const name = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email : ghlContactId;
        const company = lead?.company_name || '';
        const msg = [
          `MEETING BOOKED`,
          `${name}${company ? ` @ ${company}` : ''}`,
          `${slot.displayTime}`,
          lead?.score ? `Score: ${lead.score}` : '',
        ].filter(Boolean).join('\n');
        sendSms(msg).catch(err => console.error('[SMS] Meeting booked alert error:', err.message));
      }).catch(() => {});

      // Schedule 24-hour and 1-hour reminders
      scheduleMeetingReminders(companyId, ghlContactId, leadId, slot).catch(err => {
        console.error('[MeetingScheduler] Reminder scheduling failed:', err.message);
      });
    }

    return {
      success: true,
      appointmentId: appointment.id || appointment,
      slot,
    };
  } catch (err: any) {
    console.error('[MeetingScheduler] bookMeeting error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a meeting confirmation email via GHL.
 */
async function sendMeetingConfirmation(
  companyId: number,
  ghlContactId: string,
  slot: MeetingSlot,
): Promise<void> {
  const ghlClient = ghlService.getClient(companyId);
  if (!ghlClient) return;

  const subject = `Confirmed: ${slot.displayTime} — Granite Park Capital`;
  const html = [
    `<p>Hi there,</p>`,
    `<p>This confirms your meeting with Marc Realty at <strong>${slot.displayTime}</strong> (30 minutes).</p>`,
    `<p><strong>What to expect:</strong> A brief overview of Granite Park Capital Affordable Housing Fund II and how it may fit your portfolio. No prep needed on your end.</p>`,
    `<p>If you need to reschedule, just reply to this email and we'll find another time.</p>`,
    `<p>Looking forward to connecting,<br/>Marc Realty<br/>Granite Park Capital</p>`,
  ].join('\n');

  await ghlClient.sendMessage({
    contactId: ghlContactId,
    type: 'Email',
    subject,
    html,
  });

  console.log(`[MeetingScheduler] Confirmation email sent for ${slot.displayTime}`);
}

/**
 * Schedule 24-hour and 1-hour reminder messages before a meeting.
 */
async function scheduleMeetingReminders(
  companyId: number,
  ghlContactId: string,
  leadId: number,
  slot: MeetingSlot,
): Promise<void> {
  const meetingTime = new Date(slot.start).getTime();
  const now = Date.now();

  const reminders = [
    { label: '24h', offsetMs: 24 * 60 * 60 * 1000, message: `Quick reminder — you have a call with Marc from Granite Park Capital tomorrow at ${slot.displayTime}. Looking forward to it!` },
    { label: '1h', offsetMs: 60 * 60 * 1000, message: `Just a heads up — your call with Marc from Granite Park Capital starts in about an hour (${slot.displayTime}). Talk soon!` },
  ];

  for (const reminder of reminders) {
    const sendAt = meetingTime - reminder.offsetMs;
    if (sendAt <= now) continue; // Skip if reminder time already passed

    runSql(
      `INSERT INTO enrichment_events (enrichment_lead_id, company_id, event_type, event_data) VALUES (?, ?, 'meeting_reminder_scheduled', ?)`,
      [leadId, companyId, JSON.stringify({
        ghlContactId,
        reminderType: reminder.label,
        sendAt: new Date(sendAt).toISOString(),
        slot,
      })]
    );
  }

  saveDb();
  console.log(`[MeetingScheduler] Reminders scheduled for meeting at ${slot.displayTime}`);
}

/**
 * Process pending meeting reminders — call on a cron interval (every 5 min).
 */
export async function processMeetingReminders(): Promise<number> {
  const pending = queryAll(
    `SELECT * FROM enrichment_events
     WHERE event_type = 'meeting_reminder_scheduled'
       AND json_extract(event_data, '$.sent') IS NULL
       AND json_extract(event_data, '$.sendAt') <= datetime('now')
     ORDER BY created_at ASC LIMIT 10`
  );

  let sent = 0;
  for (const event of pending) {
    const data = JSON.parse(event.event_data);
    const ghlClient = ghlService.getClient(event.company_id);
    if (!ghlClient) continue;

    try {
      await ghlClient.sendMessage({
        contactId: data.ghlContactId,
        type: 'SMS',
        message: data.reminderType === '24h'
          ? `Quick reminder — you have a call with Marc from Granite Park Capital tomorrow at ${data.slot.displayTime}. Looking forward to it!`
          : `Just a heads up — your call with Marc from Granite Park Capital starts in about an hour (${data.slot.displayTime}). Talk soon!`,
      });

      // Mark as sent
      runSql(
        `UPDATE enrichment_events SET event_data = json_set(event_data, '$.sent', 1) WHERE id = ?`,
        [event.id]
      );
      sent++;
      console.log(`[MeetingScheduler] ${data.reminderType} reminder sent for lead ${event.enrichment_lead_id}`);
    } catch (err: any) {
      console.error(`[MeetingScheduler] Reminder send failed:`, err.message);
      runSql(
        `UPDATE enrichment_events SET event_data = json_set(event_data, '$.error', ?) WHERE id = ?`,
        [err.message, event.id]
      );
    }
  }

  if (sent > 0) saveDb();
  return sent;
}

/**
 * Initialize the meeting scheduler (call on server startup).
 */
export async function initMeetingScheduler(): Promise<void> {
  console.log(`[MeetingScheduler] Ready — meetings on ${config.meetings.meetingDays.map(d => DAY_NAMES[d]).join(', ')}, ${config.meetings.meetingStartHour}:00-${config.meetings.meetingEndHour}:00 ET, using GHL calendars`);
}
