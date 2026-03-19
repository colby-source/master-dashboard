import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../../lib/api'
import { timeAgo } from '../../../lib/utils'
import {
  CheckCircle, AlertTriangle,
  ChevronRight, Send,
  Pause, Play, Bot, User, MessageCircle,
} from 'lucide-react'
import { threadStatusColors, sentimentColors } from './shared'
import { StatBox } from './StatBox'

function ThreadDetailView({
  thread, messages, manualReply, onManualReplyChange,
  onSendReply, onUpdateStatus, onBack, sending,
}: {
  thread: any
  messages: any[]
  manualReply: string
  onManualReplyChange: (v: string) => void
  onSendReply: () => void
  onUpdateStatus: (status: string) => void
  onBack: () => void
  sending: boolean
}) {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-accent hover:underline">
          <ChevronRight className="h-3 w-3 rotate-180" /> Back to threads
        </button>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${threadStatusColors[thread?.thread_status] || ''}`}>
            {thread?.thread_status}
          </span>
          {thread?.thread_status === 'active' && (
            <button
              onClick={() => onUpdateStatus('paused')}
              className="p-1 rounded hover:bg-yellow-500/20" title="Pause auto-replies"
            >
              <Pause className="h-3.5 w-3.5 text-yellow-400" />
            </button>
          )}
          {thread?.thread_status === 'paused' && (
            <button
              onClick={() => onUpdateStatus('active')}
              className="p-1 rounded hover:bg-green-500/20" title="Resume auto-replies"
            >
              <Play className="h-3.5 w-3.5 text-green-400" />
            </button>
          )}
          {thread?.thread_status !== 'converted' && thread?.thread_status !== 'closed' && (
            <button
              onClick={() => onUpdateStatus('converted')}
              className="px-2 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500"
            >
              Mark Converted
            </button>
          )}
        </div>
      </div>

      {/* Thread Info */}
      <div className="p-2 bg-muted/30 rounded-lg mb-3 text-sm">
        <div className="flex items-center gap-4">
          <span><strong>Email:</strong> {thread?.email}</span>
          {thread?.last_sentiment && (
            <span className={sentimentColors[thread.last_sentiment] || ''}>
              {thread.last_sentiment?.replace(/_/g, ' ')}
            </span>
          )}
          {thread?.escalation_reason && (
            <span className="text-xs text-orange-400">Escalation: {thread.escalation_reason}</span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="space-y-2 max-h-[350px] overflow-y-auto mb-3 pr-1">
        {messages.length === 0 ? (
          <div className="text-muted-foreground text-sm py-4 text-center">No messages yet</div>
        ) : (
          messages.map((msg: any) => (
            <div
              key={msg.id}
              className={`p-2.5 rounded-lg text-sm ${
                msg.direction === 'inbound'
                  ? 'bg-blue-500/10 border border-blue-500/20 ml-0 mr-8'
                  : 'bg-green-500/10 border border-green-500/20 ml-8 mr-0'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {msg.direction === 'inbound' ? (
                    <><User className="h-3 w-3" /> Prospect</>
                  ) : (
                    <><Bot className="h-3 w-3" /> {msg.generated_by === 'claude' ? 'Auto-Reply' : 'Manual'}</>
                  )}
                  {msg.sentiment && (
                    <span className={`ml-2 ${sentimentColors[msg.sentiment] || ''}`}>
                      {msg.sentiment.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {msg.created_at ? timeAgo(msg.created_at) : ''}
                </span>
              </div>
              <div className="whitespace-pre-wrap">{msg.body}</div>
            </div>
          ))
        )}
      </div>

      {/* Manual Reply */}
      {thread?.thread_status !== 'closed' && (
        <div className="flex gap-2">
          <textarea
            value={manualReply}
            onChange={e => onManualReplyChange(e.target.value)}
            placeholder="Type a manual reply..."
            rows={2}
            className="flex-1 bg-muted border border-border rounded px-3 py-2 text-sm resize-none"
          />
          <button
            onClick={onSendReply}
            disabled={!manualReply.trim() || sending}
            className="px-3 py-2 rounded bg-accent hover:bg-accent/80 disabled:opacity-50 flex items-center gap-1 self-end"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

export function ThreadsTab({ companyId }: { companyId?: number }) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [selectedThread, setSelectedThread] = useState<number | null>(null)
  const [manualReply, setManualReply] = useState('')

  const { data: threadsData } = useQuery({
    queryKey: ['reply-threads', companyId, statusFilter],
    queryFn: () => api.getReplyThreads({
      company_id: companyId,
      status: statusFilter || undefined,
    }),
    refetchInterval: 15000,
  })

  const { data: threadDetail } = useQuery({
    queryKey: ['reply-thread', selectedThread],
    queryFn: () => api.getReplyThread(selectedThread!),
    enabled: !!selectedThread,
    refetchInterval: 10000,
  })

  const { data: autoReplyStats } = useQuery({
    queryKey: ['auto-reply-stats', companyId],
    queryFn: () => api.getAutoReplyStats(companyId),
    refetchInterval: 30000,
  })

  const sendReply = useMutation({
    mutationFn: ({ threadId, body }: { threadId: number; body: string }) =>
      api.sendManualReply(threadId, body),
    onSuccess: () => {
      setManualReply('')
      queryClient.invalidateQueries({ queryKey: ['reply-thread', selectedThread] })
      queryClient.invalidateQueries({ queryKey: ['reply-threads'] })
      toast.success('Reply sent')
    },
    onError: () => toast.error('Failed to send reply'),
  })

  const updateStatus = useMutation({
    mutationFn: ({ threadId, status }: { threadId: number; status: string }) =>
      api.updateThreadStatus(threadId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reply-threads'] })
      queryClient.invalidateQueries({ queryKey: ['reply-thread', selectedThread] })
      toast.success('Status updated')
    },
    onError: () => toast.error('Failed to update status'),
  })

  const threads = (threadsData as any)?.threads || []
  const ars = autoReplyStats || {} as any

  return (
    <div className="space-y-4">
      {/* Auto-Reply Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Active" value={ars.active_threads || 0} color="text-green-400" icon={MessageCircle} />
        <StatBox label="Escalated" value={ars.escalated_threads || 0} color="text-orange-400" icon={AlertTriangle} />
        <StatBox label="Auto-Replies" value={ars.auto_replies_sent || 0} color="text-blue-400" icon={Bot} />
        <StatBox label="Converted" value={ars.converted_threads || 0} color="text-emerald-400" icon={CheckCircle} />
      </div>

      {/* Thread List vs Detail View */}
      {selectedThread && threadDetail ? (
        <ThreadDetailView
          thread={(threadDetail as any).thread}
          messages={(threadDetail as any).messages || []}
          manualReply={manualReply}
          onManualReplyChange={setManualReply}
          onSendReply={() => sendReply.mutate({ threadId: selectedThread, body: manualReply })}
          onUpdateStatus={(status: string) => updateStatus.mutate({ threadId: selectedThread, status })}
          onBack={() => setSelectedThread(null)}
          sending={sendReply.isPending}
        />
      ) : (
        <>
          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-muted border border-border rounded px-2 py-1 text-xs"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="escalated">Escalated</option>
              <option value="paused">Paused</option>
              <option value="converted">Converted</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {/* Thread List */}
          {threads.length === 0 ? (
            <div className="text-muted-foreground text-sm py-8 text-center">
              No reply threads yet. Threads are created when prospects reply to campaigns.
            </div>
          ) : (
            <div className="space-y-1.5">
              {threads.map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedThread(t.id)}
                  className="w-full text-left p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{t.email}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${threadStatusColors[t.thread_status] || ''}`}>
                        {t.thread_status}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t.last_message_at ? timeAgo(t.last_message_at) : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{t.message_count} messages</span>
                    <span>{t.auto_reply_count} auto-replies</span>
                    {t.last_sentiment && (
                      <span className={sentimentColors[t.last_sentiment] || ''}>
                        {t.last_sentiment?.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
