import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { toast } from 'sonner'

type Tab = 'quick-scrape' | 'runs' | 'tasks' | 'datasets' | 'account'

export function ScrapingHub() {
  const [tab, setTab] = useState<Tab>('quick-scrape')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'quick-scrape', label: 'Quick Scrape' },
    { key: 'runs', label: 'Runs' },
    { key: 'tasks', label: 'Saved Tasks' },
    { key: 'datasets', label: 'Datasets' },
    { key: 'account', label: 'Account' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">Scraping Hub</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">Apify</span>
        </div>
      </div>
      <div className="flex border-b border-border">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'quick-scrape' && <QuickScrapeTab />}
        {tab === 'runs' && <RunsTab />}
        {tab === 'tasks' && <TasksTab />}
        {tab === 'datasets' && <DatasetsTab />}
        {tab === 'account' && <AccountTab />}
      </div>
    </div>
  )
}

// ── Quick Scrape ──────────────────────────────────────────────

type ScrapeType = 'linkedin-profiles' | 'linkedin-companies' | 'instagram-profiles' | 'instagram-hashtag' | 'google' | 'website'

function QuickScrapeTab() {
  const [scrapeType, setScrapeType] = useState<ScrapeType>('google')
  const [input, setInput] = useState('')
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scrapers: { key: ScrapeType; label: string; placeholder: string }[] = [
    { key: 'google', label: 'Google Search', placeholder: 'Enter search queries (one per line)' },
    { key: 'linkedin-profiles', label: 'LinkedIn Profiles', placeholder: 'Enter LinkedIn profile URLs (one per line)' },
    { key: 'linkedin-companies', label: 'LinkedIn Companies', placeholder: 'Enter LinkedIn company page URLs (one per line)' },
    { key: 'instagram-profiles', label: 'Instagram Profiles', placeholder: 'Enter Instagram usernames (one per line, no @)' },
    { key: 'instagram-hashtag', label: 'Instagram Hashtag', placeholder: 'Enter a hashtag (without #)' },
    { key: 'website', label: 'Website Scraper', placeholder: 'Enter website URLs to scrape (one per line)' },
  ]

  const activeScraper = scrapers.find(s => s.key === scrapeType)!

  async function handleScrape() {
    if (!input.trim()) return
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const lines = input.split('\n').map(l => l.trim()).filter(Boolean)
      let result: any
      switch (scrapeType) {
        case 'google':
          result = await api.apifyScrapeGoogle(lines)
          break
        case 'linkedin-profiles':
          result = await api.apifyScrapeLinkedInProfiles(lines)
          break
        case 'linkedin-companies':
          result = await api.apifyScrapeLinkedInCompanies(lines)
          break
        case 'instagram-profiles':
          result = await api.apifyScrapeInstagramProfiles(lines)
          break
        case 'instagram-hashtag':
          result = await api.apifyScrapeInstagramHashtag(lines[0])
          break
        case 'website':
          result = await api.apifyScrapeWebsite(lines)
          break
      }
      setResults(result)
    } catch (e: any) {
      setError(e.message || 'Scrape failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {scrapers.map(s => (
          <button key={s.key} onClick={() => { setScrapeType(s.key); setResults(null); setError(null); }}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${scrapeType === s.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'}`}>
            {s.label}
          </button>
        ))}
      </div>
      <textarea
        value={input} onChange={e => setInput(e.target.value)}
        placeholder={activeScraper.placeholder}
        className="w-full h-28 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="flex items-center gap-3">
        <button onClick={handleScrape} disabled={loading || !input.trim()}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? 'Scraping...' : 'Run Scrape'}
        </button>
        {loading && <span className="text-xs text-muted-foreground animate-pulse">This may take 1-2 minutes...</span>}
      </div>
      {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>}
      {results && <ScrapeResults data={results} />}
    </div>
  )
}

