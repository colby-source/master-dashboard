import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { toast } from 'sonner';
import { Search, Pause, Play, Shield, Flame } from 'lucide-react';

function VolumeBar({ current, max, percent }: { current: number; max: number; percent: number }) {
  const color = percent >= 100 ? 'bg-green-400' : percent >= 50 ? 'bg-yellow-400' : 'bg-orange-400';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <span className="text-xs tabular-nums">{current}/{max}</span>
    </div>
  );
}

function ReadinessPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    READY: 'bg-green-400/15 text-green-400',
    WARMING: 'bg-orange-400/15 text-orange-400',
    COLD: 'bg-red-400/15 text-red-400',
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${styles[status] ?? styles.COLD}`}>
      {status}
    </span>
  );
}

export function AccountsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['instantly-accounts-warmup', search],
    queryFn: () => api.instantlyAccountsWarmupStatus({ limit: 100, search: search || undefined }),
    staleTime: 60_000,
  });

  const pauseAcct = useMutation({
    mutationFn: (email: string) => api.instantlyPauseAccount(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instantly-accounts-warmup'] });
      toast.success('Account paused');
    },
    onError: () => toast.error('Failed to pause account'),
  });

  const resumeAcct = useMutation({
    mutationFn: (email: string) => api.instantlyResumeAccount(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instantly-accounts-warmup'] });
      toast.success('Account resumed');
    },
    onError: () => toast.error('Failed to resume account'),
  });

  const testVitals = useMutation({
    mutationFn: (email: string) => api.instantlyTestVitals(email),
    onSuccess: () => toast.success('Vitals test started'),
    onError: () => toast.error('Vitals test failed'),
  });

  const accounts: any[] = data?.items ?? data ?? [];

  const readyCount = accounts.filter((a: any) => a.readiness_status === 'READY').length;
  const warmingCount = accounts.filter((a: any) => a.readiness_status === 'WARMING').length;
  const coldCount = accounts.filter((a: any) => a.readiness_status === 'COLD' || !a.readiness_status).length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search accounts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-muted border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
      </div>

      {/* Warmup Summary Bar */}
      {!isLoading && accounts.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="p-2.5 rounded border border-green-400/20 bg-green-400/5 text-center">
            <div className="text-lg font-bold text-green-400">{readyCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Ready to Send</div>
          </div>
          <div className="p-2.5 rounded border border-orange-400/20 bg-orange-400/5 text-center">
            <div className="text-lg font-bold text-orange-400">{warmingCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Warming Up</div>
          </div>
          <div className="p-2.5 rounded border border-red-400/20 bg-red-400/5 text-center">
            <div className="text-lg font-bold text-red-400">{coldCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Cold / No Data</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading accounts with warmup data...</div>
      ) : accounts.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">No sending accounts found.</div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a: any, i: number) => {
            const isActive = a.status === 1 || a.status === 'active';
            const hasTracking = a.tracking_domain_status === 'CTD_ACTIVE';

            return (
              <div key={a.email ?? i} className="p-3 rounded border border-border/50 hover:bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-400' : 'bg-yellow-400'}`} />
                    <div>
                      <div className="text-sm font-medium">{a.email}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        {a.daily_limit && <span>{a.daily_limit}/day</span>}
                        {a.warmup_status === 1 && (
                          <span className="flex items-center gap-0.5">
                            <Flame className="h-3 w-3 text-orange-400" />
                            Warming
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => testVitals.mutate(a.email)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                      title="Test Vitals"
                    >
                      <Shield className="h-3.5 w-3.5" />
                    </button>
                    {isActive ? (
                      <button
                        onClick={() => pauseAcct.mutate(a.email)}
                        className="p-1.5 rounded hover:bg-muted text-yellow-400"
                        title="Pause"
                      >
                        <Pause className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => resumeAcct.mutate(a.email)}
                        className="p-1.5 rounded hover:bg-muted text-green-400"
                        title="Resume"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Warmup Details Row */}
                <div className="flex items-center gap-3 mt-2 ml-5 flex-wrap">
                  {a.warmup_age_days !== undefined && a.warmup_age_days > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground uppercase">Age:</span>
                      <span className="text-xs">{a.warmup_age_days}d</span>
                    </div>
                  )}
                  {a.expected_daily_volume !== undefined && a.warmup_limit > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground uppercase">Volume:</span>
                      <VolumeBar current={a.expected_daily_volume} max={a.warmup_limit} percent={a.volume_percent} />
                    </div>
                  )}
                  {a.warmup_increment !== undefined && a.warmup_increment > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground uppercase">+{a.warmup_increment}/day</span>
                    </div>
                  )}
                  {hasTracking && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-green-400">{a.tracking_domain}</span>
                    </div>
                  )}
                  {a.readiness_status && (
                    <ReadinessPill status={a.readiness_status} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
