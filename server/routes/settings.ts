import { Router } from 'express';
import { config } from '../config';
import { queryAll, queryOne } from '../db';

const router = Router();

interface IntegrationStatus {
  name: string;
  category: string;
  configured: boolean;
  keys: { label: string; set: boolean }[];
  baseUrl?: string;
  description: string;
}

function isSet(val: string | undefined): boolean {
  return !!val && val.length > 0;
}

// GET /health — all integrations and their configuration status
router.get('/health', (_req, res) => {
  try {
    const integrations: IntegrationStatus[] = [
      {
        name: 'Instantly',
        category: 'outreach',
        configured: isSet(config.instantlyApiKey),
        keys: [{ label: 'API Key', set: isSet(config.instantlyApiKey) }],
        baseUrl: config.instantlyBaseUrl,
        description: 'Cold email campaigns and warmup',
      },
      {
        name: 'GoHighLevel — Granite Park Capital',
        category: 'crm',
        configured: isSet(config.ghlLocations[0]?.apiKey) && isSet(config.ghlLocations[0]?.locationId),
        keys: [
          { label: 'API Key', set: isSet(config.ghlLocations[0]?.apiKey) },
          { label: 'Location ID', set: isSet(config.ghlLocations[0]?.locationId) },
        ],
        baseUrl: config.ghlBaseUrl,
        description: 'CRM, pipelines, contacts for Granite Park Capital',
      },
      {
        name: 'GoHighLevel — Brand Me Now',
        category: 'crm',
        configured: isSet(config.ghlLocations[1]?.apiKey) && isSet(config.ghlLocations[1]?.locationId),
        keys: [
          { label: 'API Key', set: isSet(config.ghlLocations[1]?.apiKey) },
          { label: 'Location ID', set: isSet(config.ghlLocations[1]?.locationId) },
        ],
        baseUrl: config.ghlBaseUrl,
        description: 'CRM, pipelines, contacts for Brand Me Now',
      },
      {
        name: 'GoHighLevel — Tikkun',
        category: 'crm',
        configured: isSet(config.ghlLocations[2]?.apiKey) && isSet(config.ghlLocations[2]?.locationId),
        keys: [
          { label: 'API Key', set: isSet(config.ghlLocations[2]?.apiKey) },
          { label: 'Location ID', set: isSet(config.ghlLocations[2]?.locationId) },
        ],
        baseUrl: config.ghlBaseUrl,
        description: 'CRM, pipelines, contacts for Tikkun',
      },
      {
        name: 'Meta Ads',
        category: 'advertising',
        configured: isSet(config.metaAccessToken) && isSet(config.metaAdAccountId),
        keys: [
          { label: 'Access Token', set: isSet(config.metaAccessToken) },
          { label: 'Ad Account ID', set: isSet(config.metaAdAccountId) },
        ],
        baseUrl: config.metaBaseUrl,
        description: 'Facebook & Instagram ad campaigns',
      },
      {
        name: 'WhatsApp Business',
        category: 'messaging',
        configured: isSet(config.whatsappAccessToken) && isSet(config.whatsappPhoneNumberId),
        keys: [
          { label: 'Access Token', set: isSet(config.whatsappAccessToken) },
          { label: 'Phone Number ID', set: isSet(config.whatsappPhoneNumberId) },
          { label: 'Business Account ID', set: isSet(config.whatsappBusinessAccountId) },
        ],
        baseUrl: config.metaBaseUrl,
        description: 'WhatsApp messaging and automation',
      },
      {
        name: 'OpenClaw',
        category: 'automation',
        configured: isSet(config.openclawToken),
        keys: [
          { label: 'Token', set: isSet(config.openclawToken) },
          { label: 'Gateway URL', set: isSet(config.openclawGatewayUrl) },
        ],
        baseUrl: config.openclawGatewayUrl,
        description: 'Browser automation and lead scraping',
      },
      {
        name: 'Anthropic (Claude AI)',
        category: 'ai',
        configured: isSet(config.anthropicApiKey),
        keys: [{ label: 'API Key', set: isSet(config.anthropicApiKey) }],
        description: 'AI assistant and campaign writing',
      },
      {
        name: 'Apify',
        category: 'scraping',
        configured: isSet(config.apifyApiKey),
        keys: [{ label: 'API Key', set: isSet(config.apifyApiKey) }],
        baseUrl: config.apifyBaseUrl,
        description: 'Web scraping actors and data extraction',
      },
      {
        name: 'People Data Labs',
        category: 'enrichment',
        configured: isSet(config.pdlApiKey),
        keys: [{ label: 'API Key', set: isSet(config.pdlApiKey) }],
        baseUrl: config.pdlBaseUrl,
        description: 'Person and company enrichment data',
      },
      {
        name: 'Hunter.io',
        category: 'enrichment',
        configured: isSet(config.hunterApiKey),
        keys: [{ label: 'API Key', set: isSet(config.hunterApiKey) }],
        baseUrl: config.hunterBaseUrl,
        description: 'Email verification and finding',
      },
    ];

    const webhooks = [
      { name: 'RB2B', secretConfigured: isSet(config.rb2bWebhookSecret), endpoint: '/api/enrichment/webhook/rb2b' },
      { name: 'GoHighLevel', secretConfigured: isSet(config.ghlWebhookSecret), endpoint: '/api/enrichment/webhook/ghl' },
      { name: 'Meta', secretConfigured: isSet(config.metaWebhookSecret), endpoint: '/api/enrichment/webhook/meta-ad' },
      { name: 'Instantly', secretConfigured: isSet(config.instantlyWebhookSecret), endpoint: '/api/enrichment/webhook/instantly' },
      { name: 'N8N', secretConfigured: isSet(config.n8nWebhookSecret), endpoint: '/api/enrichment/webhook/n8n' },
      { name: 'WhatsApp', secretConfigured: true, endpoint: '/api/whatsapp/webhook' },
    ];

    const system = {
      port: config.port,
      dbPath: config.dbPath,
      syncIntervalMs: config.syncIntervalMs,
      openclawEnabled: config.openclawEnabled,
      enrichmentAutoEnabled: config.enrichmentAutoEnabled,
      enrichmentStaleDays: config.enrichmentStaleDays,
      competitorCount: config.competitors.length,
    };

    const totalIntegrations = integrations.length;
    const configuredCount = integrations.filter(i => i.configured).length;

    res.json({
      integrations,
      webhooks,
      system,
      summary: {
        total: totalIntegrations,
        configured: configuredCount,
        missing: totalIntegrations - configuredCount,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /webhook-log — recent webhook events for monitoring
router.get('/webhook-log', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const source = req.query.source as string | undefined;
    const eventType = req.query.event_type as string | undefined;

    let where = '1=1';
    const params: any[] = [];

    if (source) {
      where += ' AND event_type LIKE ?';
      params.push(`${source}%`);
    }
    if (eventType) {
      where += ' AND event_type = ?';
      params.push(eventType);
    }

    const events = queryAll(
      `SELECT ee.*, el.email, el.first_name, el.last_name, el.company_name, el.source
       FROM enrichment_events ee
       LEFT JOIN enrichment_leads el ON ee.enrichment_lead_id = el.id
       WHERE ${where}
       ORDER BY ee.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = queryOne(
      `SELECT COUNT(*) as count FROM enrichment_events WHERE ${where}`,
      params
    ) as any;

    // Event type breakdown
    const breakdown = queryAll(
      `SELECT event_type, COUNT(*) as count
       FROM enrichment_events
       WHERE created_at > datetime('now', '-24 hours')
       GROUP BY event_type
       ORDER BY count DESC`,
      []
    );

    res.json({ events, total: total?.count ?? 0, breakdown });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /webhook-log/stats — webhook volume over time
router.get('/webhook-log/stats', (_req, res) => {
  try {
    // Hourly volume for last 24 hours
    const hourly = queryAll(
      `SELECT strftime('%Y-%m-%d %H:00', created_at) as hour, COUNT(*) as count
       FROM enrichment_events
       WHERE created_at > datetime('now', '-24 hours')
       GROUP BY hour
       ORDER BY hour`,
      []
    );

    // Daily volume for last 7 days
    const daily = queryAll(
      `SELECT date(created_at) as day, COUNT(*) as count
       FROM enrichment_events
       WHERE created_at > datetime('now', '-7 days')
       GROUP BY day
       ORDER BY day`,
      []
    );

    // Source breakdown
    const bySource = queryAll(
      `SELECT
         CASE
           WHEN event_type LIKE 'rb2b%' THEN 'RB2B'
           WHEN event_type LIKE 'ghl%' THEN 'GHL'
           WHEN event_type LIKE 'meta%' THEN 'Meta'
           WHEN event_type LIKE 'instantly%' THEN 'Instantly'
           WHEN event_type LIKE 'n8n%' THEN 'N8N'
           ELSE 'Other'
         END as source,
         COUNT(*) as count
       FROM enrichment_events
       WHERE created_at > datetime('now', '-24 hours')
       GROUP BY source
       ORDER BY count DESC`,
      []
    );

    res.json({ hourly, daily, bySource });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /ping/:service — test connectivity to a specific service
router.post('/ping/:service', async (req, res) => {
  const { service } = req.params;
  const start = Date.now();

  try {
    let result: { ok: boolean; latencyMs: number; details?: string } = { ok: false, latencyMs: 0 };

    switch (service) {
      case 'instantly': {
        if (!config.instantlyApiKey) {
          result = { ok: false, latencyMs: 0, details: 'API key not configured' };
          break;
        }
        const resp = await fetch(`${config.instantlyBaseUrl}/accounts?limit=1`, {
          headers: { Authorization: `Bearer ${config.instantlyApiKey}` },
        });
        result = { ok: resp.ok, latencyMs: Date.now() - start, details: resp.ok ? 'Connected' : `HTTP ${resp.status}` };
        break;
      }
      case 'ghl': {
        // Check all configured GHL locations, not just the first
        const ghlResults: string[] = [];
        let allOk = true;
        for (const loc of config.ghlLocations) {
          if (!loc.apiKey) {
            ghlResults.push(`${loc.name}: not configured`);
            allOk = false;
            continue;
          }
          try {
            const resp = await fetch(`${config.ghlBaseUrl}/contacts/?locationId=${loc.locationId}&limit=1`, {
              headers: { Authorization: `Bearer ${loc.apiKey}`, Version: '2021-07-28' },
            });
            ghlResults.push(`${loc.name}: ${resp.ok ? 'OK' : `HTTP ${resp.status}`}`);
            if (!resp.ok) allOk = false;
          } catch (e: any) {
            ghlResults.push(`${loc.name}: ${e.message}`);
            allOk = false;
          }
        }
        result = { ok: allOk, latencyMs: Date.now() - start, details: ghlResults.join(' | ') };
        break;
      }
      case 'meta-ads': {
        if (!config.metaAccessToken) {
          result = { ok: false, latencyMs: 0, details: 'Access token not configured' };
          break;
        }
        const resp = await fetch(`${config.metaBaseUrl}/me?access_token=${config.metaAccessToken}`);
        result = { ok: resp.ok, latencyMs: Date.now() - start, details: resp.ok ? 'Connected' : `HTTP ${resp.status}` };
        break;
      }
      case 'anthropic': {
        if (!config.anthropicApiKey) {
          result = { ok: false, latencyMs: 0, details: 'API key not configured' };
          break;
        }
        // Just check with a minimal request - HEAD won't work, so we check the key format
        result = {
          ok: config.anthropicApiKey.startsWith('sk-ant-'),
          latencyMs: Date.now() - start,
          details: config.anthropicApiKey.startsWith('sk-ant-') ? 'Key format valid' : 'Key format invalid',
        };
        break;
      }
      case 'pdl': {
        if (!config.pdlApiKey) {
          result = { ok: false, latencyMs: 0, details: 'API key not configured' };
          break;
        }
        const resp = await fetch(`${config.pdlBaseUrl}/person/enrich?api_key=${config.pdlApiKey}&email=test@test.com`);
        result = { ok: resp.status !== 401, latencyMs: Date.now() - start, details: resp.status === 401 ? 'Invalid API key' : 'Connected' };
        break;
      }
      case 'hunter': {
        if (!config.hunterApiKey) {
          result = { ok: false, latencyMs: 0, details: 'API key not configured' };
          break;
        }
        const resp = await fetch(`${config.hunterBaseUrl}/account?api_key=${config.hunterApiKey}`);
        result = { ok: resp.ok, latencyMs: Date.now() - start, details: resp.ok ? 'Connected' : `HTTP ${resp.status}` };
        break;
      }
      case 'apify': {
        if (!config.apifyApiKey) {
          result = { ok: false, latencyMs: 0, details: 'API key not configured' };
          break;
        }
        const resp = await fetch(`${config.apifyBaseUrl}/acts?token=${config.apifyApiKey}&limit=1`);
        result = { ok: resp.ok, latencyMs: Date.now() - start, details: resp.ok ? 'Connected' : `HTTP ${resp.status}` };
        break;
      }
      default:
        result = { ok: false, latencyMs: 0, details: `Unknown service: ${service}` };
    }

    res.json(result);
  } catch (err: any) {
    res.json({ ok: false, latencyMs: Date.now() - start, details: err.message });
  }
});

// GET /db-stats — database size and table counts
router.get('/db-stats', (_req, res) => {
  try {
    const tables = [
      'companies', 'campaigns', 'agents', 'agent_runs', 'tasks', 'metrics',
      'alerts', 'events', 'ai_discoveries', 'meta_ad_campaigns', 'competitors',
      'enrichment_leads', 'enrichment_events', 'enrichment_cache',
      'domain_health_snapshots', 'chat_history', 'assistant_chat_history',
    ];

    const stats = tables.map(table => {
      try {
        const row = queryOne(`SELECT COUNT(*) as count FROM ${table}`, []) as any;
        return { table, count: row?.count ?? 0 };
      } catch {
        return { table, count: -1 };
      }
    });

    res.json({ tables: stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
