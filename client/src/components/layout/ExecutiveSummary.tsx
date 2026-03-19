import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { BarChart3, Mail, Bot, CheckSquare, AlertTriangle } from 'lucide-react';

interface Props {
  companyId?: number;
}

export function ExecutiveSummary({ companyId: _companyId }: Props) {
  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: api.getSummary,
    refetchInterval: 60000,
  });

  const cards = [
    { label: 'Active Campaigns', value: summary?.active_campaigns ?? '-', icon: Mail, color: 'text-blue-400' },
    { label: 'Open Tasks', value: summary?.open_tasks ?? '-', icon: CheckSquare, color: 'text-yellow-400' },
    { label: 'Agent Health', value: summary?.agent_health ? `${summary.agent_health}%` : '-', icon: Bot, color: 'text-green-400' },
    { label: 'Due Today', value: summary?.tasks_due_today ?? '-', icon: BarChart3, color: 'text-purple-400' },
    { label: 'Alerts', value: summary?.unack_alerts ?? '-', icon: AlertTriangle, color: summary?.unack_alerts > 0 ? 'text-red-400' : 'text-muted-foreground' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">{card.label}</span>
            <card.icon className={`h-4 w-4 ${card.color}`} />
          </div>
          <div className="text-2xl font-bold">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
