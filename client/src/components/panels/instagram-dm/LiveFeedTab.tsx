import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { toast } from 'sonner'

interface LiveFeedTabProps {
  campaignId: number | null
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-muted/20">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

export function LiveFeedTab({ campaignId }: LiveFeedTabProps) {
  const queryClient = useQueryClient()
  const [events, setEvents] = useState<Array<{ type: string; message: string; timestamp: string }>>([])
  const feedRef = useRef<HTMLDivElement>(null)

  const { data: stats } = useQuery({
    queryKey: ['ig-dm-stats', campaignId],
    queryFn: () => campaignId ? api.igDmGetStats(campaignId) : null,
    enabled: !!campaignId,
    refetchInterval: 5000,
  })

  const { data: campaign } = useQuery({
    queryKey: ['ig-dm-campaign', campaignId],
    queryFn: () => campaignId ? api.igDmGetCampaign(campaignId) : null,
    enabled: !!campaignId,
    refetchInterval: 5000,
  })

  const startMut = useMutation({
    mutationFn: () => api.igDmStartCampaign(campaignId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-campaign', campaignId] }); toast.success('Campaign started'); },
    onError: () => toast.error('Failed to start'),
  })

  const pauseMut = useMutation({
    mutationFn: () => api.igDmPauseCampaign(campaignId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-campaign', campaignId] }); toast.success('Campaign paused'); },
    onError: () => toast.error('Failed to pause'),
  })

  // Listen for WebSocket events
  const addEvent = useCallback((ev: { type: string; message: string }) => {
    setEvents(prev => [{ ...ev, timestamp: new Date().toLocaleTimeString() }, ...prev].slice(0, 200))
  }, [])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'ig_dm_progress' || data.type === 'ig_dm_sent' || data.type === 'ig_dm_error') {
        if (!campaignId || data.campaignId === campaignId) {
          addEvent({ type: data.type, message: data.message || data.error || 'Event received' })
          queryClient.invalidateQueries({ queryKey: ['ig-dm-stats', campaignId] })
          queryClient.invalidateQueries({ queryKey: ['ig-dm-leads', campaignId] })
        }
      }
    }

    return () => ws.close()
  }, [campaignId, addEvent, queryClient])

  const st = stats as any
  const camp = campaign as any

  return (
    <div className="space-y-4">
      {!campaignId ? (
        <p className="text-sm text-muted-foreground text-center py-8">Select a campaign to see live activity</p>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Pending" value={st?.pending ?? 0} color="text-gray-400" />
            <StatCard label="Sent" value={st?.sent ?? 0} color="text-green-400" />
            <StatCard label="Replied" value={st?.replied ?? 0} color="text-blue-400" />
            <StatCard label="Reply Rate" value={`${st?.replyRate ?? 0}%`} color="text-purple-400" />
          </div>

          {/* Progress bar */}
          {st && st.total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>{st.sent + st.replied + st.failed + st.skipped} / {st.total}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-purple-500 h-2 rounded-full transition-all" style={{
                  width: `${Math.round(((st.sent + st.replied + st.failed + st.skipped) / st.total) * 100)}%`
                }} />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {camp?.status !== 'active' ? (
              <button onClick={() => startMut.mutate()} disabled={startMut.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                {startMut.isPending ? 'Starting...' : 'Start Campaign'}
              </button>
            ) : (
              <button onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 disabled:opacity-50">
                {pauseMut.isPending ? 'Pausing...' : 'Pause Campaign'}
              </button>
            )}
            <span className={`flex items-center text-xs px-3 py-1 rounded-full ${camp?.status === 'active' ? 'bg-green-600/20 text-green-400' : 'bg-gray-600/20 text-gray-400'}`}>
              {camp?.status || 'draft'}
            </span>
          </div>

          {/* Live event feed */}
          <div className="border border-border rounded-lg">
            <div className="px-3 py-2 border-b border-border flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium">Live Activity</span>
            </div>
            <div ref={feedRef} className="max-h-64 overflow-y-auto p-3 space-y-1">
              {events.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No activity yet. Start the campaign to see live updates.</p>
              )}
              {events.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0">{ev.timestamp}</span>
                  <span className={ev.type === 'ig_dm_error' ? 'text-red-400' : ev.type === 'ig_dm_sent' ? 'text-green-400' : 'text-foreground'}>
                    {ev.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
