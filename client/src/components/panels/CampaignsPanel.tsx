import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Pause, Play } from 'lucide-react';
import { timeAgo } from '../../lib/utils';
import { Skeleton } from '../ui/skeleton';
import { toast } from 'sonner';

interface Props {
  companyId?: number;
}

export function CampaignsPanel({ companyId }: Props) {
  const queryClient = useQueryClient();
  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns', companyId],
    queryFn: () => api.getCampaigns(companyId),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: number) => api.pauseCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign paused');
    },
    onError: () => toast.error('Failed to pause campaign'),
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => api.activateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign activated');
    },
    onError: () => toast.error('Failed to activate campaign'),
  });

  const statusColors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400',
    paused: 'bg-yellow-500/20 text-yellow-400',
    draft: 'bg-gray-500/20 text-gray-400',
    completed: 'bg-blue-500/20 text-blue-400',
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg">Email Campaigns</h3>
        <span className="text-sm text-muted-foreground">{campaigns.length} campaigns</span>
      </div>
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-12 ml-auto" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-8">No campaigns synced yet. Data will appear after the first sync cycle.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-2 pr-4">Campaign</th>
                <th className="text-left py-2 pr-4">Company</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-right py-2 pr-4">Open %</th>
                <th className="text-right py-2 pr-4">Reply %</th>
                <th className="text-right py-2 pr-4">Sent</th>
                <th className="text-right py-2 pr-4">Synced</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c: any) => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2.5 pr-4 font-medium">
                    <Link to={`/campaigns/${c.id}`} className="hover:text-primary transition-colors">
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4">
                    {c.company_name ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.company_color }} />
                        {c.company_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[c.status] || 'bg-gray-500/20 text-gray-400'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right">{c.stats?.open_rate || '0'}%</td>
                  <td className="py-2.5 pr-4 text-right">{c.stats?.reply_rate || '0'}%</td>
                  <td className="py-2.5 pr-4 text-right">{c.stats?.sent || 0}</td>
                  <td className="py-2.5 pr-4 text-right text-muted-foreground">{c.last_synced ? timeAgo(c.last_synced) : '--'}</td>
                  <td className="py-2.5 text-right">
                    {c.status === 'active' ? (
                      <button
                        onClick={() => pauseMutation.mutate(c.id)}
                        className="p-1 rounded hover:bg-muted text-yellow-400"
                        title="Pause"
                      >
                        <Pause className="h-4 w-4" />
                      </button>
                    ) : c.status === 'paused' ? (
                      <button
                        onClick={() => activateMutation.mutate(c.id)}
                        className="p-1 rounded hover:bg-muted text-green-400"
                        title="Activate"
                      >
                        <Play className="h-4 w-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
