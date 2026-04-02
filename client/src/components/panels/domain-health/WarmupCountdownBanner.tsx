import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { toast } from "sonner";
import { RefreshCw, Timer, Rocket, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function WarmupCountdownBanner() {
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
