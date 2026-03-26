const initSqlJs = require('sql.js');
const fs = require('fs');
const axios = require('axios');
require('dotenv/config');

const ghlApiKey = process.env.GHL_API_KEY_BNN;
const ghlBaseUrl = 'https://services.leadconnectorhq.com';

if (!ghlApiKey) {
  console.error('No GHL_API_KEY_BNN found');
  process.exit(1);
}

async function main() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync('./data/master-dashboard.db');
  const db = new SQL.Database(buf);

  // Get all auto-booked BMN appointments
  const result = db.exec("SELECT id, event_data FROM enrichment_events WHERE company_id = 2 AND event_type = 'meeting_booked' ORDER BY created_at DESC");
  if (!result.length) { console.log('None found'); return; }

  const appointments = result[0].values.map(v => {
    const data = JSON.parse(v[1]);
    return { eventId: v[0], appointmentId: data.appointmentId, time: data.slot?.displayTime };
  });

  console.log('Cancelling ' + appointments.length + ' auto-booked appointments...\n');

  let cancelled = 0;
  let failed = 0;
  let alreadyCancelled = 0;

  for (const apt of appointments) {
    try {
      await axios.put(
        ghlBaseUrl + '/calendars/events/appointments/' + apt.appointmentId,
        { status: 'cancelled' },
        {
          headers: {
            'Authorization': 'Bearer ' + ghlApiKey,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );
      cancelled++;
      console.log('CANCELLED: ' + apt.appointmentId + ' (' + apt.time + ')');
    } catch (err) {
      const status = err.response?.status;
      if (status === 404 || status === 422) {
        alreadyCancelled++;
        console.log('ALREADY GONE: ' + apt.appointmentId + ' (' + apt.time + ')');
      } else {
        failed++;
        console.error('FAILED: ' + apt.appointmentId + ' - ' + (status || err.message) + ' ' + JSON.stringify(err.response?.data || '').slice(0, 200));
      }
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\nDone: ' + cancelled + ' cancelled, ' + alreadyCancelled + ' already gone, ' + failed + ' failed');
}

main().catch(err => console.error(err));
