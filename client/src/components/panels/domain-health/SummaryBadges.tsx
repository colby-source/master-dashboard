import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";

export function SummaryBadges() {
  const { data: summary } = useQuery({
    queryKey: ["domain-health-summary"],
    queryFn: api.getDomainHealthSummary,
    refetchInterval: 60000,
  });

  if (!summary) return null;

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">{summary.total_domains ?? 0}</span> domains
      </span>
      <span className="text-green-400">
        <span className="font-medium">{summary.healthy_domains ?? 0}</span> healthy
      </span>
      <span className="text-blue-400">
        <span className="font-medium">{summary.accounts_warming ?? 0}</span> warming
      </span>
      <span className="text-green-400">
        <span className="font-medium">{summary.accounts_ready ?? 0}</span> ready
      </span>
    </div>
  );
}
