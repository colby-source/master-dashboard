import * as React from "react"
import { format } from "date-fns"
import { Clock, Send, CheckCircle2, MailOpen, Reply } from "lucide-react"
import { cn } from "@/lib/utils"

interface DeliveryStatusStepperProps {
  queuedAt?: string | null
  sentAt?: string | null
  deliveredAt?: string | null
  openedAt?: string | null
  openCount?: number
  repliedAt?: string | null
}

const steps = [
  { key: "queued", label: "Queued", icon: Clock },
  { key: "sent", label: "Sent", icon: Send },
  { key: "delivered", label: "Delivered", icon: CheckCircle2 },
  { key: "opened", label: "Opened", icon: MailOpen },
  { key: "replied", label: "Reply", icon: Reply },
] as const

export function DeliveryStatusStepper({
  queuedAt,
  sentAt,
  deliveredAt,
  openedAt,
  openCount,
  repliedAt,
}: DeliveryStatusStepperProps) {
  const timestamps: Record<string, string | null | undefined> = {
    queued: queuedAt,
    sent: sentAt,
    delivered: deliveredAt,
    opened: openedAt,
    replied: repliedAt,
  }

  // Find the furthest completed step
  let currentStep = -1
  for (let i = steps.length - 1; i >= 0; i--) {
    if (timestamps[steps[i].key]) {
      currentStep = i
      break
    }
  }

  return (
    <div className="flex items-start justify-between">
      {steps.map((step, i) => {
        const isComplete = i <= currentStep && !!timestamps[step.key]
        const Icon = step.icon
        const ts = timestamps[step.key]

        return (
          <React.Fragment key={step.key}>
            {i > 0 && (
              <div
                className={cn(
                  "mt-3.5 h-px flex-1",
                  isComplete ? "bg-green-400/60" : "bg-border"
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1 min-w-[52px]">
              <div
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border",
                  isComplete
                    ? "border-green-400/30 bg-green-500/15 text-green-400"
                    : "border-border bg-muted text-muted-foreground"
                )}
              >
                <Icon className="size-3.5" />
              </div>
              <span
                className={cn(
                  "text-[9px] font-medium leading-tight text-center",
                  isComplete ? "text-green-400" : "text-muted-foreground"
                )}
              >
                {step.label}
                {step.key === "opened" && openCount != null && openCount > 1 && (
                  <span className="block text-[8px]">x{openCount}</span>
                )}
              </span>
              {ts && (
                <span className="text-[9px] text-muted-foreground leading-tight">
                  {format(new Date(ts), "h:mm a")}
                </span>
              )}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}
