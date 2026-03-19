import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DomainSnapshot {
  domain: string;
  health_score: number;
  spf_valid: number;
  dkim_valid: number;
  dmarc_valid: number;
  blacklisted: number;
  blacklist_details?: string;
  account_count: number;
  accounts_warming: number;
  accounts_ready: number;
  avg_open_rate: number | null;
  avg_bounce_rate: number | null;
  avg_spam_rate: number | null;
  total_sent_7d: number;
  checked_at: string;
}

interface DomainCardProps {
  snapshot: DomainSnapshot;
  expanded: boolean;
  onToggle: () => void;
  onCheckNow: () => void;
  checking: boolean;
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-green-500/10 border-green-500/20";
  if (score >= 50) return "bg-yellow-500/10 border-yellow-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function DnsBadge({ label, valid }: { label: string; valid: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded",
        valid
          ? "bg-green-500/10 text-green-400"
          : "bg-red-500/10 text-red-400"
      )}
    >
      {valid ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      {label}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DomainCard({
  snapshot,
  expanded,
  onToggle,
  onCheckNow,
  checking,
}: DomainCardProps) {
  const s = snapshot;
  const ScoreIcon =
    s.health_score >= 80
      ? ShieldCheck
      : s.health_score >= 50
        ? Shield
        : ShieldAlert;

  return (
    <div
      className={cn(
        "border rounded-lg transition-colors",
        scoreBg(s.health_score)
      )}
    >
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ScoreIcon className={cn("h-6 w-6 shrink-0", scoreColor(s.health_score))} />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{s.domain}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {s.account_count} accounts &middot; {s.accounts_ready} ready &middot; {s.accounts_warming} warming
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={cn("text-2xl font-bold tabular-nums", scoreColor(s.health_score))}>
            {s.health_score}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <DnsBadge label="SPF" valid={!!s.spf_valid} />
            <DnsBadge label="DKIM" valid={!!s.dkim_valid} />
            <DnsBadge label="DMARC" valid={!!s.dmarc_valid} />
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded",
                s.blacklisted
                  ? "bg-red-500/10 text-red-400"
                  : "bg-green-500/10 text-green-400"
              )}
            >
              {s.blacklisted ? (
                <>
                  <XCircle className="h-3 w-3" /> Blacklisted
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3" /> Clean
                </>
              )}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">Open Rate</div>
              <div className="font-medium tabular-nums">
                {s.avg_open_rate != null ? `${s.avg_open_rate.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Bounce Rate</div>
              <div className="font-medium tabular-nums">
                {s.avg_bounce_rate != null ? `${s.avg_bounce_rate.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Sent (7d)</div>
              <div className="font-medium tabular-nums">{s.total_sent_7d}</div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Checked {timeAgo(s.checked_at)}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCheckNow();
              }}
              disabled={checking}
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
              Check Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
