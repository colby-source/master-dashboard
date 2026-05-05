import { useMemo } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { request, qs } from "@/lib/api/client"
import { format } from "date-fns"
import {
  ArrowLeft,
  Mail,
  Eye,
  Reply,
  AlertTriangle,
  CheckCircle2,
  Send,
  CalendarCheck,
  Sparkles,
  Check,
  X,
  Play,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Skeleton } from "@/components/ui/skeleton"
import { cn, formatNumber, timeAgo } from "@/lib/utils"
import { toast } from "sonner"

// ── Types matching the new /api/pipeline/campaigns contract ─
interface StepMetric {
  step: number
  sent?: number
  opens?: number
  replies?: number
  open_rate?: number
  reply_rate?: number
  conversion?: number
}

interface CampaignRecord {
  id: number | string
  name: string
  company_id?: number
  company_name?: string
  company_color?: string
  status: string
  provider?: string
  leads_count?: number
  sent?: number
  delivered?: number
  opens?: number
  replies?: number
  bounces?: number
  booked?: number
  open_rate?: number
  reply_rate?: number
  bounce_rate?: number
  booked_rate?: number
  step_metrics?: StepMetric[]
  last_sent_at?: string
  created_at?: string
}

interface CampaignsResponse {
  campaigns: CampaignRecord[]
}

interface Recommendation {
  id: string | number
  campaign_id?: string | number
  status: string
  kind: string
  title: string
  rationale?: string
  impact_estimate?: string | number | null
  proposed_change?: Record<string, unknown> | string
  created_at?: string
}

interface RecommendationsResponse {
  recommendations: Recommendation[]
}

const COMPANY_ACCENTS: Record<string, string> = {
  gpc: "oklch(0.65 0.2 250)",
  bmn: "oklch(0.7 0.22 295)",
}

function companyAccent(name?: string): string {
  if (!name) return "oklch(0.7 0 0)"
  const k = name.toLowerCase()
  if (k.includes("granite") || k.includes("gpc")) return COMPANY_ACCENTS.gpc
  if (k.includes("bmn") || k.includes("brand")) return COMPANY_ACCENTS.bmn
  return "oklch(0.7 0 0)"
}

