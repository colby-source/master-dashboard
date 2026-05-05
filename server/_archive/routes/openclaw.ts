import { Router } from 'express';
import { openclawService } from '../services/openclaw-service';
import { queryAll } from '../db';
import { createLogger } from '../utils/logger';
const log = createLogger('openclaw');

const router = Router();

router.get('/health', async (req, res) => {
  try {
    const health = await openclawService.getHealth();
    res.json(health);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] GET /health error:', err.message);
    res.status(500).json({ error: 'Failed to fetch health' });
  }
});

router.get('/status', async (req, res) => {
  try {
    const status = await openclawService.getStatus();
    const latencyHistory = queryAll(
      "SELECT value, recorded_at FROM metrics WHERE metric_type = 'openclaw_latency' ORDER BY recorded_at DESC LIMIT 10"
    );
    res.json({ ...status, latencyHistory });
  } catch (err: any) {
    log.error('[Routes:OpenClaw] GET /status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

router.post('/command', async (req, res) => {
  try {
    const { command, payload } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });
    const result = await openclawService.sendCommand(command, payload);
    res.json(result);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] POST /command error:', err.message);
    res.status(500).json({ error: 'Failed to execute command' });
  }
});

router.get('/machines', async (req, res) => {
  try {
    const result = await openclawService.listMachines();
    res.json(result);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] GET /machines error:', err.message);
    res.status(500).json({ error: 'Failed to list machines' });
  }
});

router.get('/machines/:id', async (req, res) => {
  try {
    const result = await openclawService.getMachineStatus(req.params.id);
    res.json(result);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] GET /machines/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch machine status' });
  }
});

router.post('/machines/:id/start', async (req, res) => {
  try {
    const result = await openclawService.startMachine(req.params.id);
    res.json(result);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] POST /machines/:id/start error:', err.message);
    res.status(500).json({ error: 'Failed to start machine' });
  }
});

router.post('/machines/:id/stop', async (req, res) => {
  try {
    const result = await openclawService.stopMachine(req.params.id);
    res.json(result);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] POST /machines/:id/stop error:', err.message);
    res.status(500).json({ error: 'Failed to stop machine' });
  }
});

router.post('/machines/:id/restart', async (req, res) => {
  try {
    const result = await openclawService.restartMachine(req.params.id);
    res.json(result);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] POST /machines/:id/restart error:', err.message);
    res.status(500).json({ error: 'Failed to restart machine' });
  }
});

router.post('/machines/:id/diagnostics', async (req, res) => {
  try {
    const result = await openclawService.runDiagnostics(req.params.id);
    res.json(result);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] POST /machines/:id/diagnostics error:', err.message);
    res.status(500).json({ error: 'Failed to run diagnostics' });
  }
});

router.get('/session', async (req, res) => {
  try {
    const result = await openclawService.getSessionInfo();
    res.json(result);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] GET /session error:', err.message);
    res.status(500).json({ error: 'Failed to fetch session info' });
  }
});

router.get('/ping', async (req, res) => {
  try {
    const result = await openclawService.ping();
    res.json(result);
  } catch (err: any) {
    log.error('[Routes:OpenClaw] GET /ping error:', err.message);
    res.status(500).json({ error: 'Failed to ping' });
  }
});

export default router;
