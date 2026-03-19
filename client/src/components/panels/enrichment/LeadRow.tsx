import { useState } from 'react'
import { timeAgo } from '../../../lib/utils'
import {
  CheckCircle, AlertTriangle,
  ChevronDown, ChevronRight, RefreshCw,
  Send, Ban, Zap, Target, MailCheck,
} from 'lucide-react'
import { statusColors, getScoreColor, coldEmailColors } from './shared'
import { TagEditor } from './TagEditor'

function EnrichmentDataPreview({ data }: { data: any }) {
  if (!data) return null

  const person = data.person || data
  const company = data.company || person.job_company || {}

  return (
    <div className="text-xs space-y-1 text-muted-foreground">
      {person.job_title && <div><span className="text-foreground">Title:</span> {person.job_title}</div>}
      {(company.name || person.job_company_name) && (
        <div><span className="text-foreground">Company:</span> {company.name || person.job_company_name}</div>
      )}
      {person.industry && <div><span className="text-foreground">Industry:</span> {person.industry}</div>}
      {person.location_name && <div><span className="text-foreground">Location:</span> {person.location_name}</div>}
      {person.linkedin_url && <div><span className="text-foreground">LinkedIn:</span> <a href={person.linkedin_url} target="_blank" rel="noopener" className="text-accent hover:underline">{person.linkedin_url.split('/in/')[1] || person.linkedin_url}</a></div>}
    </div>
  )
}

