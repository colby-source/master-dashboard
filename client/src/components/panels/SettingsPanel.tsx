import { useState } from 'react';
import { Settings, Zap, Webhook, Database } from 'lucide-react';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { WebhookMonitorTab } from './settings/WebhookMonitorTab';
import { SystemTab } from './settings/SystemTab';

type Tab = 'integrations' | 'webhooks' | 'system';

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('integrations');

  const tabs: { id: Tab; label: string; icon: typeof Settings }[] = [
    { id: 'integrations', label: 'API Integrations', icon: Zap },
    { id: 'webhooks', label: 'Webhook Monitor', icon: Webhook },
    { id: 'system', label: 'System', icon: Database },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-indigo-400" />
        <h1 className="text-lg font-semibold">Settings & System Health</h1>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'integrations' && <IntegrationsTab />}
      {activeTab === 'webhooks' && <WebhookMonitorTab />}
      {activeTab === 'system' && <SystemTab />}
    </div>
  );
}
