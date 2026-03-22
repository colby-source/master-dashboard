import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { domainHealthService } from '../services/domain-health-service';
import { instantlyService } from '../services/instantly-service';

const router = Router();

// GET /warmup-status — current warmup readiness overview
router.get('/warmup-status', (req, res) => {
  try {
    const row = queryOne('SELECT status_json, updated_at FROM warmup_status WHERE id = 1');
    if (!row) {
      return res.json({ total: 0, warming: 0, ready: 0, not_warming: 0, ready_accounts: [], checked_at: null, estimated_ready_date: null });
    }
    const status = JSON.parse(row.status_json);
    res.json({ ...status, updated_at: row.updated_at });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /warmup-check — force an immediate warmup check (bypasses 6hr throttle)
router.post('/warmup-check', async (req, res) => {
  try {
    const result = await instantlyService.listAccounts({ limit: 100 });
    const accounts = result?.items ?? result ?? [];
    const now = Date.now();

    const summary = accounts.reduce((acc: any, acct: any) => {
      if (acct.warmup_status !== 1 || !acct.timestamp_warmup_start) {
        acc.not_warming++;
        return acc;
      }
      acc.warming++;
      const daysWarming = (now - new Date(acct.timestamp_warmup_start).getTime()) / (1000 * 60 * 60 * 24);
      if (daysWarming >= 14 && (acct.stat_warmup_score ?? 0) >= 80) {
        acc.ready++;
        acc.ready_accounts.push(acct.email);
      }
      return acc;
    }, { total: accounts.length, warming: 0, ready: 0, not_warming: 0, ready_accounts: [] as string[] });

    // Calculate estimated ready date
    const warmingAccounts = accounts.filter((a: any) => a.warmup_status === 1 && a.timestamp_warmup_start);
    const starts = warmingAccounts.map((a: any) => new Date(a.timestamp_warmup_start).getTime());
    const earliest = starts.length ? Math.min(...starts) : null;
    summary.estimated_ready_date = earliest ? new Date(earliest + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null;
    summary.checked_at = new Date().toISOString();

    // Store in DB
    const statusJson = JSON.stringify(summary);
    const existing = queryOne('SELECT id FROM warmup_status WHERE id = 1');
    if (existing) {
      runSql('UPDATE warmup_status SET status_json = ?, updated_at = datetime(\'now\') WHERE id = 1', [statusJson]);
    } else {
      runSql('INSERT INTO warmup_status (id, status_json) VALUES (1, ?)', [statusJson]);
    }
    saveDb();

    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /domains — all domains with latest health snapshot
router.get('/domains', (req, res) => {
  try {
    const snapshots = domainHealthService.getLatestSnapshots();
    res.json(snapshots);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /domains/:domain — single domain detail + history
router.get('/domains/:domain', (req, res) => {
  try {
    const { domain } = req.params;
    const limit = parseInt(req.query.limit as string) || 30;
    const latest = queryOne(
      'SELECT * FROM domain_health_snapshots WHERE domain = ? ORDER BY checked_at DESC LIMIT 1',
      [domain]
    );
    const history = domainHealthService.getDomainHistory(domain, limit);
    res.json({ latest, history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /accounts — all Instantly accounts with warmup status
router.get('/accounts', async (req, res) => {
  try {
    const allAccounts: any[] = [];
    let startingAfter: string | undefined;
    for (let i = 0; i < 10; i++) {
      const result = await instantlyService.listAccounts({ limit: 100, starting_after: startingAfter });
      const items = result?.items ?? result ?? [];
      if (!Array.isArray(items) || items.length === 0) break;
      allAccounts.push(...items);
      startingAfter = result?.next_starting_after;
      if (!startingAfter || items.length < 100) break;
    }

    // Get warmup analytics
    const warmupData = await instantlyService.getWarmupAnalytics({ limit: 1000 });
    const warmupMap = new Map<string, any>();
    if (Array.isArray(warmupData?.items ?? warmupData)) {
      for (const w of warmupData?.items ?? warmupData) {
        if (w.email || w.account_id) {
          warmupMap.set(w.email || w.account_id, w);
        }
      }
    }

    // Get latest health snapshots for DNS/blacklist context
    const snapshots = domainHealthService.getLatestSnapshots();
    const domainHealthMap = new Map<string, any>();
    for (const s of snapshots) {
      domainHealthMap.set(s.domain, s);
    }

    const cfg = domainHealthService.getConfig();
    const accounts = allAccounts.map(account => {
      const domain = (account.email || '').split('@')[1] || '';
      const healthSnapshot = domainHealthMap.get(domain);
      const warmup = warmupMap.get(account.email) || {};

      const dnsResult = {
        spf_valid: !!healthSnapshot?.spf_valid,
        dkim_valid: !!healthSnapshot?.dkim_valid,
        dmarc_valid: !!healthSnapshot?.dmarc_valid,
      };

      const readiness = domainHealthService.assessWarmupReadiness(
        account, warmup, dnsResult, !!healthSnapshot?.blacklisted, cfg
      );

      return {
        email: account.email,
        domain,
        status: account.status,
        warmup_enabled: account.warmup_enabled ?? (account.warmup_status === 'active'),
        warmup_readiness: readiness.status,
        warmup_reasons: readiness.reasons,
        open_rate: warmup.open_rate ?? account.warmup_open_rate ?? null,
        bounce_rate: warmup.bounce_rate ?? null,
        spam_rate: warmup.spam_rate ?? null,
        total_sent: warmup.total_sent ?? 0,
        created_at: account.created_at,
        daily_limit: account.daily_limit ?? null,
      };
    });

    res.json(accounts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /accounts/:email — single account detail
router.get('/accounts/:email', async (req, res) => {
  try {
    const account = await instantlyService.getAccount(req.params.email);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const warmupData = await instantlyService.getWarmupAnalytics({ account_id: req.params.email });
    res.json({ account, warmup: warmupData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /accounts/warmup/enable-all
router.post('/accounts/warmup/enable-all', async (req, res) => {
  try {
    const result = await instantlyService.enableWarmupAll();
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /accounts/:email/warmup/enable
router.post('/accounts/:email/warmup/enable', async (req, res) => {
  try {
    const result = await instantlyService.enableWarmup([req.params.email]);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /accounts/:email/warmup/disable
router.post('/accounts/:email/warmup/disable', async (req, res) => {
  try {
    const result = await instantlyService.disableWarmup([req.params.email]);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /accounts/:email/pause
router.post('/accounts/:email/pause', async (req, res) => {
  try {
    const result = await instantlyService.pauseAccount(req.params.email);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /accounts/:email/resume
router.post('/accounts/:email/resume', async (req, res) => {
  try {
    const result = await instantlyService.resumeAccount(req.params.email);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /accounts/:email — remove account from Instantly
router.delete('/accounts/:email', async (req, res) => {
  try {
    const result = await instantlyService.deleteAccount(req.params.email);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /domains/:domain/check — manual health check
router.post('/domains/:domain/check', async (req, res) => {
  try {
    const snapshots = await domainHealthService.fullHealthCheck(req.params.domain);
    res.json(snapshots[0] || { error: 'No accounts found for domain' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /check-all — check all domains
router.post('/check-all', async (req, res) => {
  try {
    const snapshots = await domainHealthService.fullHealthCheck();
    res.json({ domains_checked: snapshots.length, snapshots });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /config — health monitoring config
router.get('/config', (req, res) => {
  try {
    const configs = queryAll('SELECT * FROM domain_health_config ORDER BY domain');
    res.json(configs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /config — update config
router.put('/config', (req, res) => {
  try {
    const {
      domain = '*',
      auto_pause_on_blacklist,
      auto_reduce_on_high_bounce,
      max_bounce_rate,
      max_spam_rate,
      min_warmup_days,
      min_open_rate_for_ready,
      daily_send_limit_warmup,
      daily_send_limit_ready,
      alert_on_dns_fail,
    } = req.body;

    const existing = queryOne('SELECT id FROM domain_health_config WHERE domain = ?', [domain]);

    if (existing) {
      runSql(
        `UPDATE domain_health_config SET
          auto_pause_on_blacklist = COALESCE(?, auto_pause_on_blacklist),
          auto_reduce_on_high_bounce = COALESCE(?, auto_reduce_on_high_bounce),
          max_bounce_rate = COALESCE(?, max_bounce_rate),
          max_spam_rate = COALESCE(?, max_spam_rate),
          min_warmup_days = COALESCE(?, min_warmup_days),
          min_open_rate_for_ready = COALESCE(?, min_open_rate_for_ready),
          daily_send_limit_warmup = COALESCE(?, daily_send_limit_warmup),
          daily_send_limit_ready = COALESCE(?, daily_send_limit_ready),
          alert_on_dns_fail = COALESCE(?, alert_on_dns_fail),
          updated_at = datetime('now')
        WHERE domain = ?`,
        [
          auto_pause_on_blacklist, auto_reduce_on_high_bounce,
          max_bounce_rate, max_spam_rate, min_warmup_days,
          min_open_rate_for_ready, daily_send_limit_warmup, daily_send_limit_ready,
          alert_on_dns_fail, domain,
        ]
      );
    } else {
      runSql(
        `INSERT INTO domain_health_config
          (domain, auto_pause_on_blacklist, auto_reduce_on_high_bounce, max_bounce_rate, max_spam_rate,
           min_warmup_days, min_open_rate_for_ready, daily_send_limit_warmup, daily_send_limit_ready, alert_on_dns_fail)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          domain,
          auto_pause_on_blacklist ?? 1, auto_reduce_on_high_bounce ?? 1,
          max_bounce_rate ?? 2.0, max_spam_rate ?? 0.1,
          min_warmup_days ?? 14, min_open_rate_for_ready ?? 30.0,
          daily_send_limit_warmup ?? 20, daily_send_limit_ready ?? 50,
          alert_on_dns_fail ?? 1,
        ]
      );
    }

    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /summary — overview stats
router.get('/summary', (req, res) => {
  try {
    const summary = domainHealthService.getSummary();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
