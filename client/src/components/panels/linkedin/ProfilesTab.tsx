import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { toast } from 'sonner'
import { ErrorBox, ResultsList } from './shared'

export function ProfilesTab() {
  const [urls, setUrls] = useState('')
  const [results, setResults] = useState<any[] | null>(null)

  const scrapeMut = useMutation({
    mutationFn: () => {
      const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean)
      return api.linkedinScrapeProfiles(urlList)
    },
    onSuccess: (data) => {
      const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? []
      setResults(items)
      toast.success('Profiles scraped')
    },
    onError: () => toast.error('Scraping failed'),
  })

  return (
    <div className="space-y-4">
      <textarea value={urls} onChange={e => setUrls(e.target.value)}
        placeholder="Paste LinkedIn profile URLs (one per line)&#10;https://www.linkedin.com/in/username"
        className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
      <div className="flex items-center gap-3">
        <button onClick={() => scrapeMut.mutate()} disabled={scrapeMut.isPending || !urls.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {scrapeMut.isPending ? 'Scraping...' : 'Scrape Profiles'}
        </button>
        {scrapeMut.isPending && <span className="text-xs text-muted-foreground">This may take 1-2 minutes...</span>}
      </div>
      {scrapeMut.error && <ErrorBox message={(scrapeMut.error as any).message} />}
      {results && <ResultsList data={results} type="profile" />}
    </div>
  )
}
