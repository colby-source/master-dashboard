import { Send, Zap } from 'lucide-react'
import { LeadRow } from './LeadRow'
import { TagBulkActions } from './TagBulkActions'

export function LeadsTab({
  leads, leadsLoading, leadsTotal, selectedLeads, selectAllMatching, campaigns, distinctTags,
  statusFilter, scoreFilter, coldEmailFilter, sourceFilter, tagFilter,
  expandedLead, approvalCampaignId,
  onStatusFilter, onScoreFilter, onColdEmailFilter, onSourceFilter, onTagFilter,
  onToggleExpand, onToggleSelect, onToggleSelectAll,
  onSelectAllMatching, onClearSelection,
  onApprovalCampaignId, onBulkApprove, onBulkEnrich, onBulkUpdateTags,
  onProcess, onEnrich, onScore, onPushGhl, onApprove, onExclude, onUpdateLeadTags,
}: {
  leads: any[]
  leadsLoading: boolean
  leadsTotal: number
  selectedLeads: number[]
  selectAllMatching: boolean
  campaigns: any[]
  distinctTags: string[]
  statusFilter: string
  scoreFilter: string
  coldEmailFilter: string
  sourceFilter: string
  tagFilter: string
  expandedLead: number | null
  approvalCampaignId: string
  onStatusFilter: (v: string) => void
  onScoreFilter: (v: string) => void
  onColdEmailFilter: (v: string) => void
  onSourceFilter: (v: string) => void
  onTagFilter: (v: string) => void
  onToggleExpand: (id: number) => void
  onToggleSelect: (id: number) => void
  onToggleSelectAll: () => void
  onSelectAllMatching: () => void
  onClearSelection: () => void
  onApprovalCampaignId: (v: string) => void
  onBulkApprove: () => void
  onBulkEnrich: () => void
  onBulkUpdateTags: (mode: 'add' | 'remove' | 'replace', tags: string[]) => void
  onProcess: (id: number) => void
  onEnrich: (id: number) => void
  onScore: (id: number) => void
  onPushGhl: (id: number) => void
  onApprove: (id: number, campaignId: string) => void
  onExclude: (id: number, reason?: string) => void
  onUpdateLeadTags: (id: number, tags: string[]) => void
}) {
  const allPageSelected = selectedLeads.length === leads.length && leads.length > 0

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={statusFilter}
          onChange={e => onStatusFilter(e.target.value)}
          className="bg-muted border border-border rounded px-2 py-1 text-xs"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="enriched">Enriched</option>
          <option value="scored">Scored</option>
          <option value="pushed">Pushed</option>
          <option value="meeting_set">Meeting Set</option>
          <option value="subscription_docs_sent">Docs Sent</option>
          <option value="committed">Committed</option>
          <option value="funded">Funded</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={scoreFilter}
          onChange={e => onScoreFilter(e.target.value)}
          className="bg-muted border border-border rounded px-2 py-1 text-xs"
        >
          <option value="">All Scores</option>
          <option value="hot">80+ (High)</option>
          <option value="warm">50-79 (Medium)</option>
          <option value="cold">20-49 (Low)</option>
          <option value="disqualified">0-19 (Very Low)</option>
        </select>
        <select
          value={coldEmailFilter}
          onChange={e => onColdEmailFilter(e.target.value)}
          className="bg-muted border border-border rounded px-2 py-1 text-xs"
        >
          <option value="">All Cold Email</option>
          <option value="awaiting_approval">Awaiting Approval</option>
          <option value="approved">Approved</option>
          <option value="excluded">Excluded</option>
          <option value="pushed">Pushed</option>
        </select>
        <select
          value={sourceFilter}
          onChange={e => onSourceFilter(e.target.value)}
          className="bg-muted border border-border rounded px-2 py-1 text-xs"
        >
          <option value="">All Sources</option>
          <option value="csv_import">CSV Upload</option>
          <option value="ghl_import">GHL Import</option>
          <option value="manual">Manual</option>
          <option value="meta">Meta</option>
          <option value="rb2b">RB2B</option>
          <option value="webhook">Webhook</option>
        </select>
        {distinctTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={e => onTagFilter(e.target.value)}
            className="bg-muted border border-border rounded px-2 py-1 text-xs"
          >
            <option value="">All Tags</option>
            {distinctTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        )}
      </div>

      {/* Select All Matching Banner */}
      {allPageSelected && !selectAllMatching && leadsTotal > leads.length && (
        <div className="text-center py-2 mb-3 bg-accent/10 rounded-lg text-xs text-accent">
          All {leads.length} leads on this page are selected.{' '}
          <button onClick={onSelectAllMatching} className="underline font-medium hover:text-accent/80">
            Select all {leadsTotal} matching this filter
          </button>
        </div>
      )}
      {selectAllMatching && (
        <div className="text-center py-2 mb-3 bg-accent/10 rounded-lg text-xs text-accent">
          All {selectedLeads.length} matching leads are selected.{' '}
          <button onClick={onClearSelection} className="underline font-medium hover:text-accent/80">
            Clear selection
          </button>
        </div>
      )}

      {/* Bulk Actions */}
      {selectedLeads.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2 p-2 bg-accent/10 rounded-lg">
            <span className="text-xs text-accent">{selectedLeads.length} selected</span>
            <select
              value={approvalCampaignId}
              onChange={e => onApprovalCampaignId(e.target.value)}
              className="bg-muted border border-border rounded px-2 py-1 text-xs flex-1 max-w-xs"
            >
              <option value="">Select campaign...</option>
              {campaigns.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={onBulkApprove}
              disabled={!approvalCampaignId}
              className="px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-500 disabled:opacity-50 flex items-center gap-1"
            >
              <Send className="h-3 w-3" /> Approve
            </button>
            <button
              onClick={onBulkEnrich}
              className="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 flex items-center gap-1"
            >
              <Zap className="h-3 w-3" /> Enrich
            </button>
          </div>
          <div className="mb-3">
            <TagBulkActions
              selectedCount={selectedLeads.length}
              onBulkUpdateTags={onBulkUpdateTags}
            />
          </div>
        </>
      )}

      {/* Lead Table */}
      {leadsLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading leads...</div>
      ) : leads.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">No leads found</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border text-left">
                <th className="py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={onToggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Score</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Cold Email</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead: any) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  expanded={expandedLead === lead.id}
                  selected={selectedLeads.includes(lead.id)}
                  campaigns={campaigns}
                  onToggleExpand={() => onToggleExpand(lead.id)}
                  onToggleSelect={() => onToggleSelect(lead.id)}
                  onProcess={() => onProcess(lead.id)}
                  onEnrich={() => onEnrich(lead.id)}
                  onScore={() => onScore(lead.id)}
                  onPushGhl={() => onPushGhl(lead.id)}
                  onApprove={(campaignId: string) => onApprove(lead.id, campaignId)}
                  onExclude={(reason?: string) => onExclude(lead.id, reason)}
                  onUpdateTags={(tags: string[]) => onUpdateLeadTags(lead.id, tags)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
