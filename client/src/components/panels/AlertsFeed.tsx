import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { AlertTriangle, Check, CheckCheck, Info, XCircle } from 'lucide-react';
import { timeAgo } from '../../lib/utils';

interface Props {
  companyId?: number;
}

export function AlertsFeed({ companyId: _companyId }: Props) {
  const queryClient = useQueryClient();
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: api.getAlerts,
    refetchInterval: 60000,
  });

  const ackMutation = useMutation({
    mutationFn: (id: number) => api.acknowledgeAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      toast.success('Alert acknowledged');
    },
    onError: () => toast.error('Failed to acknowledge'),
  });

  const bulkAckMutation = useMutation({
    mutationFn: (filters?: { source?: string }) => api.bulkAcknowledgeAlerts(filters),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      toast.success('All alerts cleared');
    },
    onError: () => toast.error('Failed to clear alerts'),
  });

  const severityConfig: Record<string, { icon: typeof AlertTriangle; color: string; bg: string }> = {
    critical: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
    warning: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
    info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg">Alerts & Activity</h3>
        {alerts.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{alerts.length} unread</span>
            <button
              onClick={() => bulkAckMutation.mutate(undefined)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded hover:bg-muted"
              title="Clear all alerts"
            >
              <CheckCheck className="h-3 w-3" />
              Clear All
            </button>
          </div>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-6">All clear -- no active alerts</div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {alerts.map((alert: any) => {
            const config = severityConfig[alert.severity] || severityConfig.info;
            const Icon = config.icon;
            return (
              <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-lg ${config.bg}`}>
                <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${config.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{alert.message}</div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    <span>{alert.source}</span>
                    <span>·</span>
                    <span>{alert.created_at ? timeAgo(alert.created_at) : ''}</span>
                  </div>
                </div>
                <button
                  onClick={() => ackMutation.mutate(alert.id)}
                  className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground flex-shrink-0"
                  title="Acknowledge"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
