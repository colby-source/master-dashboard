import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import {
  Mail, Users, Send, BarChart3, Pause, Play,
  RefreshCw, Search, Inbox,
  Flame, Copy, Eye, MessageSquare, ArrowUpRight, Shield,
  Zap,
} from 'lucide-react';

type Tab = 'campaigns' | 'leads' | 'unibox' | 'accounts' | 'analytics';

export function OutboundHub() {
  const [tab, setTab] = useState<Tab>('campaigns');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'campaigns', label: 'Campaigns', icon: <Send className="h-4 w-4" /> },
    { id: 'leads', label: 'Leads', icon: <Users className="h-4 w-4" /> },
    { id: 'unibox', label: 'Unibox', icon: <Inbox className="h-4 w-4" /> },
    { id: 'accounts', label: 'Accounts', icon: <Mail className="h-4 w-4" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-4 w-4" /> },
  ];

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-between p-5 pb-0">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-orange-400" />
          <h3 className="font-semibold text-lg">Outbound Command Center</h3>
        </div>
        <WorkspaceInfo />
      </div>
      <div className="flex gap-1 px-5 mt-3 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-orange-400 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-5">
        {tab === 'campaigns' && <CampaignsTab />}
        {tab === 'leads' && <LeadsTab />}
        {tab === 'unibox' && <UniboxTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}

// ── Workspace badge ───────────────────────────────────────
function WorkspaceInfo() {
  const { data } = useQuery({
    queryKey: ['instantly-workspace'],
    queryFn: () => api.instantlyWorkspace(),
    staleTime: 300_000,
  });
  if (!data) return null;
  return (
    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
      {data.name ?? 'Workspace'}
    </span>
  );
}

