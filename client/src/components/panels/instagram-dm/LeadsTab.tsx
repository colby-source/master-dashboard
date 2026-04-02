import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { toast } from 'sonner'

interface LeadsTabProps {
  campaignId: number | null
  onBack: () => void
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

export function LeadsTab({ campaignId, onBack }: LeadsTabProps) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [importMode, setImportMode] = useState<'none' | 'hashtag' | 'competitor' | 'manual'>('none')
  const [hashtagInput, setHashtagInput] = useState('')
  const [competitorInput, setCompetitorInput] = useState('')
  const [manualInput, setManualInput] = useState('')

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['ig-dm-leads', campaignId, statusFilter],
    queryFn: () => campaignId ? api.igDmGetLeads(campaignId, statusFilter || undefined) : [],
    enabled: !!campaignId,
  })

  const importHashtagMut = useMutation({
    mutationFn: () => api.igDmImportHashtag(campaignId!, hashtagInput.replace(/^#/, ''), 50),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] })
      setImportMode('none')
      setHashtagInput('')
      toast.success('Hashtag import started')
    },
    onError: () => toast.error('Import failed'),
  })

  const importCompetitorMut = useMutation({
    mutationFn: () => api.igDmImportCompetitor(campaignId!, competitorInput.replace(/^@/, ''), 50),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] })
      setImportMode('none')
      setCompetitorInput('')
      toast.success('Competitor import started')
    },
    onError: () => toast.error('Import failed'),
  })

  const addManualMut = useMutation({
    mutationFn: () => {
      const usernames = manualInput.split('\n').map(u => u.trim().replace(/^@/, '')).filter(Boolean)
      return api.igDmAddLeads(campaignId!, usernames.map(u => ({ username: u })))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] })
      setImportMode('none')
      setManualInput('')
      toast.success('Leads added')
    },
    onError: () => toast.error('Failed to add leads'),
  })

  const skipMut = useMutation({
    mutationFn: (leadId: number) => api.igDmUpdateLeadStatus(leadId, 'skipped'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] }); toast.success('Lead skipped'); },
    onError: () => toast.error('Failed to skip lead'),
  })

  if (!campaignId) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">Select a campaign first</p>
        <button onClick={onBack} className="mt-2 text-sm text-purple-400 hover:text-purple-300">Go to Campaigns</button>
      </div>
    )
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-600/20 text-gray-400',
    sent: 'bg-green-600/20 text-green-400',
    replied: 'bg-blue-600/20 text-blue-400',
    failed: 'bg-red-600/20 text-red-400',
    skipped: 'bg-yellow-600/20 text-yellow-400',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button onClick={onBack} className="text-sm text-purple-400 hover:text-purple-300">Back to Campaigns</button>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-xs bg-muted/50 border border-border rounded px-2 py-1 focus:outline-none">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="replied">Replied</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
          <span className="text-xs text-muted-foreground">{(leads as any[]).length} leads</span>
        </div>
      </div>

      {/* Import buttons */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setImportMode(importMode === 'hashtag' ? 'none' : 'hashtag')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${importMode === 'hashtag' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
          Import from Hashtag
        </button>
        <button onClick={() => setImportMode(importMode === 'competitor' ? 'none' : 'competitor')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${importMode === 'competitor' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
          Import from Competitor
        </button>
        <button onClick={() => setImportMode(importMode === 'manual' ? 'none' : 'manual')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${importMode === 'manual' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
          Add Manually
        </button>
      </div>

      {/* Import forms */}
      {importMode === 'hashtag' && (
        <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
          <input value={hashtagInput} onChange={e => setHashtagInput(e.target.value)}
            placeholder="Enter hashtag (e.g. fitness)" className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
          <button onClick={() => importHashtagMut.mutate()} disabled={importHashtagMut.isPending || !hashtagInput.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {importHashtagMut.isPending ? 'Scraping hashtag...' : 'Import Leads'}
          </button>
          {importHashtagMut.isPending && <p className="text-xs text-muted-foreground">This may take a minute...</p>}
        </div>
      )}

      {importMode === 'competitor' && (
        <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
          <input value={competitorInput} onChange={e => setCompetitorInput(e.target.value)}
            placeholder="Competitor username (e.g. nike)" className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
          <button onClick={() => importCompetitorMut.mutate()} disabled={importCompetitorMut.isPending || !competitorInput.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {importCompetitorMut.isPending ? 'Scraping competitor...' : 'Import Leads'}
          </button>
          {importCompetitorMut.isPending && <p className="text-xs text-muted-foreground">This may take a minute...</p>}
        </div>
      )}

      {importMode === 'manual' && (
        <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
          <textarea value={manualInput} onChange={e => setManualInput(e.target.value)}
            placeholder={"Paste usernames (one per line)\n@username or username"}
            className="w-full h-20 bg-muted/50 border border-border rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-purple-500" />
          <button onClick={() => addManualMut.mutate()} disabled={addManualMut.isPending || !manualInput.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {addManualMut.isPending ? 'Adding...' : 'Add Leads'}
          </button>
        </div>
      )}

      {/* Leads table */}
      {isLoading && <p className="text-sm text-muted-foreground">Loading leads...</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="pb-2 pr-4">Username</th>
              <th className="pb-2 pr-4">Followers</th>
              <th className="pb-2 pr-4">Engagement</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Step</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(leads as any[]).slice(0, 100).map((l: any) => (
              <tr key={l.id} className="border-b border-border/50">
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    {l.profile_pic_url && <img src={l.profile_pic_url} alt="" className="w-6 h-6 rounded-full" />}
                    <span className="font-medium">@{l.username}</span>
                  </div>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{l.followers ? fmt(l.followers) : '-'}</td>
                <td className="py-2 pr-4 text-muted-foreground">{l.engagement_rate ? `${l.engagement_rate}%` : '-'}</td>
                <td className="py-2 pr-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[l.status] || statusColors.pending}`}>{l.status}</span>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{l.current_step || '-'}</td>
                <td className="py-2">
                  {l.status === 'pending' && (
                    <button onClick={() => skipMut.mutate(l.id)} className="text-xs text-yellow-400 hover:text-yellow-300">Skip</button>
                  )}
                  {l.status === 'failed' && l.error_message && (
                    <span className="text-xs text-red-400" title={l.error_message}>Error</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(leads as any[]).length > 100 && (
        <p className="text-xs text-muted-foreground text-center">Showing first 100 of {(leads as any[]).length} leads</p>
      )}
    </div>
  )
}
