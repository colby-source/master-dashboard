import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { toast } from 'sonner'

type Tab = 'profiles' | 'hashtags' | 'posts' | 'reels' | 'compare'

export function InstagramPanel() {
  const [tab, setTab] = useState<Tab>('profiles')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'profiles', label: 'Profile Scraper' },
    { key: 'hashtags', label: 'Hashtag Research' },
    { key: 'posts', label: 'Post Scraper' },
    { key: 'reels', label: 'Reels' },
    { key: 'compare', label: 'Competitor Compare' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">Instagram</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-pink-600/20 text-pink-400">via Apify</span>
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
        {tab === 'profiles' && <ProfilesTab />}
        {tab === 'hashtags' && <HashtagsTab />}
        {tab === 'posts' && <PostsTab />}
        {tab === 'reels' && <ReelsTab />}
        {tab === 'compare' && <CompareTab />}
      </div>
    </div>
  )
}

// ── Profile Scraper ──────────────────────────────────────────

function ProfilesTab() {
  const [usernames, setUsernames] = useState('')
  const [results, setResults] = useState<any[] | null>(null)

  const scrapeMut = useMutation({
    mutationFn: () => {
      const list = usernames.split('\n').map(u => u.trim().replace(/^@/, '')).filter(Boolean)
      return api.instagramScrapeProfiles(list)
    },
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Profiles scraped')
    },
    onError: () => toast.error('Scraping failed'),
  })

  return (
    <div className="space-y-4">
      <textarea value={usernames} onChange={e => setUsernames(e.target.value)}
        placeholder={"Paste Instagram usernames (one per line)\n@username or username"}
        className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      <div className="flex items-center gap-3">
        <button onClick={() => scrapeMut.mutate()} disabled={scrapeMut.isPending || !usernames.trim()}
          className="px-4 py-2 bg-pink-600 text-white rounded-lg text-sm font-medium hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {scrapeMut.isPending ? 'Scraping...' : 'Scrape Profiles'}
        </button>
        {scrapeMut.isPending && <span className="text-xs text-muted-foreground">This may take 1-2 minutes...</span>}
      </div>
      {scrapeMut.error && <ErrorBox message={(scrapeMut.error as any).message} />}
      {results && <ProfileResults data={results} />}
    </div>
  )
}

// ── Hashtag Research ─────────────────────────────────────────