export function LeadRow({
  lead, expanded, selected, campaigns, onToggleExpand, onToggleSelect,
  onProcess, onEnrich, onScore, onPushGhl, onApprove, onExclude, onUpdateTags,
}: {
  lead: any
  expanded: boolean
  selected: boolean
  campaigns: any[]
  onToggleExpand: () => void
  onToggleSelect: () => void
  onProcess: () => void
  onEnrich: () => void
  onScore: () => void
  onPushGhl: () => void
  onApprove: (campaignId: string) => void
  onExclude: (reason?: string) => void
  onUpdateTags: (tags: string[]) => void
}) {
  const [campaignId, setCampaignId] = useState('')
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || '—'

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-muted/30">
        <td className="py-2 pr-2">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} className="rounded" />
        </td>
        <td className="py-2 pr-4">
          <button onClick={onToggleExpand} className="flex items-center gap-1 hover:text-accent">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span className="font-medium">{name}</span>
          </button>
        </td>
        <td className="py-2 pr-4 text-muted-foreground">{lead.email || '—'}</td>
        <td className="py-2 pr-4">
          <span className="text-xs text-muted-foreground">{lead.source}</span>
        </td>
        <td className="py-2 pr-4">
          {lead.score != null ? (
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${getScoreColor(lead.score)}`}>
              {lead.score}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-2 pr-4">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[lead.status] || ''}`}>
            {lead.status}
          </span>
        </td>
        <td className="py-2 pr-4">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${coldEmailColors[lead.instantly_push_status] || ''}`}>
            {(lead.instantly_push_status || '').replace(/_/g, ' ')}
          </span>
        </td>
        <td className="py-2">
          <div className="flex items-center gap-1">
            {lead.status === 'pending' && (
              <button onClick={onProcess} className="p-1 rounded hover:bg-accent/20" title="Process (enrich + score)">
                <Zap className="h-3.5 w-3.5 text-accent" />
              </button>
            )}
            {lead.status === 'enriched' && (
              <button onClick={onScore} className="p-1 rounded hover:bg-purple-500/20" title="Score lead">
                <Target className="h-3.5 w-3.5 text-purple-400" />
              </button>
            )}
            {lead.status === 'scored' && lead.ghl_push_status !== 'pushed' && (
              <button onClick={onPushGhl} className="p-1 rounded hover:bg-green-500/20" title="Push to GHL">
                <Send className="h-3.5 w-3.5 text-green-400" />
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded Details */}
      {expanded && (
        <tr>
          <td colSpan={8} className="p-3 bg-muted/20 border-b border-border">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Lead Details */}
              <div>
                <h5 className="text-xs text-muted-foreground uppercase mb-2">Lead Details</h5>
                <div className="space-y-1 text-sm">
                  <div><span className="text-muted-foreground">Phone:</span> {lead.phone || '—'}</div>
                  <div><span className="text-muted-foreground">GHL ID:</span> {lead.ghl_contact_id}</div>
                  <div><span className="text-muted-foreground">Known Contact:</span> {lead.is_known_contact ? 'Yes' : 'No'}</div>
                  {lead.referral_source && <div><span className="text-muted-foreground">Referral:</span> <span className="text-pink-400">{lead.referral_source}</span></div>}
                  {lead.introduced_by && <div><span className="text-muted-foreground">Introduced By:</span> {lead.introduced_by}</div>}
                  {lead.enrichment_completeness != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Completeness:</span>
                      <div className="flex-1 max-w-[120px] bg-muted/30 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${lead.enrichment_completeness >= 80 ? 'bg-green-500' : lead.enrichment_completeness >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${lead.enrichment_completeness}%` }}
                        />
                      </div>
                      <span className="text-xs">{lead.enrichment_completeness}%</span>
                    </div>
                  )}
                  <div><span className="text-muted-foreground">Created:</span> {lead.created_at ? timeAgo(lead.created_at) : '—'}</div>
                  {lead.enriched_at && <div><span className="text-muted-foreground">Enriched:</span> {timeAgo(lead.enriched_at)}</div>}
                  {lead.scored_at && <div><span className="text-muted-foreground">Scored:</span> {timeAgo(lead.scored_at)}</div>}
                </div>

                {/* Scoring Reasoning */}
                {lead.score_reasoning && (
                  <div className="mt-3">
                    <h5 className="text-xs text-muted-foreground uppercase mb-1">Scoring Reasoning</h5>
                    <p className="text-sm text-muted-foreground">{lead.score_reasoning}</p>
                  </div>
                )}

                {/* Tags */}
                <div className="mt-3">
                  <h5 className="text-xs text-muted-foreground uppercase mb-1">Tags</h5>
                  <TagEditor
                    tags={(() => {
                      try {
                        return typeof lead.tags === 'string' ? JSON.parse(lead.tags) : (lead.tags || [])
                      } catch { return [] }
                    })()}
                    onUpdateTags={onUpdateTags}
                  />
                </div>
              </div>

              {/* Cold Email Controls */}
              <div>
                <h5 className="text-xs text-muted-foreground uppercase mb-2">Cold Email Routing</h5>
                {lead.instantly_push_status === 'awaiting_approval' && (
                  <div className="space-y-2">
                    <select
                      value={campaignId}
                      onChange={e => setCampaignId(e.target.value)}
                      className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">Select campaign to approve...</option>
                      {campaigns.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={() => campaignId && onApprove(campaignId)}
                        disabled={!campaignId}
                        className="flex-1 px-3 py-1.5 text-xs rounded bg-green-600 hover:bg-green-500 disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        <CheckCircle className="h-3 w-3" /> Approve for Campaign
                      </button>
                      <button
                        onClick={() => onExclude('manual')}
                        className="px-3 py-1.5 text-xs rounded bg-gray-600 hover:bg-gray-500 flex items-center gap-1"
                      >
                        <Ban className="h-3 w-3" /> Exclude
                      </button>
                    </div>
                  </div>
                )}
                {lead.instantly_push_status === 'excluded' && (
                  <div className="text-sm text-muted-foreground">
                    <Ban className="h-4 w-4 inline mr-1" /> Excluded from cold email
                  </div>
                )}
                {lead.instantly_push_status === 'approved' && (
                  <div className="text-sm text-green-400">
                    <CheckCircle className="h-4 w-4 inline mr-1" /> Approved — {lead.instantly_campaign_id || 'pending push'}
                  </div>
                )}
                {lead.instantly_push_status === 'pushed' && (
                  <div className="text-sm text-emerald-400">
                    <MailCheck className="h-4 w-4 inline mr-1" /> Pushed to campaign
                  </div>
                )}

                {/* Enrichment Data Preview */}
                {lead.enrichment_data && (
                  <div className="mt-3">
                    <h5 className="text-xs text-muted-foreground uppercase mb-1">Enrichment Data</h5>
                    <EnrichmentDataPreview data={(() => { try { return typeof lead.enrichment_data === 'string' ? JSON.parse(lead.enrichment_data) : lead.enrichment_data } catch { return null } })()} />
                  </div>
                )}

                {/* Re-actions */}
                <div className="mt-3 flex gap-2">
                  <button onClick={onEnrich} className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" /> Re-enrich
                  </button>
                  <button onClick={onScore} className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 flex items-center gap-1">
                    <Target className="h-3 w-3" /> Re-score
                  </button>
                </div>
              </div>
            </div>

            {/* Error */}
            {lead.error_message && (
              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 inline mr-1" /> {lead.error_message}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
