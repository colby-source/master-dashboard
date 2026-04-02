import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { toast } from 'sonner'

interface SequenceTabProps {
  campaignId: number | null
  onBack: () => void
}

export function SequenceTab({ campaignId, onBack }: SequenceTabProps) {
  const queryClient = useQueryClient()
  const [newTemplate, setNewTemplate] = useState('')
  const [newDelay, setNewDelay] = useState(0)

  const { data: steps = [] } = useQuery({
    queryKey: ['ig-dm-steps', campaignId],
    queryFn: () => campaignId ? api.igDmGetSteps(campaignId) : [],
    enabled: !!campaignId,
  })

  const addMut = useMutation({
    mutationFn: () => api.igDmAddStep(campaignId!, newTemplate, newDelay),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ig-dm-steps', campaignId] })
      setNewTemplate('')
      setNewDelay(0)
      toast.success('Step added')
    },
    onError: () => toast.error('Failed to add step'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.igDmDeleteStep(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ig-dm-steps', campaignId] }); toast.success('Step deleted'); },
    onError: () => toast.error('Failed to delete step'),
  })

  if (!campaignId) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">Select a campaign first</p>
        <button onClick={onBack} className="mt-2 text-sm text-purple-400 hover:text-purple-300">Go to Campaigns</button>
      </div>
    )
  }

  const templateVars = ['{{username}}', '{{full_name}}', '{{bio_snippet}}']

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-purple-400 hover:text-purple-300">Back to Campaigns</button>
        <span className="text-xs text-muted-foreground">{(steps as any[]).length} steps</span>
      </div>

      {/* Existing steps */}
      <div className="space-y-3">
        {(steps as any[]).map((s: any, i: number) => (
          <div key={s.id} className="border border-border rounded-lg p-3 bg-muted/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-purple-400">Step {i + 1}</span>
              <div className="flex items-center gap-2">
                {s.delay_hours > 0 && <span className="text-xs text-muted-foreground">Wait {s.delay_hours}h</span>}
                <button onClick={() => deleteMut.mutate(s.id)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
              </div>
            </div>
            <p className="text-sm whitespace-pre-wrap">{s.message_template}</p>
          </div>
        ))}
      </div>

      {/* Add new step */}
      <div className="border border-dashed border-border rounded-lg p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Add New Step</p>
        <div className="flex gap-2 flex-wrap">
          {templateVars.map(v => (
            <button key={v} onClick={() => setNewTemplate(prev => prev + v)}
              className="px-2 py-1 text-xs bg-purple-600/20 text-purple-400 rounded hover:bg-purple-600/30">
              {v}
            </button>
          ))}
        </div>
        <textarea value={newTemplate} onChange={e => setNewTemplate(e.target.value)}
          placeholder={"Hey {{full_name}}! I noticed you're into..."}
          className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-purple-500" />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Delay after previous step:</label>
            <input type="number" value={newDelay} onChange={e => setNewDelay(parseInt(e.target.value) || 0)}
              className="w-20 bg-muted/50 border border-border rounded p-1 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
            <span className="text-xs text-muted-foreground">hours</span>
          </div>
          <button onClick={() => addMut.mutate()} disabled={addMut.isPending || !newTemplate.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {addMut.isPending ? 'Adding...' : 'Add Step'}
          </button>
        </div>
      </div>
    </div>
  )
}
