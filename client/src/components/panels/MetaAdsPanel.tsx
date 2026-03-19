import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';

type Tab = 'overview' | 'campaigns' | 'adsets' | 'ads' | 'audiences' | 'creatives'

const DATE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_7d', label: '7 Days' },
  { key: 'last_14d', label: '14 Days' },
  { key: 'last_30d', label: '30 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
] as const;

export function MetaAdsPanel() {
  const [tab, setTab] = useState<Tab>('overview')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'adsets', label: 'Ad Sets' },
    { key: 'ads', label: 'Ads' },
    { key: 'audiences', label: 'Audiences' },
    { key: 'creatives', label: 'Creatives' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">Meta Ads</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">Marketing API</span>
        </div>
      </div>
      <div className="flex border-b border-border overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'campaigns' && <CampaignsTab />}
        {tab === 'adsets' && <AdSetsTab />}
        {tab === 'ads' && <AdsTab />}
        {tab === 'audiences' && <AudiencesTab />}
        {tab === 'creatives' && <CreativesTab />}
      </div>
    </div>
  )
}

// ── Status Badge ─────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status?.toUpperCase()
  const colors = s === 'ACTIVE' ? 'bg-green-500/20 text-green-400'
    : s === 'PAUSED' ? 'bg-yellow-500/20 text-yellow-400'
    : s === 'DELETED' || s === 'ARCHIVED' ? 'bg-red-500/20 text-red-400'
    : 'bg-gray-500/20 text-gray-400'
  return <span className={`text-xs px-2 py-0.5 rounded-full ${colors}`}>{status}</span>
}

// ── Overview Tab ─────────────────────────────────────────────

