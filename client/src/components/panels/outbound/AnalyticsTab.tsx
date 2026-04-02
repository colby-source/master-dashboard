import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { Send, Eye, MessageSquare, ArrowUpRight, Zap } from 'lucide-react';

export function AnalyticsTab() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['instantly-analytics-overview'],
    queryFn: () => api.instantlyAnalyticsOverview(),
    staleTime: 60_000,
  });

  const { data: countData } = useQuery({
    queryKey: ['instantly-count-launched'],
    queryFn: () => api.instantlyCountLaunched(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="text-muted-foreground text-sm py-8 text-center">Loading analytics...</div>;
  }

  const stats = overview ?? {};
  const metricCards = [
    { label: 'Emails Sent', value: stats.total_sent ?? stats.sent ?? 0, icon: <Send className="h-4 w-4 text-blue-400" /> },
    { label: 'Opens', value: stats.total_opened ?? stats.opened ?? 0, icon: <Eye className="h-4 w-4 text-green-400" /> },
    { label: 'Replies', value: stats.total_replied ?? stats.replied ?? 0, icon: <MessageSquare className="h-4 w-4 text-orange-400" /> },
    { label: 'Bounced', value: stats.total_bounced ?? stats.bounced ?? 0, icon: <ArrowUpRight className="h-4 w-4 text-red-400" /> },
    { label: 'Launched', value: countData?.count ?? '--', icon: <Zap className="h-4 w-4 text-yellow-400" /> },
  ];

  const openRate = stats.total_sent > 0
    ? ((stats.total_opened ?? stats.opened ?? 0) / stats.total_sent * 100).toFixed(1)
    : '0';
  const replyRate = stats.total_sent > 0
    ? ((stats.total_replied ?? stats.replied ?? 0) / stats.total_sent * 100).toFixed(1)
    : '0';

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {metricCards.map((m) => (
          <div key={m.label} className="bg-muted/50 rounded-lg p-3 border border-border/50">
            <div className="flex items-center gap-1.5 mb-1">
              {m.icon}
              <span className="text-xs text-muted-foreground">{m.label}</span>
            </div>
            <div className="text-xl font-bold tabular-nums">{typeof m.value === 'number' ? m.value.toLocaleString() : m.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted/50 rounded-lg p-4 border border-border/50 text-center">
          <div className="text-3xl font-bold text-green-400">{openRate}%</div>
          <div className="text-xs text-muted-foreground mt-1">Open Rate</div>
        </div>
        <div className="bg-muted/50 rounded-lg p-4 border border-border/50 text-center">
          <div className="text-3xl font-bold text-orange-400">{replyRate}%</div>
          <div className="text-xs text-muted-foreground mt-1">Reply Rate</div>
        </div>
      </div>
    </div>
  );
}
