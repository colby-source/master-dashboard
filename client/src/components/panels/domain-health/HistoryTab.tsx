import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { cn } from "@/lib/utils";

export function HistoryTab() {
  const [selectedDomain, setSelectedDomain] = useState<string>("");

  const { data: domains = [] } = useQuery({
    queryKey: ["domain-health-domains"],
    queryFn: api.getDomainHealthDomains,
    refetchInterval: 60000,
  });

  const { data: history } = useQuery({
    queryKey: ["domain-health-history", selectedDomain],
    queryFn: () => api.getDomainHealthDomain(selectedDomain, 30),
    enabled: !!selectedDomain,
  });

  const domainList = domains.map((d: any) => d.domain);

  // Auto-select first domain
  if (!selectedDomain && domainList.length > 0) {
    setSelectedDomain(domainList[0]);
  }

  const historyItems = history?.history ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={selectedDomain}
          onChange={(e) => setSelectedDomain(e.target.value)}
          className="text-sm bg-muted/50 border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 min-w-[200px]"
        >
          <option value="">Select domain...</option>
          {domainList.map((d: string) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {history?.latest && (
          <span className="text-xs text-muted-foreground">
            Current score:{" "}
            <span
              className={cn(
                "font-bold",
                history.latest.health_score >= 80
                  ? "text-green-400"
                  : history.latest.health_score >= 50
                    ? "text-yellow-400"
                    : "text-red-400"
              )}
            >
              {history.latest.health_score}
            </span>
          </span>
        )}
      </div>

      {!selectedDomain ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Select a domain to view health history
        </div>
      ) : historyItems.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No history data for this domain yet
        </div>
      ) : (
        <>
          {/* Score timeline bar chart */}
          <div className="border border-border rounded-lg p-4">
            <h4 className="text-xs font-medium text-muted-foreground mb-3">
              Health Score (Last {historyItems.length} checks)
            </h4>
            <div className="flex items-end gap-1 h-24">
              {historyItems
                .slice()
                .reverse()
                .map((h: any, i: number) => {
                  const height = `${Math.max(h.health_score, 2)}%`;
                  const color =
                    h.health_score >= 80
                      ? "bg-green-500"
                      : h.health_score >= 50
                        ? "bg-yellow-500"
                        : "bg-red-500";
                  return (
                    <div
                      key={i}
                      className="flex-1 group relative"
                      title={`${h.health_score} \u2014 ${new Date(h.checked_at).toLocaleDateString()}`}
                    >
                      <div
                        className={cn("rounded-t transition-all", color)}
                        style={{ height }}
                      />
                    </div>
                  );
                })}
            </div>
          </div>

          {/* History table */}
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Score</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">SPF</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">DKIM</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">DMARC</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">Blacklist</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Open %</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Bounce %</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Actions Taken</th>
                </tr>
              </thead>
              <tbody>
                {historyItems.map((h: any) => {
                  const actions = h.auto_actions_taken ? JSON.parse(h.auto_actions_taken) : [];
                  return (
                    <tr key={h.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2 text-xs">
                        {new Date(h.checked_at).toLocaleString()}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right text-xs font-bold tabular-nums",
                          h.health_score >= 80
                            ? "text-green-400"
                            : h.health_score >= 50
                              ? "text-yellow-400"
                              : "text-red-400"
                        )}
                      >
                        {h.health_score}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusDot ok={!!h.spf_valid} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusDot ok={!!h.dkim_valid} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusDot ok={!!h.dmarc_valid} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusDot ok={!h.blacklisted} />
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {h.avg_open_rate != null ? `${h.avg_open_rate.toFixed(1)}%` : "\u2014"}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {h.avg_bounce_rate != null ? `${h.avg_bounce_rate.toFixed(1)}%` : "\u2014"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {actions.length > 0
                          ? actions.join(", ")
                          : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        ok ? "bg-green-400" : "bg-red-400"
      )}
    />
  );
}
