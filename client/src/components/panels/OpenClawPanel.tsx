import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import { Cpu, Play, Square, RotateCcw, Stethoscope, Terminal, Send, Zap, Server } from 'lucide-react';

export function OpenClawPanel() {
  const [commandInput, setCommandInput] = useState('');
  const [commandLog, setCommandLog] = useState<Array<{ cmd: string; result: any; ts: number }>>([]);
  const [activeTab, setActiveTab] = useState<'status' | 'machines' | 'terminal'>('status');

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['openclaw-status'],
    queryFn: api.getOpenClawStatus,
    refetchInterval: 30000,
  });

  const { data: machinesData, refetch: refetchMachines } = useQuery({
    queryKey: ['openclaw-machines'],
    queryFn: api.openclawListMachines,
    refetchInterval: 60000,
    enabled: activeTab === 'machines',
  });

  const { data: sessionData } = useQuery({
    queryKey: ['openclaw-session'],
    queryFn: api.openclawSession,
    enabled: activeTab === 'status',
  });

  const commandMutation = useMutation({
    mutationFn: ({ command, payload }: { command: string; payload?: any }) =>
      api.openclawCommand(command, payload),
    onSuccess: (data, variables) => {
      setCommandLog(prev => [{ cmd: variables.command, result: data, ts: Date.now() }, ...prev].slice(0, 20));
      refetchMachines();
    },
    onError: () => toast.error('Command failed'),
  });

  const startMutation = useMutation({
    mutationFn: api.openclawStartMachine,
    onSuccess: () => { refetchMachines(); toast.success('Machine started'); },
    onError: () => toast.error('Failed to start'),
  });
  const stopMutation = useMutation({
    mutationFn: api.openclawStopMachine,
    onSuccess: () => { refetchMachines(); toast.success('Machine stopped'); },
    onError: () => toast.error('Failed to stop'),
  });
  const restartMutation = useMutation({
    mutationFn: api.openclawRestartMachine,
    onSuccess: () => { refetchMachines(); toast.success('Machine restarted'); },
    onError: () => toast.error('Failed to restart'),
  });
  const diagMutation = useMutation({
    mutationFn: api.openclawDiagnostics,
    onSuccess: () => toast.success('Diagnostics complete'),
    onError: () => toast.error('Diagnostics failed'),
  });

  const online = status?.online ?? false;
  const machines = machinesData?.response?.machines || machinesData?.response || [];

  const sendCommand = () => {
    if (!commandInput.trim()) return;
    const parts = commandInput.trim().split(' ');
    const command = parts[0];
    let payload: any = undefined;
    if (parts.length > 1) {
      try { payload = JSON.parse(parts.slice(1).join(' ')); } catch { payload = { args: parts.slice(1) }; }
    }
    commandMutation.mutate({ command, payload });
    setCommandInput('');
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-purple-400" />
          <h3 className="font-semibold text-lg">OpenClaw ACP</h3>
          <div className="flex items-center gap-1.5 ml-2">
            {online ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <span className="text-xs text-green-400">Online</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-xs text-red-400">Offline</span>
              </>
            )}
          </div>
        </div>
        <button onClick={() => refetchStatus()} className="text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-0.5 mb-4">
        {(['status', 'machines', 'terminal'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ${activeTab === tab ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {tab === 'status' && <Zap className="h-3 w-3" />}
            {tab === 'machines' && <Server className="h-3 w-3" />}
            {tab === 'terminal' && <Terminal className="h-3 w-3" />}
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Status tab */}
      {activeTab === 'status' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted rounded-lg p-3">
              <div className="text-[10px] text-muted-foreground uppercase">Latency</div>
              <div className="text-lg font-mono font-bold mt-0.5">{status?.latencyMs > 0 ? `${status.latencyMs}ms` : '--'}</div>
            </div>
            <div className="bg-muted rounded-lg p-3">
              <div className="text-[10px] text-muted-foreground uppercase">Version</div>
              <div className="text-lg font-mono font-bold mt-0.5">{status?.version || '--'}</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Mode</span>
              <span>{status?.mode || '--'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Gateway</span>
              <span className="text-xs font-mono text-muted-foreground truncate max-w-[180px]">{status?.gatewayUrl || '--'}</span>
            </div>
            {sessionData?.success && sessionData.response && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Session</span>
                <span className="text-xs text-green-400">Active</span>
              </div>
            )}
          </div>

          {/* Latency history sparkline */}
          {status?.latencyHistory?.length > 1 && (
            <div>
              <div className="text-[10px] text-muted-foreground uppercase mb-1">Latency History</div>
              <div className="flex items-end gap-0.5 h-8">
                {status.latencyHistory.slice().reverse().map((point: any, i: number) => {
                  const max = Math.max(...status.latencyHistory.map((p: any) => p.value));
                  const height = max > 0 ? (point.value / max) * 100 : 0;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-purple-500/30 rounded-t"
                      style={{ height: `${Math.max(height, 5)}%` }}
                      title={`${point.value}ms`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => commandMutation.mutate({ command: 'ping' })}
              disabled={!online}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-purple-500/20 text-purple-400 rounded-md text-xs hover:bg-purple-500/30 disabled:opacity-40"
            >
              <Zap className="h-3 w-3" /> Ping
            </button>
            <button
              onClick={() => commandMutation.mutate({ command: 'session_info' })}
              disabled={!online}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-500/20 text-blue-400 rounded-md text-xs hover:bg-blue-500/30 disabled:opacity-40"
            >
              <Stethoscope className="h-3 w-3" /> Diagnostics
            </button>
          </div>
        </div>
      )}

      {/* Machines tab */}
      {activeTab === 'machines' && (
        <div className="space-y-2">
          {!online ? (
            <div className="text-muted-foreground text-sm text-center py-6">Gateway offline — cannot list machines</div>
          ) : Array.isArray(machines) && machines.length > 0 ? (
            machines.map((machine: any) => (
              <div key={machine.id || machine.machine_id} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-purple-400" />
                    <span className="text-sm font-medium">{machine.name || machine.id || machine.machine_id}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${machine.status === 'running' ? 'bg-green-500/20 text-green-400' : machine.status === 'stopped' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                    {machine.status || 'unknown'}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => startMutation.mutate(machine.id || machine.machine_id)}
                    disabled={machine.status === 'running'}
                    className="flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs hover:bg-green-500/30 disabled:opacity-30"
                  >
                    <Play className="h-3 w-3" /> Start
                  </button>
                  <button
                    onClick={() => stopMutation.mutate(machine.id || machine.machine_id)}
                    disabled={machine.status === 'stopped'}
                    className="flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/30 disabled:opacity-30"
                  >
                    <Square className="h-3 w-3" /> Stop
                  </button>
                  <button
                    onClick={() => restartMutation.mutate(machine.id || machine.machine_id)}
                    className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs hover:bg-yellow-500/30"
                  >
                    <RotateCcw className="h-3 w-3" /> Restart
                  </button>
                  <button
                    onClick={() => diagMutation.mutate(machine.id || machine.machine_id)}
                    className="flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs hover:bg-blue-500/30"
                  >
                    <Stethoscope className="h-3 w-3" /> Diag
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-muted-foreground text-sm text-center py-6">
              {machinesData?.success === false ? (machinesData.error || 'Failed to list machines') : 'No machines found'}
            </div>
          )}
        </div>
      )}

      {/* Terminal tab */}
      {activeTab === 'terminal' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Terminal className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendCommand()}
                placeholder="Enter command (e.g. ping, list_machines, session_info)..."
                className="w-full pl-8 pr-3 py-1.5 bg-muted border border-border rounded-md text-sm font-mono focus:outline-none focus:border-purple-500"
                disabled={!online}
              />
            </div>
            <button
              onClick={sendCommand}
              disabled={!online || !commandInput.trim()}
              className="px-3 py-1.5 bg-purple-500 text-white rounded-md text-sm hover:bg-purple-600 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>

          {commandMutation.isPending && (
            <div className="text-xs text-purple-400 animate-pulse">Sending command...</div>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {commandLog.length === 0 ? (
              <div className="text-muted-foreground text-xs text-center py-4 font-mono">
                {online ? '> Ready for commands...' : '> Gateway offline'}
              </div>
            ) : (
              commandLog.map((entry, i) => (
                <div key={entry.ts + i} className="bg-muted rounded-lg p-2 font-mono text-xs">
                  <div className="text-purple-400">$ {entry.cmd}</div>
                  <div className={`mt-1 ${entry.result?.success ? 'text-green-400' : 'text-red-400'}`}>
                    {entry.result?.success
                      ? (typeof entry.result.response === 'object' ? JSON.stringify(entry.result.response, null, 2) : String(entry.result.response))
                      : `Error: ${entry.result?.error || 'Unknown error'}`
                    }
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
