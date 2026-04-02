import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { toast } from "sonner";
import {
  Search,
  ArrowUpDown,
  Play,
  Pause,
  Flame,
  FlameKindling,
  RefreshCw,
} from "lucide-react";
import { WarmupBadge } from "../../domain-health/WarmupBadge";
import { cn } from "@/lib/utils";

export function AccountsTab() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("email");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const queryClient = useQueryClient();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["domain-health-accounts"],
    queryFn: api.getDomainHealthAccounts,
    refetchInterval: 60000,
  });

  const warmupMutation = useMutation({
    mutationFn: ({ email, enable }: { email: string; enable: boolean }) =>
      enable ? api.enableWarmup(email) : api.disableWarmup(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domain-health-accounts"] });
      toast.success("Warmup updated");
    },
    onError: () => toast.error("Failed to update warmup"),
  });

  const pauseMutation = useMutation({
    mutationFn: ({ email, pause }: { email: string; pause: boolean }) =>
      pause ? api.pauseAccount(email) : api.resumeAccount(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domain-health-accounts"] });
      toast.success("Account updated");
    },
    onError: () => toast.error("Failed to update account"),
  });

  const filtered = accounts
    .filter((a: any) => {
      if (search && !a.email.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus !== "all" && a.warmup_readiness !== filterStatus) return false;
      return true;
    })
    .sort((a: any, b: any) => {
      const aVal = a[sortField] ?? "";
      const bVal = b[sortField] ?? "";
      const cmp = typeof aVal === "number" ? aVal - bVal : String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });

  function toggleSort(field: string) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function SortHeader({ field, label }: { field: string; label: string }) {
    return (
      <button
        onClick={() => toggleSort(field)}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {label}
        {sortField === field && (
          <ArrowUpDown className="h-3 w-3" />
        )}
      </button>
    );
  }

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Loading accounts...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="text-sm bg-muted/50 border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="all">All Status</option>
          <option value="ready">Ready</option>
          <option value="almost_ready">Almost Ready</option>
          <option value="warming">Warming</option>
          <option value="not_warming">Not Warming</option>
          <option value="unhealthy">Unhealthy</option>
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} accounts</span>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-3 py-2"><SortHeader field="email" label="Email" /></th>
                <th className="text-left px-3 py-2"><SortHeader field="domain" label="Domain" /></th>
                <th className="text-left px-3 py-2"><SortHeader field="warmup_readiness" label="Readiness" /></th>
                <th className="text-right px-3 py-2"><SortHeader field="open_rate" label="Open %" /></th>
                <th className="text-right px-3 py-2"><SortHeader field="bounce_rate" label="Bounce %" /></th>
                <th className="text-right px-3 py-2"><SortHeader field="total_sent" label="Sent" /></th>
                <th className="text-right px-3 py-2"><SortHeader field="daily_limit" label="Daily Limit" /></th>
                <th className="text-center px-3 py-2 w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a: any) => (
                <tr key={a.email} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium text-xs truncate max-w-[200px]">
                    {a.email}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.domain}</td>
                  <td className="px-3 py-2">
                    <WarmupBadge status={a.warmup_readiness} />
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {a.open_rate != null ? `${Number(a.open_rate).toFixed(1)}%` : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {a.bounce_rate != null ? `${Number(a.bounce_rate).toFixed(1)}%` : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {a.total_sent ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {a.daily_limit ?? "\u2014"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() =>
                          warmupMutation.mutate({
                            email: a.email,
                            enable: !a.warmup_enabled,
                          })
                        }
                        disabled={warmupMutation.isPending}
                        title={a.warmup_enabled ? "Disable warmup" : "Enable warmup"}
                        className={cn(
                          "p-1 rounded hover:bg-muted",
                          a.warmup_enabled ? "text-orange-400" : "text-muted-foreground"
                        )}
                      >
                        {a.warmup_enabled ? (
                          <Flame className="h-3.5 w-3.5" />
                        ) : (
                          <FlameKindling className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() =>
                          pauseMutation.mutate({
                            email: a.email,
                            pause: a.status !== "paused",
                          })
                        }
                        disabled={pauseMutation.isPending}
                        title={a.status === "paused" ? "Resume" : "Pause"}
                        className="p-1 rounded hover:bg-muted text-muted-foreground"
                      >
                        {a.status === "paused" ? (
                          <Play className="h-3.5 w-3.5" />
                        ) : (
                          <Pause className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                    No accounts found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
