import { useParams, Link, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { format } from "date-fns"
import {
  ArrowLeft,
  Mail,
  Users,
  Calendar,
  Pause,
  Play,
  Eye,
  Reply,
  AlertTriangle,
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
import { Badge } from "@/components/ui/badge"
import { SequenceStepper } from "@/components/shared/SequenceStepper"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const statusColors: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-400/20",
  paused: "bg-yellow-500/15 text-yellow-400 border-yellow-400/20",
  draft: "bg-gray-500/15 text-gray-400 border-gray-400/20",
  completed: "bg-blue-500/15 text-blue-400 border-blue-400/20",
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ["campaign-detail", id],
    queryFn: () => api.getCampaignDetail(Number(id)),
    enabled: !!id,
  })

  const pauseMutation = useMutation({
    mutationFn: () => api.pauseCampaign(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-detail", id] })
      queryClient.invalidateQueries({ queryKey: ["campaigns"] })
      toast.success("Campaign paused")
    },
    onError: () => toast.error("Failed to pause campaign"),
  })

  const activateMutation = useMutation({
    mutationFn: () => api.activateCampaign(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-detail", id] })
      queryClient.invalidateQueries({ queryKey: ["campaigns"] })
      toast.success("Campaign activated")
    },
    onError: () => toast.error("Failed to activate campaign"),
  })

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/campaigns")}>
          <ArrowLeft className="size-4 mr-1" /> Back to Campaigns
        </Button>
        <div className="mt-8 text-center">
          <Mail className="mx-auto size-12 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">Campaign not found.</p>
        </div>
      </div>
    )
  }

  const stats = data.stats ?? {}
  const leads = data.leads ?? []
  const steps = data.steps_analytics ?? []
  const detail = data.instantly_detail

  // Compute totals from steps if available
  const totalSent = steps.reduce((s: number, st: any) => s + (st.sent ?? 0), 0) || stats.sent || 0
  const totalOpened = steps.reduce((s: number, st: any) => s + (st.opened ?? 0), 0)
  const totalReplied = steps.reduce((s: number, st: any) => s + (st.replied ?? 0), 0)
  const totalBounced = steps.reduce((s: number, st: any) => s + (st.bounced ?? 0), 0)
  const overallOpenRate = stats.open_rate ?? (totalSent ? ((totalOpened / totalSent) * 100).toFixed(1) : "0")
  const overallReplyRate = stats.reply_rate ?? (totalSent ? ((totalReplied / totalSent) * 100).toFixed(1) : "0")
  const bounceRate = totalSent ? ((totalBounced / totalSent) * 100).toFixed(1) : "0"

  return (
    <div className="space-y-6 p-6">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/" />}>Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/campaigns" />}>Campaigns</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{data.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{data.name}</h1>
            <Badge
              variant="secondary"
              className={cn("text-xs", statusColors[data.status] ?? "bg-muted text-muted-foreground")}
            >
              {data.status}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {data.company_name && (
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: data.company_color }}
                />
                {data.company_name}
              </span>
            )}
            {data.created_at && (
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                Created {format(new Date(data.created_at), "MMM d, yyyy")}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              {data.lead_count} contacts
            </span>
            {steps.length > 0 && (
              <span className="flex items-center gap-1.5">
                <Mail className="size-3.5" />
                {steps.length} step{steps.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
            >
              <Pause className="size-4 mr-1" />
              Pause
            </Button>
          )}
          {data.status === "paused" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => activateMutation.mutate()}
              disabled={activateMutation.isPending}
            >
              <Play className="size-4 mr-1" />
              Activate
            </Button>
          )}
        </div>
      </div>

      {/* Content 2-column */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Sequence stepper */}
        <div className="lg:col-span-3 space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Sequence Steps
            </h3>
            <SequenceStepper steps={steps} />
          </div>

          {/* Contacts in this campaign */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Contacts in Campaign
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {leads.length} contact{leads.length !== 1 ? "s" : ""}
              </span>
            </div>
            {leads.length === 0 ? (
              <div className="p-6 text-center">
                <Users className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No contacts linked to this campaign yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border text-[11px]">
                      <th className="text-left py-2 px-4">Name</th>
                      <th className="text-left py-2 px-4">Email</th>
                      <th className="text-left py-2 px-4">Score</th>
                      <th className="text-left py-2 px-4">Status</th>
                      <th className="text-left py-2 px-4">Push Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead: any) => (
                      <tr
                        key={lead.id}
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => navigate(`/contacts/${lead.id}`)}
                      >
                        <td className="py-2 px-4 font-medium">
                          {lead.first_name} {lead.last_name}
                        </td>
                        <td className="py-2 px-4 text-muted-foreground">{lead.email}</td>
                        <td className="py-2 px-4">
                          {lead.score != null ? (
                            <span className={cn(
                              "text-xs font-medium",
                              lead.score >= 70 ? "text-green-400" :
                              lead.score >= 40 ? "text-yellow-400" :
                              "text-red-400"
                            )}>
                              {lead.score} {lead.score_label && `(${lead.score_label})`}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">--</span>
                          )}
                        </td>
                        <td className="py-2 px-4">
                          <Badge variant="secondary" className="text-[10px]">
                            {lead.status ?? "new"}
                          </Badge>
                        </td>
                        <td className="py-2 px-4">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px]",
                              lead.instantly_push_status === "pushed" && "bg-green-500/15 text-green-400",
                              lead.instantly_push_status === "excluded" && "bg-red-500/15 text-red-400"
                            )}
                          >
                            {lead.instantly_push_status ?? "pending"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right: Analytics */}
        <div className="lg:col-span-2 space-y-4">
          {/* Overall metrics */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Campaign Analytics
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                icon={Mail}
                label="Total Sent"
                value={totalSent.toLocaleString()}
                color="text-blue-400"
              />
              <MetricCard
                icon={Eye}
                label="Opened"
                value={totalOpened.toLocaleString()}
                sub={`${overallOpenRate}%`}
                color="text-green-400"
              />
              <MetricCard
                icon={Reply}
                label="Replies"
                value={totalReplied.toLocaleString()}
                sub={`${overallReplyRate}%`}
                color="text-cyan-400"
              />
              <MetricCard
                icon={AlertTriangle}
                label="Bounced"
                value={totalBounced.toLocaleString()}
                sub={`${bounceRate}%`}
                color="text-red-400"
              />
            </div>

            {/* Open/Reply rate bars */}
            <div className="space-y-2 pt-2 border-t border-border">
              <RateBar label="Open Rate" rate={Number(overallOpenRate)} color="bg-green-400" />
              <RateBar label="Reply Rate" rate={Number(overallReplyRate)} color="bg-cyan-400" />
              <RateBar label="Bounce Rate" rate={Number(bounceRate)} color="bg-red-400" />
            </div>
          </div>

          {/* Campaign info */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Campaign Details
            </h3>
            <div className="space-y-2 text-sm">
              <DetailRow label="Platform" value={data.platform ?? "Instantly"} />
              <DetailRow label="Daily Limit" value={data.daily_limit ? `${data.daily_limit} emails/day` : "--"} />
              <DetailRow label="Account Count" value={data.account_count ? `${data.account_count} accounts` : "--"} />
              <DetailRow label="External ID" value={data.external_id ?? "--"} mono />
              {data.last_synced && (
                <DetailRow
                  label="Last Synced"
                  value={format(new Date(data.last_synced), "MMM d, yyyy h:mm a")}
                />
              )}
              {data.updated_at && (
                <DetailRow
                  label="Updated"
                  value={format(new Date(data.updated_at), "MMM d, yyyy h:mm a")}
                />
              )}
            </div>
          </div>

          {/* Auto-reply stats placeholder */}
          {detail?.auto_reply_config && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Auto-Reply Config
              </h3>
              <p className="text-sm text-muted-foreground">
                Auto-reply is {detail.auto_reply_config.enabled ? "enabled" : "disabled"} for this campaign.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<any>
  label: string
  value: string
  sub?: string
  color: string
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-3 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className={cn("size-3.5", color)} />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-bold">{value}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  )
}

function RateBar({ label, rate, color }: { label: string; rate: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{rate.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min(rate, 100)}%` }}
        />
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", mono && "font-mono text-xs")}>{value}</span>
    </div>
  )
}
