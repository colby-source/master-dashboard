import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useCompany } from '../../../contexts/CompanyContext';
import { Zap, Users, GitBranch } from 'lucide-react';
import { GhlContactsTab } from './GhlContactsTab';
import { GhlPipelinesTab } from './GhlPipelinesTab';
import { GhlBulkActions } from './GhlBulkActions';

type Tab = 'contacts' | 'pipelines';

export function GhlCommandPanel() {
  const { companyId } = useCompany();
  const [tab, setTab] = useState<Tab>('contacts');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: statusData } = useQuery({
    queryKey: ['ghl-status'],
    queryFn: api.getGhlStatus,
    refetchInterval: 60000,
  });

  const locations = statusData?.locations || [];
  const connectedCount = locations.filter((l: any) => l.hasAccess).length;

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-400" />
            <h2 className="font-semibold text-lg">GHL Command Panel</h2>
          </div>
          <div className="flex items-center gap-3">
            {locations.map((loc: any) => (
              <div key={loc.companyId} className="flex items-center gap-1.5 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full ${loc.hasAccess ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-muted-foreground">{loc.name}</span>
              </div>
            ))}
            {locations.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {connectedCount}/{locations.length} connected
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <button
            onClick={() => { setTab('contacts'); handleClearSelection(); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'contacts' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="h-4 w-4" /> Contacts
          </button>
          <button
            onClick={() => { setTab('pipelines'); handleClearSelection(); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'pipelines' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <GitBranch className="h-4 w-4" /> Pipelines
          </button>
        </div>
      </div>

      {/* Bulk actions bar */}
      {tab === 'contacts' && (
        <GhlBulkActions
          selectedIds={selectedIds}
          onClearSelection={handleClearSelection}
        />
      )}

      {/* Tab content */}
      <div className="bg-card border border-border rounded-lg p-5">
        {tab === 'contacts' && (
          <GhlContactsTab
            companyId={companyId}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
          />
        )}
        {tab === 'pipelines' && (
          <GhlPipelinesTab companyId={companyId} />
        )}
      </div>
    </div>
  );
}
