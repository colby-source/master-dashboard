import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { Search } from 'lucide-react';

export function LeadsTab() {
  const [search, setSearch] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');

  const { data: campaignsData } = useQuery({
    queryKey: ['instantly-campaigns-list'],
    queryFn: () => api.instantlyCampaigns({ limit: 100 }),
    staleTime: 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['instantly-leads', campaignFilter, search],
    queryFn: () => api.instantlyLeads({
      campaign_id: campaignFilter || undefined,
      limit: 100,
      search: search || undefined,
    }),
  });

  const campaigns = campaignsData?.items ?? campaignsData ?? [];
  const leads = data?.items ?? data ?? [];

  const interestLabels: Record<number, { color: string; label: string }> = {
    0: { color: 'text-gray-400', label: 'Unknown' },
    1: { color: 'text-green-400', label: 'Interested' },
    2: { color: 'text-yellow-400', label: 'Maybe' },
    3: { color: 'text-red-400', label: 'Not Interested' },
    4: { color: 'text-blue-400', label: 'Wrong Person' },
    5: { color: 'text-orange-400', label: 'Out of Office' },
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-muted border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 max-w-[200px]"
        >
          <option value="">All campaigns</option>
          {campaigns.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading leads...</div>
      ) : leads.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">No leads found. Select a campaign or search.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-2 pr-4">Email</th>
                <th className="text-left py-2 pr-4">Name</th>
                <th className="text-left py-2 pr-4">Company</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-left py-2">Interest</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l: any, i: number) => {
                const interest = interestLabels[l.interest_status] ?? interestLabels[0];
                return (
                  <tr key={l.email ?? i} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-2.5 pr-4 font-mono text-xs">{l.email}</td>
                    <td className="py-2.5 pr-4">{[l.first_name, l.last_name].filter(Boolean).join(' ') || '--'}</td>
                    <td className="py-2.5 pr-4">{l.company_name || '--'}</td>
                    <td className="py-2.5 pr-4">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-muted">{l.lead_status ?? l.status ?? '--'}</span>
                    </td>
                    <td className={`py-2.5 text-xs font-medium ${interest.color}`}>{interest.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="text-xs text-muted-foreground mt-2">Showing {leads.length} leads</div>
        </div>
      )}
    </div>
  );
}
