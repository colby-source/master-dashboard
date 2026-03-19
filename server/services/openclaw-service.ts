import WebSocket from 'ws';
import { config } from '../config';

interface CommandResult {
  success: boolean;
  response?: any;
  error?: string;
}

class OpenClawService {
  async getHealth(): Promise<{ online: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      return new Promise((resolve) => {
        const ws = new WebSocket(config.openclawGatewayUrl, {
          headers: { 'Authorization': `Bearer ${config.openclawToken}` },
        });
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ online: false, latencyMs: -1 });
        }, 5000);

        ws.on('open', () => {
          clearTimeout(timeout);
          ws.close();
          resolve({ online: true, latencyMs: Date.now() - start });
        });
        ws.on('error', () => {
          clearTimeout(timeout);
          resolve({ online: false, latencyMs: -1 });
        });
      });
    } catch {
      return { online: false, latencyMs: -1 };
    }
  }

  async getStatus() {
    const health = await this.getHealth();
    return {
      ...health,
      gatewayUrl: config.openclawGatewayUrl,
      version: '2026.3.2',
      mode: 'remote',
    };
  }

  async sendCommand(command: string, payload?: any, timeoutMs = 10000): Promise<CommandResult> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(config.openclawGatewayUrl, {
          headers: { 'Authorization': `Bearer ${config.openclawToken}` },
        });
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ success: false, error: 'Command timed out' });
        }, timeoutMs);

        ws.on('open', () => {
          const msg = JSON.stringify({ type: command, ...(payload || {}) });
          ws.send(msg);
        });

        ws.on('message', (raw) => {
          clearTimeout(timeout);
          try {
            const data = JSON.parse(raw.toString());
            ws.close();
            resolve({ success: true, response: data });
          } catch {
            ws.close();
            resolve({ success: true, response: raw.toString() });
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          resolve({ success: false, error: err.message });
        });

        ws.on('close', () => {
          clearTimeout(timeout);
        });
      } catch (err: any) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  async listMachines(): Promise<CommandResult> {
    return this.sendCommand('list_machines');
  }

  async getMachineStatus(machineId: string): Promise<CommandResult> {
    return this.sendCommand('machine_status', { machine_id: machineId });
  }

  async startMachine(machineId: string): Promise<CommandResult> {
    return this.sendCommand('start_machine', { machine_id: machineId });
  }

  async stopMachine(machineId: string): Promise<CommandResult> {
    return this.sendCommand('stop_machine', { machine_id: machineId });
  }

  async restartMachine(machineId: string): Promise<CommandResult> {
    return this.sendCommand('restart_machine', { machine_id: machineId });
  }

  async runDiagnostics(machineId: string): Promise<CommandResult> {
    return this.sendCommand('run_diagnostics', { machine_id: machineId });
  }

  async getSessionInfo(): Promise<CommandResult> {
    return this.sendCommand('session_info');
  }

  async ping(): Promise<CommandResult> {
    return this.sendCommand('ping');
  }
}

export const openclawService = new OpenClawService();