function OverviewTab() {
  const [datePreset, setDatePreset] = useState('last_7d')

  const { data: account } = useQuery({
    queryKey: ['meta-ads-account'],
    queryFn: api.getMetaAdAccount,
  })

  const { data: insights, isLoading } = useQuery({
    queryKey: ['meta-ads-insights', datePreset],
    queryFn: () => api.getMetaAdInsights(datePreset),
  })

  const { data: timeSeries } = useQuery({
    queryKey: ['meta-ads-time-series', datePreset],
    queryFn: () => api.getMetaAdInsightsTimeSeries(datePreset, 1),
  })

  if (account?.error) {
    return <div className="text-sm text-muted-foreground text-center py-6">
      Meta Ads not configured. Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in .env
    </div>
  }

  return (
    <div className="space-y-4">
      {/* Account Info */}
      {account && (
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium">{account.name || account.business_name || 'Ad Account'}</span>
          <span className="text-muted-foreground">{account.currency}</span>
          <span className="text-muted-foreground">Spent: ${(parseFloat(account.amount_spent || '0') / 100).toFixed(2)}</span>
        </div>
      )}

      {/* Date preset selector */}
      <div className="flex gap-1.5 flex-wrap">
        {DATE_PRESETS.map(dp => (
          <button key={dp.key} onClick={() => setDatePreset(dp.key)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${datePreset === dp.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'}`}>
            {dp.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      {isLoading ? <div className="text-sm text-muted-foreground">Loading insights...</div> : insights && Object.keys(insights).length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Spend" value={`$${parseFloat(insights.spend || '0').toFixed(2)}`} />
          <KpiCard label="Impressions" value={parseInt(insights.impressions || '0').toLocaleString()} />
          <KpiCard label="Clicks" value={parseInt(insights.clicks || '0').toLocaleString()} />
          <KpiCard label="CTR" value={`${parseFloat(insights.ctr || '0').toFixed(2)}%`} />
          <KpiCard label="CPC" value={`$${parseFloat(insights.cpc || '0').toFixed(2)}`} />
          <KpiCard label="CPM" value={`$${parseFloat(insights.cpm || '0').toFixed(2)}`} />
          <KpiCard label="Reach" value={parseInt(insights.reach || '0').toLocaleString()} />
          <KpiCard label="Frequency" value={parseFloat(insights.frequency || '0').toFixed(2)} />
        </div>
      ) : (
        <div className="text-sm text-muted-foreground text-center py-4">No insights data for this period.</div>
      )}

      {/* Daily trend */}
      {Array.isArray(timeSeries) && timeSeries.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Daily Spend Trend</h4>
          <div className="flex items-end gap-1 h-20">
            {timeSeries.map((d: any, i: number) => {
              const spend = parseFloat(d.spend || '0')
              const maxSpend = Math.max(...timeSeries.map((t: any) => parseFloat(t.spend || '0')), 1)
              const height = (spend / maxSpend) * 100
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.date_start}: $${spend.toFixed(2)}`}>
                  <div className="w-full bg-blue-500/60 rounded-t" style={{ height: `${Math.max(height, 2)}%` }} />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{timeSeries[0]?.date_start}</span>
            <span>{timeSeries[timeSeries.length - 1]?.date_start}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3 text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

// ── Campaigns Tab ────────────────────────────────────────────

function CampaignsTab() {
  const qc = useQueryClient()
  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['meta-ads-campaigns-live'],
    queryFn: () => api.getMetaAdCampaignsLive(),
  })

  const pauseMut = useMutation({
    mutationFn: (id: string) => api.pauseMetaAdCampaign(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meta-ads-campaigns-live'] }); toast.success('Campaign paused'); },
    onError: () => toast.error('Operation failed'),
  })

  const activateMut = useMutation({
    mutationFn: (id: string) => api.activateMetaAdCampaign(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meta-ads-campaigns-live'] }); toast.success('Campaign activated'); },
    onError: () => toast.error('Operation failed'),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading campaigns...</div>
  if (campaigns.length === 0) return <div className="text-sm text-muted-foreground text-center py-6">No campaigns found. Configure Meta Ads credentials first.</div>

  return (
    <div className="space-y-2">
      {campaigns.map((c: any) => (
        <div key={c.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{c.name}</div>
            <div className="flex gap-2 text-xs text-muted-foreground mt-0.5">
              <span>{c.objective}</span>
              {c.daily_budget && <span>Daily: ${(parseInt(c.daily_budget) / 100).toFixed(2)}</span>}
              {c.lifetime_budget && <span>Lifetime: ${(parseInt(c.lifetime_budget) / 100).toFixed(2)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={c.effective_status || c.status} />
            {(c.effective_status || c.status) === 'ACTIVE' ? (
              <button onClick={() => pauseMut.mutate(c.id)} disabled={pauseMut.isPending}
                className="text-xs px-2 py-1 rounded bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30">
                Pause
              </button>
            ) : (
              <button onClick={() => activateMut.mutate(c.id)} disabled={activateMut.isPending}
                className="text-xs px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/30">
                Activate
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Ad Sets Tab ──────────────────────────────────────────────

function AdSetsTab() {
  const qc = useQueryClient()
  const { data: adSets = [], isLoading } = useQuery({
    queryKey: ['meta-ads-adsets'],
    queryFn: () => api.getMetaAdSets(),
  })

  const pauseMut = useMutation({
    mutationFn: (id: string) => api.pauseMetaAdSet(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meta-ads-adsets'] }); toast.success('Ad set paused'); },
    onError: () => toast.error('Operation failed'),
  })

  const activateMut = useMutation({
    mutationFn: (id: string) => api.activateMetaAdSet(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meta-ads-adsets'] }); toast.success('Ad set activated'); },
    onError: () => toast.error('Operation failed'),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading ad sets...</div>
  if (adSets.length === 0) return <div className="text-sm text-muted-foreground text-center py-6">No ad sets found.</div>

  return (
    <div className="space-y-2">
      {adSets.map((as: any) => (
        <div key={as.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{as.name}</div>
            <div className="flex gap-2 text-xs text-muted-foreground mt-0.5">
              <span>{as.optimization_goal}</span>
              {as.daily_budget && <span>Daily: ${(parseInt(as.daily_budget) / 100).toFixed(2)}</span>}
              {as.budget_remaining && <span>Remaining: ${(parseInt(as.budget_remaining) / 100).toFixed(2)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={as.effective_status || as.status} />
            {(as.effective_status || as.status) === 'ACTIVE' ? (
              <button onClick={() => pauseMut.mutate(as.id)} disabled={pauseMut.isPending}
                className="text-xs px-2 py-1 rounded bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30">
                Pause
              </button>
            ) : (
              <button onClick={() => activateMut.mutate(as.id)} disabled={activateMut.isPending}
                className="text-xs px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/30">
                Activate
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Ads Tab ──────────────────────────────────────────────────

function AdsTab() {
  const qc = useQueryClient()
  const { data: ads = [], isLoading } = useQuery({
    queryKey: ['meta-ads-ads'],
    queryFn: () => api.getMetaAds(),
  })

  const pauseMut = useMutation({
    mutationFn: (id: string) => api.pauseMetaAd(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meta-ads-ads'] }); toast.success('Ad paused'); },
    onError: () => toast.error('Operation failed'),
  })

  const activateMut = useMutation({
    mutationFn: (id: string) => api.activateMetaAd(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meta-ads-ads'] }); toast.success('Ad activated'); },
    onError: () => toast.error('Operation failed'),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading ads...</div>
  if (ads.length === 0) return <div className="text-sm text-muted-foreground text-center py-6">No ads found.</div>

  return (
    <div className="space-y-2">
      {ads.map((ad: any) => (
        <div key={ad.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{ad.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              ID: {ad.id}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={ad.effective_status || ad.status} />
            {(ad.effective_status || ad.status) === 'ACTIVE' ? (
              <button onClick={() => pauseMut.mutate(ad.id)} disabled={pauseMut.isPending}
                className="text-xs px-2 py-1 rounded bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30">
                Pause
              </button>
            ) : (
              <button onClick={() => activateMut.mutate(ad.id)} disabled={activateMut.isPending}
                className="text-xs px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/30">
                Activate
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Audiences Tab ────────────────────────────────────────────

function AudiencesTab() {
  const qc = useQueryClient()
  const { data: audiences = [], isLoading } = useQuery({
    queryKey: ['meta-ads-audiences'],
    queryFn: () => api.getMetaAdAudiences(),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteMetaAdAudience(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['meta-ads-audiences'] }); toast.success('Audience deleted'); },
    onError: () => toast.error('Operation failed'),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading audiences...</div>
  if (audiences.length === 0) return <div className="text-sm text-muted-foreground text-center py-6">No custom audiences found.</div>

  return (
    <div className="space-y-2">
      {audiences.map((aud: any) => (
        <div key={aud.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{aud.name}</div>
            <div className="flex gap-2 text-xs text-muted-foreground mt-0.5">
              <span>{aud.subtype}</span>
              {aud.approximate_count != null && <span>~{parseInt(aud.approximate_count).toLocaleString()} users</span>}
            </div>
          </div>
          <button onClick={() => { if (confirm('Delete this audience?')) deleteMut.mutate(aud.id); }}
            disabled={deleteMut.isPending}
            className="text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30">
            Delete
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Creatives Tab ────────────────────────────────────────────

function CreativesTab() {
  const { data: creatives = [], isLoading } = useQuery({
    queryKey: ['meta-ads-creatives'],
    queryFn: () => api.getMetaAdCreatives(),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading creatives...</div>
  if (creatives.length === 0) return <div className="text-sm text-muted-foreground text-center py-6">No ad creatives found.</div>

  return (
    <div className="space-y-2">
      {creatives.map((cr: any) => (
        <div key={cr.id} className="flex items-start gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
          {cr.thumbnail_url && (
            <img src={cr.thumbnail_url} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{cr.name || cr.title || `Creative ${cr.id}`}</div>
            {cr.body && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{cr.body}</div>}
            <div className="text-[10px] text-muted-foreground mt-1">ID: {cr.id}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
