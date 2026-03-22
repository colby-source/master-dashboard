#!/usr/bin/env npx tsx
/**
 * GHL Calendar Audit Script
 *
 * Pulls all calendars from GHL for Grand Park Capital (Company 1),
 * lists their configurations, connected accounts, and conflict settings.
 */

import 'dotenv/config';
import axios from 'axios';

const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const GHL_BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';

if (!GHL_API_KEY) throw new Error('GHL_API_KEY not set');
if (!GHL_LOCATION_ID) throw new Error('GHL_LOCATION_ID not set');

const client = axios.create({
  baseURL: GHL_BASE_URL,
  headers: {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  GHL Calendar Audit — Grand Park Capital                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── 1. Fetch all calendars ──
  console.log('[1] Fetching all calendars...\n');
  const { data: calData } = await client.get('/calendars/', {
    params: { locationId: GHL_LOCATION_ID },
  });

  const calendars = calData?.calendars || [];
  console.log(`  Found ${calendars.length} calendar(s)\n`);

  for (const cal of calendars) {
    console.log('  ─────────────────────────────────────────────');
    console.log(`  Calendar: ${cal.name}`);
    console.log(`  ID: ${cal.id}`);
    console.log(`  Type: ${cal.calendarType || cal.type || 'unknown'}`);
    console.log(`  Slug: ${cal.slug || '—'}`);
    console.log(`  Widget Type: ${cal.widgetType || '—'}`);
    console.log(`  Duration: ${cal.slotDuration || cal.eventDuration || '—'} min`);
    console.log(`  Interval: ${cal.slotInterval || cal.eventInterval || '—'} min`);
    console.log(`  Buffer: ${cal.slotBuffer || cal.eventBuffer || '—'} min`);
    console.log(`  Timezone: ${cal.timezone || '—'}`);
    console.log(`  Status: ${cal.isActive !== undefined ? (cal.isActive ? 'Active' : 'Inactive') : '—'}`);

    // Availability / Open hours
    if (cal.openHours || cal.availability) {
      console.log(`  Open Hours:`, JSON.stringify(cal.openHours || cal.availability, null, 2).split('\n').map((l: string, i: number) => i === 0 ? l : `    ${l}`).join('\n'));
    }

    // Connected calendars / Google integration
    if (cal.connectedCalendars) {
      console.log(`  Connected Calendars:`, JSON.stringify(cal.connectedCalendars, null, 2));
    }
    if (cal.googleCalendar) {
      console.log(`  Google Calendar:`, JSON.stringify(cal.googleCalendar, null, 2));
    }

    // Team members (who is assigned)
    if (cal.teamMembers && cal.teamMembers.length > 0) {
      console.log(`  Team Members:`);
      for (const member of cal.teamMembers) {
        console.log(`    - ${member.name || member.email || member.userId} (${member.priority || 'no priority'})`);
      }
    }

    // Notification settings
    if (cal.notifications) {
      console.log(`  Notifications:`, JSON.stringify(cal.notifications, null, 2));
    }

    // Look for any conflict/check-conflict settings
    if (cal.shouldAssignContactToTeamMember !== undefined) {
      console.log(`  Auto-assign contact: ${cal.shouldAssignContactToTeamMember}`);
    }

    // Dump full object keys for inspection
    const knownKeys = ['id', 'name', 'calendarType', 'type', 'slug', 'widgetType', 'slotDuration', 'slotInterval', 'slotBuffer', 'timezone', 'isActive', 'openHours', 'availability', 'connectedCalendars', 'googleCalendar', 'teamMembers', 'notifications', 'shouldAssignContactToTeamMember', 'eventDuration', 'eventInterval', 'eventBuffer'];
    const extraKeys = Object.keys(cal).filter(k => !knownKeys.includes(k));
    if (extraKeys.length > 0) {
      console.log(`  Other fields: ${extraKeys.join(', ')}`);
      for (const k of extraKeys) {
        const v = cal[k];
        if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) {
          const display = typeof v === 'object' ? JSON.stringify(v, null, 2) : v;
          console.log(`    ${k}: ${display}`);
        }
      }
    }

    console.log();
  }

  // ── 2. Fetch calendar-specific details (individual GET) ──
  console.log('\n[2] Fetching detailed config per calendar...\n');
  for (const cal of calendars) {
    try {
      const { data: detail } = await client.get(`/calendars/${cal.id}`);
      const calDetail = detail?.calendar || detail;

      console.log(`  ── ${calDetail.name || cal.name} (detailed) ──`);

      // Look for conflict calendar settings
      const conflictKeys = Object.keys(calDetail).filter(k =>
        k.toLowerCase().includes('conflict') ||
        k.toLowerCase().includes('check') ||
        k.toLowerCase().includes('connected') ||
        k.toLowerCase().includes('google') ||
        k.toLowerCase().includes('outlook') ||
        k.toLowerCase().includes('integration')
      );

      if (conflictKeys.length > 0) {
        console.log('  Conflict/Integration settings:');
        for (const k of conflictKeys) {
          console.log(`    ${k}:`, JSON.stringify(calDetail[k], null, 2));
        }
      }

      // Team members with calendar connections
      if (calDetail.teamMembers) {
        console.log('  Team Members (detailed):');
        for (const tm of calDetail.teamMembers) {
          console.log(`    - User: ${tm.userId || tm.email || tm.name}`);
          if (tm.calendarConfig) console.log(`      calendarConfig:`, JSON.stringify(tm.calendarConfig, null, 2));
          if (tm.selectedCalendars) console.log(`      selectedCalendars:`, JSON.stringify(tm.selectedCalendars, null, 2));
          if (tm.googleCalendarId) console.log(`      googleCalendarId: ${tm.googleCalendarId}`);
          // Dump all tm keys
          const tmExtra = Object.keys(tm).filter(k => !['userId', 'email', 'name', 'calendarConfig', 'selectedCalendars', 'googleCalendarId', 'priority'].includes(k));
          for (const k of tmExtra) {
            if (tm[k] !== null && tm[k] !== undefined && tm[k] !== '') {
              console.log(`      ${k}:`, typeof tm[k] === 'object' ? JSON.stringify(tm[k], null, 2) : tm[k]);
            }
          }
        }
      }

      // Full dump for debugging
      console.log('  Full keys:', Object.keys(calDetail).join(', '));
      console.log();
    } catch (err: any) {
      console.error(`  Error fetching ${cal.name}: ${err.response?.data?.message || err.message}`);
    }
  }

  // ── 3. Check what the meeting-scheduler code would select ──
  console.log('\n[3] Code Selection Logic Check...\n');
  const targetCal = calendars.find((c: any) =>
    c.name?.toLowerCase().includes('1-1') ||
    c.name?.toLowerCase().includes('meeting') ||
    c.name?.toLowerCase().includes('1 on 1')
  ) || calendars[0];

  console.log(`  Code would book on: "${targetCal?.name}" (${targetCal?.id})`);
  console.log(`  Selection reason: ${
    targetCal?.name?.toLowerCase().includes('1-1') ? 'matched "1-1"' :
    targetCal?.name?.toLowerCase().includes('meeting') ? 'matched "meeting"' :
    targetCal?.name?.toLowerCase().includes('1 on 1') ? 'matched "1 on 1"' :
    'fallback to first calendar'
  }`);

  // Check if "GoHighLevel meeting" would match
  const ghlMeetingCal = calendars.find((c: any) =>
    c.name?.toLowerCase().includes('gohighlevel meeting') ||
    c.name?.toLowerCase() === 'gohighlevel meeting'
  );
  if (ghlMeetingCal) {
    console.log(`  ✓ "GoHighLevel meeting" calendar found: ${ghlMeetingCal.id}`);
    if (ghlMeetingCal.id === targetCal?.id) {
      console.log(`  ✓ Code correctly selects this calendar`);
    } else {
      console.log(`  ✗ Code selects "${targetCal?.name}" instead — needs fix`);
    }
  } else {
    console.log(`  ✗ No calendar named "GoHighLevel meeting" found`);
    console.log(`  Available names: ${calendars.map((c: any) => `"${c.name}"`).join(', ')}`);
  }

  // ── 4. Conflict calendar check ──
  console.log('\n[4] Conflict Calendar Requirements...\n');
  console.log('  Required conflict calendars:');
  console.log('    - colby@grantpark.co (Google Calendar)');
  console.log('    - colby@brandmenow.ai (Google Calendar)');
  console.log('    - colby@whbiopharma.* (Google Calendar)');
  console.log();
  console.log('  Check the team member / connected calendar data above to verify these are connected.');

  // ── 5. Fetch upcoming appointments to verify booking works ──
  console.log('\n[5] Upcoming appointments (next 7 days)...\n');
  const now = new Date();
  const weekOut = new Date(now);
  weekOut.setDate(weekOut.getDate() + 7);

  for (const cal of calendars) {
    try {
      const { data: evtData } = await client.get('/calendars/events', {
        params: {
          locationId: GHL_LOCATION_ID,
          calendarId: cal.id,
          startTime: now.toISOString(),
          endTime: weekOut.toISOString(),
        },
      });
      const events = evtData?.events || [];
      console.log(`  ${cal.name}: ${events.length} event(s)`);
      for (const evt of events.slice(0, 5)) {
        const start = evt.startTime ? new Date(evt.startTime).toLocaleString() : '?';
        console.log(`    - ${evt.title || 'Untitled'} | ${start} | Status: ${evt.appointmentStatus || '?'}`);
      }
      if (events.length > 5) console.log(`    ... and ${events.length - 5} more`);
    } catch (err: any) {
      console.error(`  ${cal.name}: Error — ${err.response?.data?.message || err.message}`);
    }
  }

  // ── 6. Try free-slots endpoint ──
  console.log('\n[6] Free Slots API check (next 3 days)...\n');
  const threeDays = new Date(now);
  threeDays.setDate(threeDays.getDate() + 3);

  for (const cal of calendars) {
    try {
      const { data: freeData } = await client.get(`/calendars/${cal.id}/free-slots`, {
        params: {
          startDate: now.toISOString().split('T')[0],
          endDate: threeDays.toISOString().split('T')[0],
          timezone: 'America/New_York',
        },
      });
      const slots = freeData?.slots || freeData;
      const slotCount = typeof slots === 'object' ? Object.keys(slots).length : 0;
      console.log(`  ${cal.name}: free-slots response has ${slotCount} date(s)`);
      // Show first day's slots
      if (typeof slots === 'object') {
        const firstDay = Object.keys(slots)[0];
        if (firstDay && Array.isArray(slots[firstDay])) {
          console.log(`    ${firstDay}: ${slots[firstDay].length} slot(s) — first: ${slots[firstDay][0] || '—'}`);
        }
      }
    } catch (err: any) {
      console.error(`  ${cal.name}: free-slots error — ${err.response?.status} ${err.response?.data?.message || err.message}`);
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Audit complete. Review output above for:');
  console.log('  1. Which calendar the code selects for booking');
  console.log('  2. Whether conflict calendars are connected');
  console.log('  3. Whether free-slots API respects conflicts');
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('[FATAL]', err.response?.data || err.message);
  process.exit(1);
});
