import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  Settings,
  CheckCircle2,
  XCircle,
  Zap,
  Loader2,
  Activity,
  Database,
  Webhook,
  RefreshCw,
  ExternalLink,
  Clock,
  AlertTriangle,
} from 'lucide-react';

type Tab = 'integrations' | 'webhooks' | 'system';

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('integrations');

  const tabs: { id: Tab; label: string; icon: typeof Settings }[] = [
    { id: 'integrations', label: 'API Integrations', icon: Zap },
    { id: 'webhooks', label: 'Webhook Monitor', icon: Webhook },
    { id: 'system', label: 'System', icon: Database },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-indigo-400" />
        <h1 className="text-lg font-semibold">Settings & System Health</h1>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'integrations' && <IntegrationsTab />}
      {activeTab === 'webhooks' && <WebhookMonitorTab />}
      {activeTab === 'system' && <SystemTab />}
    </div>
  );
}

// ── Integrations Tab ─────────────────────────────────────────

function IntegrationsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api.getSystemHealth(),
    refetchInterval: 60000,
  });

  const [pinging, setPinging] = useState<string | null>(null);
  const [pingResults, setPingResults] = useState<Record<string, { ok: boolean; latencyMs: number; details?: string }>>({});

  const pingMutation = useMutation({
    mutationFn: (service: string) => api.pingService(service),
    onSuccess: (result, service) => {
      setPingResults((prev) => ({ ...prev, [service]: result }));
      setPinging(null);
    },
    onError: (_err, service) => {
      setPingResults((prev) => ({ ...prev, [service]: { ok: false, latencyMs: 0, details: 'Request failed' } }));
      setPinging(null);
    },
  });

  const handlePing = (service: string) => {
    setPinging(service);
    pingMutation.mutate(service);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const { integrations = [], summary } = data ?? {};

  const categoryLabels: Record<string, string> = {
    outreach: 'Outreach',
    crm: 'CRM',
    advertising: 'Advertising',
    messaging: 'Messaging',
    automation: 'Automation',
    ai: 'AI',
    scraping: 'Scraping',
    enrichment: 'Enrichment',
  };

  const serviceSlug: Record<string, string> = {
    'Instantly': 'instantly',
    'GoHighLevel — Grand Park Capital': 'ghl',
    'Meta Ads': 'meta-ads',
    'Anthropic (Claude AI)': 'anthropic',
    'People Data Labs': 'pdl',
    'Hunter.io': 'hunter',
    'Apify': 'apify',
  };

  const grouped = integrations.reduce<Record<string, any[]>>((acc, integration: any) => {
    const cat = integration.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(integration);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold">{summary?.total ?? 0}</div>
          <div className="text-xs text-muted-foreground">Total Integrations</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{summary?.configured ?? 0}</div>
          <div className="text-xs text-muted-foreground">Connected</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-red-400">{summary?.missing ?? 0}</div>
          <div className="text-xs text-muted-foreground">Not Configured</div>
        </div>
      </div>

      {/* Integration cards by category */}
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            {categoryLabels[category] ?? category}
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((integration: any) => {
              const slug = serviceSlug[integration.name];
              const pingResult = slug ? pingResults[slug] : undefined;
              const isPinging = pinging === slug;

              return (
                <div
                  key={integration.name}
                  className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        {integration.configured ? (
                          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                        )}
                        <span className="font-medium text-sm">{integration.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{integration.description}</p>
                    </div>
                    {slug && (
                      <button
                        onClick={() => handlePing(slug)}
                        disabled={isPinging}
                        className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 flex items-center gap-1"
                      >
                        {isPinging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                        Ping
                      </button>
                    )}
                  </div>

                  {/* API Keys status */}
                  <div className="flex flex-wrap gap-2">
                    {integration.keys.map((key: any) => (
                      <span
                        key={key.label}
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          key.set
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}
                      >
                        {key.label}: {key.set ? 'Set' : 'Missing'}
                      </span>
                    ))}
                  </div>

                  {/* Base URL */}
                  {integration.baseUrl && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ExternalLink className="h-3 w-3" />
                      <span className="truncate">{integration.baseUrl}</span>
                    </div>
                  )}

                  {/* Ping result */}
                  {pingResult && (
                    <div className={`text-xs px-2 py-1 rounded ${pingResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                      {pingResult.ok ? '✓' : '✗'} {pingResult.details}
                      {pingResult.latencyMs > 0 && ` (${pingResult.latencyMs}ms)`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Webhook Monitor Tab ──────────────────────────────────────

function WebhookMonitorTab() {
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
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3 text-xs">{evt.source ?? '—'}</td>
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

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60000) return 'just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function summarizeEventData(json: string | null): string {
  if (!json) return '—';
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

// ── System Tab ───────────────────────────────────────────────

function SystemTab() {
  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api.getSystemHealth(),
    staleTime: 60000,
  });

  const { data: dbStats, isLoading: dbLoading } = useQuery({
    queryKey: ['db-stats'],
    queryFn: () => api.getDbStats(),
  });

  const system = health?.system;

  return (
    <div className="space-y-4">
      {/* System config */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3">System Configuration</h3>
        {system ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <ConfigItem label="Port" value={String(system.port)} />
            <ConfigItem label="DB Path" value={system.dbPath} />
            <ConfigItem label="Sync Interval" value={`${system.syncIntervalMs / 1000}s`} />
            <ConfigItem label="OpenClaw" value={system.openclawEnabled ? 'Enabled' : 'Disabled'} ok={system.openclawEnabled} />
            <ConfigItem label="Auto Enrichment" value={system.enrichmentAutoEnabled ? 'Enabled' : 'Disabled'} ok={system.enrichmentAutoEnabled} />
            <ConfigItem label="Enrichment Stale Days" value={String(system.enrichmentStaleDays)} />
            <ConfigItem label="Competitor URLs" value={String(system.competitorCount)} />
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">Loading...</div>
        )}
      </div>

      {/* Database stats */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3">Database Tables</h3>
        {dbLoading ? (
          <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {(dbStats?.tables ?? []).map((t: any) => (
              <div key={t.table} className="flex items-center justify-between bg-muted/50 rounded px-3 py-2 text-xs">
                <span className="font-mono text-muted-foreground">{t.table}</span>
                <span className="font-bold">
                  {t.count >= 0 ? t.count.toLocaleString() : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigItem({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${ok === false ? 'text-red-400' : ok === true ? 'text-green-400' : ''}`}>
        {value}
      </span>
    </div>
  );
}
