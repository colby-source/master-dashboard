import { useState } from 'react'
import { OutreachQueueTab } from './linkedin/OutreachQueueTab'
import { ProfilesTab } from './linkedin/ProfilesTab'
import { PeopleSearchTab } from './linkedin/PeopleSearchTab'
import { CompaniesTab } from './linkedin/CompaniesTab'
import { JobsTab } from './linkedin/JobsTab'

type Tab = 'outreach' | 'profiles' | 'people-search' | 'companies' | 'jobs'

export function LinkedInPanel() {
  const [tab, setTab] = useState<Tab>('outreach')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'outreach', label: 'Outreach Queue' },
    { key: 'profiles', label: 'Profile Scraper' },
    { key: 'people-search', label: 'People Search' },
    { key: 'companies', label: 'Companies' },
    { key: 'jobs', label: 'Job Search' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">LinkedIn</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400">via Apify</span>
        </div>
      </div>
      <div className="flex border-b border-border overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'outreach' && <OutreachQueueTab />}
        {tab === 'profiles' && <ProfilesTab />}
        {tab === 'people-search' && <PeopleSearchTab />}
        {tab === 'companies' && <CompaniesTab />}
        {tab === 'jobs' && <JobsTab />}
      </div>
    </div>
  )
}
