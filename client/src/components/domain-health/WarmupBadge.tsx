import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const warmupColors: Record<string, string> = {
  ready: "bg-green-500/15 text-green-400",
  almost_ready: "bg-yellow-500/15 text-yellow-400",
  warming: "bg-blue-500/15 text-blue-400",
  not_warming: "bg-muted text-muted-foreground",
  unhealthy: "bg-red-500/15 text-red-400",
};

const warmupLabels: Record<string, string> = {
  ready: "Ready",
  almost_ready: "Almost Ready",
  warming: "Warming",
  not_warming: "Not Warming",
  unhealthy: "Unhealthy",
};

interface WarmupBadgeProps {
  status: string;
  className?: string;
}

export function WarmupBadge({ status, className }: WarmupBadgeProps) {
  const colors = warmupColors[status] ?? warmupColors.not_warming;
  const label = warmupLabels[status] ?? status;

  return (
    <Badge
      variant="secondary"
      className={cn(
        "border-0 text-[10px] font-semibold uppercase tracking-wide",
        colors,
        className
      )}
    >
      {label}
    </Badge>
  );
}
