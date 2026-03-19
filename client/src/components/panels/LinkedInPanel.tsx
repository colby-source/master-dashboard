import { useState, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { toast } from 'sonner'

type Tab = 'outreach' | 'profiles' | 'people-search' | 'companies' | 'jobs'

export function LinkedInPanel() {
  const [tab, setTab] = useState<Tab>('outreach')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'outreach', label: 'Outreach Queue' },
    { key: 'profiles', label: 'Profile Scraper' },
    { key: 'people-search', label: 'People Search' },
    { key: 'companies', label: 'Companies' },
    { key: 'jobs', label: 'Job Search' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">LinkedIn</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400">via Apify</span>
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
        {tab === 'outreach' && <OutreachQueueTab />}
        {tab === 'profiles' && <ProfilesTab />}
        {tab === 'people-search' && <PeopleSearchTab />}
        {tab === 'companies' && <CompaniesTab />}
        {tab === 'jobs' && <JobsTab />}
      </div>
    </div>
  )
}

// ── Outreach Queue ──────────────────────────────────────────

interface OutreachLead {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
  score: number | null
  score_label: string | null
  company_id: number
  company_name: string
  linkedin_url: string
  linkedin_message: string | null
  linkedin_outreach_status: string
  job_title: string
  lead_company: string
  updated_at: string
}