const statusConfig: Record<string, { dot: string; label: string }> = {
  active: { dot: "bg-green-500", label: "Active" },
  paused: { dot: "bg-zinc-500", label: "Paused" },
  draft: { dot: "bg-zinc-500", label: "Draft" },
  completed: { dot: "bg-blue-500", label: "Completed" },
  degraded: { dot: "bg-amber-500", label: "Degraded" },
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Pull the campaigns list + find the one we want.  This keeps the page
  // decoupled from any per-campaign endpoint shape that may differ between
  // backends.
  const campaignsQuery = useQuery<CampaignsResponse>({
    queryKey: ["pipeline", "campaigns", "all"],
    queryFn: () => request<CampaignsResponse>("/pipeline/campaigns"),
    retry: 0,
  })

  const campaign = useMemo(() => {
    const list = campaignsQuery.data?.campaigns ?? []
    return list.find((c) => String(c.id) === String(id))
  }, [campaignsQuery.data, id])

  // Recommendations for this campaign
  const recsQuery = useQuery<RecommendationsResponse>({
    queryKey: ["learning", "recommendations", "campaign", id],
    queryFn: () =>
      request<RecommendationsResponse>(
        `/learning/recommendations${qs({ campaign_id: id, status: "pending" })}`
      ),
    enabled: !!id,
    retry: 0,
  })

  const approveMutation = useMutation({
    mutationFn: (recId: string | number) =>
      request(`/learning/recommendations/${recId}/approve`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["learning", "recommendations", "campaign", id],
      })
      toast.success("Recommendation approved")
    },
    onError: () => toast.error("Failed to approve recommendation"),
  })

  const rejectMutation = useMutation({
    mutationFn: (recId: string | number) =>
      request(`/learning/recommendations/${recId}/reject`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["learning", "recommendations", "campaign", id],
      })
      toast.success("Recommendation rejected")
    },
    onError: () => toast.error("Failed to reject recommendation"),
  })

  const analyzeMutation = useMutation({
    mutationFn: () =>
      request("/learning/analyze", {
        method: "POST",
        body: JSON.stringify({ campaign_id: id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["learning", "recommendations", "campaign", id],
      })
      toast.success("Analysis kicked off — recommendations will appear shortly.")
    },
    onError: () => toast.error("Failed to start analysis"),
  })

  if (campaignsQuery.isLoading) {
    return <DetailSkeleton />
  }

  if (campaignsQuery.isError) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          <ArrowLeft className="size-4 mr-1" /> Back to Pipeline
        </Button>
        <div className="mt-8 rounded-lg border border-border bg-card p-10 text-center">
          <AlertTriangle className="mx-auto size-6 text-amber-500 mb-2" />
          <p className="text-sm text-muted-foreground">
            Endpoint <span className="font-mono">/api/pipeline/campaigns</span> not yet available.
          </p>
        </div>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          <ArrowLeft className="size-4 mr-1" /> Back to Pipeline
        </Button>
        <div className="mt-8 rounded-lg border border-border bg-card p-10 text-center">
          <Mail className="mx-auto size-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">Campaign not found.</p>
        </div>
      </div>
    )
  }

  const accent = companyAccent(campaign.company_name)
  const statusCfg = statusConfig[campaign.status] ?? {
    dot: "bg-zinc-500",
    label: campaign.status,
  }
  const recommendations = recsQuery.data?.recommendations ?? []
  const steps = campaign.step_metrics ?? []

  return (
    <div className="space-y-6 p-6">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/" />}>Pipeline</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/campaigns" />}>Campaigns</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{campaign.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight truncate">{campaign.name}</h1>
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className={cn("size-1.5 rounded-full", statusCfg.dot)} />
              {statusCfg.label}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            {campaign.company_name && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: accent }} />
                {campaign.company_name}
              </span>
            )}
            {campaign.provider && (
              <span className="capitalize">{campaign.provider}</span>
            )}
            {campaign.leads_count != null && (
              <span>{formatNumber(campaign.leads_count)} leads</span>
            )}
            {campaign.last_sent_at && (
              <span>Last sent {timeAgo(campaign.last_sent_at)}</span>
            )}
            {campaign.created_at && (
              <span>Created {format(new Date(campaign.created_at), "MMM d, yyyy")}</span>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending}
        >
          <Play className="size-3.5" />
          Run analysis now
        </Button>
      </div>

      {/* Top row stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Sent" value={formatNumber(campaign.sent ?? 0)} icon={Send} />
        <StatCard
          label="Delivered"
          value={formatNumber(campaign.delivered ?? 0)}
          icon={CheckCircle2}
        />
        <StatCard
          label="Opens"
          value={formatNumber(campaign.opens ?? 0)}
          sub={campaign.open_rate != null ? `${campaign.open_rate.toFixed(1)}%` : undefined}
          icon={Eye}
        />
        <StatCard
          label="Replies"
          value={formatNumber(campaign.replies ?? 0)}
          sub={campaign.reply_rate != null ? `${campaign.reply_rate.toFixed(1)}%` : undefined}
          icon={Reply}
        />
        <StatCard
          label="Bounces"
          value={formatNumber(campaign.bounces ?? 0)}
          sub={campaign.bounce_rate != null ? `${campaign.bounce_rate.toFixed(1)}%` : undefined}
          icon={AlertTriangle}
        />
        <StatCard
          label="Booked"
          value={formatNumber(campaign.booked ?? 0)}
          sub={campaign.booked_rate != null ? `${campaign.booked_rate.toFixed(1)}%` : undefined}
          icon={CalendarCheck}
        />
      </div>

      {/* Body: steps grid + recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <SectionHeader title="Step performance" hint={`${steps.length} step${steps.length !== 1 ? "s" : ""}`} />
          {steps.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-10 text-center">
              <p className="text-sm text-muted-foreground">No step-level metrics yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {steps.map((s) => (
                <StepCard key={s.step} step={s} />
              ))}
            </div>
          )}
        </div>

        {/* Right rail: recommendations */}
        <div className="space-y-4">
          <SectionHeader
            title="Recommendations"
            hint={`${recommendations.length} pending`}
          />
          {recsQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : recsQuery.isError ? (
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <p className="text-xs text-muted-foreground">
                Endpoint <span className="font-mono">/api/learning/recommendations</span> not yet available.
              </p>
            </div>
          ) : recommendations.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <Sparkles className="mx-auto size-5 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">
                No pending recommendations. Click <span className="font-medium">Run analysis now</span> to generate fresh suggestions.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.map((r) => (
                <MiniRecCard
                  key={r.id}
                  rec={r}
                  onApprove={() => approveMutation.mutate(r.id)}
                  onReject={() => rejectMutation.mutate(r.id)}
                  isPending={
                    (approveMutation.isPending && approveMutation.variables === r.id) ||
                    (rejectMutation.isPending && rejectMutation.variables === r.id)
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub components ─────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="lg:col-span-2 h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {sub && <span className="text-xs text-muted-foreground tabular-nums">{sub}</span>}
      </div>
    </div>
  )
}

function StepCard({ step }: { step: StepMetric }) {
  const sent = step.sent ?? 0
  const opens = step.opens ?? 0
  const replies = step.replies ?? 0
  const openRate = step.open_rate ?? (sent ? (opens / sent) * 100 : 0)
  const replyRate = step.reply_rate ?? (sent ? (replies / sent) * 100 : 0)
  const conv = step.conversion ?? replyRate

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Step {step.step}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {conv.toFixed(1)}% conv
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Mini label="Sent" value={formatNumber(sent)} />
        <Mini label="Opens" value={formatNumber(opens)} sub={`${openRate.toFixed(0)}%`} />
        <Mini label="Replies" value={formatNumber(replies)} sub={`${replyRate.toFixed(1)}%`} />
      </div>
      {/* Subtle conversion bar */}
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-foreground/40"
          style={{ width: `${Math.min(conv, 100)}%` }}
        />
      </div>
    </div>
  )
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  )
}

function MiniRecCard({
  rec,
  onApprove,
  onReject,
  isPending,
}: {
  rec: Recommendation
  onApprove: () => void
  onReject: () => void
  isPending: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3" />
          {rec.kind}
        </span>
        {rec.created_at && (
          <span className="text-[10px] text-muted-foreground">
            {timeAgo(rec.created_at)}
          </span>
        )}
      </div>
      <h3 className="text-sm font-medium leading-snug">{rec.title}</h3>
      {rec.rationale && (
        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
          {rec.rationale}
        </p>
      )}
      {rec.impact_estimate != null && (
        <div className="text-[11px]">
          <span className="text-muted-foreground">Estimated impact: </span>
          <span className="font-medium">{String(rec.impact_estimate)}</span>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onReject}
          disabled={isPending}
          className="gap-1 flex-1"
        >
          <X className="size-3" />
          Reject
        </Button>
        <Button
          size="sm"
          onClick={onApprove}
          disabled={isPending}
          className="gap-1 flex-1"
        >
          <Check className="size-3" />
          Approve
        </Button>
      </div>
    </div>
  )
}
