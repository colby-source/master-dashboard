import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  enriching: "bg-blue-500/15 text-blue-400",
  enriched: "bg-cyan-500/15 text-cyan-400",
  scored: "bg-purple-500/15 text-purple-400",
  pushed: "bg-green-500/15 text-green-400",
  approved: "bg-green-500/15 text-green-400",
  excluded: "bg-red-500/15 text-red-400",
  failed: "bg-red-500/15 text-red-400",
  active: "bg-green-500/15 text-green-400",
  paused: "bg-yellow-500/15 text-yellow-400",
  completed: "bg-blue-500/15 text-blue-400",
  draft: "bg-muted text-muted-foreground",
}

const scoreColors: Record<string, string> = {
  hot: "bg-red-500/15 text-red-400",
  warm: "bg-orange-500/15 text-orange-400",
  cool: "bg-blue-500/15 text-blue-400",
  cold: "bg-muted text-muted-foreground",
}

const pushStatusColors: Record<string, string> = {
  not_pushed: "bg-muted text-muted-foreground",
  pushed: "bg-green-500/15 text-green-400",
  approved: "bg-cyan-500/15 text-cyan-400",
  excluded: "bg-red-500/15 text-red-400",
  failed: "bg-red-500/15 text-red-400",
}

interface StatusBadgeProps {
  type: "status" | "score" | "push"
  value: string | null | undefined
  className?: string
}

export function StatusBadge({ type, value, className }: StatusBadgeProps) {
  if (!value) return null

  const colorMap =
    type === "score"
      ? scoreColors
      : type === "push"
        ? pushStatusColors
        : statusColors

  const colors = colorMap[value.toLowerCase()] ?? "bg-muted text-muted-foreground"
  const label = value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <Badge
      variant="secondary"
      className={cn("border-0 text-[10px] font-semibold uppercase tracking-wide", colors, className)}
    >
      {label}
    </Badge>
  )
}

interface ScoreBadgeProps {
  score: number | null | undefined
  label?: string | null
  className?: string
}

export function ScoreBadge({ score, label, className }: ScoreBadgeProps) {
  if (score == null) return null

  const color =
    score >= 80
      ? "text-red-400"
      : score >= 50
        ? "text-orange-400"
        : score >= 20
          ? "text-blue-400"
          : "text-muted-foreground"

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className={cn("text-sm font-bold tabular-nums", color)}>{score}</span>
      {label && <StatusBadge type="score" value={label} />}
    </div>
  )
}
