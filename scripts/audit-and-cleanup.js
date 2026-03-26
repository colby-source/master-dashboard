const initSqlJs = require('sql.js');
const fs = require('fs');

(async () => {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync('./data/master-dashboard.db');
  const db = new SQL.Database(buf);

  console.log('========= BMN REPLY AUDIT — PAST 5 DAYS =========\n');

  // 1. Get unique leads who replied (deduplicated by email)
  var r = db.exec(
    "SELECT DISTINCT rt.email, rt.last_sentiment, rt.thread_status, rt.auto_reply_count, rt.message_count, rt.created_at, rt.id " +
    "FROM reply_threads rt " +
    "WHERE rt.company_id = 2 AND rt.created_at >= datetime('now', '-5 days') " +
    "ORDER BY rt.email, rt.created_at DESC"
  );

  // Dedupe by email — keep the newest thread per email
  var byEmail = {};
  if (r.length) {
    for (var v of r[0].values) {
      var email = v[0];
      if (!byEmail[email]) {
        byEmail[email] = { email: email, sentiment: v[1], status: v[2], autoReplies: v[3], msgs: v[4], created: v[5], threadId: v[6], dupeThreads: 0 };
      } else {
        byEmail[email].dupeThreads++;
      }
    }
  }

  var leads = Object.values(byEmail);
  console.log('UNIQUE LEADS WHO REPLIED: ' + leads.length + '\n');

  // 2. For each unique lead, show their conversation status
  var interested = [];
  var notInterested = [];
  var needsAttention = [];
  var handled = [];

  for (var lead of leads) {
    // Get the latest inbound message
    var inbound = db.exec(
      "SELECT SUBSTR(body, 1, 250) FROM reply_messages WHERE thread_id = " + lead.threadId + " AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1"
    );
    var inboundText = (inbound.length && inbound[0].values.length) ? inbound[0].values[0][0] : '(no inbound found)';
    inboundText = String(inboundText).replace(/\n/g, ' ').replace(/<[^>]+>/g, '').substring(0, 150);

    // Get the latest outbound message and its status
    var outbound = db.exec(
      "SELECT SUBSTR(body, 1, 250), sent, last_error, generated_by FROM reply_messages WHERE thread_id = " + lead.threadId + " AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1"
    );
    var outText = '(no reply generated)';
    var outStatus = 'none';
    var outError = '';
    if (outbound.length && outbound[0].values.length) {
      outText = String(outbound[0].values[0][0]).replace(/\n/g, ' ').replace(/<[^>]+>/g, '').substring(0, 150);
      var sentVal = outbound[0].values[0][1];
      outStatus = sentVal === 1 ? 'SENT' : sentVal === -1 ? 'FAILED' : sentVal === 0 ? 'PENDING' : String(sentVal);
      outError = outbound[0].values[0][2] || '';
    }

    var entry = {
      email: lead.email,
      sentiment: lead.sentiment,
      status: lead.status,
      autoReplies: lead.autoReplies,
      dupeThreads: lead.dupeThreads,
      inbound: inboundText,
      outbound: outText,
      outStatus: outStatus,
      outError: outError
    };

    if (lead.sentiment === 'interested' || lead.sentiment === 'positive') {
      interested.push(entry);
    } else if (lead.sentiment === 'not_interested' || lead.sentiment === 'negative') {
      notInterested.push(entry);
    } else {
      handled.push(entry);
    }

    // Flag issues
    if (lead.status === 'active' && lead.autoReplies === 0) {
      needsAttention.push(entry);
    }
  }

  // Print interested leads (most important)
  console.log('--- INTERESTED / POSITIVE LEADS (' + interested.length + ') ---');
  for (var e of interested) {
    console.log('\n  ' + e.email + ' [' + e.status + '] sentiment=' + e.sentiment + ' auto_replies=' + e.autoReplies + (e.dupeThreads > 0 ? ' DUPES=' + e.dupeThreads : ''));
    console.log('    THEM: "' + e.inbound + '"');
    console.log('    US [' + e.outStatus + ']: "' + e.outbound + '"');
    if (e.outError && !e.outError.includes('cancel') && !e.outError.includes('cleanup')) {
      console.log('    ERROR: ' + e.outError.substring(0, 80));
    }
  }

  console.log('\n\n--- NOT INTERESTED / NEGATIVE LEADS (' + notInterested.length + ') ---');
  for (var e of notInterested) {
    console.log('\n  ' + e.email + ' [' + e.status + '] sentiment=' + e.sentiment + ' auto_replies=' + e.autoReplies);
    console.log('    THEM: "' + e.inbound + '"');
    console.log('    US [' + e.outStatus + ']: "' + e.outbound + '"');
  }

  console.log('\n\n--- OTHER LEADS (' + handled.length + ') ---');
  for (var e of handled) {
    console.log('  ' + e.email + ' [' + e.status + '] sentiment=' + e.sentiment + ' auto_replies=' + e.autoReplies);
  }

  if (needsAttention.length > 0) {
    console.log('\n\n!!! NEEDS ATTENTION — Active threads with 0 auto-replies:');
    for (var e of needsAttention) {
      console.log('  ' + e.email + ' | sentiment=' + e.sentiment);
      console.log('    THEM: "' + e.inbound + '"');
    }
  }

  // 3. CLEANUP — cancel all junk
  console.log('\n\n========= CLEANUP =========');

  // Cancel pending replies on non-active threads
  var res = db.exec("SELECT COUNT(*) FROM reply_messages WHERE sent = 0 AND direction = 'outbound' AND thread_id IN (SELECT id FROM reply_threads WHERE thread_status IN ('paused', 'closed', 'escalated'))");
  var nonActiveCount = res[0].values[0][0];
  db.run("UPDATE reply_messages SET sent = 1, last_error = 'cancelled_thread_not_active' WHERE sent = 0 AND direction = 'outbound' AND thread_id IN (SELECT id FROM reply_threads WHERE thread_status IN ('paused', 'closed', 'escalated'))");
  console.log('Cancelled ' + nonActiveCount + ' pending replies on paused/closed/escalated threads');

  // For active threads with multiple pending, keep only newest
  var multiPending = db.exec("SELECT thread_id, COUNT(*) as cnt FROM reply_messages WHERE sent = 0 AND direction = 'outbound' GROUP BY thread_id HAVING cnt > 1");
  var dedupedCount = 0;
  if (multiPending.length) {
    for (var row of multiPending[0].values) {
      var tid = row[0];
      db.run("UPDATE reply_messages SET sent = 1, last_error = 'cleanup_duplicate' WHERE sent = 0 AND direction = 'outbound' AND thread_id = ? AND id NOT IN (SELECT id FROM reply_messages WHERE sent = 0 AND direction = 'outbound' AND thread_id = ? ORDER BY id DESC LIMIT 1)", [tid, tid]);
      dedupedCount += row[1] - 1;
    }
  }
  console.log('Cleaned ' + dedupedCount + ' duplicate pending replies');

  // Reset retry counts on remaining pending
  db.run("UPDATE reply_messages SET retry_count = 0, last_error = NULL WHERE sent = 0 AND direction = 'outbound'");

  // Final count
  var final = db.exec("SELECT rm.id, rt.email, rt.thread_status, rm.scheduled_at FROM reply_messages rm JOIN reply_threads rt ON rm.thread_id = rt.id WHERE rm.sent = 0 AND rm.direction = 'outbound' ORDER BY rm.id");
  if (final.length) {
    console.log('\nFinal pending replies (' + final[0].values.length + '):');
    for (var v of final[0].values) {
      console.log('  id=' + v[0] + ' | ' + v[1] + ' | ' + v[2] + ' | sched=' + v[3]);
    }
  } else {
    console.log('\nNo pending replies remaining');
  }

  // Save
  var data = db.export();
  fs.writeFileSync('./data/master-dashboard.db', Buffer.from(data));
  console.log('\nDB saved to disk');
})();
