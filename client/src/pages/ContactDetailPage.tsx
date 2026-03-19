import { useParams, Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { format } from "date-fns"
import {
  Mail,
  Phone,
  RefreshCw,
  Zap,
  ArrowUpRight,
  ArrowLeft,
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
import { StatusBadge, ScoreBadge } from "@/components/shared/StatusBadge"
import { ContactInfoCard } from "@/components/shared/ContactInfoCard"
import { ScoreCard } from "@/components/shared/ScoreCard"
import { ActivityTimeline } from "@/components/shared/ActivityTimeline"
import { EmailThreadView } from "@/components/shared/EmailThreadView"
import { EmailInspector } from "@/components/shared/EmailInspector"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import * as React from "react"

export default function ContactDetailPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const leadId = Number(id)

  const [activityFilter, setActivityFilter] = React.useState("all")
  const [selectedMessage, setSelectedMessage] = React.useState<any>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ["enrichment-lead-full", leadId],
    queryFn: () => api.getEnrichmentLeadFull(leadId),
    enabled: !isNaN(leadId),
  })

  const enrichMutation = useMutation({
    mutationFn: () => api.triggerEnrich(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-lead-full", leadId] })
      toast.success("Enrichment triggered")
    },
    onError: () => toast.error("Failed to trigger enrichment"),
  })

  const scoreMutation = useMutation({
    mutationFn: () => api.triggerScore(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-lead-full", leadId] })
      toast.success("Scoring triggered")
    },
    onError: () => toast.error("Failed to trigger scoring"),
  })

  const pushGhlMutation = useMutation({
    mutationFn: () => api.triggerPushGhl(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-lead-full", leadId] })
      toast.success("Pushed to GHL")
    },
    onError: () => toast.error("Failed to push to GHL"),
  })

  if (isLoading) return <ContactDetailSkeleton />

  if (error || !data?.lead) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" render={<Link to="/contacts" />}>
          <ArrowLeft className="size-4" />
          Back to Contacts
        </Button>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {error ? "Failed to load contact." : "Contact not found."}
          </p>
        </div>
      </div>
    )
  }

  const { lead, enrichment, events = [], threads = [], campaign, coldEmailVariables } = data
  const person = enrichment?.pdl_person
  const company = enrichment?.pdl_company
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || "Unknown"
  const initials = [lead.first_name?.[0], lead.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "?"

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/" />}>Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/contacts" />}>Contacts</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{fullName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Contact Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-lg font-semibold">
            {initials}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{fullName}</h1>
            <p className="text-sm text-muted-foreground">
              {[person?.job_title, person?.job_company_name ?? company?.name]
                .filter(Boolean)
                .join(" at ") || lead.email}
            </p>
          </div>
          <div className="flex items-center gap-2 ml-2">
            {lead.status && <StatusBadge type="status" value={lead.status} />}
            {lead.score != null && <ScoreBadge score={lead.score} label={lead.score_label} />}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lead.email && (
            <Button variant="outline" size="sm" render={<a href={`mailto:${lead.email}`} />}>
              <Mail className="size-3.5" />
              Email
            </Button>
          )}
          {lead.phone && (
            <Button variant="outline" size="sm" render={<a href={`tel:${lead.phone}`} />}>
              <Phone className="size-3.5" />
              Call
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
          >
            <RefreshCw className={cn("size-3.5", enrichMutation.isPending && "animate-spin")} />
            Re-Enrich
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => scoreMutation.mutate()}
            disabled={scoreMutation.isPending}
          >
            <Zap className="size-3.5" />
            Score
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => pushGhlMutation.mutate()}
            disabled={pushGhlMutation.isPending}
          >
            <ArrowUpRight className="size-3.5" />
            Push GHL
          </Button>
        </div>
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column (60%) */}
        <div className="lg:col-span-3 space-y-6">
          <ContactInfoCard
            lead={lead}
            enrichment={enrichment}
            tags={lead.score_tags ? (typeof lead.score_tags === "string" ? JSON.parse(lead.score_tags) : lead.score_tags) : undefined}
          />

          {threads.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Email Conversations
              </h3>
              <EmailThreadView threads={threads} onMessageClick={setSelectedMessage} />
            </div>
          )}

          {campaign && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Campaign Association
              </h3>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {campaign.name ?? "Unknown Campaign"}
                  </span>
                  {campaign.status && (
                    <StatusBadge type="status" value={campaign.status} />
                  )}
                </div>
                {lead.instantly_campaign_id && (
                  <p className="text-xs text-muted-foreground">
                    Campaign ID: {lead.instantly_campaign_id}
                  </p>
                )}
                {lead.instantly_push_status && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Push Status:</span>
                    <StatusBadge type="push" value={lead.instantly_push_status} />
                  </div>
                )}
                {lead.instantly_pushed_at && (
                  <p className="text-xs text-muted-foreground">
                    Pushed: {format(new Date(lead.instantly_pushed_at), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                )}
              </div>
            </div>
          )}

          {coldEmailVariables && Object.keys(coldEmailVariables).length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cold Email Variables
              </h3>
              <div className="space-y-1">
                {Object.entries(coldEmailVariables).map(([key, val]) => (
                  <div key={key} className="flex items-start gap-2 py-0.5">
                    <span className="text-xs text-muted-foreground min-w-[100px] shrink-0">{key}:</span>
                    <span className="text-sm text-foreground">{String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column (40%) */}
        <div className="lg:col-span-2 space-y-6">
          <ActivityTimeline
            events={events}
            filter={activityFilter}
            onFilterChange={setActivityFilter}
            maxItems={20}
          />

          <ScoreCard
            score={lead.score}
            label={lead.score_label}
            reasoning={lead.score_reasoning}
            tags={lead.score_tags ? (typeof lead.score_tags === "string" ? JSON.parse(lead.score_tags) : lead.score_tags) : undefined}
          />

          {(lead.instantly_push_status || lead.ghl_contact_id) && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Integration Status
              </h3>
              {lead.instantly_push_status && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Cold Email</span>
                  <StatusBadge type="push" value={lead.instantly_push_status} />
                </div>
              )}
              {lead.ghl_contact_id && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">GHL Contact</span>
                  <span className="text-xs font-mono text-foreground">{lead.ghl_contact_id}</span>
                </div>
              )}
              {lead.hunter_status && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Email Verification</span>
                  <span className={cn(
                    "text-xs font-medium",
                    lead.hunter_status === "valid" ? "text-green-400" :
                    lead.hunter_status === "invalid" ? "text-red-400" :
                    "text-yellow-400"
                  )}>
                    {lead.hunter_status}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Email Inspector Sheet */}
      <EmailInspector
        open={!!selectedMessage}
        onClose={() => setSelectedMessage(null)}
        message={selectedMessage}
        events={events}
        campaignName={campaign?.name}
      />
    </div>
  )
}

function ContactDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-48" />
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}