function HashtagsTab() {
  const [hashtags, setHashtags] = useState('')
  const [maxPosts, setMaxPosts] = useState('50')
  const [results, setResults] = useState<any | null>(null)

  const scrapeMut = useMutation({
    mutationFn: () => {
      const list = hashtags.split('\n').map(h => h.trim().replace(/^#/, '')).filter(Boolean)
      return api.instagramScrapeHashtags(list, parseInt(maxPosts))
    },
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Hashtags scraped')
    },
    onError: () => toast.error('Scraping failed'),
  })

  const analyzeMut = useMutation({
    mutationFn: () => {
      const tag = hashtags.split('\n')[0]?.trim().replace(/^#/, '') || ''
      return api.instagramAnalyzeHashtag(tag, parseInt(maxPosts))
    },
    onSuccess: (data) => { setResults(data); toast.success('Analysis complete'); },
    onError: () => toast.error('Analysis failed'),
  })

  return (
    <div className="space-y-4">
      <textarea value={hashtags} onChange={e => setHashtags(e.target.value)}
        placeholder={"Paste hashtags (one per line)\n#marketing or marketing"}
        className="w-full h-20 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      <div className="flex items-center gap-3">
        <input type="number" value={maxPosts} onChange={e => setMaxPosts(e.target.value)}
          placeholder="Max posts" className="w-24 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        <button onClick={() => scrapeMut.mutate()} disabled={scrapeMut.isPending || !hashtags.trim()}
          className="px-4 py-2 bg-pink-600 text-white rounded-lg text-sm font-medium hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {scrapeMut.isPending ? 'Scraping...' : 'Scrape Posts'}
        </button>
        <button onClick={() => analyzeMut.mutate()} disabled={analyzeMut.isPending || !hashtags.trim()}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {analyzeMut.isPending ? 'Analyzing...' : 'Analyze Hashtag'}
        </button>
      </div>
      {(scrapeMut.error || analyzeMut.error) && <ErrorBox message={((scrapeMut.error || analyzeMut.error) as any)?.message} />}
      {results && (
        Array.isArray(results)
          ? <PostResults data={results} />
          : <HashtagAnalysis data={results} />
      )}
    </div>
  )
}

// ── Post Scraper ─────────────────────────────────────────────

function PostsTab() {
  const [urls, setUrls] = useState('')
  const [results, setResults] = useState<any[] | null>(null)

  const scrapeMut = useMutation({
    mutationFn: () => {
      const list = urls.split('\n').map(u => u.trim()).filter(Boolean)
      return api.instagramScrapePosts(list)
    },
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Posts scraped')
    },
    onError: () => toast.error('Scraping failed'),
  })

  return (
    <div className="space-y-4">
      <textarea value={urls} onChange={e => setUrls(e.target.value)}
        placeholder={"Paste Instagram post URLs (one per line)\nhttps://www.instagram.com/p/ABC123/"}
        className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      <div className="flex items-center gap-3">
        <button onClick={() => scrapeMut.mutate()} disabled={scrapeMut.isPending || !urls.trim()}
          className="px-4 py-2 bg-pink-600 text-white rounded-lg text-sm font-medium hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {scrapeMut.isPending ? 'Scraping...' : 'Scrape Posts'}
        </button>
        {scrapeMut.isPending && <span className="text-xs text-muted-foreground">This may take 1-2 minutes...</span>}
      </div>
      {scrapeMut.error && <ErrorBox message={(scrapeMut.error as any).message} />}
      {results && <PostResults data={results} />}
    </div>
  )
}

// ── Reels ────────────────────────────────────────────────────

function ReelsTab() {
  const [username, setUsername] = useState('')
  const [maxReels, setMaxReels] = useState('20')
  const [results, setResults] = useState<any[] | null>(null)

  const scrapeMut = useMutation({
    mutationFn: () => api.instagramScrapeReels(username.replace(/^@/, ''), parseInt(maxReels)),
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Reels scraped')
    },
    onError: () => toast.error('Scraping failed'),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input type="text" value={username} onChange={e => setUsername(e.target.value)}
          placeholder="Instagram username"
          className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        <input type="number" value={maxReels} onChange={e => setMaxReels(e.target.value)}
          placeholder="Max"
          className="w-20 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <button onClick={() => scrapeMut.mutate()} disabled={scrapeMut.isPending || !username.trim()}
        className="px-4 py-2 bg-pink-600 text-white rounded-lg text-sm font-medium hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed">
        {scrapeMut.isPending ? 'Scraping...' : 'Scrape Reels'}
      </button>
      {scrapeMut.error && <ErrorBox message={(scrapeMut.error as any).message} />}
      {results && <PostResults data={results} />}
    </div>
  )
}

// ── Competitor Compare ───────────────────────────────────────

function CompareTab() {
  const [usernames, setUsernames] = useState('')
  const [results, setResults] = useState<any | null>(null)

  const compareMut = useMutation({
    mutationFn: () => {
      const list = usernames.split('\n').map(u => u.trim().replace(/^@/, '')).filter(Boolean)
      return api.instagramCompareProfiles(list)
    },
    onSuccess: (data) => { setResults(data); toast.success('Comparison complete'); },
    onError: () => toast.error('Comparison failed'),
  })

  return (
    <div className="space-y-4">
      <textarea value={usernames} onChange={e => setUsernames(e.target.value)}
        placeholder={"Paste competitor usernames to compare (one per line)\n@competitor1\n@competitor2"}
        className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      <button onClick={() => compareMut.mutate()} disabled={compareMut.isPending || !usernames.trim()}
        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
        {compareMut.isPending ? 'Comparing...' : 'Compare Profiles'}
      </button>
      {compareMut.error && <ErrorBox message={(compareMut.error as any).message} />}
      {results?.profiles && <CompareResults data={results.profiles} />}
    </div>
  )
}

// ── Shared Components ────────────────────────────────────────

function ErrorBox({ message }: { message: string }) {
  return <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{message}</div>
}

function ProfileResults({ data }: { data: any[] }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  if (data.length === 0) return <div className="text-sm text-muted-foreground">No results found.</div>

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{data.length} profiles</div>
      {data.map((item, i) => (
        <div key={i} className="bg-muted/30 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(expanded === i ? null : i)}>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {item.profilePicUrl && (
                <img src={item.profilePicUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  @{item.username || 'unknown'} {item.verified && <span className="text-blue-400 text-xs">verified</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {item.fullName || item.full_name || ''} &middot; {fmt(item.followersCount || item.followers)} followers &middot; {item.postsCount || item.mediaCount || 0} posts
                </div>
              </div>
            </div>
            <span className="text-xs text-muted-foreground ml-2">{expanded === i ? '\u25b2' : '\u25bc'}</span>
          </div>
          {expanded === i && (
            <div className="mt-2 space-y-1">
              {item.biography && <div className="text-xs text-muted-foreground">{item.biography}</div>}
              <pre className="text-xs text-muted-foreground overflow-x-auto max-h-40 overflow-y-auto bg-background/50 rounded p-2">
                {JSON.stringify(item, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function PostResults({ data }: { data: any[] }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  if (data.length === 0) return <div className="text-sm text-muted-foreground">No results found.</div>

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{data.length} posts</div>
      {data.map((item, i) => (
        <div key={i} className="bg-muted/30 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(expanded === i ? null : i)}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {item.caption?.slice(0, 80) || item.text?.slice(0, 80) || 'No caption'}
              </div>
              <div className="text-xs text-muted-foreground">
                {fmt(item.likesCount || item.likes)} likes &middot; {fmt(item.commentsCount || item.comments)} comments
                {item.ownerUsername && <> &middot; @{item.ownerUsername}</>}
              </div>
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

function CompareResults({ data }: { data: any[] }) {
  if (data.length === 0) return <div className="text-sm text-muted-foreground">No profiles to compare.</div>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b border-border">
            <th className="pb-2 pr-4">Username</th>
            <th className="pb-2 pr-4">Followers</th>
            <th className="pb-2 pr-4">Following</th>
            <th className="pb-2 pr-4">Posts</th>
            <th className="pb-2 pr-4">Eng. Rate</th>
            <th className="pb-2">Verified</th>
          </tr>
        </thead>
        <tbody>
          {data.map((p, i) => (
            <tr key={i} className="border-b border-border/50">
              <td className="py-2 pr-4 font-medium">@{p.username}</td>
              <td className="py-2 pr-4">{fmt(p.followers)}</td>
              <td className="py-2 pr-4">{fmt(p.following)}</td>
              <td className="py-2 pr-4">{fmt(p.posts)}</td>
              <td className="py-2 pr-4">{p.engagementRate}%</td>
              <td className="py-2">{p.isVerified ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HashtagAnalysis({ data }: { data: any }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/30 rounded-lg p-3 text-center">
          <div className="text-lg font-bold">{fmt(data.totalPosts)}</div>
          <div className="text-xs text-muted-foreground">Posts Analyzed</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-3 text-center">
          <div className="text-lg font-bold">{fmt(data.avgLikes)}</div>
          <div className="text-xs text-muted-foreground">Avg Likes</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-3 text-center">
          <div className="text-lg font-bold">{fmt(data.avgComments)}</div>
          <div className="text-xs text-muted-foreground">Avg Comments</div>
        </div>
      </div>
      {data.mediaTypes && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Media Types</div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(data.mediaTypes).map(([type, count]) => (
              <span key={type} className="text-xs px-2 py-1 bg-muted/50 rounded">{type}: {count as number}</span>
            ))}
          </div>
        </div>
      )}
      {data.topPosts?.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Top Posts by Likes</div>
          <PostResults data={data.topPosts} />
        </div>
      )}
    </div>
  )
}

function fmt(n: number | undefined | null): string {
  if (n == null) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}