function ScrapeResults({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false)
  const defaultDatasetId = data?.defaultDatasetId
  const status = data?.status

  const { data: items } = useQuery({
    queryKey: ['apify-dataset-items', defaultDatasetId],
    queryFn: () => api.apifyGetDatasetItems(defaultDatasetId, { limit: 50, clean: true }),
    enabled: !!defaultDatasetId && status === 'SUCCEEDED',
  })

  const displayItems = Array.isArray(items) ? items : []

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className={`text-xs px-2 py-0.5 rounded-full ${status === 'SUCCEEDED' ? 'bg-green-500/20 text-green-400' : status === 'RUNNING' ? 'bg-blue-500/20 text-blue-400 animate-pulse' : 'bg-yellow-500/20 text-yellow-400'}`}>
          {status || 'PENDING'}
        </span>
        {defaultDatasetId && <span className="text-xs text-muted-foreground">Dataset: {defaultDatasetId.slice(0, 8)}...</span>}
        {displayItems.length > 0 && <span className="text-xs text-muted-foreground">{displayItems.length} results</span>}
      </div>
      {displayItems.length > 0 && (
        <div className="space-y-1">
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-primary hover:underline">
            {expanded ? 'Collapse' : 'Show'} results
          </button>
          {expanded && (
            <pre className="bg-muted/50 border border-border rounded-lg p-3 text-xs max-h-96 overflow-auto">
              {JSON.stringify(displayItems, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── Runs ──────────────────────────────────────────────────────

function RunsTab() {
  const { data: runs, isLoading } = useQuery({
    queryKey: ['apify-runs'],
    queryFn: () => api.apifyListRuns({ limit: 20, desc: true }),
    refetchInterval: 10_000,
  })

  const qc = useQueryClient()
  const abortMut = useMutation({
    mutationFn: (runId: string) => api.apifyAbortRun(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apify-runs'] })
      toast.success('Run aborted')
    },
    onError: () => toast.error('Failed to abort run'),
  })

  const items = runs?.items ?? runs ?? []

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading runs...</div>

  return (
    <div className="space-y-2">
      {items.length === 0 && <div className="text-sm text-muted-foreground">No recent runs</div>}
      {items.map((run: any) => (
        <div key={run.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <StatusDot status={run.status} />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{run.actId || run.actorTaskId || 'Run'}</div>
              <div className="text-xs text-muted-foreground">
                {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}
                {run.stats?.durationMillis && <span className="ml-2">{(run.stats.durationMillis / 1000).toFixed(1)}s</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(run.status)}`}>{run.status}</span>
            {(run.status === 'RUNNING' || run.status === 'READY') && (
              <button onClick={() => abortMut.mutate(run.id)}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-500/30 hover:bg-red-500/10">
                Abort
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Tasks ─────────────────────────────────────────────────────

function TasksTab() {
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['apify-tasks'],
    queryFn: () => api.apifyListTasks({ limit: 50 }),
  })

  const qc = useQueryClient()
  const runMut = useMutation({
    mutationFn: (taskId: string) => api.apifyRunTask(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apify-runs'] })
      toast.success('Task started')
    },
    onError: () => toast.error('Failed to start task'),
  })

  const items = tasks?.items ?? tasks ?? []

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading tasks...</div>

  return (
    <div className="space-y-2">
      {items.length === 0 && <div className="text-sm text-muted-foreground">No saved tasks. Create tasks via Apify Console or the API.</div>}
      {items.map((task: any) => (
        <div key={task.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{task.name || task.id}</div>
            <div className="text-xs text-muted-foreground">{task.actId}</div>
          </div>
          <button onClick={() => runMut.mutate(task.id)}
            className="text-xs px-3 py-1 rounded-lg bg-purple-600 text-white hover:bg-purple-700">
            {runMut.isPending ? 'Starting...' : 'Run'}
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Datasets ──────────────────────────────────────────────────

function DatasetsTab() {
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null)

  const { data: datasets, isLoading } = useQuery({
    queryKey: ['apify-datasets'],
    queryFn: () => api.apifyListDatasets({ limit: 20 }),
  })

  const { data: items } = useQuery({
    queryKey: ['apify-dataset-items', selectedDataset],
    queryFn: () => api.apifyGetDatasetItems(selectedDataset!, { limit: 50, clean: true }),
    enabled: !!selectedDataset,
  })

  const datasetList = datasets?.items ?? datasets ?? []
  const displayItems = Array.isArray(items) ? items : []

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading datasets...</div>

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {datasetList.length === 0 && <div className="text-sm text-muted-foreground">No datasets yet</div>}
        {datasetList.map((ds: any) => (
          <button key={ds.id} onClick={() => setSelectedDataset(ds.id === selectedDataset ? null : ds.id)}
            className={`w-full text-left flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${ds.id === selectedDataset ? 'bg-primary/10 border border-primary/30' : 'bg-muted/30 hover:bg-muted/50'}`}>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{ds.name || ds.id.slice(0, 12)}</div>
              <div className="text-xs text-muted-foreground">{ds.itemCount ?? '?'} items &middot; {new Date(ds.modifiedAt || ds.createdAt).toLocaleDateString()}</div>
            </div>
          </button>
        ))}
      </div>
      {selectedDataset && displayItems.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">{displayItems.length} items loaded</div>
          <pre className="bg-muted/50 border border-border rounded-lg p-3 text-xs max-h-80 overflow-auto">
            {JSON.stringify(displayItems, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Account ───────────────────────────────────────────────────

function AccountTab() {
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['apify-user'],
    queryFn: () => api.apifyUser(),
  })

  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ['apify-usage'],
    queryFn: () => api.apifyUsage(),
  })

  if (userLoading || usageLoading) return <div className="text-sm text-muted-foreground">Loading account info...</div>

  return (
    <div className="space-y-4">
      {user && (
        <div className="bg-muted/30 rounded-lg p-4 space-y-2">
          <div className="text-sm font-semibold">{user.username || user.email || 'User'}</div>
          {user.email && <div className="text-xs text-muted-foreground">{user.email}</div>}
          {user.plan && (
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
                {typeof user.plan === 'object' ? user.plan.id : user.plan}
              </span>
            </div>
          )}
        </div>
      )}
      {usage && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Actor Compute', value: formatUsage(usage.usageUsd?.ACTOR_COMPUTE_UNITS ?? usage.actorComputeUnits), sub: 'CU used' },
            { label: 'Data Transfer', value: formatUsage(usage.usageUsd?.EXTERNAL_DATA_TRANSFER ?? usage.dataTransferGb), sub: 'GB' },
            { label: 'Proxy', value: formatUsage(usage.usageUsd?.RESIDENTIAL_PROXY ?? usage.proxySerpGoogleCredits), sub: 'credits' },
            { label: 'Total Cost', value: `$${(usage.usageUsd?.totalUsageUsd ?? 0).toFixed(2)}`, sub: 'this month' },
          ].map(m => (
            <div key={m.label} className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-lg font-bold">{m.value}</div>
              <div className="text-xs text-muted-foreground">{m.label}</div>
              <div className="text-[10px] text-muted-foreground">{m.sub}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'SUCCEEDED' ? 'bg-green-400' :
    status === 'RUNNING' || status === 'READY' ? 'bg-blue-400 animate-pulse' :
    status === 'FAILED' || status === 'ABORTED' ? 'bg-red-400' :
    'bg-gray-400'
  return <span className={`w-2 h-2 rounded-full ${color}`} />
}

function statusColor(status: string): string {
  switch (status) {
    case 'SUCCEEDED': return 'bg-green-500/20 text-green-400'
    case 'RUNNING': case 'READY': return 'bg-blue-500/20 text-blue-400'
    case 'FAILED': case 'ABORTED': case 'TIMED-OUT': return 'bg-red-500/20 text-red-400'
    default: return 'bg-gray-500/20 text-gray-400'
  }
}

function formatUsage(val: any): string {
  if (val === undefined || val === null) return '—'
  if (typeof val === 'number') return val < 1 ? val.toFixed(4) : val.toFixed(2)
  return String(val)
}
