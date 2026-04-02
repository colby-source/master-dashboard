import { useState, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { toast } from 'sonner'

interface OutreachLead {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
  score: number | null
  score_label: string | null
  company_id: number
  company_name: string
  linkedin_url: string
  linkedin_message: string | null
  linkedin_outreach_status: string
  job_title: string
  lead_company: string
  updated_at: string
}

export function OutreachQueueTab() {
  const [statusFilter, setStatusFilter] = useState('queued')
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['linkedin-outreach-queue', statusFilter],
    queryFn: () => api.linkedinOutreachQueue(statusFilter),
    refetchInterval: 15000,
  })

  const markSentMut = useMutation({
    mutationFn: (leadId: number) => api.linkedinOutreachMarkSent(leadId),
    onSuccess: () => { toast.success('Marked as sent'); refetch(); },
    onError: () => toast.error('Failed to mark as sent'),
  })

  const skipMut = useMutation({
    mutationFn: (leadId: number) => api.linkedinOutreachSkip(leadId),
    onSuccess: () => { toast.success('Skipped'); refetch(); },
    onError: () => toast.error('Failed to skip'),
  })

  const regenMut = useMutation({
    mutationFn: (leadId: number) => api.linkedinOutreachRegenerate(leadId),
    onSuccess: () => { toast.success('Message regenerated'); refetch(); },
    onError: () => toast.error('Failed to regenerate'),
  })

  const sendMut = useMutation({
    mutationFn: (leadId: number) => api.linkedinOutreachSend(leadId),
    onSuccess: () => { toast.success('Connection request sent via Apify!'); refetch(); },
    onError: (err: any) => toast.error(err?.message || 'Failed to send connection request'),
  })

  const sendBatchMut = useMutation({
    mutationFn: () => api.linkedinOutreachSendBatch(),
    onSuccess: (data: any) => {
      toast.success(`Batch sent: ${data?.sent || 0} sent, ${data?.failed || 0} failed`);
      refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'Batch send failed'),
  })

  const { data: outreachStatus } = useQuery({
    queryKey: ['linkedin-outreach-status'],
    queryFn: () => api.linkedinOutreachStatus(),
    refetchInterval: 60000,
  })

  const copyMessage = useCallback((lead: OutreachLead) => {
    if (!lead.linkedin_message) return
    navigator.clipboard.writeText(lead.linkedin_message)
    setCopiedId(lead.id)
    toast.success('Message copied to clipboard')
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const openLinkedIn = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const queue: OutreachLead[] = data?.queue ?? []

  const scoreBadge = (label: string | null) => {
    const colors: Record<string, string> = {
      hot: 'bg-red-500/20 text-red-400',
      warm: 'bg-orange-500/20 text-orange-400',
      cold: 'bg-blue-500/20 text-blue-400',
    }
    return colors[label || ''] || 'bg-muted text-muted-foreground'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['queued', 'sending', 'sent', 'skipped'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${statusFilter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/50 text-muted-foreground hover:text-foreground'}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {statusFilter === 'queued' && queue.length > 0 && outreachStatus?.ready && (
            <button onClick={() => sendBatchMut.mutate()}
              disabled={sendBatchMut.isPending}
              className="px-3 py-1 text-xs bg-green-600 text-white rounded-full font-medium hover:bg-green-700 disabled:opacity-50">
              {sendBatchMut.isPending ? 'Sending...' : `Send All (${queue.length})`}
            </button>
          )}
          {!outreachStatus?.ready && statusFilter === 'queued' && (
            <span className="text-[10px] text-yellow-400">Set LINKEDIN_LI_AT in .env to enable auto-send</span>
          )}
          <span className="text-xs text-muted-foreground">{queue.length} leads</span>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading queue...</div>}

      {!isLoading && queue.length === 0 && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No {statusFilter} leads. Hot leads from enrichment will appear here automatically.
        </div>
      )}

      <div className="space-y-2">
        {queue.map(lead => (
          <div key={lead.id} className="bg-muted/30 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {lead.first_name || ''} {lead.last_name || 'Unknown'}
                  </span>
                  {lead.score_label && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase ${scoreBadge(lead.score_label)}`}>
                      {lead.score_label} ({lead.score})
                    </span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {lead.company_name}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {lead.job_title}{lead.lead_company ? ` @ ${lead.lead_company}` : ''}
                </div>
              </div>
            </div>

            {lead.linkedin_message && (
              <div className="bg-background/50 rounded p-2 text-xs text-muted-foreground whitespace-pre-wrap">
                {lead.linkedin_message}
                <div className="text-[10px] text-right mt-1 opacity-50">
                  {lead.linkedin_message.length}/280 chars
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              {lead.linkedin_url && (
                <button onClick={() => openLinkedIn(lead.linkedin_url)}
                  className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded font-medium hover:bg-blue-700">
                  Open LinkedIn
                </button>
              )}
              <button onClick={() => copyMessage(lead)}
                disabled={!lead.linkedin_message}
                className="px-2.5 py-1 text-xs bg-muted text-foreground rounded font-medium hover:bg-muted/80 disabled:opacity-50">
                {copiedId === lead.id ? 'Copied!' : 'Copy Message'}
              </button>
              {statusFilter === 'queued' && (
                <>
                  {outreachStatus?.ready && (
                    <button onClick={() => sendMut.mutate(lead.id)}
                      disabled={sendMut.isPending}
                      className="px-2.5 py-1 text-xs bg-green-600 text-white rounded font-medium hover:bg-green-700 disabled:opacity-50">
                      {sendMut.isPending ? 'Sending...' : 'Send'}
                    </button>
                  )}
                  <button onClick={() => markSentMut.mutate(lead.id)}
                    disabled={markSentMut.isPending}
                    className="px-2.5 py-1 text-xs bg-green-600/20 text-green-400 rounded font-medium hover:bg-green-600/30">
                    Mark Sent
                  </button>
                  <button onClick={() => skipMut.mutate(lead.id)}
                    disabled={skipMut.isPending}
                    className="px-2.5 py-1 text-xs bg-muted/50 text-muted-foreground rounded font-medium hover:bg-muted/80">
                    Skip
                  </button>
                </>
              )}
              <button onClick={() => regenMut.mutate(lead.id)}
                disabled={regenMut.isPending}
                className="px-2.5 py-1 text-xs bg-purple-600/20 text-purple-400 rounded font-medium hover:bg-purple-600/30">
                {regenMut.isPending ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
