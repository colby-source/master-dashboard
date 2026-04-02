import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { Loader2 } from 'lucide-react';

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

export function SystemTab() {
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
                  {t.count >= 0 ? t.count.toLocaleString() : '\u2014'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
