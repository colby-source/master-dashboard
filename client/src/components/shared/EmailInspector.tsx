import * as React from "react"
import { format } from "date-fns"
import DOMPurify from "dompurify"
import {
  Mail,
  Reply,
  Bot,
  FileText,
  Code,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { DeliveryStatusStepper } from "./DeliveryStatusStepper"

interface Message {
  id: number
  direction: string
  from_email?: string
  to_email?: string
  subject?: string
  body_text?: string
  body_html?: string
  is_auto_reply?: number | boolean
  created_at: string
}

interface TimelineEvent {
  id: number
  event_type: string
  event_data?: any
  created_at: string
}

interface EmailInspectorProps {
  open: boolean
  onClose: () => void
  message: Message | null
  events: TimelineEvent[]
  campaignName?: string | null
}

const deliveryEventTypes = new Set([
  "email_sent",
  "email_opened",
  "email_delivered",
  "email_queued",
  "reply_received",
  "email_bounced",
])

function extractDeliveryTimestamps(events: TimelineEvent[], _messageDate: string) {
  // Filter to events close to this message (same day context)
  const relevant = events.filter((e) => deliveryEventTypes.has(e.event_type))

  let queuedAt: string | null = null
  let sentAt: string | null = null
  let deliveredAt: string | null = null
  let openedAt: string | null = null
  let repliedAt: string | null = null
  let openCount = 0

  for (const e of relevant) {
    switch (e.event_type) {
      case "email_queued":
        if (!queuedAt) queuedAt = e.created_at
        break
      case "email_sent":
        sentAt = e.created_at
        if (!queuedAt) queuedAt = e.created_at
        break
      case "email_delivered":
        deliveredAt = e.created_at
        break
      case "email_opened":
        if (!openedAt) openedAt = e.created_at
        openCount++
        break
      case "reply_received":
        if (!repliedAt) repliedAt = e.created_at
        break
    }
  }

  return { queuedAt, sentAt, deliveredAt, openedAt, openCount, repliedAt }
}

function EventTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; className: string }> = {
    email_sent: { label: "Sent", className: "bg-blue-500/15 text-blue-400" },
    email_opened: { label: "Opened", className: "bg-green-500/15 text-green-400" },
    email_delivered: { label: "Delivered", className: "bg-green-500/15 text-green-400" },
    email_queued: { label: "Queued", className: "bg-yellow-500/15 text-yellow-400" },
    email_bounced: { label: "Bounced", className: "bg-red-500/15 text-red-400" },
    reply_received: { label: "Reply", className: "bg-green-500/15 text-green-400" },
    auto_reply_sent: { label: "Auto-Reply", className: "bg-purple-500/15 text-purple-400" },
  }
  const c = config[type] ?? { label: type, className: "bg-muted text-muted-foreground" }
  return (
    <Badge variant="secondary" className={cn("text-[10px] border-0", c.className)}>
      {c.label}
    </Badge>
  )
}

