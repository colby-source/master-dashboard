import * as React from "react"
import { format, isToday, isYesterday } from "date-fns"
import {
  Sparkles,
  Mail,
  MailOpen,
  Reply,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
  Bot,
  ArrowUpRight,
  Clock,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface TimelineEvent {
  id: number
  event_type: string
  event_data?: any
  created_at: string
  enrichment_lead_id?: number
}

interface ActivityTimelineProps {
  events: TimelineEvent[]
  filter?: string
  onFilterChange?: (filter: string) => void
  maxItems?: number
}

const eventConfig: Record<string, { icon: React.ComponentType<any>; color: string; label: string }> = {
  enrichment_complete: { icon: Sparkles, color: "text-cyan-400", label: "Enrichment Complete" },
  enrichment_failed: { icon: AlertTriangle, color: "text-red-400", label: "Enrichment Failed" },
  score_complete: { icon: Zap, color: "text-purple-400", label: "Scored" },
  email_sent: { icon: Mail, color: "text-blue-400", label: "Email Sent" },
  email_opened: { icon: MailOpen, color: "text-green-400", label: "Email Opened" },
  reply_received: { icon: Reply, color: "text-green-400", label: "Reply Received" },
  auto_reply_sent: { icon: Bot, color: "text-purple-400", label: "Auto-Reply Sent" },
  ghl_pushed: { icon: ArrowUpRight, color: "text-green-400", label: "Pushed to GHL" },
  cold_email_approved: { icon: CheckCircle2, color: "text-green-400", label: "Cold Email Approved" },
  cold_email_excluded: { icon: XCircle, color: "text-red-400", label: "Cold Email Excluded" },
  lead_created: { icon: UserPlus, color: "text-blue-400", label: "Lead Created" },
  status_change: { icon: Clock, color: "text-yellow-400", label: "Status Changed" },
}

const defaultEvent = { icon: Clock, color: "text-muted-foreground", label: "Event" }

const filterOptions = [
  { value: "all", label: "All" },
  { value: "emails", label: "Emails" },
  { value: "enrichment", label: "Enrichment" },
  { value: "scoring", label: "Scoring" },
  { value: "system", label: "System" },
]

const filterMatches: Record<string, string[]> = {
  all: [],
  emails: ["email_sent", "email_opened", "reply_received", "auto_reply_sent"],
  enrichment: ["enrichment_complete", "enrichment_failed"],
  scoring: ["score_complete"],
  system: ["ghl_pushed", "cold_email_approved", "cold_email_excluded", "lead_created", "status_change"],
}

function groupByDate(events: TimelineEvent[]): { label: string; events: TimelineEvent[] }[] {
  const groups: Map<string, TimelineEvent[]> = new Map()

  for (const event of events) {
    const date = new Date(event.created_at)
    let label: string
    if (isToday(date)) label = "Today"
    else if (isYesterday(date)) label = "Yesterday"
    else label = format(date, "MMMM d, yyyy")

    const existing = groups.get(label)
    if (existing) {
      existing.push(event)
    } else {
      groups.set(label, [event])
    }
  }

  return Array.from(groups.entries()).map(([label, events]) => ({ label, events }))
}

export function ActivityTimeline({ events, filter = "all", onFilterChange, maxItems }: ActivityTimelineProps) {
  const filtered = filter === "all"
    ? events
    : events.filter((e) => filterMatches[filter]?.includes(e.event_type))

  const displayed = maxItems ? filtered.slice(0, maxItems) : filtered
  const groups = groupByDate(displayed)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Activity
        </h3>
        {onFilterChange && (
          <div className="flex gap-1">
            {filterOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onFilterChange(opt.value)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
                  filter === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 sticky top-0 bg-card">
                {group.label}
              </p>
              <div className="relative space-y-0">
                <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />
                {group.events.map((event) => {
                  const config = eventConfig[event.event_type] ?? defaultEvent
                  const Icon = config.icon
                  const date = new Date(event.created_at)
                  return (
                    <div key={event.id} className="relative flex gap-3 py-1.5">
                      <div className={cn("relative z-10 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-card", config.color)}>
                        <Icon className="size-3" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-medium text-foreground truncate">
                            {config.label}
                          </p>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {format(date, "h:mm a")}
                          </span>
                        </div>
                        <EventDetail event={event} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {maxItems && filtered.length > maxItems && (
        <p className="text-center text-xs text-muted-foreground">
          Showing {maxItems} of {filtered.length} events
        </p>
      )}
    </div>
  )
}

function EventDetail({ event }: { event: TimelineEvent }) {
  const data = event.event_data
  if (!data) return null

  if (event.event_type === "score_complete" && data.score != null) {
    return (
      <p className="text-xs text-muted-foreground">
        Score: {data.score} ({data.score_label ?? "—"})
        {data.reasoning && ` — ${data.reasoning.slice(0, 80)}...`}
      </p>
    )
  }

  if (event.event_type === "enrichment_complete") {
    return (
      <p className="text-xs text-muted-foreground">
        {data.source ?? "PDL"} enrichment completed
        {data.fields_found ? ` (${data.fields_found} fields)` : ""}
      </p>
    )
  }

  if (event.event_type === "reply_received" && data.subject) {
    return (
      <p className="text-xs text-muted-foreground truncate">
        {data.subject}
      </p>
    )
  }

  if (event.event_type === "auto_reply_sent" && data.strategy) {
    return (
      <p className="text-xs text-muted-foreground truncate">
        Strategy: {data.strategy}
      </p>
    )
  }

  if (event.event_type === "cold_email_excluded" && data.reason) {
    return (
      <p className="text-xs text-muted-foreground truncate">
        Reason: {data.reason}
      </p>
    )
  }

  if (data.message || data.detail) {
    return (
      <p className="text-xs text-muted-foreground truncate">
        {data.message ?? data.detail}
      </p>
    )
  }

  return null
}
