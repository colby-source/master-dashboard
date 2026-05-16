import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { config } from './config';
import { getDb } from './db';
import { runMigrations } from './db-migrate';
import { wsServer } from './websocket/ws-server';
import { syncManager } from './sync/sync-manager';
import { apiKeyAuth, assertAdminAuthConfigured } from './middleware/auth';
import { notFoundHandler } from './middleware/not-found';
import { errorHandler } from './middleware/error-handler';

import companiesRouter from './routes/companies';
import campaignsRouter from './routes/campaigns';
import metricsRouter from './routes/metrics';
import alertsRouter from './routes/alerts';
import ghlRouter from './routes/ghl';
import eventsRouter from './routes/events';
import aiDiscoveriesRouter from './routes/ai-discoveries';
import aiRouter from './routes/ai';
import metaAdsRouter from './routes/meta-ads';
import competitorsRouter from './routes/competitors';
import instantlyRouter from './routes/instantly';
import apifyRouter from './routes/apify';
import enrichmentRouter from './routes/enrichment';
import enrichmentWebhooksRouter from './routes/enrichment-webhooks';
import aiAssistantRouter from './routes/ai-assistant';
import exportsRouter from './routes/exports';
import bulkUploadRouter from './routes/bulk-upload';
import domainHealthRouter from './routes/domain-health';
import settingsRouter from './routes/settings';
import anymailfinderRouter from './routes/anymailfinder';
import reportsRouter from './routes/reports';
import propertyAnnouncementWebhookRouter from './routes/property-announcement-webhook';
import { startPropertyAnnouncementPoller } from './services/property-announcement-poller';
import gpf2WebhooksRouter from './routes/gpf2-webhooks';
import { startStallRecovery } from './services/gpc/gpf2-stall-recovery';
import { reportScheduler } from './services/report-scheduler';
import { initMeetingScheduler } from './services/meeting-scheduler';
import { dailyAuditService } from './services/daily-audit-service';
import { startTunnel } from './tunnel';
import auditRouter from './routes/audit';
import spendRouter from './routes/spend';
import cmoHealthRouter from './routes/cmo-health';
import adIntelligenceRouter from './routes/ad-intelligence';
import bmnCadenceRouter from './routes/bmn-cadence';
import gpcPipelineRouter from './routes/gpc-pipeline';
import pipelineRouter from './routes/pipeline';
import integrationsRouter from './routes/integrations';
import learningRouter from './routes/learning';
import dataInventoryRouter from './routes/data-inventory';
import launchpadRouter from './routes/launchpad';
import launchpadPublicRouter from './routes/launchpad-public';
import gpcFormPublicRouter from './routes/gpc-form-public';
import { createLogger } from './utils/logger';
const log = createLogger('index');

