import { format } from "date-fns"
import { Mail, Reply, Bot, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

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

interface Thread {
  id: number
  subject?: string
  status?: string
  last_message_at?: string
  messages: Message[]
}

interface EmailThreadViewProps {
  threads: Thread[]
  onMessageClick?: (message: Message) => void
}

export function EmailThreadView({ threads, onMessageClick }: EmailThreadViewProps) {
  if (!threads.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <Mail className="mx-auto size-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No email conversations yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {threads.map((thread) => (
        <div key={thread.id} className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium truncate">
                {thread.subject ?? "No Subject"}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {thread.status && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px]",
                    thread.status === "active" && "bg-green-500/15 text-green-400",
                    thread.status === "closed" && "bg-muted text-muted-foreground"
                  )}
                >
                  {thread.status}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground">
                {thread.messages.length} message{thread.messages.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <div className="divide-y divide-border">
            {thread.messages.map((msg) => {
              const isInbound = msg.direction === "inbound"
              const isAuto = msg.is_auto_reply === 1 || msg.is_auto_reply === true
              return (
                <div
                  key={msg.id}
                  className={cn(
                    "px-4 py-3 space-y-1.5",
                    onMessageClick && "cursor-pointer hover:bg-muted/30 transition-colors"
                  )}
                  onClick={() => onMessageClick?.(msg)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        "flex size-5 items-center justify-center rounded-full",
                        isInbound ? "bg-green-500/15 text-green-400" : "bg-blue-500/15 text-blue-400"
                      )}>
                        {isAuto ? <Bot className="size-3" /> : isInbound ? <Reply className="size-3" /> : <User className="size-3" />}
                      </div>
                      <span className="text-xs font-medium truncate">
                        {isInbound ? (msg.from_email ?? "Contact") : (isAuto ? "Auto-Reply" : "You")}
                      </span>
                      {isAuto && (
                        <Badge variant="secondary" className="text-[9px] bg-purple-500/15 text-purple-400 border-0">
                          AI
                        </Badge>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {format(new Date(msg.created_at), "MMM d, h:mm a")}
                    </span>
                  </div>
                  {msg.body_text && (
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 pl-7">
                      {msg.body_text}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