export function EmailInspector({
  open,
  onClose,
  message,
  events,
  campaignName,
}: EmailInspectorProps) {
  const [showHtml, setShowHtml] = React.useState(false)

  if (!message) return null

  const isInbound = message.direction === "inbound"
  const isAuto = message.is_auto_reply === 1 || message.is_auto_reply === true
  const isOutbound = !isInbound

  // Extract delivery timestamps from events
  const delivery = isOutbound
    ? extractDeliveryTimestamps(events, message.created_at)
    : null

  // Filter email-related events for the log table
  const emailEvents = events
    .filter((e) => deliveryEventTypes.has(e.event_type) || e.event_type === "auto_reply_sent")
    .slice(0, 20)

  // Extract auto-reply metadata from events
  const autoReplyEvent = isAuto
    ? events.find((e) => e.event_type === "auto_reply_sent")
    : null
  const autoReplyData = autoReplyEvent?.event_data

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="sm:max-w-xl overflow-y-auto"
      >
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle className="flex items-center gap-2">
            <div className={cn(
              "flex size-6 items-center justify-center rounded-full shrink-0",
              isInbound ? "bg-green-500/15 text-green-400" : "bg-blue-500/15 text-blue-400"
            )}>
              {isAuto ? <Bot className="size-3.5" /> : isInbound ? <Reply className="size-3.5" /> : <Mail className="size-3.5" />}
            </div>
            <span className="truncate text-sm">
              {message.subject ?? "No Subject"}
            </span>
          </SheetTitle>
          <SheetDescription>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-12 shrink-0">From:</span>
                <span className="text-foreground">{isInbound ? (message.from_email ?? "Contact") : (isAuto ? "Auto-Reply" : "You")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-12 shrink-0">To:</span>
                <span className="text-foreground">{isInbound ? (message.to_email ?? "You") : (message.to_email ?? "Contact")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-12 shrink-0">Date:</span>
                <span className="text-foreground">
                  {format(new Date(message.created_at), "MMMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
              {campaignName && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-12 shrink-0">Camp:</span>
                  <span className="text-foreground">{campaignName}</span>
                </div>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 p-4">
          {/* Delivery Status Stepper (outbound emails only) */}
          {delivery && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Delivery Status
              </h4>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <DeliveryStatusStepper
                  queuedAt={delivery.queuedAt}
                  sentAt={delivery.sentAt}
                  deliveredAt={delivery.deliveredAt}
                  openedAt={delivery.openedAt}
                  openCount={delivery.openCount}
                  repliedAt={delivery.repliedAt}
                />
              </div>
            </div>
          )}

          {/* Email Body */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Email Body
              </h4>
              {message.body_html && (
                <button
                  onClick={() => setShowHtml(!showHtml)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showHtml ? <FileText className="size-3" /> : <Code className="size-3" />}
                  {showHtml ? "Plain Text" : "View HTML"}
                </button>
              )}
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              {showHtml && message.body_html ? (
                <div
                  className="prose prose-invert prose-sm max-w-none text-sm text-foreground [&_a]:text-blue-400"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.body_html) }}
                />
              ) : (
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {message.body_text ?? "No content available."}
                </p>
              )}
            </div>
          </div>

          {/* Webhook Event Log */}
          {emailEvents.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Event Log
              </h4>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Time</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Event</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {emailEvents.map((e) => (
                      <tr key={e.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {format(new Date(e.created_at), "h:mm:ss a")}
                        </td>
                        <td className="px-3 py-2">
                          <EventTypeBadge type={e.event_type} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">
                          {formatEventDetail(e)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* AI Generation Details (auto-replies only) */}
          {isAuto && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                AI Generation Details
              </h4>
              <div className="rounded-lg border border-border bg-purple-500/5 p-4 space-y-2">
                {autoReplyData?.strategy && (
                  <div>
                    <span className="text-[10px] text-muted-foreground">Strategy</span>
                    <p className="text-sm text-foreground">{autoReplyData.strategy}</p>
                  </div>
                )}
                {autoReplyData?.model && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Model:</span>
                    <span className="text-xs text-foreground">{autoReplyData.model}</span>
                  </div>
                )}
                {autoReplyData?.reply_delay_seconds != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Reply Delay:</span>
                    <span className="text-xs text-foreground">
                      {formatReplyDelay(autoReplyData.reply_delay_seconds)}
                    </span>
                  </div>
                )}
                {!autoReplyData && (
                  <p className="text-xs text-muted-foreground italic">
                    Auto-reply generated — no additional metadata recorded.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function formatEventDetail(event: TimelineEvent): string {
  const data = event.event_data
  if (!data) return "—"

  if (event.event_type === "email_opened" && data.ip) {
    return `IP: ${data.ip}${data.location ? ` (${data.location})` : ""}`
  }
  if (event.event_type === "email_delivered" && data.mx_host) {
    return `MX: ${data.mx_host}`
  }
  if (event.event_type === "email_sent" && data.message_id) {
    return `ID: ${data.message_id.slice(0, 16)}...`
  }
  if (event.event_type === "email_bounced" && data.reason) {
    return data.reason
  }
  if (event.event_type === "reply_received" && data.subject) {
    return data.subject
  }
  if (event.event_type === "auto_reply_sent" && data.strategy) {
    return `Strategy: ${data.strategy}`
  }
  if (data.detail || data.message) {
    return data.detail ?? data.message
  }
  return "—"
}

function formatReplyDelay(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins < 60) return `${mins}m ${secs}s`
  const hrs = Math.floor(mins / 60)
  const remainMins = mins % 60
  return `${hrs}h ${remainMins}m`
}
