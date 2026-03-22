import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { config } from './config';
import { getDb } from './db';
import { runMigrations } from './db-migrate';
import { wsServer } from './websocket/ws-server';
import { syncManager } from './sync/sync-manager';
import { apiKeyAuth } from './middleware/auth';
import { notFoundHandler } from './middleware/not-found';
import { errorHandler } from './middleware/error-handler';

import companiesRouter from './routes/companies';
import tasksRouter from './routes/tasks';
import campaignsRouter from './routes/campaigns';
import agentsRouter from './routes/agents';
import metricsRouter from './routes/metrics';
import alertsRouter from './routes/alerts';
import openclawRouter from './routes/openclaw';
import ghlRouter from './routes/ghl';
import eventsRouter from './routes/events';
import aiDiscoveriesRouter from './routes/ai-discoveries';
import aiRouter from './routes/ai';
import metaAdsRouter from './routes/meta-ads';
import competitorsRouter from './routes/competitors';
import btrConferenceRouter from './routes/btr-conference';
import instantlyRouter from './routes/instantly';
import apifyRouter from './routes/apify';
import whatsappRouter from './routes/whatsapp';
import linkedinRouter from './routes/linkedin';
import instagramRouter from './routes/instagram';
import instagramDmRouter from './routes/instagram-dm';
import enrichmentRouter from './routes/enrichment';
import enrichmentWebhooksRouter from './routes/enrichment-webhooks';
import aiAssistantRouter from './routes/ai-assistant';
import exportsRouter from './routes/exports';
import bulkUploadRouter from './routes/bulk-upload';
import domainHealthRouter from './routes/domain-health';
import settingsRouter from './routes/settings';
import rb2bRouter from './routes/rb2b';
import anymailfinderRouter from './routes/anymailfinder';
import reportsRouter from './routes/reports';
import { yachtCheckinPageRouter, yachtCheckinRouter, yachtEventsRouter } from './routes/yacht-events';
import { reportScheduler } from './services/report-scheduler';
import { initMeetingScheduler } from './services/meeting-scheduler';
import { dailyAuditService } from './services/daily-audit-service';
import { startTunnel } from './tunnel';
import auditRouter from './routes/audit';
import spendRouter from './routes/spend';
import cmoHealthRouter from './routes/cmo-health';
import adIntelligenceRouter from './routes/ad-intelligence';

async function main() {
  // Initialize database
  await getDb();
  console.log('[DB] Initialized');

  // Run pending database migrations
  runMigrations();

  const app = express();

  // CORS — restrict to known origins
  const allowedOrigins = [
    'http://localhost:5173',   // Vite dev server
    'http://localhost:3001',   // Production self-serve
    `http://localhost:${config.port}`,
    'https://granitepark.co',  // GHL hosted pages — GPC
    'https://checkin.graiteparkcapitalfund.com',  // Cloudflare tunnel — GPC
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
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));

  // Health check — no auth, used by Railway
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  // Webhook routes — mounted BEFORE auth middleware (they have their own verification)
  app.use('/api/enrichment', enrichmentWebhooksRouter);
  app.use('/api/whatsapp', whatsappRouter);

  // Yacht check-in — public routes (no auth, guests scan QR)
  app.use('/yacht-checkin', yachtCheckinPageRouter);     // HTML page
  app.use('/api/yacht-checkin', yachtCheckinRouter);       // API endpoints

  // API key auth — only enforced when DASHBOARD_API_KEY env var is set
  app.use('/api', apiKeyAuth);

  // API routes
  app.use('/api/companies', companiesRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/metrics', metricsRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/openclaw', openclawRouter);
  app.use('/api/ghl', ghlRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/ai-discoveries', aiDiscoveriesRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/meta-ads', metaAdsRouter);
  app.use('/api/competitors', competitorsRouter);
  app.use('/api/btr-conference', btrConferenceRouter);
  app.use('/api/instantly', instantlyRouter);
  app.use('/api/apify', apifyRouter);
  app.use('/api/linkedin', linkedinRouter);
  app.use('/api/instagram', instagramRouter);
  app.use('/api/instagram-dm', instagramDmRouter);
  app.use('/api/enrichment', enrichmentRouter);
  app.use('/api/ai-assistant', aiAssistantRouter);
  app.use('/api/exports', exportsRouter);
  app.use('/api/enrichment/bulk-upload', bulkUploadRouter);
  app.use('/api/domain-health', domainHealthRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/rb2b', rb2bRouter);
  app.use('/api/anymailfinder', anymailfinderRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/yacht-events', yachtEventsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/spend', spendRouter);
  app.use('/api/cmo', cmoHealthRouter);
  app.use('/api/ad-intelligence', adIntelligenceRouter);

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
    console.error('[Server] Meeting scheduler init failed:', err.message);
  });

  server.listen(config.port, () => {
    console.log(`[Server] Running on http://localhost:${config.port}`);
    // Auto-start Cloudflare tunnel for yacht check-in (and other external access)
    if (process.env.ENABLE_TUNNEL !== 'false') {
      startTunnel(config.port).catch(err => {
        console.error('[Tunnel] Failed to start:', err.message);
      });
    }
  });
}

main().catch(console.error);
