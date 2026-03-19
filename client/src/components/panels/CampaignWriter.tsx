import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import { Wand2, Copy, Check, Loader2, ChevronDown } from 'lucide-react';

interface Props {
  companyId?: number;
}

export function CampaignWriter({ companyId }: Props) {
  const [selectedCampaign, setSelectedCampaign] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns', companyId],
    queryFn: () => api.getCampaigns(companyId),
  });

  const generateMutation = useMutation({
    mutationFn: (campaignId: number) => api.generateCampaignVariations(campaignId),
    onSuccess: () => toast.success('Variations generated'),
    onError: () => toast.error('Failed to generate'),
  });

  const activeCampaigns = campaigns.filter((c: any) => c.stats?.sent > 0);

  const handleGenerate = () => {
    if (selectedCampaign) generateMutation.mutate(selectedCampaign);
  };

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <Wand2 className="h-5 w-5 text-violet-400" />
        <h3 className="font-semibold text-lg">Campaign Writer</h3>
        <span className="text-xs text-muted-foreground ml-auto">Powered by Claude</span>
      </div>

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <select
            value={selectedCampaign || ''}
            onChange={(e) => setSelectedCampaign(Number(e.target.value) || null)}
            className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm appearance-none pr-8"
          >
            <option value="">Select a campaign to remix...</option>
            {activeCampaigns.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.stats?.reply_rate || 0}% reply)
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
        <button
          onClick={handleGenerate}
          disabled={!selectedCampaign || generateMutation.isPending}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
        >
          {generateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          Generate 3 Variations
        </button>
      </div>

      {generateMutation.isError && (
        <div className="text-red-400 text-sm mb-3 p-2 bg-red-500/10 rounded">
          {(generateMutation.error as Error).message}
        </div>
      )}

      {generateMutation.data?.variations && (
        <div className="space-y-3">
          {generateMutation.data.variations.map((v: any, i: number) => (
            <div key={i} className="bg-muted/50 border border-border/50 rounded-lg p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <span className="text-xs text-violet-400 font-medium">Variation {i + 1}</span>
                  <div className="font-medium text-sm mt-1">Subject: {v.subject}</div>
                </div>
                <button
                  onClick={() => copyToClipboard(`Subject: ${v.subject}\n\n${v.body}`, i)}
                  className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground flex-shrink-0"
                  title="Copy"
                >
                  {copied === i ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap mb-2">{v.body}</div>
              <div className="text-xs text-violet-300/60 italic">{v.reasoning}</div>
            </div>
          ))}
        </div>
      )}

      {!generateMutation.data && !generateMutation.isPending && (
        <div className="text-muted-foreground text-sm text-center py-4">
          Select a top-performing campaign and generate AI-powered variations
        </div>
      )}
    </div>
  );
}
