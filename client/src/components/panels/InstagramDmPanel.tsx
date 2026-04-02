import { useState } from 'react'
import { CampaignsTab } from './instagram-dm/CampaignsTab'
import { SequenceTab } from './instagram-dm/SequenceTab'
import { LeadsTab } from './instagram-dm/LeadsTab'
import { LiveFeedTab } from './instagram-dm/LiveFeedTab'

type Tab = 'campaigns' | 'sequence' | 'leads' | 'live'

export function InstagramDmPanel() {
  const [tab, setTab] = useState<Tab>('campaigns')
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null)
  const tabs: { key: Tab; label: string }[] = [
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'sequence', label: 'Sequence Builder' },
    { key: 'leads', label: 'Leads' },
    { key: 'live', label: 'Live Feed' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">Instagram DM Outreach</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-600/20 text-purple-400">Auto DM</span>
        </div>
      </div>
      <div className="flex border-b border-border overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'text-foreground border-b-2 border-purple-500' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'campaigns' && <CampaignsTab selectedId={selectedCampaignId} onSelect={(id) => { setSelectedCampaignId(id); setTab('sequence') }} />}
        {tab === 'sequence' && <SequenceTab campaignId={selectedCampaignId} onBack={() => setTab('campaigns')} />}
        {tab === 'leads' && <LeadsTab campaignId={selectedCampaignId} onBack={() => setTab('campaigns')} />}
        {tab === 'live' && <LiveFeedTab campaignId={selectedCampaignId} />}
      </div>
    </div>
  )
}
