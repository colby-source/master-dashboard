import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { toast } from 'sonner';
import { Sparkles, Tag, Loader2 } from 'lucide-react';
import { useCompany } from '../../../contexts/CompanyContext';

interface Props {
  selectedIds: Set<string>;
  onClearSelection: () => void;
}

export function GhlBulkActions({ selectedIds, onClearSelection }: Props) {
  const { companyId } = useCompany();
  const [action, setAction] = useState<'enrich' | 'tag' | 'workflow' | null>(null);
  const [tagInput, setTagInput] = useState('');
  const queryClient = useQueryClient();

  const enrichMutation = useMutation({
    mutationFn: () => api.importFromGhl({
      company_id: companyId!,
      contact_ids: Array.from(selectedIds),
      auto_process: true,
    }),
    onSuccess: (data: any) => {
      toast.success(`Imported ${data.imported} contacts for enrichment`);
      onClearSelection();
    },
    onError: () => toast.error('Failed to import contacts'),
  });

  const tagMutation = useMutation({
    mutationFn: async () => {
      const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
      if (tags.length === 0) throw new Error('No tags provided');
      const results = await Promise.all(
        Array.from(selectedIds).map(id => api.addGhlContactTags(id, tags, companyId))
      );
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ghl-cmd-contacts'] });
      toast.success(`Tags added to ${selectedIds.size} contacts`);
      setTagInput('');
      setAction(null);
      onClearSelection();
    },
    onError: () => toast.error('Failed to add tags'),
  });

  if (selectedIds.size === 0) return null;

  const isPending = enrichMutation.isPending || tagMutation.isPending;

  return (
    <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {selectedIds.size} contact{selectedIds.size !== 1 ? 's' : ''} selected
        </span>
        <button onClick={onClearSelection} className="text-xs text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => enrichMutation.mutate()}
          disabled={!companyId || isPending}
          className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-md text-xs hover:bg-accent/90 disabled:opacity-50"
        >
          {enrichMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Enrich Selected
        </button>
        <button
          onClick={() => setAction(action === 'tag' ? null : 'tag')}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-500/20 text-blue-400 rounded-md text-xs hover:bg-blue-500/30 disabled:opacity-50"
        >
          <Tag className="h-3.5 w-3.5" /> Bulk Tag
        </button>
      </div>

      {!companyId && (
        <div className="text-xs text-yellow-400">Select a specific company to use bulk actions</div>
      )}

      {/* Tag input */}
      {action === 'tag' && (
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="Tag1, Tag2, Tag3..."
            className="flex-1 bg-card border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
          />
          <button
            onClick={() => tagMutation.mutate()}
            disabled={!tagInput.trim() || tagMutation.isPending}
            className="px-3 py-1.5 bg-blue-500 text-white rounded-md text-sm disabled:opacity-50"
          >
            {tagMutation.isPending ? 'Applying...' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  );
}
