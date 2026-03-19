import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { toast } from 'sonner'

type Tab = 'campaigns' | 'sequence' | 'leads' | 'live'

export function InstagramDmPanel() {
  const [tab, setTab] = useState<Tab>('campaigns')
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null)
  const tabs: { key: Tab; label: string }[] = [
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'sequence', label: 'Sequence Builder' },
    { key: 'leads', label: 'Leads' },
    { key: 'live', label: 'Live Feed' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">Instagram DM Outreach</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-600/20 text-purple-400">Auto DM</span>
        </div>
      </div>
      <div className="flex border-b border-border overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'text-foreground border-b-2 border-purple-500' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'campaigns' && <CampaignsTab selectedId={selectedCampaignId} onSelect={(id) => { setSelectedCampaignId(id); setTab('sequence') }} />}
        {tab === 'sequence' && <SequenceTab campaignId={selectedCampaignId} onBack={() => setTab('campaigns')} />}
        {tab === 'leads' && <LeadsTab campaignId={selectedCampaignId} onBack={() => setTab('campaigns')} />}
        {tab === 'live' && <LiveFeedTab campaignId={selectedCampaignId} />}
      </div>
    </div>
  )
}

// ── Campaigns Tab ───────────────────────────────────────────

function CampaignsTab({ selectedId, onSelect }: { selectedId: number | null; onSelect: (id: number) => void }) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', daily_limit: 20, delay_min: 60, delay_max: 180, ig_session_cookie: '' })

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['ig-dm-campaigns'],
    queryFn: () => api.igDmGetCampaigns(),
  })

  const createMut = useMutation({
    mutationFn: () => api.igDmCreateCampaign(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-campaigns'] })
      setShowForm(false)
      setForm({ name: '', daily_limit: 20, delay_min: 60, delay_max: 180, ig_session_cookie: '' })
      toast.success('Campaign created')
    },
    onError: () => toast.error('Failed to create campaign'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.igDmDeleteCampaign(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-campaigns'] }); toast.success('Campaign deleted'); },
    onError: () => toast.error('Failed to delete'),
  })

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-600/20 text-gray-400',
      active: 'bg-green-600/20 text-green-400',
      paused: 'bg-yellow-600/20 text-yellow-400',
      completed: 'bg-blue-600/20 text-blue-400',
    }
    return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || colors.draft}`}>{status}</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{(campaigns as any[]).length} campaigns</span>
        <button onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">
          {showForm ? 'Cancel' : '+ New Campaign'}
        </button>
      </div>

      {showForm && (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Campaign name" className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Daily Limit</label>
              <input type="number" value={form.daily_limit} onChange={e => setForm({ ...form, daily_limit: parseInt(e.target.value) || 20 })}
                className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Min Delay (s)</label>
              <input type="number" value={form.delay_min} onChange={e => setForm({ ...form, delay_min: parseInt(e.target.value) || 60 })}
                className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Max Delay (s)</label>
              <input type="number" value={form.delay_max} onChange={e => setForm({ ...form, delay_max: parseInt(e.target.value) || 180 })}
                className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Instagram Session Cookie</label>
            <input value={form.ig_session_cookie} onChange={e => setForm({ ...form, ig_session_cookie: e.target.value })}
              placeholder="Paste your IG session cookie (sessionid=...)" type="password"
              className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
          </div>
          <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.name.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {createMut.isPending ? 'Creating...' : 'Create Campaign'}
          </button>
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading campaigns...</p>}

      <div className="space-y-2">
        {(campaigns as any[]).map((c: any) => (
          <div key={c.id} className={`border rounded-lg p-3 cursor-pointer transition-colors ${selectedId === c.id ? 'border-purple-500 bg-purple-500/5' : 'border-border hover:border-purple-500/50'}`}
            onClick={() => onSelect(c.id)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{c.name}</span>
                {statusBadge(c.status)}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{c.total_sent} sent / {c.total_replies} replies</span>
                <button onClick={e => { e.stopPropagation(); deleteMut.mutate(c.id) }}
                  className="text-xs text-red-400 hover:text-red-300 px-1">Del</button>
              </div>
            </div>
            {c.lead_source && (
              <p className="text-xs text-muted-foreground mt-1">
                Source: {c.lead_source === 'hashtag' ? '#' : '@'}{c.lead_source_value}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sequence Builder Tab ────────────────────────────────────

function SequenceTab({ campaignId, onBack }: { campaignId: number | null; onBack: () => void }) {
  const queryClient = useQueryClient()
  const [newTemplate, setNewTemplate] = useState('')
  const [newDelay, setNewDelay] = useState(0)

  const { data: steps = [] } = useQuery({
    queryKey: ['ig-dm-steps', campaignId],
    queryFn: () => campaignId ? api.igDmGetSteps(campaignId) : [],
    enabled: !!campaignId,
  })

  const addMut = useMutation({
    mutationFn: () => api.igDmAddStep(campaignId!, newTemplate, newDelay),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-steps', campaignId] })
      setNewTemplate('')
      setNewDelay(0)
      toast.success('Step added')
    },
    onError: () => toast.error('Failed to add step'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.igDmDeleteStep(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-steps', campaignId] }); toast.success('Step deleted'); },
    onError: () => toast.error('Failed to delete step'),
  })

  if (!campaignId) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">Select a campaign first</p>
        <button onClick={onBack} className="mt-2 text-sm text-purple-400 hover:text-purple-300">Go to Campaigns</button>
      </div>
    )
  }

  const templateVars = ['{{username}}', '{{full_name}}', '{{bio_snippet}}']

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-purple-400 hover:text-purple-300">Back to Campaigns</button>
        <span className="text-xs text-muted-foreground">{(steps as any[]).length} steps</span>
      </div>

      {/* Existing steps */}
      <div className="space-y-3">
        {(steps as any[]).map((s: any, i: number) => (
          <div key={s.id} className="border border-border rounded-lg p-3 bg-muted/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-purple-400">Step {i + 1}</span>
              <div className="flex items-center gap-2">
                {s.delay_hours > 0 && <span className="text-xs text-muted-foreground">Wait {s.delay_hours}h</span>}
                <button onClick={() => deleteMut.mutate(s.id)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
              </div>
            </div>
            <p className="text-sm whitespace-pre-wrap">{s.message_template}</p>
          </div>
        ))}
      </div>

      {/* Add new step */}
      <div className="border border-dashed border-border rounded-lg p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Add New Step</p>
        <div className="flex gap-2 flex-wrap">
          {templateVars.map(v => (
            <button key={v} onClick={() => setNewTemplate(prev => prev + v)}
              className="px-2 py-1 text-xs bg-purple-600/20 text-purple-400 rounded hover:bg-purple-600/30">
              {v}
            </button>
          ))}
        </div>
        <textarea value={newTemplate} onChange={e => setNewTemplate(e.target.value)}
          placeholder={"Hey {{full_name}}! I noticed you're into..."}
          className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-purple-500" />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Delay after previous step:</label>
            <input type="number" value={newDelay} onChange={e => setNewDelay(parseInt(e.target.value) || 0)}
              className="w-20 bg-muted/50 border border-border rounded p-1 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
            <span className="text-xs text-muted-foreground">hours</span>
          </div>
          <button onClick={() => addMut.mutate()} disabled={addMut.isPending || !newTemplate.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {addMut.isPending ? 'Adding...' : 'Add Step'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Leads Tab ───────────────────────────────────────────────

function LeadsTab({ campaignId, onBack }: { campaignId: number | null; onBack: () => void }) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [importMode, setImportMode] = useState<'none' | 'hashtag' | 'competitor' | 'manual'>('none')
  const [hashtagInput, setHashtagInput] = useState('')
  const [competitorInput, setCompetitorInput] = useState('')
  const [manualInput, setManualInput] = useState('')

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['ig-dm-leads', campaignId, statusFilter],
    queryFn: () => campaignId ? api.igDmGetLeads(campaignId, statusFilter || undefined) : [],
    enabled: !!campaignId,
  })

  const importHashtagMut = useMutation({
    mutationFn: () => api.igDmImportHashtag(campaignId!, hashtagInput.replace(/^#/, ''), 50),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] })
      setImportMode('none')
      setHashtagInput('')
      toast.success('Hashtag import started')
    },
    onError: () => toast.error('Import failed'),
  })

  const importCompetitorMut = useMutation({
    mutationFn: () => api.igDmImportCompetitor(campaignId!, competitorInput.replace(/^@/, ''), 50),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] })
      setImportMode('none')
      setCompetitorInput('')
      toast.success('Competitor import started')
    },
    onError: () => toast.error('Import failed'),
  })

  const addManualMut = useMutation({
    mutationFn: () => {
      const usernames = manualInput.split('\n').map(u => u.trim().replace(/^@/, '')).filter(Boolean)
      return api.igDmAddLeads(campaignId!, usernames.map(u => ({ username: u })))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] })
      setImportMode('none')
      setManualInput('')
      toast.success('Leads added')
    },
    onError: () => toast.error('Failed to add leads'),
  })

  const skipMut = useMutation({
    mutationFn: (leadId: number) => api.igDmUpdateLeadStatus(leadId, 'skipped'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] }); toast.success('Lead skipped'); },
    onError: () => toast.error('Failed to skip lead'),
  })

  if (!campaignId) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">Select a campaign first</p>
        <button onClick={onBack} className="mt-2 text-sm text-purple-400 hover:text-purple-300">Go to Campaigns</button>
      </div>
    )
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-600/20 text-gray-400',
    sent: 'bg-green-600/20 text-green-400',
    replied: 'bg-blue-600/20 text-blue-400',
    failed: 'bg-red-600/20 text-red-400',
    skipped: 'bg-yellow-600/20 text-yellow-400',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button onClick={onBack} className="text-sm text-purple-400 hover:text-purple-300">Back to Campaigns</button>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-xs bg-muted/50 border border-border rounded px-2 py-1 focus:outline-none">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="replied">Replied</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
          <span className="text-xs text-muted-foreground">{(leads as any[]).length} leads</span>
        </div>
      </div>

      {/* Import buttons */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setImportMode(importMode === 'hashtag' ? 'none' : 'hashtag')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${importMode === 'hashtag' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
          Import from Hashtag
        </button>
        <button onClick={() => setImportMode(importMode === 'competitor' ? 'none' : 'competitor')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${importMode === 'competitor' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
          Import from Competitor
        </button>
        <button onClick={() => setImportMode(importMode === 'manual' ? 'none' : 'manual')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${importMode === 'manual' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
          Add Manually
        </button>
      </div>

      {/* Import forms */}
      {importMode === 'hashtag' && (
        <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
          <input value={hashtagInput} onChange={e => setHashtagInput(e.target.value)}
            placeholder="Enter hashtag (e.g. fitness)" className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
          <button onClick={() => importHashtagMut.mutate()} disabled={importHashtagMut.isPending || !hashtagInput.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {importHashtagMut.isPending ? 'Scraping hashtag...' : 'Import Leads'}
          </button>
          {importHashtagMut.isPending && <p className="text-xs text-muted-foreground">This may take a minute...</p>}
        </div>
      )}

      {importMode === 'competitor' && (
        <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
          <input value={competitorInput} onChange={e => setCompetitorInput(e.target.value)}
            placeholder="Competitor username (e.g. nike)" className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
          <button onClick={() => importCompetitorMut.mutate()} disabled={importCompetitorMut.isPending || !competitorInput.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {importCompetitorMut.isPending ? 'Scraping competitor...' : 'Import Leads'}
          </button>
          {importCompetitorMut.isPending && <p className="text-xs text-muted-foreground">This may take a minute...</p>}
        </div>
      )}

      {importMode === 'manual' && (
        <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
          <textarea value={manualInput} onChange={e => setManualInput(e.target.value)}
            placeholder={"Paste usernames (one per line)\n@username or username"}
            className="w-full h-20 bg-muted/50 border border-border rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-purple-500" />
          <button onClick={() => addManualMut.mutate()} disabled={addManualMut.isPending || !manualInput.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {addManualMut.isPending ? 'Adding...' : 'Add Leads'}
          </button>
        </div>
      )}

      {/* Leads table */}
      {isLoading && <p className="text-sm text-muted-foreground">Loading leads...</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="pb-2 pr-4">Username</th>
              <th className="pb-2 pr-4">Followers</th>
              <th className="pb-2 pr-4">Engagement</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Step</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(leads as any[]).slice(0, 100).map((l: any) => (
              <tr key={l.id} className="border-b border-border/50">
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    {l.profile_pic_url && <img src={l.profile_pic_url} alt="" className="w-6 h-6 rounded-full" />}
                    <span className="font-medium">@{l.username}</span>
                  </div>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{l.followers ? fmt(l.followers) : '-'}</td>
                <td className="py-2 pr-4 text-muted-foreground">{l.engagement_rate ? `${l.engagement_rate}%` : '-'}</td>
                <td className="py-2 pr-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[l.status] || statusColors.pending}`}>{l.status}</span>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{l.current_step || '-'}</td>
                <td className="py-2">
                  {l.status === 'pending' && (
                    <button onClick={() => skipMut.mutate(l.id)} className="text-xs text-yellow-400 hover:text-yellow-300">Skip</button>
                  )}
                  {l.status === 'failed' && l.error_message && (
                    <span className="text-xs text-red-400" title={l.error_message}>Error</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(leads as any[]).length > 100 && (
        <p className="text-xs text-muted-foreground text-center">Showing first 100 of {(leads as any[]).length} leads</p>
      )}
    </div>
  )
}

