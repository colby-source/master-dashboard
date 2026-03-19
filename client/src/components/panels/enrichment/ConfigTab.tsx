import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../../lib/api'
import {
  Settings, MessageCircle, Target,
} from 'lucide-react'
import { ToggleOption } from './ToggleOption'

export function ConfigTab({ companyId }: { companyId?: number }) {
  const queryClient = useQueryClient()
  const cid = companyId || 1
  const [configSection, setConfigSection] = useState<'enrichment' | 'autoreply' | 'playbook'>('enrichment')

  const { data: config } = useQuery({
    queryKey: ['enrichment-config', cid],
    queryFn: () => api.getEnrichmentConfig(cid),
  })

  const { data: playbook } = useQuery({
    queryKey: ['playbook', cid],
    queryFn: () => api.getPlaybook(cid),
    enabled: configSection === 'playbook',
  })

  const updateConfig = useMutation({
    mutationFn: (data: any) => api.updateEnrichmentConfig(cid, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrichment-config'] })
      toast.success('Configuration saved')
    },
    onError: () => toast.error('Failed to save configuration'),
  })

  const updatePlaybook = useMutation({
    mutationFn: (data: any) => api.updatePlaybook(cid, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbook', cid] })
      toast.success('Playbook saved')
    },
    onError: () => toast.error('Failed to save playbook'),
  })

  const cfg = config || {}
  const pb = playbook || {}

  const allSentiments = ['interested', 'question', 'meeting_request', 'not_interested', 'out_of_office', 'unsubscribe']
  const activeSentiments: string[] = (() => {
    try { return JSON.parse(cfg.auto_reply_sentiments || '["interested","question","meeting_request"]') } catch { return [] }
  })()

  const toggleSentiment = (s: string) => {
    const next = activeSentiments.includes(s)
      ? activeSentiments.filter(x => x !== s)
      : [...activeSentiments, s]
    updateConfig.mutate({ auto_reply_sentiments: JSON.stringify(next) })
  }

  return (
    <div className="space-y-4">
      {/* Section tabs */}
      <div className="flex gap-1 border-b border-border pb-2">
        {(['enrichment', 'autoreply', 'playbook'] as const).map(s => (
          <button key={s} onClick={() => setConfigSection(s)}
            className={`px-3 py-1 text-xs rounded-t font-medium transition-colors ${configSection === s ? 'bg-accent/20 text-accent border-b-2 border-accent' : 'text-muted-foreground hover:text-foreground'}`}>
            {s === 'enrichment' ? 'Enrichment' : s === 'autoreply' ? 'Auto-Reply' : 'Playbook'}
          </button>
        ))}
      </div>

      {/* Enrichment Config */}
      {configSection === 'enrichment' && (
        <div className="space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-1">
            <Settings className="h-4 w-4 text-muted-foreground" /> Enrichment Configuration
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ToggleOption label="Enrichment Enabled" value={cfg.enabled === 1}
              onChange={v => updateConfig.mutate({ enabled: v ? 1 : 0 })} />
            <ToggleOption label="Auto-Enrich on Webhook" value={cfg.auto_enrich === 1}
              onChange={v => updateConfig.mutate({ auto_enrich: v ? 1 : 0 })} />
            <ToggleOption label="Auto-Push to GHL" value={cfg.auto_push_ghl === 1}
              onChange={v => updateConfig.mutate({ auto_push_ghl: v ? 1 : 0 })} />
            <ToggleOption label="Cold Email Requires Approval" value={cfg.cold_email_requires_approval === 1}
              onChange={v => updateConfig.mutate({ cold_email_requires_approval: v ? 1 : 0 })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">Hot Score Threshold</label>
              <input type="number" value={cfg.score_threshold_hot ?? 80}
                onChange={e => updateConfig.mutate({ score_threshold_hot: parseFloat(e.target.value) })}
                className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Warm Score Threshold</label>
              <input type="number" value={cfg.score_threshold_warm ?? 50}
                onChange={e => updateConfig.mutate({ score_threshold_warm: parseFloat(e.target.value) })}
                className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">GHL Tag Prefix</label>
            <input type="text" value={cfg.ghl_tag_prefix ?? 'enriched'}
              onChange={e => updateConfig.mutate({ ghl_tag_prefix: e.target.value })}
              className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Custom Scoring Prompt (optional)</label>
            <textarea value={cfg.scoring_prompt ?? ''}
              onChange={e => updateConfig.mutate({ scoring_prompt: e.target.value })}
              rows={4} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1 resize-none"
              placeholder="Leave empty to use the default scoring prompt" />
          </div>
        </div>
      )}

      {/* Auto-Reply Config */}
      {configSection === 'autoreply' && (
        <div className="space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-1">
            <MessageCircle className="h-4 w-4 text-muted-foreground" /> Auto-Reply Settings
          </h4>
          <div className="p-3 bg-muted/30 rounded border border-border">
            <ToggleOption label="Auto-Reply Enabled" value={cfg.auto_reply_enabled === 1}
              onChange={v => updateConfig.mutate({ auto_reply_enabled: v ? 1 : 0 })} />
            <p className="text-xs text-muted-foreground mt-2">
              When enabled, Claude will automatically generate and send intelligent replies to prospect responses matching the selected sentiments.
            </p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground font-medium">Auto-Reply Sentiments</label>
            <p className="text-xs text-muted-foreground mb-2">Select which reply sentiments trigger an automatic response:</p>
            <div className="grid grid-cols-2 gap-2">
              {allSentiments.map(s => (
                <label key={s} className="flex items-center gap-2 p-2 bg-muted/20 rounded cursor-pointer hover:bg-muted/40 transition-colors">
                  <input type="checkbox" checked={activeSentiments.includes(s)} onChange={() => toggleSentiment(s)}
                    className="rounded border-border" />
                  <span className="text-sm capitalize">{s.replace(/_/g, ' ')}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
            <p className="text-xs text-yellow-400">
              Replies are delayed 2-5 minutes to feel natural. After reaching the max auto-replies per thread, the system escalates to a human.
            </p>
          </div>
        </div>
      )}

      {/* Playbook Editor */}
      {configSection === 'playbook' && (
        <div className="space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-1">
            <Target className="h-4 w-4 text-muted-foreground" /> Company Playbook
          </h4>
          {!pb.id ? (
            <p className="text-sm text-muted-foreground">No playbook configured for this company.</p>
          ) : (
            <>
              <div>
                <label className="text-xs text-muted-foreground font-medium">Company Description</label>
                <textarea value={pb.company_description || ''} rows={3}
                  onChange={e => updatePlaybook.mutate({ company_description: e.target.value })}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1 resize-none" />
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium">Tone</label>
                <select value={pb.tone || 'professional'}
                  onChange={e => updatePlaybook.mutate({ tone: e.target.value })}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1">
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="authoritative">Authoritative</option>
                  <option value="friendly">Friendly</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium">Target ICP</label>
                <textarea value={pb.target_icp || ''} rows={2}
                  onChange={e => updatePlaybook.mutate({ target_icp: e.target.value })}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1 resize-none" />
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium">Value Propositions (one per line)</label>
                <textarea rows={4}
                  value={(() => { try { return JSON.parse(pb.value_propositions || '[]').join('\n') } catch { return '' } })()}
                  onChange={e => updatePlaybook.mutate({ value_propositions: JSON.stringify(e.target.value.split('\n').filter(Boolean)) })}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1 resize-none"
                  placeholder="One value proposition per line" />
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium">Conversation Goals (one per line)</label>
                <textarea rows={3}
                  value={(() => { try { return JSON.parse(pb.conversation_goals || '[]').join('\n') } catch { return '' } })()}
                  onChange={e => updatePlaybook.mutate({ conversation_goals: JSON.stringify(e.target.value.split('\n').filter(Boolean)) })}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1 resize-none"
                  placeholder="e.g., book_call, send_deck, qualify_interest" />
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium">Escalation Triggers (one per line)</label>
                <textarea rows={3}
                  value={(() => { try { return JSON.parse(pb.escalation_triggers || '[]').join('\n') } catch { return '' } })()}
                  onChange={e => updatePlaybook.mutate({ escalation_triggers: JSON.stringify(e.target.value.split('\n').filter(Boolean)) })}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1 resize-none"
                  placeholder="e.g., legal_questions, specific_meeting_time" />
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium">Do Not Mention (one per line)</label>
                <textarea rows={2}
                  value={(() => { try { return JSON.parse(pb.do_not_mention || '[]').join('\n') } catch { return '' } })()}
                  onChange={e => updatePlaybook.mutate({ do_not_mention: JSON.stringify(e.target.value.split('\n').filter(Boolean)) })}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1 resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Booking URL</label>
                  <input type="text" value={pb.booking_url || ''}
                    onChange={e => updatePlaybook.mutate({ booking_url: e.target.value || null })}
                    className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1"
                    placeholder="https://calendly.com/..." />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Max Auto-Replies</label>
                  <input type="number" value={pb.max_auto_replies ?? 3} min={1} max={10}
                    onChange={e => updatePlaybook.mutate({ max_auto_replies: parseInt(e.target.value) })}
                    className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm mt-1" />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium">Objection Handlers</label>
                <p className="text-xs text-muted-foreground mb-2">JSON map of objections to responses:</p>
                <textarea rows={6}
                  value={(() => { try { return JSON.stringify(JSON.parse(pb.objection_handlers || '{}'), null, 2) } catch { return pb.objection_handlers || '{}' } })()}
                  onChange={e => { try { JSON.parse(e.target.value); updatePlaybook.mutate({ objection_handlers: e.target.value }) } catch { /* wait for valid JSON */ } }}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-xs font-mono mt-1 resize-none" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
