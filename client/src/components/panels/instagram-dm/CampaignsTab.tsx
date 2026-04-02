import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { toast } from 'sonner'

interface CampaignsTabProps {
  selectedId: number | null
  onSelect: (id: number) => void
}

export function CampaignsTab({ selectedId, onSelect }: CampaignsTabProps) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', daily_limit: 20, delay_min: 60, delay_max: 180, ig_session_cookie: '' })

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['ig-dm-campaigns'],
    queryFn: () => api.igDmGetCampaigns(),
  })

  const createMut = useMutation({
    mutationFn: () => api.igDmCreateCampaign(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-campaigns'] })
      setShowForm(false)
      setForm({ name: '', daily_limit: 20, delay_min: 60, delay_max: 180, ig_session_cookie: '' })
      toast.success('Campaign created')
    },
    onError: () => toast.error('Failed to create campaign'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.igDmDeleteCampaign(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-campaigns'] }); toast.success('Campaign deleted'); },
    onError: () => toast.error('Failed to delete'),
  })

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-600/20 text-gray-400',
      active: 'bg-green-600/20 text-green-400',
      paused: 'bg-yellow-600/20 text-yellow-400',
      completed: 'bg-blue-600/20 text-blue-400',
    }
    return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || colors.draft}`}>{status}</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{(campaigns as any[]).length} campaigns</span>
        <button onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">
          {showForm ? 'Cancel' : '+ New Campaign'}
        </button>
      </div>

      {showForm && (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Campaign name" className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Daily Limit</label>
              <input type="number" value={form.daily_limit} onChange={e => setForm({ ...form, daily_limit: parseInt(e.target.value) || 20 })}
                className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Min Delay (s)</label>
              <input type="number" value={form.delay_min} onChange={e => setForm({ ...form, delay_min: parseInt(e.target.value) || 60 })}
                className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Max Delay (s)</label>
              <input type="number" value={form.delay_max} onChange={e => setForm({ ...form, delay_max: parseInt(e.target.value) || 180 })}
                className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Instagram Session Cookie</label>
            <input value={form.ig_session_cookie} onChange={e => setForm({ ...form, ig_session_cookie: e.target.value })}
              placeholder="Paste your IG session cookie (sessionid=...)" type="password"
              className="w-full bg-muted/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
          </div>
          <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.name.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {createMut.isPending ? 'Creating...' : 'Create Campaign'}
          </button>
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading campaigns...</p>}

      <div className="space-y-2">
        {(campaigns as any[]).map((c: any) => (
          <div key={c.id} className={`border rounded-lg p-3 cursor-pointer transition-colors ${selectedId === c.id ? 'border-purple-500 bg-purple-500/5' : 'border-border hover:border-purple-500/50'}`}
            onClick={() => onSelect(c.id)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{c.name}</span>
                {statusBadge(c.status)}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{c.total_sent} sent / {c.total_replies} replies</span>
                <button onClick={e => { e.stopPropagation(); deleteMut.mutate(c.id) }}
                  className="text-xs text-red-400 hover:text-red-300 px-1">Del</button>
              </div>
            </div>
            {c.lead_source && (
              <p className="text-xs text-muted-foreground mt-1">
                Source: {c.lead_source === 'hashtag' ? '#' : '@'}{c.lead_source_value}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
