import { spawn } from 'child_process';
import { createLogger } from './utils/logger';
const log = createLogger('tunnel');

// GPC-ONLY: This tunnel serves Granite Park Capital's yacht event check-in page.
// If BMN needs a tunnel, add a separate tunnel config keyed by company_id.
const TUNNEL_NAME = 'yacht-checkin';
const TUNNEL_URL = 'https://checkin.graiteparkcapitalfund.com';

let tunnelProcess: ReturnType<typeof spawn> | null = null;

export function getTunnelUrl(): string {
  return TUNNEL_URL;
}

export async function startTunnel(_port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    log.info(`[Tunnel] Starting named tunnel "${TUNNEL_NAME}" → ${TUNNEL_URL}`);

    const proc = spawn('npx', ['cloudflared', 'tunnel', 'run', TUNNEL_NAME], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });

    tunnelProcess = proc;
    let resolved = false;

    const handleOutput = (data: Buffer) => {
      const text = data.toString();
      // Named tunnel logs "Registered tunnel connection" when ready
      if (text.includes('Registered tunnel connection') && !resolved) {
        resolved = true;
        log.info(`[Tunnel] Live at: ${TUNNEL_URL}`);
        log.info(`[Tunnel] Yacht check-in: ${TUNNEL_URL}/yacht-checkin/yacht-2026-04-08`);
        resolve(TUNNEL_URL);
      }
      // Log errors
      if (text.includes('ERR')) {
        log.error(`[Tunnel] ${text.trim()}`);
      }
    };

    proc.stdout?.on('data', handleOutput);
    proc.stderr?.on('data', handleOutput);

    proc.on('error', (err) => {
      log.error('[Tunnel] Process error:', err.message);
      if (!resolved) reject(err);
    });

    proc.on('exit', (code) => {
      log.info(`[Tunnel] Process exited with code ${code}`);
      tunnelProcess = null;
      // Auto-restart after 5 seconds
      log.info('[Tunnel] Restarting in 5 seconds...');
      setTimeout(() => startTunnel(_port).catch(() => {}), 5000);
    });

    // Timeout — named tunnels connect fast, but give 30s
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Resolve anyway — the tunnel might be working even without the log line
        log.info(`[Tunnel] Assuming connected at ${TUNNEL_URL}`);
        resolve(TUNNEL_URL);
      }
    }, 30000);
  });
}

// Clean shutdown
process.on('SIGINT', () => {
  if (tunnelProcess) {
    log.info('[Tunnel] Shutting down...');
    tunnelProcess.kill();
  }
});

process.on('SIGTERM', () => {
  if (tunnelProcess) {
    tunnelProcess.kill();
  }
});