// ── Live Feed Tab ───────────────────────────────────────────

function LiveFeedTab({ campaignId }: { campaignId: number | null }) {
  const queryClient = useQueryClient()
  const [events, setEvents] = useState<Array<{ type: string; message: string; timestamp: string }>>([])
  const feedRef = useRef<HTMLDivElement>(null)

  const { data: stats } = useQuery({
    queryKey: ['ig-dm-stats', campaignId],
    queryFn: () => campaignId ? api.igDmGetStats(campaignId) : null,
    enabled: !!campaignId,
    refetchInterval: 5000,
  })

  const { data: campaign } = useQuery({
    queryKey: ['ig-dm-campaign', campaignId],
    queryFn: () => campaignId ? api.igDmGetCampaign(campaignId) : null,
    enabled: !!campaignId,
    refetchInterval: 5000,
  })

  const startMut = useMutation({
    mutationFn: () => api.igDmStartCampaign(campaignId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-campaign', campaignId] }); toast.success('Campaign started'); },
    onError: () => toast.error('Failed to start'),
  })

  const pauseMut = useMutation({
    mutationFn: () => api.igDmPauseCampaign(campaignId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-campaign', campaignId] }); toast.success('Campaign paused'); },
    onError: () => toast.error('Failed to pause'),
  })

  // Listen for WebSocket events
  const addEvent = useCallback((ev: { type: string; message: string }) => {
    setEvents(prev => [{ ...ev, timestamp: new Date().toLocaleTimeString() }, ...prev].slice(0, 200))
  }, [])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'ig_dm_progress' || data.type === 'ig_dm_sent' || data.type === 'ig_dm_error') {
        if (!campaignId || data.campaignId === campaignId) {
          addEvent({ type: data.type, message: data.message || data.error || 'Event received' })
          queryClient.invalidateQueries({ queryKey: ['ig-dm-stats', campaignId] })
          queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] })
        }
      }
    }

    return () => ws.close()
  }, [campaignId, addEvent, queryClient])

  const st = stats as any
  const camp = campaign as any

  return (
    <div className="space-y-4">
      {!campaignId ? (
        <p className="text-sm text-muted-foreground text-center py-8">Select a campaign to see live activity</p>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Pending" value={st?.pending ?? 0} color="text-gray-400" />
            <StatCard label="Sent" value={st?.sent ?? 0} color="text-green-400" />
            <StatCard label="Replied" value={st?.replied ?? 0} color="text-blue-400" />
            <StatCard label="Reply Rate" value={`${st?.replyRate ?? 0}%`} color="text-purple-400" />
          </div>

          {/* Progress bar */}
          {st && st.total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>{st.sent + st.replied + st.failed + st.skipped} / {st.total}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-purple-500 h-2 rounded-full transition-all" style={{
                  width: `${Math.round(((st.sent + st.replied + st.failed + st.skipped) / st.total) * 100)}%`
                }} />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {camp?.status !== 'active' ? (
              <button onClick={() => startMut.mutate()} disabled={startMut.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                {startMut.isPending ? 'Starting...' : 'Start Campaign'}
              </button>
            ) : (
              <button onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 disabled:opacity-50">
                {pauseMut.isPending ? 'Pausing...' : 'Pause Campaign'}
              </button>
            )}
            <span className={`flex items-center text-xs px-3 py-1 rounded-full ${camp?.status === 'active' ? 'bg-green-600/20 text-green-400' : 'bg-gray-600/20 text-gray-400'}`}>
              {camp?.status || 'draft'}
            </span>
          </div>

          {/* Live event feed */}
          <div className="border border-border rounded-lg">
            <div className="px-3 py-2 border-b border-border flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium">Live Activity</span>
            </div>
            <div ref={feedRef} className="max-h-64 overflow-y-auto p-3 space-y-1">
              {events.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No activity yet. Start the campaign to see live updates.</p>
              )}
              {events.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0">{ev.timestamp}</span>
                  <span className={ev.type === 'ig_dm_error' ? 'text-red-400' : ev.type === 'ig_dm_sent' ? 'text-green-400' : 'text-foreground'}>
                    {ev.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-muted/20">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}
