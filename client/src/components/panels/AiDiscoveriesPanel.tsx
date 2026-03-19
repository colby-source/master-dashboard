import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Lightbulb, Bookmark, X, TrendingUp, AlertCircle, Trophy, Zap } from 'lucide-react';
import { timeAgo } from '../../lib/utils';

const categoryConfig: Record<string, { icon: typeof Lightbulb; color: string; bg: string; label: string }> = {
  performance: { icon: Trophy, color: 'text-green-400', bg: 'bg-green-500/10', label: 'Performance' },
  'action-needed': { icon: AlertCircle, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'Action Needed' },
  trend: { icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Trend' },
  milestone: { icon: Zap, color: 'text-purple-400', bg: 'bg-purple-500/10', label: 'Milestone' },
};

const defaultConfig = { icon: Lightbulb, color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: 'Insight' };

export function AiDiscoveriesPanel() {
  const queryClient = useQueryClient();
  const { data: discoveries = [] } = useQuery({
    queryKey: ['discoveries'],
    queryFn: api.getDiscoveries,
    refetchInterval: 60000,
  });

  const saveMutation = useMutation({
    mutationFn: (id: number) => api.saveDiscovery(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discoveries'] });
      toast.success('Discovery saved');
    },
    onError: () => toast.error('Failed to save discovery'),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => api.dismissDiscovery(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discoveries'] });
      toast.success('Discovery dismissed');
    },
    onError: () => toast.error('Failed to dismiss'),
  });

  const unsaved = discoveries.filter((d: any) => !d.saved);
  const saved = discoveries.filter((d: any) => d.saved);

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-yellow-400" />
          <h3 className="font-semibold text-lg">AI Discoveries</h3>
        </div>
        {unsaved.length > 0 && (
          <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full">
            {unsaved.length} new
          </span>
        )}
      </div>

      {discoveries.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-6">
          No discoveries yet — insights will appear as data flows in
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {unsaved.map((d: any) => {
            const config = categoryConfig[d.category] || defaultConfig;
            const Icon = config.icon;
            return (
              <div key={d.id} className={`p-3 rounded-lg ${config.bg} border border-transparent`}>
                <div className="flex items-start gap-3">
                  <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{d.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground leading-relaxed">{d.summary}</div>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                      <span>{d.platform}</span>
                      <span>·</span>
                      <span>{d.discovered_at ? timeAgo(d.discovered_at) : ''}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => saveMutation.mutate(d.id)}
                      className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-yellow-400 transition-colors"
                      title="Save"
                    >
                      <Bookmark className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => dismissMutation.mutate(d.id)}
                      className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                      title="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {saved.length > 0 && (
            <>
              <div className="text-xs text-muted-foreground font-medium pt-2 pb-1 flex items-center gap-2">
                <Bookmark className="h-3 w-3" />
                Saved ({saved.length})
              </div>
              {saved.map((d: any) => {
                const config = categoryConfig[d.category] || defaultConfig;
                const Icon = config.icon;
                return (
                  <div key={d.id} className="p-3 rounded-lg bg-muted/30 border border-border/50 opacity-80">
                    <div className="flex items-start gap-3">
                      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${config.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{d.title}</div>
                        <div className="text-xs text-muted-foreground mt-1">{d.summary}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {d.platform} · {d.discovered_at ? timeAgo(d.discovered_at) : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