function OutreachQueueTab() {
  const [statusFilter, setStatusFilter] = useState('queued')
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['linkedin-outreach-queue', statusFilter],
    queryFn: () => api.linkedinOutreachQueue(statusFilter),
    refetchInterval: 15000,
  })

  const markSentMut = useMutation({
    mutationFn: (leadId: number) => api.linkedinOutreachMarkSent(leadId),
    onSuccess: () => { toast.success('Marked as sent'); refetch(); },
    onError: () => toast.error('Failed to mark as sent'),
  })

  const skipMut = useMutation({
    mutationFn: (leadId: number) => api.linkedinOutreachSkip(leadId),
    onSuccess: () => { toast.success('Skipped'); refetch(); },
    onError: () => toast.error('Failed to skip'),
  })

  const regenMut = useMutation({
    mutationFn: (leadId: number) => api.linkedinOutreachRegenerate(leadId),
    onSuccess: () => { toast.success('Message regenerated'); refetch(); },
    onError: () => toast.error('Failed to regenerate'),
  })

  const sendMut = useMutation({
    mutationFn: (leadId: number) => api.linkedinOutreachSend(leadId),
    onSuccess: () => { toast.success('Connection request sent via Apify!'); refetch(); },
    onError: (err: any) => toast.error(err?.message || 'Failed to send connection request'),
  })

  const sendBatchMut = useMutation({
    mutationFn: () => api.linkedinOutreachSendBatch(),
    onSuccess: (data: any) => {
      toast.success(`Batch sent: ${data?.sent || 0} sent, ${data?.failed || 0} failed`);
      refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'Batch send failed'),
  })

  const { data: outreachStatus } = useQuery({
    queryKey: ['linkedin-outreach-status'],
    queryFn: () => api.linkedinOutreachStatus(),
    refetchInterval: 60000,
  })

  const copyMessage = useCallback((lead: OutreachLead) => {
    if (!lead.linkedin_message) return
    navigator.clipboard.writeText(lead.linkedin_message)
    setCopiedId(lead.id)
    toast.success('Message copied to clipboard')
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const openLinkedIn = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const queue: OutreachLead[] = data?.queue ?? []

  const scoreBadge = (label: string | null) => {
    const colors: Record<string, string> = {
      hot: 'bg-red-500/20 text-red-400',
      warm: 'bg-orange-500/20 text-orange-400',
      cold: 'bg-blue-500/20 text-blue-400',
    }
    return colors[label || ''] || 'bg-muted text-muted-foreground'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['queued', 'sending', 'sent', 'skipped'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${statusFilter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {statusFilter === 'queued' && queue.length > 0 && outreachStatus?.ready && (
            <button onClick={() => sendBatchMut.mutate()}
              disabled={sendBatchMut.isPending}
              className="px-3 py-1 text-xs bg-green-600 text-white rounded-full font-medium hover:bg-green-700 disabled:opacity-50">
              {sendBatchMut.isPending ? 'Sending...' : `Send All (${queue.length})`}
            </button>
          )}
          {!outreachStatus?.ready && statusFilter === 'queued' && (
            <span className="text-[10px] text-yellow-400">Set LINKEDIN_LI_AT in .env to enable auto-send</span>
          )}
          <span className="text-xs text-muted-foreground">{queue.length} leads</span>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading queue...</div>}

      {!isLoading && queue.length === 0 && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No {statusFilter} leads. Hot leads from enrichment will appear here automatically.
        </div>
      )}

      <div className="space-y-2">
        {queue.map(lead => (
          <div key={lead.id} className="bg-muted/30 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {lead.first_name || ''} {lead.last_name || 'Unknown'}
                  </span>
                  {lead.score_label && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase ${scoreBadge(lead.score_label)}`}>
                      {lead.score_label} ({lead.score})
                    </span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {lead.company_name}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {lead.job_title}{lead.lead_company ? ` @ ${lead.lead_company}` : ''}
                </div>
              </div>
            </div>

            {lead.linkedin_message && (
              <div className="bg-background/50 rounded p-2 text-xs text-muted-foreground whitespace-pre-wrap">
                {lead.linkedin_message}
                <div className="text-[10px] text-right mt-1 opacity-50">
                  {lead.linkedin_message.length}/280 chars
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              {lead.linkedin_url && (
                <button onClick={() => openLinkedIn(lead.linkedin_url)}
                  className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded font-medium hover:bg-blue-700">
                  Open LinkedIn
                </button>
              )}
              <button onClick={() => copyMessage(lead)}
                disabled={!lead.linkedin_message}
                className="px-2.5 py-1 text-xs bg-muted text-foreground rounded font-medium hover:bg-muted/80 disabled:opacity-50">
                {copiedId === lead.id ? 'Copied!' : 'Copy Message'}
              </button>
              {statusFilter === 'queued' && (
                <>
                  {outreachStatus?.ready && (
                    <button onClick={() => sendMut.mutate(lead.id)}
                      disabled={sendMut.isPending}
                      className="px-2.5 py-1 text-xs bg-green-600 text-white rounded font-medium hover:bg-green-700 disabled:opacity-50">
                      {sendMut.isPending ? 'Sending...' : 'Send'}
                    </button>
                  )}
                  <button onClick={() => markSentMut.mutate(lead.id)}
                    disabled={markSentMut.isPending}
                    className="px-2.5 py-1 text-xs bg-green-600/20 text-green-400 rounded font-medium hover:bg-green-600/30">
                    Mark Sent
                  </button>
                  <button onClick={() => skipMut.mutate(lead.id)}
                    disabled={skipMut.isPending}
                    className="px-2.5 py-1 text-xs bg-muted/50 text-muted-foreground rounded font-medium hover:bg-muted/80">
                    Skip
                  </button>
                </>
              )}
              <button onClick={() => regenMut.mutate(lead.id)}
                disabled={regenMut.isPending}
                className="px-2.5 py-1 text-xs bg-purple-600/20 text-purple-400 rounded font-medium hover:bg-purple-600/30">
                {regenMut.isPending ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Profile Scraper ──────────────────────────────────────────

function ProfilesTab() {
  const [urls, setUrls] = useState('')
  const [results, setResults] = useState<any[] | null>(null)

  const scrapeMut = useMutation({
    mutationFn: () => {
      const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean)
      return api.linkedinScrapeProfiles(urlList)
    },
    onSuccess: (data) => {
      // Sync result comes back with dataset items
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Profiles scraped')
    },
    onError: () => toast.error('Scraping failed'),
  })

  return (
    <div className="space-y-4">
      <textarea value={urls} onChange={e => setUrls(e.target.value)}
        placeholder="Paste LinkedIn profile URLs (one per line)&#10;https://www.linkedin.com/in/username"
        className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      <div className="flex items-center gap-3">
        <button onClick={() => scrapeMut.mutate()} disabled={scrapeMut.isPending || !urls.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {scrapeMut.isPending ? 'Scraping...' : 'Scrape Profiles'}
        </button>
        {scrapeMut.isPending && <span className="text-xs text-muted-foreground">This may take 1-2 minutes...</span>}
      </div>
      {scrapeMut.error && <ErrorBox message={(scrapeMut.error as any).message} />}
      {results && <ResultsList data={results} type="profile" />}
    </div>
  )
}

// ── People Search ────────────────────────────────────────────

function PeopleSearchTab() {
  const [query, setQuery] = useState('')
  const [maxResults, setMaxResults] = useState('25')
  const [results, setResults] = useState<any[] | null>(null)

  const searchMut = useMutation({
    mutationFn: () => api.linkedinSearchPeople(query, parseInt(maxResults)),
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Search complete')
    },
    onError: () => toast.error('Search failed'),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder='Search query (e.g. "VP Sales SaaS New York")'
          className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        <input type="number" value={maxResults} onChange={e => setMaxResults(e.target.value)}
          placeholder="Max"
          className="w-20 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => searchMut.mutate()} disabled={searchMut.isPending || !query.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {searchMut.isPending ? 'Searching...' : 'Search People'}
        </button>
        {searchMut.isPending && <span className="text-xs text-muted-foreground">This may take 1-3 minutes...</span>}
      </div>
      {searchMut.error && <ErrorBox message={(searchMut.error as any).message} />}
      {results && <ResultsList data={results} type="profile" />}
    </div>
  )
}

// ── Companies ────────────────────────────────────────────────

function CompaniesTab() {
  const [urls, setUrls] = useState('')
  const [results, setResults] = useState<any[] | null>(null)

  const scrapeMut = useMutation({
    mutationFn: () => {
      const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean)
      return api.linkedinScrapeCompanies(urlList)
    },
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Companies scraped')
    },
    onError: () => toast.error('Scraping failed'),
  })

  return (
    <div className="space-y-4">
      <textarea value={urls} onChange={e => setUrls(e.target.value)}
        placeholder="Paste LinkedIn company URLs (one per line)&#10;https://www.linkedin.com/company/company-name"
        className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      <div className="flex items-center gap-3">
        <button onClick={() => scrapeMut.mutate()} disabled={scrapeMut.isPending || !urls.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {scrapeMut.isPending ? 'Scraping...' : 'Scrape Companies'}
        </button>
      </div>
      {scrapeMut.error && <ErrorBox message={(scrapeMut.error as any).message} />}
      {results && <ResultsList data={results} type="company" />}
    </div>
  )
}

// ── Job Search ───────────────────────────────────────────────

function JobsTab() {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [results, setResults] = useState<any[] | null>(null)

  const searchMut = useMutation({
    mutationFn: () => api.linkedinScrapeJobs(query, location || undefined),
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Jobs found')
    },
    onError: () => toast.error('Search failed'),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder='Job title or keywords (e.g. "Marketing Manager")'
          className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        <input type="text" value={location} onChange={e => setLocation(e.target.value)}
          placeholder="Location (optional)"
          className="w-40 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <button onClick={() => searchMut.mutate()} disabled={searchMut.isPending || !query.trim()}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
        {searchMut.isPending ? 'Searching...' : 'Search Jobs'}
      </button>
      {searchMut.error && <ErrorBox message={(searchMut.error as any).message} />}
      {results && <ResultsList data={results} type="job" />}
    </div>
  )
}

// ── Shared Components ────────────────────────────────────────

function ErrorBox({ message }: { message: string }) {
  return <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{message}</div>
}

function ResultsList({ data, type }: { data: any[]; type: 'profile' | 'company' | 'job' }) {
  const [expanded, setExpanded] = useState<number | null>(null)

  if (data.length === 0) return <div className="text-sm text-muted-foreground">No results found.</div>

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{data.length} results</div>
      {data.map((item, i) => (
        <div key={i} className="bg-muted/30 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(expanded === i ? null : i)}>
            <div className="min-w-0 flex-1">
              {type === 'profile' && (
                <>
                  <div className="text-sm font-medium truncate">
                    {item.firstName || item.first_name || ''} {item.lastName || item.last_name || item.name || 'Unknown'}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {item.headline || item.title || ''} {item.companyName || item.company ? `@ ${item.companyName || item.company}` : ''}
                  </div>
                </>
              )}
              {type === 'company' && (
                <>
                  <div className="text-sm font-medium truncate">{item.name || item.companyName || 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {item.industry || ''} {item.employeeCount ? `\u00b7 ${item.employeeCount} employees` : ''}
                  </div>
                </>
              )}
              {type === 'job' && (
                <>
                  <div className="text-sm font-medium truncate">{item.title || item.jobTitle || 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {item.company || item.companyName || ''} {item.location ? `\u00b7 ${item.location}` : ''}
                  </div>
                </>
              )}
            </div>
            <span className="text-xs text-muted-foreground ml-2">{expanded === i ? '\u25b2' : '\u25bc'}</span>
          </div>
          {expanded === i && (
            <pre className="text-xs text-muted-foreground mt-2 overflow-x-auto max-h-40 overflow-y-auto bg-background/50 rounded p-2">
              {JSON.stringify(item, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
