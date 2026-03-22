import { type ReactNode, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, BarChart3, Brain, Paintbrush, Rocket,
  RefreshCw, TrendingUp, Eye, Zap, ChevronRight,
  Star, Clock, Globe, AlertTriangle, CheckCircle,
  Play, Filter, ArrowUpDown,
} from 'lucide-react'

const BASE = '/api/ad-intelligence'

async function apiFetch<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// ── Tab definitions ──────────────────────────────────────────────

const TABS = [
  { id: 'discover', label: 'Discover', icon: Search },
  { id: 'analyze', label: 'Analyze', icon: BarChart3 },
  { id: 'research', label: 'Research', icon: Brain },
  { id: 'create', label: 'Create', icon: Paintbrush },
  { id: 'launch', label: 'Launch', icon: Rocket },
] as const

type TabId = typeof TABS[number]['id']

// ── Score badge ──────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70 ? 'text-green-400 bg-green-400/10' :
    score >= 40 ? 'text-yellow-400 bg-yellow-400/10' :
    'text-red-400 bg-red-400/10'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <Star className="h-3 w-3" />
      {score}
    </span>
  )
}

// ── Discover Tab ─────────────────────────────────────────────────

function DiscoverTab() {
  const queryClient = useQueryClient()
  const [selectedTerms, setSelectedTerms] = useState<string[]>([])
  const [activeOnly, setActiveOnly] = useState(true)

  const { data: searchTerms } = useQuery({
    queryKey: ['ad-intel-terms'],
    queryFn: () => apiFetch('/discover/search-terms'),
  })

  const { data: stats } = useQuery({
    queryKey: ['ad-intel-stats'],
    queryFn: () => apiFetch('/stats'),
  })

  const { data: pages } = useQuery({
    queryKey: ['ad-intel-pages'],
    queryFn: () => apiFetch('/pages'),
  })

  const searchMutation = useMutation({
    mutationFn: () =>
      apiFetch('/discover/search', {
        method: 'POST',
        body: JSON.stringify({
          searchTerms: selectedTerms.length > 0 ? selectedTerms : undefined,
          activeOnly,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ad-intel-stats'] })
      queryClient.invalidateQueries({ queryKey: ['ad-intel-pages'] })
      queryClient.invalidateQueries({ queryKey: ['ad-intel-ads'] })
    },
  })

  const terms = searchTerms?.data || []
  const statsData = stats?.data || {}
  const pagesData = pages?.data || []

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Ads', value: statsData.totalAds || 0, icon: Eye },
          { label: 'Active Ads', value: statsData.activeAds || 0, icon: Play },
          { label: 'Competitors', value: statsData.uniqueCompetitors || 0, icon: Globe },
          { label: 'Avg Score', value: statsData.avgScore || 0, icon: TrendingUp },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </div>
            <div className="text-2xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Search Controls */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Search className="h-4 w-4" />
          Search Meta Ad Library
        </h3>

        <div className="flex flex-wrap gap-2 mb-4">
          {terms.map((term: string) => (
            <button
              key={term}
              onClick={() =>
                setSelectedTerms(prev =>
                  prev.includes(term) ? prev.filter(t => t !== term) : [...prev, term]
                )
              }
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                selectedTerms.includes(term)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              {term}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={e => setActiveOnly(e.target.checked)}
              className="rounded border-border"
            />
            Active ads only
          </label>
          <button
            onClick={() => searchMutation.mutate()}
            disabled={searchMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50"
          >
            {searchMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {searchMutation.isPending ? 'Scanning...' : 'Scan Ad Library'}
          </button>
        </div>

        {searchMutation.data && (
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm">
            <CheckCircle className="h-4 w-4 inline mr-2 text-green-400" />
            Found {searchMutation.data.data?.totalFound || 0} ads, stored {searchMutation.data.data?.totalStored || 0} new.
            Scored {searchMutation.data.data?.scoring?.scored || 0} ads (avg: {searchMutation.data.data?.scoring?.avgScore || 0}).
          </div>
        )}
      </div>

      {/* Competitor Pages */}
      {pagesData.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Discovered Competitors ({pagesData.length})
          </h3>
          <div className="space-y-2">
            {pagesData.map((page: any) => (
              <div key={page.page_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div>
                  <div className="text-sm font-medium">{page.page_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {page.total_ads} ads · {page.active_ads} active · {page.longest_running}d longest
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ScoreBadge score={Math.round(page.avg_score || 0)} />
                  <span className="text-xs text-muted-foreground">{page.all_platforms}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Analyze Tab ──────────────────────────────────────────────────

function AnalyzeTab() {
  const queryClient = useQueryClient()
  const [sortBy, setSortBy] = useState('winner_score')
  const [minScore, setMinScore] = useState(0)

  const { data: adsResponse, isLoading } = useQuery({
    queryKey: ['ad-intel-ads', sortBy, minScore],
    queryFn: () => apiFetch(`/ads?sortBy=${sortBy}&minScore=${minScore}&limit=50`),
  })

  const { data: scoreSummary } = useQuery({
    queryKey: ['ad-intel-score-summary'],
    queryFn: () => apiFetch('/score/summary'),
  })

  const analyzeMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/analyze/${id}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ad-intel-ads'] })
    },
  })

  const batchAnalyzeMutation = useMutation({
    mutationFn: () =>
      apiFetch('/analyze/batch', { method: 'POST', body: JSON.stringify({ limit: 10 }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ad-intel-ads'] })
    },
  })

  const ads = adsResponse?.data?.ads || []
  const summary = scoreSummary?.data

  return (
    <div className="space-y-6">
      {/* Score Distribution */}
      {summary && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-sm font-semibold mb-4">Score Distribution</h3>
          <div className="flex items-end gap-2 h-24">
            {(summary.scoreDistribution || []).map((d: any) => {
              const maxCount = Math.max(...(summary.scoreDistribution || []).map((x: any) => x.count), 1)
              const height = (d.count / maxCount) * 100
              return (
                <div key={d.range} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-muted-foreground">{d.count}</div>
                  <div
                    className="w-full bg-primary/60 rounded-t"
                    style={{ height: `${Math.max(height, 4)}%` }}
                  />
                  <div className="text-[10px] text-muted-foreground">{d.range}</div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {summary.scoredAds} scored · Avg: {summary.avgScore}/100
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-card border border-border rounded px-2 py-1 text-sm"
          >
            <option value="winner_score">Score</option>
            <option value="days_active">Days Active</option>
            <option value="created_at">Newest</option>
            <option value="page_name">Competitor</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={minScore}
            onChange={e => setMinScore(parseInt(e.target.value))}
            className="bg-card border border-border rounded px-2 py-1 text-sm"
          >
            <option value={0}>All scores</option>
            <option value={30}>30+</option>
            <option value={50}>50+</option>
            <option value={70}>70+</option>
          </select>
        </div>
        <button
          onClick={() => batchAnalyzeMutation.mutate()}
          disabled={batchAnalyzeMutation.isPending}
          className="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50"
        >
          {batchAnalyzeMutation.isPending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Brain className="h-4 w-4" />
          )}
          Analyze Top 10
        </button>
      </div>

      {/* Ads List */}
      {isLoading ? (
        <div className="text-muted-foreground text-sm text-center py-8">Loading ads...</div>
      ) : ads.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No competitor ads found. Run a discovery scan first.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ads.map((ad: any) => (
            <div key={ad.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{ad.page_name}</span>
                    <ScoreBadge score={ad.winner_score} />
                    {!ad.delivery_stop && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded">ACTIVE</span>
                    )}
                  </div>
                  {ad.creative_link_title && (
                    <div className="text-sm text-foreground mb-1">{ad.creative_link_title}</div>
                  )}
                  {ad.creative_body && (
                    <div className="text-xs text-muted-foreground line-clamp-2">{ad.creative_body}</div>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {ad.days_active}d
                    </span>
                    {ad.platforms && (
                      <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {ad.platforms}
                      </span>
                    )}
                    {ad.search_term && (
                      <span className="text-primary/60">#{ad.search_term}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {ad.analysis_json ? (
                    <span className="text-[10px] px-2 py-1 bg-blue-500/10 text-blue-400 rounded">Analyzed</span>
                  ) : (
                    <button
                      onClick={() => analyzeMutation.mutate(ad.id)}
                      disabled={analyzeMutation.isPending}
                      className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded flex items-center gap-1"
                    >
                      <Brain className="h-3 w-3" />
                      Analyze
                    </button>
                  )}
                  {ad.snapshot_url && (
                    <a
                      href={ad.snapshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      View
                    </a>
                  )}
                </div>
              </div>

              {/* Analysis Results */}
              {ad.analysis_json && (() => {
                try {
                  const analysis = typeof ad.analysis_json === 'string'
                    ? JSON.parse(ad.analysis_json)
                    : ad.analysis_json
                  return (
                    <div className="mt-3 pt-3 border-t border-border">
                      {analysis.suggestedHook && (
                        <div className="text-xs mb-2">
                          <span className="text-muted-foreground">Suggested GPC Hook: </span>
                          <span className="text-primary font-medium">{analysis.suggestedHook}</span>
                        </div>
                      )}
                      {analysis.summary && (
                        <div className="text-xs text-muted-foreground">{analysis.summary}</div>
                      )}
                      {analysis.overallAssessment && (
                        <div className="text-xs text-muted-foreground">{analysis.overallAssessment}</div>
                      )}
                    </div>
                  )
                } catch { return null }
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Research Tab ─────────────────────────────────────────────────

function ResearchTab() {
  const queryClient = useQueryClient()

  const { data: briefResponse, isLoading: briefLoading } = useQuery({
    queryKey: ['ad-intel-brief'],
    queryFn: () => apiFetch('/research/brief'),
  })

  const { data: contextResponse } = useQuery({
    queryKey: ['ad-intel-research-context'],
    queryFn: () => apiFetch('/research/context'),
  })

  const briefMutation = useMutation({
    mutationFn: () => apiFetch('/research/brief', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ad-intel-brief'] })
    },
  })

  const variantsMutation = useMutation({
    mutationFn: () => apiFetch('/research/variants', { method: 'POST' }),
  })

  const pipelineMutation = useMutation({
    mutationFn: () => apiFetch('/research/pipeline', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ad-intel-brief'] })
    },
  })

  const brief = briefResponse?.data
  const context = contextResponse?.data
  const competitorCount = context?.competitorAds?.length || 0

  return (
    <div className="space-y-6">
      {/* Research Context */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Brain className="h-4 w-4" />
          Research Context
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Competitor Ads (Score 60+)</div>
            <div className="text-xl font-bold">{competitorCount}</div>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Brand</div>
            <div className="text-xl font-bold">{context?.brandContext?.name || 'GPC'}</div>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Fund</div>
            <div className="text-sm font-medium mt-1">{context?.brandContext?.fund || '$100M BTR'}</div>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Returns</div>
            <div className="text-sm font-medium mt-1">8% pref / 19.2% IRR</div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => briefMutation.mutate()}
            disabled={briefMutation.isPending || pipelineMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50"
          >
            {briefMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Brain className="h-4 w-4" />
            )}
            Generate Strategic Brief
          </button>
          <button
            onClick={() => pipelineMutation.mutate()}
            disabled={pipelineMutation.isPending || briefMutation.isPending}
            className="px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-muted/80 disabled:opacity-50"
          >
            {pipelineMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            Full Pipeline (Brief + Copy)
          </button>
        </div>
      </div>

      {/* Strategic Brief */}
      {briefLoading ? (
        <div className="text-muted-foreground text-sm text-center py-8">Loading brief...</div>
      ) : brief ? (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Strategic Brief</h3>
            <span className="text-xs text-muted-foreground">
              {brief.createdAt ? new Date(brief.createdAt).toLocaleString() : ''}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: 'Messaging Angles', items: brief.messagingAngles, color: 'text-blue-400' },
              { label: 'Audience Insights', items: brief.audienceInsights, color: 'text-green-400' },
              { label: 'Competitive Gaps', items: brief.competitiveGaps, color: 'text-yellow-400' },
              { label: 'Recommended Hooks', items: brief.recommendedHooks, color: 'text-purple-400' },
              { label: 'CTA Strategies', items: brief.ctaStrategies, color: 'text-orange-400' },
              { label: 'Visual Direction', items: brief.visualDirection, color: 'text-cyan-400' },
            ].map(section => (
              <div key={section.label} className="p-3 bg-muted/30 rounded-lg">
                <div className={`text-xs font-medium mb-2 ${section.color}`}>{section.label}</div>
                <ul className="space-y-1">
                  {(section.items || []).map((item: string, i: number) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-2">
                      <span className="text-muted-foreground/50">-</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground bg-card border border-border rounded-lg">
          <Brain className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No strategic brief yet. Generate one from competitor analysis + GPC context.</p>
        </div>
      )}

      {/* Ad Copy Variants from Research */}
      {(variantsMutation.data || pipelineMutation.data) && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-sm font-semibold mb-4">Generated Ad Copy Variants (5 Angles)</h3>
          <div className="space-y-3">
            {((variantsMutation.data?.data || pipelineMutation.data?.data?.variants) || []).map((v: any, i: number) => (
              <div key={i} className="p-4 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded font-medium uppercase">
                    {v.angle}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 bg-muted rounded text-muted-foreground">
                    {v.ctaType}
                  </span>
                </div>
                <div className="text-sm font-semibold mb-1">{v.headline}</div>
                <div className="text-xs text-foreground mb-1">{v.primaryText}</div>
                <div className="text-xs text-muted-foreground">{v.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate Variants Button (if brief exists but no variants shown) */}
      {brief && !variantsMutation.data && !pipelineMutation.data && (
        <div className="flex justify-center">
          <button
            onClick={() => variantsMutation.mutate()}
            disabled={variantsMutation.isPending}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50"
          >
            {variantsMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            Generate 5-Angle Ad Copy
          </button>
        </div>
      )}
    </div>
  )
}

// ── Create Tab ───────────────────────────────────────────────────

function CreateTab() {
  const queryClient = useQueryClient()
  const [style, setStyle] = useState('professional')
  const [format, setFormat] = useState('feed_square')
  const [customContext, setCustomContext] = useState('')

  const { data: creativesResponse } = useQuery({
    queryKey: ['ad-intel-creatives'],
    queryFn: () => apiFetch('/creatives'),
  })

  const { data: imagesResponse } = useQuery({
    queryKey: ['ad-intel-images'],
    queryFn: () => apiFetch('/create/images'),
  })

  const copyMutation = useMutation({
    mutationFn: () =>
      apiFetch('/create/copy', {
        method: 'POST',
        body: JSON.stringify({ style, format, customContext: customContext || undefined }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ad-intel-creatives'] })
    },
  })

  const imageMutation = useMutation({
    mutationFn: (params: { headline: string; body: string; cta: string }) =>
      apiFetch('/create/image', {
        method: 'POST',
        body: JSON.stringify({ ...params, style, format }),
      }),
  })

  const creatives = creativesResponse?.data || []
  const images = imagesResponse?.data || []

  return (
    <div className="space-y-6">
      {/* Generation Controls */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Paintbrush className="h-4 w-4" />
          Generate Ad Creative
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Style</label>
            <select
              value={style}
              onChange={e => setStyle(e.target.value)}
              className="w-full bg-card border border-border rounded px-3 py-2 text-sm"
            >
              <option value="professional">Professional</option>
              <option value="luxury">Luxury</option>
              <option value="modern">Modern</option>
              <option value="editorial">Editorial</option>
              <option value="data-driven">Data-Driven</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Format</label>
            <select
              value={format}
              onChange={e => setFormat(e.target.value)}
              className="w-full bg-card border border-border rounded px-3 py-2 text-sm"
            >
              <option value="feed_square">Feed Square (1080x1080)</option>
              <option value="feed_landscape">Feed Landscape (1200x628)</option>
              <option value="story_vertical">Story Vertical (1080x1920)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Custom Context</label>
            <input
              type="text"
              value={customContext}
              onChange={e => setCustomContext(e.target.value)}
              placeholder="e.g., Focus on tax benefits..."
              className="w-full bg-card border border-border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => copyMutation.mutate()}
            disabled={copyMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50"
          >
            {copyMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            Generate Ad Copy
          </button>
        </div>

        {/* Generated Copy Variants */}
        {copyMutation.data && (
          <div className="mt-4 space-y-3">
            {(copyMutation.data.data || []).map((variant: any, i: number) => (
              <div key={i} className="p-4 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="text-sm font-semibold mb-1">{variant.headline}</div>
                    <div className="text-xs text-foreground mb-1">{variant.body}</div>
                    {variant.description && (
                      <div className="text-xs text-muted-foreground">{variant.description}</div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded">
                        {variant.cta}
                      </span>
                      {variant.hook_type && (
                        <span className="text-[10px] px-2 py-0.5 bg-muted rounded text-muted-foreground">
                          {variant.hook_type}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => imageMutation.mutate({
                      headline: variant.headline,
                      body: variant.body,
                      cta: variant.cta,
                    })}
                    disabled={imageMutation.isPending}
                    className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded flex items-center gap-1 shrink-0"
                  >
                    <Paintbrush className="h-3 w-3" />
                    Generate Image
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved Creatives */}
      {creatives.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-sm font-semibold mb-4">Saved Creatives ({creatives.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {creatives.map((c: any) => (
              <div key={c.id} className="p-3 bg-muted/30 rounded-lg">
                <div className="text-sm font-medium">{c.headline || c.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{c.body}</div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded ${
                    c.status === 'launched' ? 'bg-green-500/10 text-green-400' :
                    c.status === 'approved' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {c.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{c.style} · {c.format}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generated Images */}
      {images.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-sm font-semibold mb-4">Generated Images ({images.length})</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {images.map((img: any) => (
              <div key={img.fileName} className="bg-muted/30 rounded-lg p-2 text-center">
                <div className="text-xs font-medium truncate">{img.fileName}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {(img.size / 1024).toFixed(0)} KB
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Launch Tab ───────────────────────────────────────────────────

function LaunchTab() {
  const queryClient = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const { data: creativesResponse } = useQuery({
    queryKey: ['ad-intel-creatives-approved'],
    queryFn: () => apiFetch('/creatives?status=approved'),
  })

  const { data: launchStatusResponse } = useQuery({
    queryKey: ['ad-intel-launch-status'],
    queryFn: () => apiFetch('/launch/status'),
  })

  const launchMutation = useMutation({
    mutationFn: (creativeIds: number[]) =>
      apiFetch('/launch', {
        method: 'POST',
        body: JSON.stringify({ creativeIds }),
      }),
    onSuccess: () => {
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ['ad-intel-launch-status'] })
      queryClient.invalidateQueries({ queryKey: ['ad-intel-creatives-approved'] })
    },
  })

  const monitorMutation = useMutation({
    mutationFn: () => apiFetch('/launch/monitor', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ad-intel-launch-status'] })
    },
  })

  const scaleMutation = useMutation({
    mutationFn: () => apiFetch('/launch/scale', { method: 'POST', body: JSON.stringify({}) }),
  })

  const pauseMutation = useMutation({
    mutationFn: () => apiFetch('/launch/pause', { method: 'POST', body: JSON.stringify({}) }),
  })

  const creatives = creativesResponse?.data || []
  const launchedAds = launchStatusResponse?.data || []
  const monitorReport = monitorMutation.data?.data

  const toggleSelect = (id: number) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-6">
      {/* Campaign Config */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          Campaign Launcher
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">Daily Budget</div>
            <div className="text-lg font-bold">$50/day</div>
          </div>
          <div className="p-4 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">Max Scale</div>
            <div className="text-lg font-bold">$100/day</div>
          </div>
          <div className="p-4 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">Targeting</div>
            <div className="text-lg font-bold">US, 25-65</div>
          </div>
          <div className="p-4 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">Objective</div>
            <div className="text-lg font-bold">Awareness</div>
          </div>
        </div>

        {/* Approved Creatives to Launch */}
        {creatives.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No approved creatives ready to launch.</p>
            <p className="text-xs mt-1">Create and approve ad creatives in the Create tab first.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-muted-foreground uppercase">
              Select Creatives to Launch ({selectedIds.length} selected)
            </h4>
            {creatives.map((c: any) => (
              <div
                key={c.id}
                onClick={() => toggleSelect(c.id)}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedIds.includes(c.id)
                    ? 'bg-primary/10 border border-primary/30'
                    : 'bg-muted/30 border border-transparent hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(c.id)}
                    onChange={() => toggleSelect(c.id)}
                    className="rounded border-border"
                  />
                  <div>
                    <div className="text-sm font-medium">{c.headline || c.title}</div>
                    <div className="text-xs text-muted-foreground">{c.body}</div>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() => launchMutation.mutate(selectedIds)}
              disabled={selectedIds.length === 0 || launchMutation.isPending}
              className="w-full px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {launchMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Launch Campaign ({selectedIds.length} ads)
            </button>
          </div>
        )}

        {/* Launch Result */}
        {launchMutation.data && (
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm">
            <CheckCircle className="h-4 w-4 inline mr-2 text-green-400" />
            Campaign created! {launchMutation.data.data?.ads?.length || 0} ads launched,{' '}
            {launchMutation.data.data?.errors?.length || 0} errors.
            Campaign ID: {launchMutation.data.data?.campaignId}
          </div>
        )}
      </div>

      {/* Performance Monitoring */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Performance Monitor
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => monitorMutation.mutate()}
              disabled={monitorMutation.isPending}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded flex items-center gap-1 hover:bg-primary/90 disabled:opacity-50"
            >
              {monitorMutation.isPending ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Refresh
            </button>
            <button
              onClick={() => scaleMutation.mutate()}
              disabled={scaleMutation.isPending}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded flex items-center gap-1 hover:bg-green-700 disabled:opacity-50"
            >
              <TrendingUp className="h-3 w-3" />
              Scale Winners
            </button>
            <button
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded flex items-center gap-1 hover:bg-red-700 disabled:opacity-50"
            >
              Pause Losers
            </button>
          </div>
        </div>

        {/* Performance Summary */}
        {monitorReport && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="p-3 bg-muted/30 rounded-lg text-center">
              <div className="text-xs text-muted-foreground">Active</div>
              <div className="text-xl font-bold">{monitorReport.activeAds}</div>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg text-center">
              <div className="text-xs text-muted-foreground">Total Spend</div>
              <div className="text-xl font-bold">${monitorReport.totalSpend?.toFixed(2)}</div>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg text-center">
              <div className="text-xs text-muted-foreground">Avg CTR</div>
              <div className="text-xl font-bold">{monitorReport.avgCtr?.toFixed(2)}%</div>
            </div>
            <div className="p-3 bg-green-500/10 rounded-lg text-center">
              <div className="text-xs text-green-400">Winners</div>
              <div className="text-xl font-bold text-green-400">{monitorReport.winners?.length || 0}</div>
            </div>
            <div className="p-3 bg-red-500/10 rounded-lg text-center">
              <div className="text-xs text-red-400">Underperformers</div>
              <div className="text-xl font-bold text-red-400">{monitorReport.underperformers?.length || 0}</div>
            </div>
          </div>
        )}

        {/* Launched Ads List */}
        {launchedAds.length > 0 ? (
          <div className="space-y-2">
            {launchedAds.map((ad: any) => (
              <div key={ad.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex-1">
                  <div className="text-sm font-medium">{ad.headline || ad.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Ad ID: {ad.metaAdId} · Campaign: {ad.metaCampaignId}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {ad.performance && (
                    <div className="text-right">
                      <div className="text-xs font-medium">
                        CTR: {ad.performance.ctr?.toFixed(2)}%
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        ${ad.performance.spend?.toFixed(2)} · {ad.performance.impressions} imp
                      </div>
                    </div>
                  )}
                  <span className={`text-[10px] px-2 py-0.5 rounded ${
                    ad.status === 'launched' ? 'bg-green-500/10 text-green-400' :
                    ad.status === 'approved' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {ad.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground text-sm">
            No launched ads yet. Select and launch approved creatives above.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────

export default function AdIntelligencePage() {
  const [activeTab, setActiveTab] = useState<TabId>('discover')

  const tabComponents: Record<TabId, ReactNode> = {
    discover: <DiscoverTab />,
    analyze: <AnalyzeTab />,
    research: <ResearchTab />,
    create: <CreateTab />,
    launch: <LaunchTab />,
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Ad Intelligence</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Discover, analyze, and outperform competitor ads for Granite Park Capital
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 mb-6 bg-muted/30 p-1 rounded-lg w-fit">
        {TABS.map((tab, i) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {i < TABS.length - 1 && !isActive && (
                <ChevronRight className="h-3 w-3 text-muted-foreground/30 ml-1" />
              )}
            </button>
          )
        })}
      </div>

      {/* Active Tab Content */}
      {tabComponents[activeTab]}
    </div>
  )
}
