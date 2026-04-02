import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Clock,
  AlertTriangle,
} from 'lucide-react';

function formatTime(iso: string): string {
  if (!iso) return '\u2014';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60000) return 'just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function summarizeEventData(json: string | null): string {
  if (!json) return '\u2014';
  try {
    const data = JSON.parse(json);
    if (data.page_url) return `Page: ${data.page_url}`;
    if (data.campaign_name) return `Campaign: ${data.campaign_name}`;
    if (data.pipeline_name) return `Pipeline: ${data.pipeline_name}`;
    if (data.ad_name) return `Ad: ${data.ad_name}`;
    const keys = Object.keys(data);
    return keys.slice(0, 3).join(', ');
  } catch {
    return json.slice(0, 50);
  }
}

export function WebhookMonitorTab() {
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['webhook-log', sourceFilter, page],
    queryFn: () => api.getWebhookLog({ limit: pageSize, offset: page * pageSize, source: sourceFilter || undefined }),
    refetchInterval: 15000,
  });

  const { data: stats } = useQuery({
    queryKey: ['webhook-log-stats'],
    queryFn: () => api.getWebhookLogStats(),
    refetchInterval: 30000,
  });

  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api.getSystemHealth(),
    staleTime: 60000,
  });

  const webhookEndpoints = health?.webhooks ?? [];

  return (
    <div className="space-y-4">
      {/* Webhook endpoint status */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3">Webhook Endpoints</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {webhookEndpoints.map((wh: any) => (
            <div key={wh.name} className="flex items-center gap-2 text-xs">
              {wh.secretConfigured ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
              )}
              <span>{wh.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Volume stats */}
      {stats?.bySource && stats.bySource.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Last 24h Volume</h3>
          <div className="flex flex-wrap gap-3">
            {stats.bySource.map((s: any) => (
              <div key={s.source} className="bg-muted rounded-lg px-3 py-2 text-center">
                <div className="text-lg font-bold">{s.count}</div>
                <div className="text-xs text-muted-foreground">{s.source}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter & refresh */}
      <div className="flex items-center gap-3">
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }}
          className="bg-muted border border-border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Sources</option>
          <option value="rb2b">RB2B</option>
          <option value="ghl">GHL</option>
          <option value="meta">Meta</option>
          <option value="instantly">Instantly</option>
          <option value="n8n">N8N</option>
        </select>
        <button onClick={() => refetch()} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        <span className="text-xs text-muted-foreground ml-auto">
          {data?.total ?? 0} total events
        </span>
      </div>

      {/* Event log table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left p-3">Time</th>
                <th className="text-left p-3">Event Type</th>
                <th className="text-left p-3">Contact</th>
                <th className="text-left p-3">Source</th>
                <th className="text-left p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {(data?.events ?? []).map((evt: any) => (
                <tr key={evt.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTime(evt.created_at)}
                    </div>
                  </td>
                  <td className="p-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-mono">
                      {evt.event_type}
                    </span>
                  </td>
                  <td className="p-3 text-xs">
                    {evt.email ? (
                      <div>
                        <div className="font-medium">{evt.first_name} {evt.last_name}</div>
                        <div className="text-muted-foreground">{evt.email}</div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">\u2014</span>
                    )}
                  </td>
                  <td className="p-3 text-xs">{evt.source ?? '\u2014'}</td>
                  <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate">
                    {summarizeEventData(evt.event_data)}
                  </td>
                </tr>
              ))}
              {(data?.events ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                    No webhook events found
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {(data?.total ?? 0) > pageSize && (
            <div className="flex items-center justify-between p-3 border-t border-border text-xs">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded bg-muted hover:bg-muted/80 disabled:opacity-30"
              >
                Previous
              </button>
              <span className="text-muted-foreground">
                Page {page + 1} of {Math.ceil((data?.total ?? 0) / pageSize)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * pageSize >= (data?.total ?? 0)}
                className="px-2 py-1 rounded bg-muted hover:bg-muted/80 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Event type breakdown */}
      {(data?.breakdown ?? []).length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Event Types (Last 24h)</h3>
          <div className="flex flex-wrap gap-2">
            {data!.breakdown.map((b: any) => (
              <span key={b.event_type} className="text-xs px-2 py-1 rounded bg-muted">
                {b.event_type}: <strong>{b.count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
