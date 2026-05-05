module.exports = {
  apps: [
    {
      name: 'master-dashboard-server',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'watch server/index.ts',
      cwd: __dirname,
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
      },
      error_file: 'logs/pm2-server-error.log',
      out_file: 'logs/pm2-server-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'master-dashboard-client',
      script: 'node_modules/vite/bin/vite.js',
      args: '--host',
      cwd: require('path').join(__dirname, 'client'),
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '1G',
      error_file: '../logs/pm2-client-error.log',
      out_file: '../logs/pm2-client-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Campaign delay-violation watchdog. cron_restart kicks a fresh
      // instance Monday-Friday at 07:30 ET, ahead of the 08:00 send window.
      // The script self-exits at 18:00 ET when the window closes.
      name: 'gpf2-watchdog',
      script: 'scripts/watchdog-loop.sh',
      cwd: __dirname,
      interpreter: 'bash',
      watch: false,
      autorestart: false,           // don't restart on natural exit
      cron_restart: '30 7 * * 1-5', // Mon-Fri 07:30 local
      env: {
        WATCHDOG_CAMPAIGN_ID: 'efdf292b-b958-415c-ab57-5bf117f656d3',
      },
      error_file: 'logs/pm2-watchdog-error.log',
      out_file: 'logs/pm2-watchdog-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Hourly health snapshot for GPF-II Primary. Standalone — does not
      // depend on master-dashboard-server. Writes to data/gpf2-monitoring.jsonl
      // and prints a one-line summary to PM2 logs. Exits non-zero on threshold
      // breach so `pm2 logs gpf2-monitor` shows alert history.
      name: 'gpf2-monitor',
      script: 'scripts/gpf2-monitor.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '*/15 8-17 * * 1-5', // every 15min during 08-17 ET, Mon-Fri
      env: {
        MONITOR_CAMPAIGN_ID: 'efdf292b-b958-415c-ab57-5bf117f656d3',
      },
      error_file: 'logs/pm2-monitor-error.log',
      out_file: 'logs/pm2-monitor-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Subject-pattern self-learning optimizer. Runs each weekday at
      // 14:00 ET — after 6 hours of opens have accumulated. Dry-run by
      // default for the first 5 days; switch script args to '--apply'
      // once the open-rate sample is statistically significant.
      name: 'gpf2-optimizer',
      script: 'scripts/instantly-subject-optimizer.py',
      args: 'efdf292b-b958-415c-ab57-5bf117f656d3',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '0 14 * * 1-5', // Mon-Fri 14:00 local
      error_file: 'logs/pm2-optimizer-error.log',
      out_file: 'logs/pm2-optimizer-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Daily lead-cadence mover for the GPF-II 4-touch architecture.
      // Replaces the broken Instantly multi-step sequence: 4 single-step
      // campaigns (Touch 1-4), this script promotes leads between them
      // at 3 / 7 / 7 day intervals. Skips leads with interest_status set.
      // Runs Mon-Fri 08:00 local (before sending window opens).
      // Logs to logs/gpf2-cadence.log.
      name: 'gpf2-touch-cadence',
      script: 'scripts/gpf2-touch-cadence.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '0 8 * * 1-5', // Mon-Fri 08:00 local
      error_file: 'logs/pm2-cadence-error.log',
      out_file: 'logs/pm2-cadence-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // One-shot Monday launch: adds 6 renames to Touch 1-4 email_list,
      // sets daily_limit=5 on each, loads first 200 leads from queue.
      // Fires once at 07:30 ET on May 4, 2026. Won't fire again (date-pinned).
      name: 'gpf2-monday-launch',
      script: 'scripts/gpf2-monday-launch.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '30 7 4 5 *', // 07:30 local on May 4 (one-shot)
      error_file: 'logs/pm2-monday-launch-error.log',
      out_file: 'logs/pm2-monday-launch-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Daily inbox ramp: bumps daily_limit on the 6 rename inboxes
      // following the schedule 5/5,10,15,20,25 across 5/4-5/8.
      // Runs Mon-Fri 07:00 local (before sending window opens).
      // No-ops on dates outside the 5/4-5/8 ramp window.
      name: 'gpf2-inbox-ramp',
      script: 'scripts/gpf2-ramp-inboxes.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '0 7 * * 1-5', // Mon-Fri 07:00 local
      error_file: 'logs/pm2-ramp-error.log',
      out_file: 'logs/pm2-ramp-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Daily lead loader: pulls top-ranked unloaded leads from the
      // 3K queue and POSTs them to Touch 1 at the day's capacity.
      // Week 1 capacity 90->210/day as renames ramp; load=150/day matches
      // weekly send capacity (~750) without backlog buildup.
      // Runs Mon-Fri 08:30 local (after ramp, before sending window).
      name: 'gpf2-daily-loader',
      script: 'scripts/gpf2-load-from-queue.py',
      args: '150',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '30 8 * * 1-5', // Mon-Fri 08:30 local
      error_file: 'logs/pm2-loader-error.log',
      out_file: 'logs/pm2-loader-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Self-learning insights collector. Captures every signal worth
      // learning from (per-inbox, per-subject, per-tier, per-touch, hourly,
      // bounce-domain, placement). Snapshot saved to data/gpf2-learnings/.
      // Runs daily 23:00 local (after sending window closes).
      name: 'gpf2-insights',
      script: 'scripts/gpf2-insights.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '0 23 * * *', // every day at 23:00 local
      error_file: 'logs/pm2-insights-error.log',
      out_file: 'logs/pm2-insights-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Rules engine: evaluates today's snapshot against trends, auto-pauses
      // underperforming inboxes (--execute), surfaces alerts to Telegram.
      // Runs daily 23:30 local (after insights collector finishes).
      name: 'gpf2-rules-engine',
      script: 'scripts/gpf2-rules-engine.py',
      args: '--execute',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '30 23 * * *',
      error_file: 'logs/pm2-rules-error.log',
      out_file: 'logs/pm2-rules-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Reply classifier: pulls inbound replies, classifies via Claude,
      // updates interest_status in Instantly, logs to learnings file.
      // Runs hourly during business hours so hot replies get auto-routed
      // to interest_status=1 within ~60 min of arrival.
      name: 'gpf2-reply-classifier',
      script: 'scripts/gpf2-reply-classifier.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '15 8-18 * * 1-5', // hourly :15 during 8am-6pm Mon-Fri
      error_file: 'logs/pm2-replies-error.log',
      out_file: 'logs/pm2-replies-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Two-way Telegram listener — Colby talks to the campaign.
      // Long-polls Telegram getUpdates, routes inbound messages through
      // Claude with a read-only Instantly toolset, replies in chat.
      // Long-running process — autorestart on crash. Single instance only.
      name: 'gpf2-telegram-listener',
      script: 'scripts/gpf2-telegram-listener.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      max_memory_restart: '500M',
      error_file: 'logs/pm2-telegram-listener-error.log',
      out_file: 'logs/pm2-telegram-listener-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // One-shot Monday-morning verify: fires once at 08:35 ET on May 4
      // (~35 min into send window, just after daily-loader). Confirms T1
      // active, today's first-half-hour sends, no inbox suspensions.
      // Sends Telegram. Won't fire again (date-pinned).
      name: 'gpf2-monday-verify',
      script: 'scripts/gpf2-monday-verify.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '35 8 4 5 *', // 08:35 local on May 4 (one-shot)
      error_file: 'logs/pm2-monday-verify-error.log',
      out_file: 'logs/pm2-monday-verify-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // End-of-day campaign-employee debrief. Aggregates today's send,
      // per-touch, per-inbox stats and pushes a Telegram report at 17:30
      // (after the 17:00 send-window close). Acts like an employee filing
      // an EOD report so Colby has a single daily checkpoint.
      name: 'gpf2-debrief',
      script: 'scripts/gpf2-debrief.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '30 17 * * 1-5', // Mon-Fri 17:30 local
      error_file: 'logs/pm2-debrief-error.log',
      out_file: 'logs/pm2-debrief-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // Weekly report: WoW deltas, best performers, recommendations.
      // Sent to Telegram. Runs Friday 16:00 local (before end of work week).
      name: 'gpf2-weekly-report',
      script: 'scripts/gpf2-weekly-report.py',
      cwd: __dirname,
      interpreter: 'python',
      watch: false,
      autorestart: false,
      cron_restart: '0 16 * * 5', // Friday 16:00 local
      error_file: 'logs/pm2-weekly-error.log',
      out_file: 'logs/pm2-weekly-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
