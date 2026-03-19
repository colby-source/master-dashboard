import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Bot, ChevronDown, ChevronUp, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { timeAgo } from '../../lib/utils';

interface Props {
  companyId?: number;
}

export function AgentsPanel({ companyId }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', companyId],
    queryFn: () => api.getAgents(companyId),
  });

  const { data: runs = [] } = useQuery({
    queryKey: ['agent-runs', expandedId],
    queryFn: () => (expandedId ? api.getAgentRuns(expandedId) : Promise.resolve([])),
    enabled: !!expandedId,
  });

  const statusDot: Record<string, string> = {
    active: 'bg-green-500',
    paused: 'bg-yellow-500',
    error: 'bg-red-500',
    disabled: 'bg-gray-500',
  };

  const typeLabel: Record<string, string> = {
    cloudcode: 'CloudCode',
    ghl_workflow: 'GHL Workflow',
    openclaw_cron: 'OpenClaw',
  };

  const runStatusIcon: Record<string, { icon: typeof Clock; color: string }> = {
    running: { icon: Clock, color: 'text-blue-400' },
    success: { icon: CheckCircle2, color: 'text-green-400' },
    failed: { icon: XCircle, color: 'text-red-400' },
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <Bot className="h-5 w-5 text-blue-400" />
        <h3 className="font-semibold text-lg">Agents & Automations</h3>
      </div>
      {agents.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-6">No agents configured yet</div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent: any) => (
            <div key={agent.id}>
              <div
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted/70"
                onClick={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${statusDot[agent.status] || 'bg-gray-500'}`} />
                  <div>
                    <div className="font-medium text-sm">{agent.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{typeLabel[agent.type] || agent.type}</span>
                      {agent.company_name && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: agent.company_color }} />
                            {agent.company_name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right text-xs text-muted-foreground">
                    {agent.last_run ? timeAgo(agent.last_run) : 'Never run'}
                    <div>{agent.success_rate}% success</div>
                  </div>
                  {expandedId === agent.id ? (
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              </div>

              {expandedId === agent.id && (
                <div className="ml-6 mt-1 space-y-1 max-h-[200px] overflow-y-auto">
                  {runs.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-2">No run history recorded</div>
                  ) : (
                    runs.slice(0, 10).map((run: any) => {
                      const config = runStatusIcon[run.status] || runStatusIcon.running;
                      const Icon = config.icon;
                      return (
                        <div key={run.id} className="flex items-center gap-2 p-2 rounded bg-muted/30 text-xs">
                          <Icon className={`h-3 w-3 flex-shrink-0 ${config.color}`} />
                          <span className="flex-1 capitalize">{run.status}</span>
                          {run.duration_ms != null && (
                            <span className="text-muted-foreground">{(run.duration_ms / 1000).toFixed(1)}s</span>
                          )}
                          {run.cost_cents != null && run.cost_cents > 0 && (
                            <span className="text-muted-foreground">${(run.cost_cents / 100).toFixed(2)}</span>
                          )}
                          <span className="text-muted-foreground">{run.started_at ? timeAgo(run.started_at) : ''}</span>
                          {run.error_message && (
                            <span className="text-red-400 truncate max-w-[150px]" title={run.error_message}>{run.error_message}</span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