// ── Campaigns Tab ─────────────────────────────────────────
function CampaignsTab() {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['instantly-campaigns', search],
    queryFn: () => api.instantlyCampaigns({ limit: 100, search: search || undefined }),
  });

  const pause = useMutation({
    mutationFn: (id: string) => api.instantlyPauseCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instantly-campaigns'] });
      toast.success('Campaign paused');
    },
    onError: () => toast.error('Failed to pause'),
  });

  const activate = useMutation({
    mutationFn: (id: string) => api.instantlyActivateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instantly-campaigns'] });
      toast.success('Campaign activated');
    },
    onError: () => toast.error('Failed to activate'),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.instantlyDuplicateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instantly-campaigns'] });
      toast.success('Campaign duplicated');
    },
    onError: () => toast.error('Failed to duplicate'),
  });

  const campaigns = data?.items ?? data ?? [];

  const statusColors: Record<number, { bg: string; label: string }> = {
    0: { bg: 'bg-gray-500/20 text-gray-400', label: 'Draft' },
    1: { bg: 'bg-green-500/20 text-green-400', label: 'Active' },
    2: { bg: 'bg-yellow-500/20 text-yellow-400', label: 'Paused' },
    3: { bg: 'bg-blue-500/20 text-blue-400', label: 'Completed' },
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-muted border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['instantly-campaigns'] })}
          className="p-2 rounded hover:bg-muted text-muted-foreground"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading campaigns...</div>
      ) : campaigns.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">No campaigns found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-2 pr-4">Campaign</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-right py-2 pr-4">Sent</th>
                <th className="text-right py-2 pr-4">Opens</th>
                <th className="text-right py-2 pr-4">Replies</th>
                <th className="text-right py-2 pr-4">Bounced</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c: any) => {
                const st = statusColors[c.campaign_status] ?? statusColors[0];
                return (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-2.5 pr-4 font-medium max-w-[300px] truncate">{c.name}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{c.stats?.sent ?? '--'}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{c.stats?.opened ?? '--'}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{c.stats?.replied ?? '--'}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{c.stats?.bounced ?? '--'}</td>
                    <td className="py-2.5 text-right flex items-center justify-end gap-1">
                      {c.campaign_status === 1 ? (
                        <button onClick={() => pause.mutate(c.id)} className="p-1 rounded hover:bg-muted text-yellow-400" title="Pause">
                          <Pause className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => activate.mutate(c.id)} className="p-1 rounded hover:bg-muted text-green-400" title="Activate">
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => duplicate.mutate(c.id)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Duplicate">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Leads Tab ─────────────────────────────────────────────
function LeadsTab() {
  const [search, setSearch] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');

  const { data: campaignsData } = useQuery({
    queryKey: ['instantly-campaigns-list'],
    queryFn: () => api.instantlyCampaigns({ limit: 100 }),
    staleTime: 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['instantly-leads', campaignFilter, search],
    queryFn: () => api.instantlyLeads({
      campaign_id: campaignFilter || undefined,
      limit: 100,
      search: search || undefined,
    }),
  });

  const campaigns = campaignsData?.items ?? campaignsData ?? [];
  const leads = data?.items ?? data ?? [];

  const interestLabels: Record<number, { color: string; label: string }> = {
    0: { color: 'text-gray-400', label: 'Unknown' },
    1: { color: 'text-green-400', label: 'Interested' },
    2: { color: 'text-yellow-400', label: 'Maybe' },
    3: { color: 'text-red-400', label: 'Not Interested' },
    4: { color: 'text-blue-400', label: 'Wrong Person' },
    5: { color: 'text-orange-400', label: 'Out of Office' },
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-muted border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 max-w-[200px]"
        >
          <option value="">All campaigns</option>
          {campaigns.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading leads...</div>
      ) : leads.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">No leads found. Select a campaign or search.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-2 pr-4">Email</th>
                <th className="text-left py-2 pr-4">Name</th>
                <th className="text-left py-2 pr-4">Company</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-left py-2">Interest</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l: any, i: number) => {
                const interest = interestLabels[l.interest_status] ?? interestLabels[0];
                return (
                  <tr key={l.email ?? i} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-2.5 pr-4 font-mono text-xs">{l.email}</td>
                    <td className="py-2.5 pr-4">{[l.first_name, l.last_name].filter(Boolean).join(' ') || '--'}</td>
                    <td className="py-2.5 pr-4">{l.company_name || '--'}</td>
                    <td className="py-2.5 pr-4">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-muted">{l.lead_status ?? l.status ?? '--'}</span>
                    </td>
                    <td className={`py-2.5 text-xs font-medium ${interest.color}`}>{interest.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="text-xs text-muted-foreground mt-2">Showing {leads.length} leads</div>
        </div>
      )}
    </div>
  );
}

// ── Unibox Tab ────────────────────────────────────────────
function UniboxTab() {
  const [selectedEmail, setSelectedEmail] = useState<any>(null);

  const { data: unread } = useQuery({
    queryKey: ['instantly-unread'],
    queryFn: () => api.instantlyCountUnread(),
    refetchInterval: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['instantly-emails'],
    queryFn: () => api.instantlyEmails({ limit: 50 }),
  });

  const { data: emailDetail } = useQuery({
    queryKey: ['instantly-email', selectedEmail?.id],
    queryFn: () => api.instantlyEmail(selectedEmail.id),
    enabled: !!selectedEmail?.id,
  });

  const emails = data?.items ?? data ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Inbox className="h-4 w-4 text-orange-400" />
        <span className="font-medium text-sm">Unified Inbox</span>
        {unread?.count > 0 && (
          <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full font-medium">
            {unread.count} unread
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading emails...</div>
      ) : (
        <div className="flex gap-4">
          {/* Email list */}
          <div className="flex-1 space-y-1 max-h-[400px] overflow-y-auto">
            {emails.length === 0 ? (
              <div className="text-muted-foreground text-sm py-8 text-center">No emails in inbox.</div>
            ) : emails.map((e: any, i: number) => (
              <button
                key={e.id ?? i}
                onClick={() => setSelectedEmail(e)}
                className={`w-full text-left p-3 rounded border transition-colors ${
                  selectedEmail?.id === e.id
                    ? 'border-orange-400/50 bg-orange-400/5'
                    : 'border-border/50 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate max-w-[60%]">
                    {e.from_address_email ?? e.from ?? 'Unknown'}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.timestamp ? new Date(e.timestamp).toLocaleDateString() : ''}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">{e.subject ?? '(no subject)'}</div>
                {e.is_unread && <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mt-1" />}
              </button>
            ))}
          </div>
          {/* Email detail */}
          {selectedEmail && (
            <div className="flex-1 border border-border rounded p-4 max-h-[400px] overflow-y-auto">
              <div className="text-sm font-medium mb-1">{emailDetail?.subject ?? selectedEmail.subject ?? '(no subject)'}</div>
              <div className="text-xs text-muted-foreground mb-3">
                From: {emailDetail?.from_address_email ?? selectedEmail.from_address_email ?? 'Unknown'}
              </div>
              <div className="text-sm whitespace-pre-wrap">{emailDetail?.body ?? emailDetail?.text_body ?? selectedEmail.snippet ?? 'Loading...'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Accounts Tab ──────────────────────────────────────────
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

function AccountsTab() {
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

// ── Analytics Tab ─────────────────────────────────────────
function AnalyticsTab() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['instantly-analytics-overview'],
    queryFn: () => api.instantlyAnalyticsOverview(),
    staleTime: 60_000,
  });

  const { data: countData } = useQuery({
    queryKey: ['instantly-count-launched'],
    queryFn: () => api.instantlyCountLaunched(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="text-muted-foreground text-sm py-8 text-center">Loading analytics...</div>;
  }

  const stats = overview ?? {};
  const metricCards = [
    { label: 'Emails Sent', value: stats.total_sent ?? stats.sent ?? 0, icon: <Send className="h-4 w-4 text-blue-400" /> },
    { label: 'Opens', value: stats.total_opened ?? stats.opened ?? 0, icon: <Eye className="h-4 w-4 text-green-400" /> },
    { label: 'Replies', value: stats.total_replied ?? stats.replied ?? 0, icon: <MessageSquare className="h-4 w-4 text-orange-400" /> },
    { label: 'Bounced', value: stats.total_bounced ?? stats.bounced ?? 0, icon: <ArrowUpRight className="h-4 w-4 text-red-400" /> },
    { label: 'Launched', value: countData?.count ?? '--', icon: <Zap className="h-4 w-4 text-yellow-400" /> },
  ];

  const openRate = stats.total_sent > 0
    ? ((stats.total_opened ?? stats.opened ?? 0) / stats.total_sent * 100).toFixed(1)
    : '0';
  const replyRate = stats.total_sent > 0
    ? ((stats.total_replied ?? stats.replied ?? 0) / stats.total_sent * 100).toFixed(1)
    : '0';

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {metricCards.map((m) => (
          <div key={m.label} className="bg-muted/50 rounded-lg p-3 border border-border/50">
            <div className="flex items-center gap-1.5 mb-1">
              {m.icon}
              <span className="text-xs text-muted-foreground">{m.label}</span>
            </div>
            <div className="text-xl font-bold tabular-nums">{typeof m.value === 'number' ? m.value.toLocaleString() : m.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted/50 rounded-lg p-4 border border-border/50 text-center">
          <div className="text-3xl font-bold text-green-400">{openRate}%</div>
          <div className="text-xs text-muted-foreground mt-1">Open Rate</div>
        </div>
        <div className="bg-muted/50 rounded-lg p-4 border border-border/50 text-center">
          <div className="text-3xl font-bold text-orange-400">{replyRate}%</div>
          <div className="text-xs text-muted-foreground mt-1">Reply Rate</div>
        </div>
      </div>
    </div>
  );
}
