import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import {
  Database, XCircle,
  RefreshCw, Clock, Target, TrendingUp, Upload, Download, Users,
} from 'lucide-react'
import { BulkUploadDialog } from '../dialogs/BulkUploadDialog'
import { ImportFromGhlDialog } from '../dialogs/ImportFromGhlDialog'
import type { Tab } from './enrichment/shared'
import { StatBox } from './enrichment/StatBox'
import { PipelineFunnel } from './enrichment/PipelineFunnel'
import { LeadsTab } from './enrichment/LeadsTab'
import { ActivityTab } from './enrichment/ActivityTab'
import { ThreadsTab } from './enrichment/ThreadsTab'
import { RulesTab } from './enrichment/RulesTab'
import { ConfigTab } from './enrichment/ConfigTab'

interface Props {
  companyId?: number
}

export function EnrichmentPanel({ companyId }: Props) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('pipeline')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [scoreFilter, setScoreFilter] = useState<string>('')
  const [coldEmailFilter, setColdEmailFilter] = useState<string>('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [expandedLead, setExpandedLead] = useState<number | null>(null)
  const [selectedLeads, setSelectedLeads] = useState<number[]>([])
  const [selectAllMatching, setSelectAllMatching] = useState(false)
  const [approvalCampaignId, setApprovalCampaignId] = useState('')
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false)
  const [ghlImportOpen, setGhlImportOpen] = useState(false)

  // Queries
  const { data: stats } = useQuery({
    queryKey: ['enrichment-stats', companyId],
    queryFn: () => api.getEnrichmentStats(companyId),
    refetchInterval: 30000,
  })

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['enrichment-leads', companyId, statusFilter, scoreFilter, coldEmailFilter, sourceFilter, tagFilter],
    queryFn: () => api.getEnrichmentLeads({
      company_id: companyId,
      status: statusFilter || undefined,
      score_label: scoreFilter || undefined,
      instantly_push_status: coldEmailFilter || undefined,
      source: sourceFilter || undefined,
      tag: tagFilter || undefined,
      limit: 50,
    }),
  })
  const leads: any[] = (leadsData as any)?.leads ?? []
  const leadsTotal: number = (leadsData as any)?.total ?? 0

  const { data: distinctTags = [] } = useQuery({
    queryKey: ['distinct-tags'],
    queryFn: () => api.getDistinctTags(),
  })

  const { data: eventsData } = useQuery({
    queryKey: ['enrichment-events', companyId],
    queryFn: () => api.getEnrichmentEvents({ company_id: companyId, limit: 30 }),
    enabled: tab === 'activity',
  })
  const events: any[] = Array.isArray(eventsData) ? eventsData : (eventsData as any)?.events ?? []

  const { data: rules = [] } = useQuery({
    queryKey: ['cold-email-rules', companyId],
    queryFn: () => api.getColdEmailRules(companyId),
    enabled: tab === 'rules',
  })

  const { data: knownContacts = [] } = useQuery({
    queryKey: ['known-contacts', companyId],
    queryFn: () => api.getKnownContacts({ company_id: companyId }),
    enabled: tab === 'rules',
  })

  const { data: instantlyCampaigns = [] } = useQuery({
    queryKey: ['instantly-campaigns'],
    queryFn: async () => {
      const res = await api.instantlyCampaigns({ limit: 50 })
      return Array.isArray(res) ? res : (res as any)?.items ?? []
    },
  })

  // Mutations
  const processLead = useMutation({
    mutationFn: (id: number) => api.triggerProcess(id),
    onSuccess: () => { invalidateAll(); toast.success('Lead processed') },
    onError: () => toast.error('Failed to process lead'),
  })

  const enrichLead = useMutation({
    mutationFn: (id: number) => api.triggerEnrich(id),
    onSuccess: () => { invalidateAll(); toast.success('Enrichment triggered') },
    onError: () => toast.error('Failed to enrich lead'),
  })

  const scoreLead = useMutation({
    mutationFn: (id: number) => api.triggerScore(id),
    onSuccess: () => { invalidateAll(); toast.success('Lead scored') },
    onError: () => toast.error('Failed to score lead'),
  })

  const pushGhl = useMutation({
    mutationFn: (id: number) => api.triggerPushGhl(id),
    onSuccess: () => { invalidateAll(); toast.success('Pushed to GHL') },
    onError: () => toast.error('Failed to push to GHL'),
  })

  const approveColdEmail = useMutation({
    mutationFn: ({ id, campaignId }: { id: number; campaignId: string }) =>
      api.approveColdEmail(id, campaignId),
    onSuccess: () => { invalidateAll(); toast.success('Cold email approved') },
    onError: () => toast.error('Failed to approve'),
  })

  const excludeColdEmail = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      api.excludeColdEmail(id, reason),
    onSuccess: () => { invalidateAll(); toast.success('Contact excluded') },
    onError: () => toast.error('Failed to exclude'),
  })

  const bulkApprove = useMutation({
    mutationFn: ({ ids, campaignId }: { ids: number[]; campaignId: string }) =>
      api.bulkApproveColdEmail(ids, campaignId),
    onSuccess: () => { invalidateAll(); setSelectedLeads([]); toast.success('Bulk approval complete') },
    onError: () => toast.error('Bulk approval failed'),
  })

  const bulkEnrich = useMutation({
    mutationFn: (ids: number[]) => api.bulkEnrich(ids),
    onSuccess: () => { invalidateAll(); toast.success('Bulk enrichment started') },
    onError: () => toast.error('Bulk enrichment failed'),
  })

  const reEnrichStale = useMutation({
    mutationFn: () => api.reEnrichStale(companyId),
    onSuccess: () => { invalidateAll(); toast.success('Re-enrichment started') },
    onError: () => toast.error('Re-enrichment failed'),
  })

  const bulkUpdateTags = useMutation({
    mutationFn: ({ ids, tags, mode }: { ids: number[]; tags: string[]; mode: 'add' | 'remove' | 'replace' }) =>
      api.bulkUpdateTags(ids, tags, mode),
    onSuccess: () => { invalidateAll(); queryClient.invalidateQueries({ queryKey: ['distinct-tags'] }); toast.success('Tags updated') },
    onError: () => toast.error('Failed to update tags'),
  })

  const updateLeadTags = useMutation({
    mutationFn: ({ id, tags }: { id: number; tags: string[] }) =>
      api.updateLeadTags(id, tags),
    onSuccess: () => { invalidateAll(); queryClient.invalidateQueries({ queryKey: ['distinct-tags'] }); toast.success('Tags updated') },
    onError: () => toast.error('Failed to update tags'),
  })

  const deleteRule = useMutation({
    mutationFn: (id: number) => api.deleteColdEmailRule(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['cold-email-rules'] }); toast.success('Rule deleted') },
    onError: () => toast.error('Failed to delete rule'),
  })

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['enrichment-leads'] })
    queryClient.invalidateQueries({ queryKey: ['enrichment-stats'] })
    queryClient.invalidateQueries({ queryKey: ['enrichment-events'] })
  }

  function toggleSelect(id: number) {
    setSelectedLeads(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function toggleSelectAll() {
    setSelectAllMatching(false)
    if (selectedLeads.length === leads.length) {
      setSelectedLeads([])
    } else {
      setSelectedLeads(leads.map((l: any) => l.id))
    }
  }

  async function handleSelectAllMatching() {
    try {
      const result = await api.getMatchingLeadIds({
        company_id: companyId,
        status: statusFilter || undefined,
        score_label: scoreFilter || undefined,
        source: sourceFilter || undefined,
        instantly_push_status: coldEmailFilter || undefined,
        tag: tagFilter || undefined,
      })
      setSelectedLeads((result as any).ids)
      setSelectAllMatching(true)
    } catch {
      toast.error('Failed to select all matching')
    }
  }

  function clearSelection() {
    setSelectedLeads([])
    setSelectAllMatching(false)
  }

  const campaigns = Array.isArray(instantlyCampaigns)
    ? instantlyCampaigns
    : (instantlyCampaigns as any)?.items || []

  // Stats (flat keys from API)
  const s = stats || {} as any

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-accent" />
          <h3 className="font-semibold text-lg">Data Enrichment</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGhlImportOpen(true)}
            className="px-2.5 py-1 text-xs rounded bg-accent/20 hover:bg-accent/30 text-accent flex items-center gap-1"
          >
            <Download className="h-3 w-3" /> Import from GHL
          </button>
          <button
            onClick={() => setBulkUploadOpen(true)}
            className="px-2.5 py-1 text-xs rounded bg-primary/20 hover:bg-primary/30 text-primary flex items-center gap-1"
          >
            <Upload className="h-3 w-3" /> Upload CSV
          </button>
          <button
            onClick={() => reEnrichStale.mutate()}
            className="px-2.5 py-1 text-xs rounded bg-muted hover:bg-muted/80 flex items-center gap-1"
            title="Re-enrich stale leads (90+ days)"
          >
            <RefreshCw className="h-3 w-3" /> Refresh Stale
          </button>
          <span className="text-sm text-muted-foreground">{s.total || 0} leads</span>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 mb-4">
        <StatBox label="Pending" value={s.pending || 0} color="text-gray-400" icon={Clock} />
        <StatBox label="Enriched" value={s.enriched || 0} color="text-cyan-400" icon={Database} />
        <StatBox label="Scored" value={s.scored || 0} color="text-purple-400" icon={Target} />
        <StatBox label="Avg Score" value={Math.round(s.avgScore || 0)} color="text-orange-400" icon={TrendingUp} />
        <StatBox label="Meetings" value={s.meetingSet || 0} color="text-amber-400" icon={Users} />
        <StatBox label="Committed" value={s.committed || 0} color="text-emerald-400" icon={Target} />
        <StatBox label="Warm Intros" value={s.warmIntros || 0} color="text-pink-400" icon={Users} />
        <StatBox label="Failed" value={s.failed || 0} color="text-red-400" icon={XCircle} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-md p-0.5 mb-4">
        {(['pipeline', 'leads', 'threads', 'activity', 'rules', 'config'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs rounded capitalize ${tab === t ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'pipeline' && (
        <PipelineFunnel stats={s} />
      )}

      {tab === 'leads' && (
        <LeadsTab
          leads={leads}
          leadsLoading={leadsLoading}
          leadsTotal={leadsTotal}
          selectedLeads={selectedLeads}
          selectAllMatching={selectAllMatching}
          campaigns={campaigns}
          distinctTags={distinctTags as string[]}
          statusFilter={statusFilter}
          scoreFilter={scoreFilter}
          coldEmailFilter={coldEmailFilter}
          sourceFilter={sourceFilter}
          tagFilter={tagFilter}
          expandedLead={expandedLead}
          approvalCampaignId={approvalCampaignId}
          onStatusFilter={setStatusFilter}
          onScoreFilter={setScoreFilter}
          onColdEmailFilter={setColdEmailFilter}
          onSourceFilter={setSourceFilter}
          onTagFilter={setTagFilter}
          onToggleExpand={(id) => setExpandedLead(expandedLead === id ? null : id)}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onSelectAllMatching={handleSelectAllMatching}
          onClearSelection={clearSelection}
          onApprovalCampaignId={setApprovalCampaignId}
          onBulkApprove={() => approvalCampaignId && bulkApprove.mutate({ ids: selectedLeads, campaignId: approvalCampaignId })}
          onBulkEnrich={() => bulkEnrich.mutate(selectedLeads)}
          onBulkUpdateTags={(mode, tags) => bulkUpdateTags.mutate({ ids: selectedLeads, tags, mode })}
          onProcess={(id) => processLead.mutate(id)}
          onEnrich={(id) => enrichLead.mutate(id)}
          onScore={(id) => scoreLead.mutate(id)}
          onPushGhl={(id) => pushGhl.mutate(id)}
          onApprove={(id, campaignId) => approveColdEmail.mutate({ id, campaignId })}
          onExclude={(id, reason) => excludeColdEmail.mutate({ id, reason })}
          onUpdateLeadTags={(id, tags) => updateLeadTags.mutate({ id, tags })}
        />
      )}

      {tab === 'threads' && (
        <ThreadsTab companyId={companyId} />
      )}

      {tab === 'activity' && (
        <ActivityTab events={events} />
      )}

      {tab === 'rules' && (
        <RulesTab
          rules={rules}
          knownContacts={knownContacts}
          companyId={companyId}
          onDeleteRule={(id: number) => deleteRule.mutate(id)}
        />
      )}

      {tab === 'config' && <ConfigTab companyId={companyId} />}

      <BulkUploadDialog open={bulkUploadOpen} onOpenChange={setBulkUploadOpen} companyId={companyId} />
      <ImportFromGhlDialog open={ghlImportOpen} onOpenChange={setGhlImportOpen} companyId={companyId} />
    </div>
  )
}
