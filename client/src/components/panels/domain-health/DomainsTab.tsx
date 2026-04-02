import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { toast } from "sonner";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { DomainCard } from "../../domain-health/DomainCard";
import { cn } from "@/lib/utils";

export function DomainsTab() {
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
