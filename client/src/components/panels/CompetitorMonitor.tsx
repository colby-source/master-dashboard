import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Radar, Plus, Trash2, ExternalLink, Clock, AlertTriangle } from 'lucide-react';
import { timeAgo } from '../../lib/utils';

export function CompetitorMonitor() {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: competitors = [] } = useQuery({
    queryKey: ['competitors'],
    queryFn: api.getCompetitors,
    refetchInterval: 60000,
  });

  const { data: changes = [] } = useQuery({
    queryKey: ['competitor-changes', expandedId],
    queryFn: () => (expandedId ? api.getCompetitorChanges(expandedId) : Promise.resolve([])),
    enabled: !!expandedId,
  });

  const addMutation = useMutation({
    mutationFn: () => api.addCompetitor(name, url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
      setName('');
      setUrl('');
      setShowAdd(false);
      toast.success('Competitor added');
    },
    onError: () => toast.error('Failed to add competitor'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => api.removeCompetitor(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
      toast.success('Competitor removed');
    },
    onError: () => toast.error('Failed to remove'),
  });

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-amber-400" />
          <h3 className="font-semibold text-lg">Competitor Monitor</h3>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {showAdd && (
        <div className="flex gap-2 mb-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="bg-muted border border-border rounded-md px-3 py-1.5 text-sm flex-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://competitor.com"
            className="bg-muted border border-border rounded-md px-3 py-1.5 text-sm flex-[2] focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <button
            onClick={() => addMutation.mutate()}
            disabled={!name || !url}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-md text-sm transition-colors"
          >
            Add
          </button>
        </div>
      )}

      {competitors.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-6">
          No competitors tracked yet. Add URLs to monitor for changes.
        </div>
      ) : (
        <div className="space-y-2">
          {competitors.map((c: any) => (
            <div key={c.id}>
              <div
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted/70"
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full ${c.last_status_code === 200 ? 'bg-green-500' : c.last_status_code ? 'bg-red-500' : 'bg-gray-500'}`} />
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{c.url}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.last_checked && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeAgo(c.last_checked)}
                    </span>
                  )}
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 rounded hover:bg-white/10 text-muted-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeMutation.mutate(c.id); }}
                    className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {expandedId === c.id && (
                <div className="ml-6 mt-1 space-y-1">
                  {c.last_title && (
                    <div className="text-xs text-muted-foreground">
                      Title: <span className="text-foreground">{c.last_title}</span>
                    </div>
                  )}
                  {changes.length > 0 ? (
                    changes.map((ch: any) => (
                      <div key={ch.id} className="flex items-start gap-2 p-2 rounded bg-amber-500/10 text-xs">
                        <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="text-amber-300">Content changed</span>
                          {ch.old_title !== ch.new_title && (
                            <span className="text-muted-foreground"> — title: "{ch.old_title}" → "{ch.new_title}"</span>
                          )}
                          <div className="text-muted-foreground mt-0.5">{ch.detected_at ? timeAgo(ch.detected_at) : ''}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground p-2">No changes detected yet</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
