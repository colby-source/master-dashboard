const initSqlJs = require('sql.js');
const fs = require('fs');

(async () => {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync('./data/master-dashboard.db');
  const db = new SQL.Database(buf);

  const threads = db.exec(
    "SELECT rt.id, rt.email, rt.thread_status, rt.message_count, rt.auto_reply_count, " +
    "rt.last_sentiment, rt.subject, rt.instantly_email_id, rt.company_id, " +
    "rt.created_at, rt.last_message_at " +
    "FROM reply_threads rt " +
    "WHERE rt.company_id = 2 AND rt.created_at >= datetime('now', '-5 days') " +
    "ORDER BY rt.created_at DESC"
  );

  if (!threads.length) { console.log('No threads found'); return; }

  console.log('BMN Reply Threads (past 5 days): ' + threads[0].values.length);
  console.log('='.repeat(120));

  let summary = { total: 0, sent: 0, failed: 0, pending: 0, cancelled: 0, noReplyNeeded: 0 };

  for (const t of threads[0].values) {
    const [id, email, status, msgCount, autoCount, sentiment, subject, emailId, companyId, created, lastMsg] = t;
    console.log('\n--- Thread #' + id + ' | ' + email + ' | status=' + status + ' | sentiment=' + sentiment + ' ---');
    console.log('  subject: ' + (subject || '(none)') + ' | created: ' + created + ' | last_msg: ' + lastMsg);
    console.log('  msgs=' + msgCount + ' | auto_replies=' + autoCount + ' | instantly_email_id=' + (emailId || 'null'));
    summary.total++;

    const msgs = db.exec(
      "SELECT id, direction, sentiment, generated_by, strategy, sent, retry_count, last_error, " +
      "scheduled_at, created_at, SUBSTR(body, 1, 300) as body_preview " +
      "FROM reply_messages WHERE thread_id = " + id + " ORDER BY created_at ASC"
    );

    if (msgs.length) {
      for (const m of msgs[0].values) {
        const [mid, dir, mSentiment, genBy, strat, sent, retry, err, schedAt, createdAt, body] = m;
        const sentLabel = sent === 1 ? 'SENT' : sent === -1 ? 'FAILED' : sent === 0 ? 'PENDING' : String(sent);
        const dirIcon = dir === 'inbound' ? '<--' : '-->';
        const errStr = err ? ' | err=' + String(err).substring(0, 80) : '';

        if (dir === 'outbound') {
          if (sent === 1 && err && err.includes('cancel')) summary.cancelled++;
          else if (sent === 1) summary.sent++;
          else if (sent === -1) summary.failed++;
          else if (sent === 0) summary.pending++;
        }

        console.log('  ' + dirIcon + ' [' + sentLabel + '] id=' + mid + ' | by=' + (genBy || 'lead') + ' | strat=' + (strat || '-') + ' | ' + createdAt + errStr);
        const preview = (body || '').replace(/\n/g, ' ').replace(/<[^>]+>/g, '').substring(0, 180);
        console.log('     "' + preview + '"');
      }
    } else {
      console.log('  (no messages found)');
      summary.noReplyNeeded++;
    }
  }

  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY:');
  console.log('  Total threads: ' + summary.total);
  console.log('  Outbound sent: ' + summary.sent);
  console.log('  Outbound failed: ' + summary.failed);
  console.log('  Outbound pending: ' + summary.pending);
  console.log('  Outbound cancelled: ' + summary.cancelled);
  console.log('  No reply needed: ' + summary.noReplyNeeded);

  // Also check for any threads that should have a reply but don't
  const orphans = db.exec(
    "SELECT rt.id, rt.email, rt.thread_status, rt.last_sentiment, rt.created_at " +
    "FROM reply_threads rt " +
    "WHERE rt.company_id = 2 AND rt.created_at >= datetime('now', '-5 days') " +
    "AND rt.thread_status = 'active' " +
    "AND NOT EXISTS (SELECT 1 FROM reply_messages rm WHERE rm.thread_id = rt.id AND rm.direction = 'outbound') " +
    "ORDER BY rt.created_at DESC"
  );

  if (orphans.length && orphans[0].values.length > 0) {
    console.log('\nWARNING - Active threads with NO outbound reply:');
    for (const o of orphans[0].values) {
      console.log('  Thread #' + o[0] + ' | ' + o[1] + ' | status=' + o[2] + ' | sentiment=' + o[3] + ' | ' + o[4]);
    }
  } else {
    console.log('\nNo orphaned active threads found (all active threads have replies)');
  }
})();
