import { useState } from "react";
import { ShieldCheck, Mail, History } from "lucide-react";
import { WarmupCountdownBanner } from "./domain-health/WarmupCountdownBanner";
import { SummaryBadges } from "./domain-health/SummaryBadges";
import { DomainsTab } from "./domain-health/DomainsTab";
import { AccountsTab } from "./domain-health/AccountsTab";
import { HistoryTab } from "./domain-health/HistoryTab";

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
