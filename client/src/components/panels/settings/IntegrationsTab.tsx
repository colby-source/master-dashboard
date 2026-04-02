import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
  ExternalLink,
} from 'lucide-react';

export function IntegrationsTab() {
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
    'GoHighLevel \u2014 Granite Park Capital': 'ghl',
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
                      {pingResult.ok ? '\u2713' : '\u2717'} {pingResult.details}
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
