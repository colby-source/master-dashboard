import { useState } from 'react';
import {
  Mail, Users, Send, BarChart3, Inbox, Zap,
} from 'lucide-react';
import { WorkspaceInfo } from './outbound/WorkspaceInfo';
import { CampaignsTab } from './outbound/CampaignsTab';
import { LeadsTab } from './outbound/LeadsTab';
import { UniboxTab } from './outbound/UniboxTab';
import { AccountsTab } from './outbound/AccountsTab';
import { AnalyticsTab } from './outbound/AnalyticsTab';

type Tab = 'campaigns' | 'leads' | 'unibox' | 'accounts' | 'analytics';

export function OutboundHub() {
  const [tab, setTab] = useState<Tab>('campaigns');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'campaigns', label: 'Campaigns', icon: <Send className="h-4 w-4" /> },
    { id: 'leads', label: 'Leads', icon: <Users className="h-4 w-4" /> },
    { id: 'unibox', label: 'Unibox', icon: <Inbox className="h-4 w-4" /> },
    { id: 'accounts', label: 'Accounts', icon: <Mail className="h-4 w-4" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-4 w-4" /> },
  ];

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-between p-5 pb-0">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-orange-400" />
          <h3 className="font-semibold text-lg">Outbound Command Center</h3>
        </div>
        <WorkspaceInfo />
      </div>
      <div className="flex gap-1 px-5 mt-3 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-orange-400 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-5">
        {tab === 'campaigns' && <CampaignsTab />}
        {tab === 'leads' && <LeadsTab />}
        {tab === 'unibox' && <UniboxTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}
