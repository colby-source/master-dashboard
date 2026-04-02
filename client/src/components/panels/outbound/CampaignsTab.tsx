import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { toast } from 'sonner';
import { Search, RefreshCw, Pause, Play, Copy } from 'lucide-react';

export function CampaignsTab() {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['instantly-campaigns', search],
    queryFn: () => api.instantlyCampaigns({ limit: 100, search: search || undefined }),
  });

  const pause = useMutation({
    mutationFn: (id: string) => api.instantlyPauseCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instantly-campaigns'] });
      toast.success('Campaign paused');
    },
    onError: () => toast.error('Failed to pause'),
  });

  const activate = useMutation({
    mutationFn: (id: string) => api.instantlyActivateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instantly-campaigns'] });
      toast.success('Campaign activated');
    },
    onError: () => toast.error('Failed to activate'),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.instantlyDuplicateCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instantly-campaigns'] });
      toast.success('Campaign duplicated');
    },
    onError: () => toast.error('Failed to duplicate'),
  });

  const campaigns = data?.items ?? data ?? [];

  const statusColors: Record<number, { bg: string; label: string }> = {
    0: { bg: 'bg-gray-500/20 text-gray-400', label: 'Draft' },
    1: { bg: 'bg-green-500/20 text-green-400', label: 'Active' },
    2: { bg: 'bg-yellow-500/20 text-yellow-400', label: 'Paused' },
    3: { bg: 'bg-blue-500/20 text-blue-400', label: 'Completed' },
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-muted border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['instantly-campaigns'] })}
          className="p-2 rounded hover:bg-muted text-muted-foreground"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading campaigns...</div>
      ) : campaigns.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">No campaigns found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-2 pr-4">Campaign</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-right py-2 pr-4">Sent</th>
                <th className="text-right py-2 pr-4">Opens</th>
                <th className="text-right py-2 pr-4">Replies</th>
                <th className="text-right py-2 pr-4">Bounced</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c: any) => {
                const st = statusColors[c.campaign_status] ?? statusColors[0];
                return (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-2.5 pr-4 font-medium max-w-[300px] truncate">{c.name}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{c.stats?.sent ?? '--'}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{c.stats?.opened ?? '--'}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{c.stats?.replied ?? '--'}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{c.stats?.bounced ?? '--'}</td>
                    <td className="py-2.5 text-right flex items-center justify-end gap-1">
                      {c.campaign_status === 1 ? (
                        <button onClick={() => pause.mutate(c.id)} className="p-1 rounded hover:bg-muted text-yellow-400" title="Pause">
                          <Pause className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => activate.mutate(c.id)} className="p-1 rounded hover:bg-muted text-green-400" title="Activate">
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => duplicate.mutate(c.id)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Duplicate">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