async function main() {
  // Initialize database
  await getDb();
  log.info('[DB] Initialized');

  // Run pending database migrations
  runMigrations();

  // Fail-closed: in production, refuse to boot if admin auth is misconfigured.
  // In dev, this only validates the key length when one is set.
  assertAdminAuthConfigured();

  // Boot the BMN PLDS catalog cache. Initial sync is fire-and-forget so it
  // never blocks server startup; failures degrade gracefully (empty catalog).
  const { catalogService } = await import('./services/launchpad/catalog-service');
  catalogService.start();

  const app = express();

  // CORS — restrict to known origins
  const allowedOrigins = [
    'http://localhost:5173',   // Vite dev server
    'http://localhost:3001',   // Production self-serve
    `http://localhost:${config.port}`,
    'https://granitepark.co',  // GHL hosted pages — GPC
    'https://checkin.graiteparkcapitalfund.com',  // Cloudflare tunnel — GPC
    'https://graniteparkcapitalfund.com',  // Public Fund II site (CF Pages) — data-room intake
    'https://www.graniteparkcapitalfund.com',
    'https://brandmenow.co',   // BMN main domain
    'https://www.brandmenow.co', // BMN www
  ];
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Allow any trycloudflare.com tunnel origin (URL changes on restart)
      if (origin.endsWith('.trycloudflare.com')) return callback(null, true);
      // Allow Railway deployment origin
      if (origin.endsWith('.railway.app')) return callback(null, true);
      // Allow Cloudflare Pages preview deploys for the GPC funnel
      if (origin.endsWith('.granite-park-capital-funnel.pages.dev')) return callback(null, true);
      // Allow any subdomain of our owned domains (covers dashboard.*, checkin.*, etc.)
      if (origin.endsWith('.graiteparkcapitalfund.com')) return callback(null, true);
      if (origin.endsWith('.graniteparkcapitalfund.com')) return callback(null, true);
      if (origin.endsWith('.brandmenow.co')) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));

  // Health check — no auth, used by Railway
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  // Webhook routes — mounted BEFORE auth middleware (they have their own verification)
  app.use('/api/enrichment', enrichmentWebhooksRouter);
  app.use('/api/property-announcement', propertyAnnouncementWebhookRouter);

  // GPF-II — Instantly reply webhook (/api/webhooks/gpf2-reply) + ops URL buttons (/ops/gpf2/...)
  // Mounted at root so both path prefixes route. HMAC-token-guarded on ops endpoints.
  app.use(gpf2WebhooksRouter);

  // Launchpad PUBLIC routes — mounted BEFORE apiKeyAuth. Magic-link tokens authenticate.
  app.use('/api/launchpad-public', launchpadPublicRouter);

  // GPC public form intake — mounted BEFORE apiKeyAuth. HMAC-signed by the
  // GPC marketing site (graniteparkcapitalfund.com) using GPC_FORM_SHARED_SECRET.
  // Replaces the legacy direct-to-GHL pattern that leaked the GHL PIT into
  // the client bundle via VITE_GHL_API_KEY.
  app.use('/api/gpc-public', gpcFormPublicRouter);

  // API key auth — only enforced when DASHBOARD_API_KEY env var is set
  app.use('/api', apiKeyAuth);

  // API routes
  app.use('/api/companies', companiesRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/metrics', metricsRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/ghl', ghlRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/ai-discoveries', aiDiscoveriesRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/meta-ads', metaAdsRouter);
  app.use('/api/competitors', competitorsRouter);
  app.use('/api/instantly', instantlyRouter);
  app.use('/api/apify', apifyRouter);
  app.use('/api/enrichment', enrichmentRouter);
  app.use('/api/ai-assistant', aiAssistantRouter);
  app.use('/api/exports', exportsRouter);
  app.use('/api/enrichment/bulk-upload', bulkUploadRouter);
  app.use('/api/domain-health', domainHealthRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/anymailfinder', anymailfinderRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/spend', spendRouter);
  app.use('/api/cmo', cmoHealthRouter);
  app.use('/api/ad-intelligence', adIntelligenceRouter);
  app.use('/api/bmn-cadence', bmnCadenceRouter);
  app.use('/api/gpc/pipeline', gpcPipelineRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/learning', learningRouter);
  app.use('/api/data-inventory', dataInventoryRouter);
  app.use('/api/launchpad', launchpadRouter);

  // 404 handler for unmatched API routes (must be after all API routes)
  app.use(notFoundHandler);

  // Serve frontend in production
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });

  // Global error handler (must be the LAST middleware registered)
  app.use(errorHandler);

  const server = createServer(app);
  wsServer.attach(server);

  // Start background sync
  syncManager.start();

  // Start daily report scheduler (8 AM + 6 PM ET)
  reportScheduler.start();

  // Start daily audit (7 AM ET — runs before morning report)
  dailyAuditService.start();

  // Initialize meeting scheduler (Google Calendar + GHL availability)
  initMeetingScheduler().catch(err => {
    log.error('[Server] Meeting scheduler init failed:', err.message);
  });

  // Start property announcement reply poller (every 2 min)
  startPropertyAnnouncementPoller();

  // Start GPF-II stall recovery — 14-day silent replies get a Telegram nudge (every 12h)
  startStallRecovery();

  server.listen(config.port, () => {
    log.info(`[Server] Running on http://localhost:${config.port}`);
    // Auto-start Cloudflare tunnel for yacht check-in (and other external access)
    if (process.env.ENABLE_TUNNEL !== 'false') {
      startTunnel(config.port).catch(err => {
        log.error('[Tunnel] Failed to start:', err.message);
      });
    }
  });
}

log.info('[Boot] Starting master-dashboard...');
main().catch(err => {
  log.error('[Boot] Fatal startup error:', err && (err.stack || err.message || JSON.stringify(err)));
  if (err && err.stack) console.error(err.stack);
  else console.error('Empty error thrown:', err);
  process.exit(1);
});
