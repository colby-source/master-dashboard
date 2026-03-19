import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { toast } from 'sonner';
import {
  DollarSign, ChevronDown, ChevronRight, Users, Building2,
  Plus, Trash2, ArrowRight, X,
} from 'lucide-react';

interface Props {
  companyId?: number;
}

export function GhlPipelinesTab({ companyId }: Props) {
  const [expandedPipeline, setExpandedPipeline] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newOpp, setNewOpp] = useState({ name: '', monetaryValue: '', contactId: '', stageId: '' });
  const [stageMove, setStageMove] = useState<{ oppId: string; currentStageId: string } | null>(null);
  const queryClient = useQueryClient();

  const { data: allPipelinesData, isLoading: loadingAll } = useQuery({
    queryKey: ['ghl-all-pipelines'],
    queryFn: api.getGhlAllPipelines,
    refetchInterval: 120000,
    enabled: !companyId,
  });

  const { data: companyPipelinesData, isLoading: loadingCompany } = useQuery({
    queryKey: ['ghl-pipelines', companyId],
    queryFn: () => api.getGhlPipelines(companyId),
    refetchInterval: 120000,
    enabled: !!companyId,
  });

  const { data: opportunitiesData } = useQuery({
    queryKey: ['ghl-opportunities', expandedPipeline, companyId],
    queryFn: () => api.getGhlOpportunities(expandedPipeline!, companyId),
    enabled: !!expandedPipeline,
  });

  const createOppMutation = useMutation({
    mutationFn: (data: any) => api.createGhlOpportunity(data, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ghl-opportunities'] });
      setShowCreateForm(false);
      setNewOpp({ name: '', monetaryValue: '', contactId: '', stageId: '' });
      toast.success('Opportunity created');
    },
    onError: () => toast.error('Failed to create opportunity'),
  });

  const deleteOppMutation = useMutation({
    mutationFn: (id: string) => api.deleteGhlOpportunity(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ghl-opportunities'] });
      toast.success('Opportunity deleted');
    },
    onError: () => toast.error('Failed to delete opportunity'),
  });

  const moveStageMutation = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) => api.updateGhlOpportunityStage(id, stageId, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ghl-opportunities'] });
      setStageMove(null);
      toast.success('Stage updated');
    },
    onError: () => toast.error('Failed to move opportunity'),
  });

  const pipelines = companyId
    ? (companyPipelinesData?.pipelines || [])
    : (allPipelinesData?.pipelines || []);
  const isLoading = companyId ? loadingCompany : loadingAll;
  const opportunities = opportunitiesData?.opportunities || [];

  const currentPipeline = pipelines.find((p: any) => p.id === expandedPipeline);
  const stages = currentPipeline?.stages || [];

  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val}`;
  };

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="text-muted-foreground text-sm text-center py-8">Loading pipelines...</div>
      ) : pipelines.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-8">No pipelines found</div>
      ) : (
        <div className="space-y-2">
          {pipelines.map((pipeline: any) => {
            const isExpanded = expandedPipeline === pipeline.id;
            const pipelineOpps = isExpanded ? opportunities : [];
            return (
              <div key={pipeline.id} className="border border-border rounded-lg overflow-hidden">
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
                  onClick={() => setExpandedPipeline(isExpanded ? null : pipeline.id)}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <div>
                      <div className="text-sm font-medium">{pipeline.name}</div>
                      {pipeline.companyName && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Building2 className="h-3 w-3" /> {pipeline.companyName}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{pipeline.opportunityCount ?? '—'}</span>
                      </div>
                    </div>
                    {pipeline.totalValue > 0 && (
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-sm text-green-400">
                          <DollarSign className="h-3.5 w-3.5" />
                          <span className="font-medium">{formatCurrency(pipeline.totalValue)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border">
                    {/* Stage progress bar */}
                    {stages.length > 0 && (
                      <div className="flex gap-0 overflow-x-auto p-3 pb-0">
                        {stages.map((stage: any, i: number) => {
                          const count = pipelineOpps.filter((o: any) => o.pipelineStageId === stage.id).length;
                          return (
                            <div key={stage.id || i} className="flex-1 min-w-[100px]">
                              <div className="text-[10px] font-medium text-muted-foreground uppercase truncate">
                                {stage.name} ({count})
                              </div>
                              <div className="h-1.5 bg-accent/20 rounded-full mt-1 mr-1">
                                <div
                                  className="h-full bg-accent rounded-full"
                                  style={{ width: `${Math.min(100, (count / Math.max(pipelineOpps.length, 1)) * 100)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="px-3 pt-2">
                      <button
                        onClick={() => setShowCreateForm(!showCreateForm)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-accent text-white rounded-md text-xs hover:bg-accent/90"
                      >
                        <Plus className="h-3 w-3" /> New Opportunity
                      </button>
                    </div>

                    {/* Create form */}
                    {showCreateForm && (
                      <div className="mx-3 mt-2 p-3 bg-muted rounded-lg space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            placeholder="Opportunity name"
                            value={newOpp.name}
                            onChange={(e) => setNewOpp(p => ({ ...p, name: e.target.value }))}
                            className="bg-card border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none"
                          />
                          <input
                            placeholder="Value ($)"
                            type="number"
                            value={newOpp.monetaryValue}
                            onChange={(e) => setNewOpp(p => ({ ...p, monetaryValue: e.target.value }))}
                            className="bg-card border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            placeholder="Contact ID (optional)"
                            value={newOpp.contactId}
                            onChange={(e) => setNewOpp(p => ({ ...p, contactId: e.target.value }))}
                            className="bg-card border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none"
                          />
                          <select
                            value={newOpp.stageId}
                            onChange={(e) => setNewOpp(p => ({ ...p, stageId: e.target.value }))}
                            className="bg-card border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none"
                          >
                            <option value="">Select stage...</option>
                            {stages.map((s: any) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => createOppMutation.mutate({
                              pipelineId: expandedPipeline,
                              name: newOpp.name,
                              monetaryValue: newOpp.monetaryValue ? Number(newOpp.monetaryValue) : undefined,
                              contactId: newOpp.contactId || undefined,
                              stageId: newOpp.stageId || stages[0]?.id,
                            })}
                            disabled={!newOpp.name}
                            className="px-3 py-1.5 bg-accent text-white rounded-md text-sm disabled:opacity-50"
                          >
                            Create
                          </button>
                          <button onClick={() => setShowCreateForm(false)} className="px-3 py-1.5 bg-muted-foreground/20 rounded-md text-sm">Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Opportunities list */}
                    <div className="p-3 space-y-1 max-h-[350px] overflow-y-auto">
                      {pipelineOpps.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-3">No opportunities in this pipeline</div>
                      ) : (
                        pipelineOpps.map((opp: any) => (
                          <div key={opp.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 group">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">{opp.name || opp.contact?.name || 'Untitled'}</div>
                              <div className="text-xs text-muted-foreground">
                                {opp.contact?.email || opp.contact?.phone || ''}
                                {opp.status && ` · ${opp.status}`}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {opp.monetaryValue > 0 && (
                                <span className="text-sm text-green-400 font-medium">{formatCurrency(opp.monetaryValue)}</span>
                              )}
                              {opp.pipelineStageId && (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                  {stages.find((s: any) => s.id === opp.pipelineStageId)?.name || ''}
                                </span>
                              )}
                              {/* Stage move */}
                              <button
                                onClick={() => setStageMove(stageMove?.oppId === opp.id ? null : { oppId: opp.id, currentStageId: opp.pipelineStageId })}
                                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-accent"
                                title="Move stage"
                              >
                                <ArrowRight className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => { if (confirm('Delete this opportunity?')) deleteOppMutation.mutate(opp.id); }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-400"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {/* Stage move dropdown */}
                            {stageMove?.oppId === opp.id && (
                              <div className="absolute right-0 mt-1 bg-card border border-border rounded-lg shadow-lg p-2 z-10 space-y-1">
                                <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
                                  Move to stage
                                  <button onClick={() => setStageMove(null)}><X className="h-3 w-3" /></button>
                                </div>
                                {stages.filter((s: any) => s.id !== stageMove?.currentStageId).map((s: any) => (
                                  <button
                                    key={s.id}
                                    onClick={() => moveStageMutation.mutate({ id: opp.id, stageId: s.id })}
                                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
                                  >
                                    {s.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
