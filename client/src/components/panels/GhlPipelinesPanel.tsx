import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { GitBranch, DollarSign, ChevronDown, ChevronRight, Users, Building2 } from 'lucide-react';

interface Props {
  companyId?: number;
}

export function GhlPipelinesPanel({ companyId }: Props) {
  const [expandedPipeline, setExpandedPipeline] = useState<string | null>(null);

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

  const pipelines = companyId
    ? (companyPipelinesData?.pipelines || [])
    : (allPipelinesData?.pipelines || []);
  const isLoading = companyId ? loadingCompany : loadingAll;
  const opportunities = opportunitiesData?.opportunities || [];

  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val}`;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="h-5 w-5 text-green-400" />
        <h3 className="font-semibold text-lg">GHL Pipelines</h3>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm text-center py-6">Loading pipelines...</div>
      ) : pipelines.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-6">
          No pipelines found. Enable GHL API scopes to view pipelines.
        </div>
      ) : (
        <div className="space-y-2">
          {pipelines.map((pipeline: any) => {
            const isExpanded = expandedPipeline === pipeline.id;
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
                      <div className="text-[10px] text-muted-foreground">opportunities</div>
                    </div>
                    {pipeline.totalValue > 0 && (
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-sm text-green-400">
                          <DollarSign className="h-3.5 w-3.5" />
                          <span className="font-medium">{formatCurrency(pipeline.totalValue)}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">total value</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded: show stages + opportunities */}
                {isExpanded && (
                  <div className="border-t border-border">
                    {/* Pipeline stages */}
                    {pipeline.stages?.length > 0 && (
                      <div className="flex gap-0 overflow-x-auto p-3 pb-0">
                        {pipeline.stages.map((stage: any, i: number) => (
                          <div key={stage.id || i} className="flex-1 min-w-[100px]">
                            <div className="text-[10px] font-medium text-muted-foreground uppercase truncate">{stage.name}</div>
                            <div className="h-1.5 bg-accent/20 rounded-full mt-1 mr-1">
                              <div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(100, (opportunities.filter((o: any) => o.pipelineStageId === stage.id).length / Math.max(opportunities.length, 1)) * 100)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Opportunity list */}
                    <div className="p-3 space-y-1 max-h-[250px] overflow-y-auto">
                      {opportunities.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-3">No opportunities in this pipeline</div>
                      ) : (
                        opportunities.map((opp: any) => (
                          <div key={opp.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                            <div>
                              <div className="text-sm font-medium">{opp.name || opp.contact?.name || 'Untitled'}</div>
                              <div className="text-xs text-muted-foreground">
                                {opp.contact?.email || opp.contact?.phone || ''}
                                {opp.status && ` · ${opp.status}`}
                              </div>
                            </div>
                            <div className="text-right">
                              {opp.monetaryValue > 0 && (
                                <div className="text-sm text-green-400 font-medium">{formatCurrency(opp.monetaryValue)}</div>
                              )}
                              {opp.pipelineStageId && pipeline.stages && (
                                <div className="text-[10px] text-muted-foreground">
                                  {pipeline.stages.find((s: any) => s.id === opp.pipelineStageId)?.name || ''}
                                </div>
                              )}
                            </div>
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
