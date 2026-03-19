export type Tab = 'pipeline' | 'leads' | 'threads' | 'activity' | 'rules' | 'config'

export const statusColors: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-400',
  enriching: 'bg-blue-500/20 text-blue-400',
  enriched: 'bg-cyan-500/20 text-cyan-400',
  scored: 'bg-purple-500/20 text-purple-400',
  pushed: 'bg-green-500/20 text-green-400',
  meeting_set: 'bg-amber-500/20 text-amber-400',
  subscription_docs_sent: 'bg-indigo-500/20 text-indigo-400',
  committed: 'bg-emerald-500/20 text-emerald-400',
  funded: 'bg-teal-500/20 text-teal-400',
  failed: 'bg-red-500/20 text-red-400',
}

export function getScoreColor(score: number | null | undefined): string {
  if (score == null) return 'bg-gray-500/20 text-gray-400'
  if (score >= 80) return 'bg-red-500/20 text-red-400'
  if (score >= 50) return 'bg-orange-500/20 text-orange-400'
  if (score >= 20) return 'bg-blue-500/20 text-blue-400'
  return 'bg-gray-500/20 text-gray-400'
}

export const coldEmailColors: Record<string, string> = {
  excluded: 'bg-gray-500/20 text-gray-400',
  awaiting_approval: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  pushed: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-red-500/20 text-red-400',
}

export const threadStatusColors: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  escalated: 'bg-orange-500/20 text-orange-400',
  converted: 'bg-blue-500/20 text-blue-400',
  closed: 'bg-gray-500/20 text-gray-400',
}

export const sentimentColors: Record<string, string> = {
  interested: 'text-green-400',
  meeting_request: 'text-blue-400',
  question: 'text-yellow-400',
  not_interested: 'text-red-400',
  unsubscribe: 'text-gray-400',
  out_of_office: 'text-gray-400',
}
