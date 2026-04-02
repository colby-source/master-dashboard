import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { toast } from 'sonner'
import { ErrorBox, ResultsList } from './shared'

export function JobsTab() {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [results, setResults] = useState<any[] | null>(null)

  const searchMut = useMutation({
    mutationFn: () => api.linkedinScrapeJobs(query, location || undefined),
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Jobs found')
    },
    onError: () => toast.error('Search failed'),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder='Job title or keywords (e.g. "Marketing Manager")'
          className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        <input type="text" value={location} onChange={e => setLocation(e.target.value)}
          placeholder="Location (optional)"
          className="w-40 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <button onClick={() => searchMut.mutate()} disabled={searchMut.isPending || !query.trim()}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
        {searchMut.isPending ? 'Searching...' : 'Search Jobs'}
      </button>
      {searchMut.error && <ErrorBox message={(searchMut.error as any).message} />}
      {results && <ResultsList data={results} type="job" />}
    </div>
  )
}
