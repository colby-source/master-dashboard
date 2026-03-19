import { coldEmailColors } from './shared'

export function PipelineFunnel({ stats: s }: { stats: any }) {
  const total = s.total || 0
  const stages = [
    { label: 'Received', value: total, color: 'bg-gray-500' },
    { label: 'Enriched', value: (s.enriched || 0) + (s.scored || 0), color: 'bg-cyan-500' },
    { label: 'Scored', value: s.scored || 0, color: 'bg-purple-500' },
    { label: 'GHL Pushed', value: s.pushedToGhl || 0, color: 'bg-green-500' },
    { label: 'Meeting Set', value: s.meetingSet || 0, color: 'bg-amber-500' },
    { label: 'Docs Sent', value: s.subscriptionDocsSent || 0, color: 'bg-indigo-500' },
    { label: 'Committed', value: s.committed || 0, color: 'bg-emerald-500' },
    { label: 'Funded', value: s.funded || 0, color: 'bg-teal-500' },
  ]

  const maxVal = Math.max(...stages.map(st => st.value), 1)

  const scoreRanges = [
    { label: '80-100', count: s.scoreHigh || 0, color: 'bg-red-500/20 text-red-400' },
    { label: '50-79', count: s.scoreMedium || 0, color: 'bg-orange-500/20 text-orange-400' },
    { label: '20-49', count: s.scoreLow || 0, color: 'bg-blue-500/20 text-blue-400' },
    { label: '0-19', count: s.scoreVeryLow || 0, color: 'bg-gray-500/20 text-gray-400' },
  ]

  const coldEmailStatuses = [
    { key: 'awaiting_approval', count: s.awaitingApproval || 0 },
    { key: 'approved', count: 0 },
    { key: 'pushed', count: s.pushedToInstantly || 0 },
    { key: 'excluded', count: s.excludedFromCold || 0 },
  ]

  return (
    <div className="space-y-4">
      {/* Funnel */}
      <div className="space-y-2">
        <h4 className="text-xs text-muted-foreground uppercase tracking-wider">Pipeline Funnel</h4>
        {stages.map((stage) => (
          <div key={stage.label} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-20 text-right">{stage.label}</span>
            <div className="flex-1 bg-muted/30 rounded-full h-6 overflow-hidden">
              <div
                className={`${stage.color} h-full rounded-full flex items-center justify-end pr-2 transition-all`}
                style={{ width: `${Math.max((stage.value / maxVal) * 100, 5)}%` }}
              >
                <span className="text-xs font-medium text-white">{stage.value}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Score Distribution + Cold Email + Warm Intros */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Score Distribution {s.avgScore ? `(avg: ${Math.round(s.avgScore)})` : ''}
          </h4>
          <div className="space-y-1.5">
            {scoreRanges.map(range => (
              <div key={range.label} className="flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${range.color}`}>{range.label}</span>
                <span className="text-sm font-medium">{range.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Cold Email Status</h4>
          <div className="space-y-1.5">
            {coldEmailStatuses.map(item => (
              <div key={item.key} className="flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${coldEmailColors[item.key]}`}>
                  {item.key.replace(/_/g, ' ')}
                </span>
                <span className="text-sm font-medium">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Warm Intros</h4>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-pink-500/20 text-pink-400">referral leads</span>
              <span className="text-sm font-medium">{s.warmIntros || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400">known contacts</span>
              <span className="text-sm font-medium">{s.knownContacts || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
