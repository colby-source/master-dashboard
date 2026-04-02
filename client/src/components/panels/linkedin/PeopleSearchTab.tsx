import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { toast } from 'sonner'
import { ErrorBox, ResultsList } from './shared'

export function PeopleSearchTab() {
  const [query, setQuery] = useState('')
  const [maxResults, setMaxResults] = useState('25')
  const [results, setResults] = useState<any[] | null>(null)

  const searchMut = useMutation({
    mutationFn: () => api.linkedinSearchPeople(query, parseInt(maxResults)),
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Search complete')
    },
    onError: () => toast.error('Search failed'),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder='Search query (e.g. "VP Sales SaaS New York")'
          className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        <input type="number" value={maxResults} onChange={e => setMaxResults(e.target.value)}
          placeholder="Max"
          className="w-20 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => searchMut.mutate()} disabled={searchMut.isPending || !query.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {searchMut.isPending ? 'Searching...' : 'Search People'}
        </button>
        {searchMut.isPending && <span className="text-xs text-muted-foreground">This may take 1-3 minutes...</span>}
      </div>
      {searchMut.error && <ErrorBox message={(searchMut.error as any).message} />}
      {results && <ResultsList data={results} type="profile" />}
    </div>
  )
}
