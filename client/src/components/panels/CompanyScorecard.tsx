import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Building2 } from 'lucide-react';

interface Props {
  companyId?: number;
}

export function CompanyScorecard({ companyId }: Props) {
  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: api.getCompanies,
  });

  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.getCampaigns(),
  });

  const displayCompanies = companyId
    ? companies.filter((c: any) => c.id === companyId)
    : companies.filter((c: any) => c.type !== 'personal');

  if (displayCompanies.length === 0) {
    return (
      <div className={`${companyId ? '' : 'lg:col-span-2'} bg-card border border-border rounded-lg p-8 text-center`}>
        <Building2 className="mx-auto size-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">No companies found. Add a company in Settings to get started.</p>
      </div>
    );
  }

  return (
    <div className={`${companyId ? '' : 'lg:col-span-2'} grid ${displayCompanies.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
      {displayCompanies.map((company: any) => {
        const companyCampaigns = campaigns.filter((c: any) => c.company_id === company.id);
        const activeCampaigns = companyCampaigns.filter((c: any) => c.status === 'active');
        const avgOpenRate = companyCampaigns.reduce((sum: number, c: any) => {
          const rate = c.stats?.open_rate ? parseFloat(c.stats.open_rate) : 0;
          return sum + rate;
        }, 0) / (companyCampaigns.length || 1);
        const avgReplyRate = companyCampaigns.reduce((sum: number, c: any) => {
          const rate = c.stats?.reply_rate ? parseFloat(c.stats.reply_rate) : 0;
          return sum + rate;
        }, 0) / (companyCampaigns.length || 1);

        return (
          <div key={company.id} className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: company.color }} />
              <h3 className="font-semibold text-lg">{company.name}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Active Campaigns</div>
                <div className="text-xl font-bold">{activeCampaigns.length}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Campaigns</div>
                <div className="text-xl font-bold">{companyCampaigns.length}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Avg Open Rate</div>
                <div className="text-xl font-bold">{avgOpenRate.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Avg Reply Rate</div>
                <div className="text-xl font-bold">{avgReplyRate.toFixed(1)}%</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
