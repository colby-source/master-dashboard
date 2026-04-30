import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Search, Flame, TrendingDown, MapPin, Clock, ExternalLink,
  AlertTriangle, CheckCircle, XCircle, DollarSign, Zap,
} from 'lucide-react'

// ── API ─────────────────────────────────────────────────────────

const BASE = '/api/equipment-finder'

interface Listing {
  id: string
  source: string
  sourceUrl: string
  title: string
  description: string
  category: string
  make?: string
  model?: string
  year?: number
  hours?: number
  price?: number
  currentBid?: number
  isAuction: boolean
  auctionEndTime?: string
  condition: string
  location?: { city?: string; state?: string }
  seller?: { name?: string; isDealer: boolean }
  imageUrls: string[]
  imageCount: number
  daysOnMarket?: number
}

interface DealScore {
  listingId: string
  score: number
  tier: 'steal' | 'great_deal' | 'good_deal' | 'fair' | 'overpriced' | 'avoid'
  signals: Array<{ signal: string; points: number; explanation: string }>
  summary: string
  suggestedAction: string
  negotiationNotes: string
  priceVsMarketPct?: number
  marketAvgPrice?: number
}

interface SearchResult {
  query: { rawQuery: string; equipmentType?: string; priceMax?: number; radiusMiles?: number; expandedTerms: string[] }
  marketSummary: string
  totalFound: number
  sourcesSearched: string[]
  durationMs: number
  results: Array<{ listing: Listing; dealScore: DealScore }>
}

async function postSearch(query: string): Promise<SearchResult> {
  const res = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topN: 10, minScore: 0 }),
  })
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || `API error: ${res.status}`)
  return json.data
}

// ── Components ──────────────────────────────────────────────────

const TIER_CONFIG: Record<DealScore['tier'], { label: string; color: string; icon: typeof Flame }> = {
  steal: { label: 'STEAL', color: 'bg-red-500 text-white', icon: Flame },
  great_deal: { label: 'GREAT DEAL', color: 'bg-orange-500 text-white', icon: TrendingDown },
  good_deal: { label: 'GOOD DEAL', color: 'bg-green-500 text-white', icon: CheckCircle },
  fair: { label: 'FAIR', color: 'bg-slate-500 text-white', icon: DollarSign },
  overpriced: { label: 'OVERPRICED', color: 'bg-amber-600 text-white', icon: AlertTriangle },
  avoid: { label: 'AVOID', color: 'bg-red-700 text-white', icon: XCircle },
}

