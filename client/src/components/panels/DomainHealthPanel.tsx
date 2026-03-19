import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { toast } from "sonner";
import {
  ShieldCheck,
  Mail,
  History,
  RefreshCw,
  Play,
  Pause,
  Flame,
  FlameKindling,
  Search,
  ArrowUpDown,
  Timer,
  Rocket,
  CheckCircle2,
} from "lucide-react";
import { DomainCard } from "../domain-health/DomainCard";
import { WarmupBadge } from "../domain-health/WarmupBadge";
import { cn } from "@/lib/utils";

type Tab = "domains" | "accounts" | "history";

export function DomainHealthPanel() {
  const [tab, setTab] = useState<Tab>("domains");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "domains", label: "Domain Health", icon: <ShieldCheck className="h-4 w-4" /> },
    { id: "accounts", label: "Email Accounts", icon: <Mail className="h-4 w-4" /> },
    { id: "history", label: "History", icon: <History className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-4">
      <WarmupCountdownBanner />
      <div className="bg-card border border-border rounded-lg">
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h3 className="font-semibold text-lg">Domain Health & Warmup</h3>
          </div>
          <SummaryBadges />
        </div>
        <div className="flex gap-1 px-5 mt-3 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-emerald-400 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-5">
          {tab === "domains" && <DomainsTab />}
          {tab === "accounts" && <AccountsTab />}
          {tab === "history" && <HistoryTab />}
        </div>
      </div>
    </div>
  );
}

// ── Warmup countdown banner ─────────────────────────────────────

function WarmupCountdownBanner() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["warmup-status"],
    queryFn: api.getWarmupStatus,
    refetchInterval: 60000,
  });

  const checkMutation = useMutation({
    mutationFn: api.forceWarmupCheck,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["warmup-status"] });
      toast.success(`Warmup check complete: ${data.warming ?? 0} warming, ${data.ready ?? 0} ready`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (!status || (status.total === 0 && !status.estimated_ready_date)) return null;

  const allReady = status.warming > 0 && status.ready === status.warming;
  const estimatedDate = status.estimated_ready_date ? new Date(status.estimated_ready_date) : null;
  const now = new Date();
  const daysLeft = estimatedDate
    ? Math.max(0, Math.ceil((estimatedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  const bgClass = allReady
    ? "bg-green-500/10 border-green-500/30"
    : "bg-amber-500/10 border-amber-500/30";

  const Icon = allReady ? Rocket : Timer;
  const iconColor = allReady ? "text-green-400" : "text-amber-400";

  return (
    <div className={cn("rounded-lg border p-4", bgClass)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className={cn("h-6 w-6", iconColor)} />
          <div>
            {allReady ? (
              <p className="font-semibold text-green-400">
                All {status.ready} accounts are warmed up and ready to send!
              </p>
            ) : (
              <p className="font-semibold text-amber-300">
                {daysLeft !== null && daysLeft > 0
                  ? `~${daysLeft} day${daysLeft === 1 ? "" : "s"} until accounts are warmed up`
                  : "Warmup in progress..."}
              </p>
            )}
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span>{status.total ?? 0} total accounts</span>
              <span className="text-blue-400">{status.warming ?? 0} warming</span>
              <span className="text-green-400">
                <CheckCircle2 className="inline h-3 w-3 mr-0.5" />
                {status.ready ?? 0} ready
              </span>
              <span>{status.not_warming ?? 0} not warming</span>
              {estimatedDate && !allReady && (
                <span>Est. ready: {estimatedDate.toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", checkMutation.isPending && "animate-spin")} />
          {checkMutation.isPending ? "Checking..." : "Check Now"}
        </button>
      </div>
      {status.warming > 0 && !allReady && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Warmup progress</span>
            <span>{status.ready}/{status.warming} accounts ready</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-green-500 rounded-full transition-all"
              style={{ width: `${Math.round((status.ready / status.warming) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {status.checked_at && (
        <p className="text-[10px] text-muted-foreground mt-2">
          Last checked: {new Date(status.checked_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

// ── Summary badges at top ────────────────────────────────────────

function SummaryBadges() {
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

// ── Tab 1: Domain Health ──────────────────────────────────────────

function DomainsTab() {
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ["domain-health-domains"],
    queryFn: api.getDomainHealthDomains,
    refetchInterval: 60000,
  });

  const checkMutation = useMutation({
    mutationFn: (domain: string) => api.checkDomainHealth(domain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domain-health-domains"] });
      queryClient.invalidateQueries({ queryKey: ["domain-health-summary"] });
      toast.success("Health check complete");
    },
    onError: () => toast.error("Health check failed"),
  });

  const checkAllMutation = useMutation({
    mutationFn: api.checkAllDomainHealth,
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["domain-health-domains"] });
      queryClient.invalidateQueries({ queryKey: ["domain-health-summary"] });
      toast.success(`Checked ${data.domains_checked} domains`);
    },
    onError: () => toast.error("Check all failed"),
  });

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Loading domain health data...
      </div>
    );
  }

  if (domains.length === 0) {
    return (
      <div className="text-center py-12">
        <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground text-sm">
          No domain health data yet. Run a health check to get started.
        </p>
        <button
          onClick={() => checkAllMutation.mutate()}
          disabled={checkAllMutation.isPending}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-md disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", checkAllMutation.isPending && "animate-spin")} />
          Check All Domains
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          onClick={() => checkAllMutation.mutate()}
          disabled={checkAllMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-md disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", checkAllMutation.isPending && "animate-spin")} />
          Check All
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {domains.map((d: any) => (
          <DomainCard
            key={d.domain}
            snapshot={d}
            expanded={expandedDomain === d.domain}
            onToggle={() =>
              setExpandedDomain(expandedDomain === d.domain ? null : d.domain)
            }
            onCheckNow={() => checkMutation.mutate(d.domain)}
            checking={checkMutation.isPending && checkMutation.variables === d.domain}
          />
        ))}
      </div>
    </div>
  );
}

// ── Tab 2: Email Accounts ─────────────────────────────────────────

function AccountsTab() {
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
                    {a.open_rate != null ? `${Number(a.open_rate).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {a.bounce_rate != null ? `${Number(a.bounce_rate).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {a.total_sent ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {a.daily_limit ?? "—"}
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

// ── Tab 3: Health History ─────────────────────────────────────────

function HistoryTab() {
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
                      title={`${h.health_score} — ${new Date(h.checked_at).toLocaleDateString()}`}
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
                        {h.avg_open_rate != null ? `${h.avg_open_rate.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {h.avg_bounce_rate != null ? `${h.avg_bounce_rate.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {actions.length > 0
                          ? actions.join(", ")
                          : "—"}
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
