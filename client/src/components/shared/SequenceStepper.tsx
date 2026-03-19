import * as React from "react"
import { Mail, Clock, ChevronDown, ChevronUp, Eye, Reply, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

interface StepData {
  step_number?: number
  variant_label?: string
  subject?: string
  body_preview?: string
  sent?: number
  opened?: number
  replied?: number
  bounced?: number
  open_rate?: number
  reply_rate?: number
  bounce_rate?: number
  delay_days?: number
}

interface SequenceStepperProps {
  steps: StepData[]
  onStepClick?: (step: StepData, index: number) => void
}

function computeRate(numerator: number | undefined, denominator: number | undefined): string {
  if (!denominator || !numerator) return "0"
  return ((numerator / denominator) * 100).toFixed(1)
}

export function SequenceStepper({ steps, onStepClick }: SequenceStepperProps) {
  const [expandedStep, setExpandedStep] = React.useState<number | null>(null)

  if (!steps || steps.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <Mail className="mx-auto size-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No sequence steps found.</p>
        <p className="text-xs text-muted-foreground mt-1">Step data will appear after syncing with Instantly.</p>
      </div>
    )
  }

  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const stepNum = step.step_number ?? i + 1
        const isExpanded = expandedStep === i
        const sent = step.sent ?? 0
        const opened = step.opened ?? 0
        const replied = step.replied ?? 0
        const bounced = step.bounced ?? 0
        const openRate = step.open_rate ?? computeRate(opened, sent)
        const replyRate = step.reply_rate ?? computeRate(replied, sent)

        return (
          <React.Fragment key={i}>
            {/* Delay connector */}
            {i > 0 && (
              <div className="flex items-center gap-2 pl-4 py-1.5">
                <div className="w-px h-6 bg-border ml-[11px]" />
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-3">
                  <Clock className="size-3" />
                  {step.delay_days
                    ? `${step.delay_days} day${step.delay_days !== 1 ? "s" : ""} delay`
                    : "Auto delay"}
                </div>
              </div>
            )}

            {/* Step card */}
            <div
              className={cn(
                "rounded-lg border border-border bg-card overflow-hidden transition-colors",
                onStepClick && "cursor-pointer hover:border-primary/30"
              )}
              onClick={() => {
                setExpandedStep(isExpanded ? null : i)
                onStepClick?.(step, i)
              }}
            >
              {/* Step header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                  {stepNum}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      Step {stepNum}: {step.variant_label || step.subject || "Email"}
                    </p>
                  </div>
                  {step.subject && step.variant_label && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      Subject: {step.subject}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {isExpanded ? (
                    <ChevronUp className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Stats bar */}
              <div className="flex items-center gap-4 px-4 pb-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <Mail className="size-3 text-blue-400" />
                  <span className="text-muted-foreground">Sent</span>
                  <span className="font-medium">{sent.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Eye className="size-3 text-green-400" />
                  <span className="text-muted-foreground">Opened</span>
                  <span className="font-medium">{opened.toLocaleString()}</span>
                  <span className="text-muted-foreground">({openRate}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Reply className="size-3 text-cyan-400" />
                  <span className="text-muted-foreground">Replied</span>
                  <span className="font-medium">{replied.toLocaleString()}</span>
                  <span className="text-muted-foreground">({replyRate}%)</span>
                </div>
                {bounced > 0 && (
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="size-3 text-red-400" />
                    <span className="text-muted-foreground">Bounced</span>
                    <span className="font-medium text-red-400">{bounced.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Progress bars */}
              <div className="px-4 pb-3 flex gap-2">
                <div className="flex-1">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-green-400 transition-all"
                      style={{ width: `${Math.min(Number(openRate), 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground mt-0.5 block">Open Rate</span>
                </div>
                <div className="flex-1">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-cyan-400 transition-all"
                      style={{ width: `${Math.min(Number(replyRate), 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground mt-0.5 block">Reply Rate</span>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-border px-4 py-3 bg-muted/20 space-y-2">
                  {step.body_preview && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Preview</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{step.body_preview}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Total Sent:</span>{" "}
                      <span className="font-medium">{sent.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Opens:</span>{" "}
                      <span className="font-medium">{opened.toLocaleString()} ({openRate}%)</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Replies:</span>{" "}
                      <span className="font-medium">{replied.toLocaleString()} ({replyRate}%)</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Bounces:</span>{" "}
                      <span className="font-medium">{bounced.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}