function TierBadge({ tier, score }: { tier: DealScore['tier']; score: number }) {
  const cfg = TIER_CONFIG[tier]
  const Icon = cfg.icon
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold ${cfg.color}`}>
      <Icon className="w-3.5 h-3.5" />
      {cfg.label} · {score.toFixed(0)}/100
    </div>
  )
}

function formatPrice(l: Listing): string {
  const p = l.price ?? l.currentBid
  return p ? `$${Math.round(p).toLocaleString()}` : 'No price'
}

function ListingCard({ listing, dealScore }: { listing: Listing; dealScore: DealScore }) {
  const [expanded, setExpanded] = useState(false)
  const primaryImg = listing.imageUrls[0]
  const location = [listing.location?.city, listing.location?.state].filter(Boolean).join(', ') || 'Unknown'

  return (
    <div className="border rounded-lg overflow-hidden bg-white dark:bg-slate-900 hover:shadow-lg transition-shadow">
      <div className="flex">
        {primaryImg && (
          <img src={primaryImg} alt="" className="w-48 h-36 object-cover flex-shrink-0" />
        )}
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <TierBadge tier={dealScore.tier} score={dealScore.score} />
                {listing.isAuction && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 text-xs">
                    <Zap className="w-3 h-3" /> Auction
                  </span>
                )}
              </div>
              <h3 className="font-semibold text-base leading-tight">{listing.title}</h3>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xl font-bold">{formatPrice(listing)}</div>
              {dealScore.priceVsMarketPct !== undefined && dealScore.marketAvgPrice && (
                <div className={`text-xs ${dealScore.priceVsMarketPct < 0 ? 'text-green-600' : 'text-slate-500'}`}>
                  {dealScore.priceVsMarketPct < 0 ? '↓' : '↑'} {Math.abs(dealScore.priceVsMarketPct).toFixed(0)}% vs market
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400 mb-2">
            {listing.year && <span>{listing.year}</span>}
            {listing.hours !== undefined && <span>{listing.hours.toLocaleString()} hrs</span>}
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{location}</span>
            <span className="uppercase tracking-wide">{listing.source.replace('_', ' ')}</span>
            {listing.daysOnMarket !== undefined && (
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{listing.daysOnMarket}d</span>
            )}
          </div>

          <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">{dealScore.summary}</p>

          {expanded && (
            <div className="mt-3 space-y-2 text-sm border-t pt-3">
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">🎯 Action: </span>
                <span className="text-slate-700 dark:text-slate-300">{dealScore.suggestedAction}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">💬 Negotiation: </span>
                <span className="text-slate-700 dark:text-slate-300">{dealScore.negotiationNotes}</span>
              </div>
              {dealScore.signals.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {dealScore.signals.map((s, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      {s.signal.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-slate-600 dark:text-slate-400 hover:underline"
            >
              {expanded ? 'Less details' : 'More details'}
            </button>
            <a
              href={listing.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              View listing <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────

export default function EquipmentFinderPage() {
  const [query, setQuery] = useState('')
  const [lastQuery, setLastQuery] = useState<string | null>(null)

  const searchMutation = useMutation({
    mutationFn: postSearch,
    onSuccess: (_, q) => setLastQuery(q),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    searchMutation.mutate(query.trim())
  }

  const result = searchMutation.data
  const isLoading = searchMutation.isPending

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Equipment Finder</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Search across Craigslist, Facebook Marketplace, eBay, GovDeals and more. AI scores every deal 1–100 and surfaces hidden opportunities (misspellings, poor titles, motivated sellers).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. low hour excavator under $80k within 500 miles of Dallas"
              className="w-full pl-10 pr-4 py-2.5 border rounded-lg bg-white dark:bg-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-medium"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Try: <button type="button" onClick={() => setQuery('2018+ Bobcat skid steer under $40k')} className="underline hover:text-slate-700">2018+ Bobcat skid steer under $40k</button>
          {' · '}
          <button type="button" onClick={() => setQuery('John Deere backhoe low hours Texas')} className="underline hover:text-slate-700">John Deere backhoe low hours Texas</button>
        </div>
      </form>

      {searchMutation.error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 dark:bg-red-950/20 rounded text-sm text-red-700 dark:text-red-400">
          Search failed: {(searchMutation.error as Error).message}
        </div>
      )}

      {isLoading && (
        <div className="p-8 text-center text-slate-500">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2" />
          <div>Searching {result?.sourcesSearched?.length ?? 'all'} sources… This can take 30–90 seconds.</div>
        </div>
      )}

      {result && !isLoading && (
        <div>
          <div className="mb-4 p-3 rounded bg-slate-50 dark:bg-slate-900/50 border text-sm">
            <div className="font-medium">{result.marketSummary}</div>
            <div className="text-xs text-slate-500 mt-1">
              Query: <em>{lastQuery}</em>
              {result.query.equipmentType && <> · Parsed: {result.query.equipmentType}</>}
              {result.query.priceMax && <> · under ${result.query.priceMax.toLocaleString()}</>}
              {result.query.radiusMiles && <> · {result.query.radiusMiles} mi</>}
              {' · '}
              {result.totalFound} listings across {result.sourcesSearched.length} source(s)
              {' · '}
              {(result.durationMs / 1000).toFixed(1)}s
            </div>
            {result.query.expandedTerms?.length > 0 && (
              <div className="text-xs text-slate-500 mt-1">
                Expansions: {result.query.expandedTerms.slice(0, 6).join(', ')}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {result.results.length === 0 ? (
              <div className="p-8 text-center text-slate-500 border rounded-lg">
                No listings found. Try adjusting your query or increasing the price range.
              </div>
            ) : (
              result.results.map((r) => (
                <ListingCard key={r.listing.id} listing={r.listing} dealScore={r.dealScore} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
