import { ScoreBadge } from "./StatusBadge"

interface ScoreCardProps {
  score: number | null | undefined
  label: string | null | undefined
  reasoning?: string | null
  tags?: string[]
}

export function ScoreCard({ score, label, reasoning, tags }: ScoreCardProps) {
  if (score == null) return null

  const barColor =
    score >= 80
      ? "bg-red-500"
      : score >= 50
        ? "bg-orange-500"
        : score >= 20
          ? "bg-blue-500"
          : "bg-muted-foreground"

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Score
      </h3>

      <div className="flex items-center gap-3">
        <ScoreBadge score={score} label={label} />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>0</span>
          <span>100</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(score, 100)}%` }}
          />
        </div>
      </div>

      {reasoning && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reasoning</p>
          <p className="text-sm text-foreground leading-relaxed">{reasoning}</p>
        </div>
      )}

      {tags && tags.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Score Tags</p>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
