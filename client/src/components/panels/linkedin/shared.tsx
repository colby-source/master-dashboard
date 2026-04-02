import { useState } from 'react'

export function ErrorBox({ message }: { message: string }) {
  return <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{message}</div>
}

export function ResultsList({ data, type }: { data: any[]; type: 'profile' | 'company' | 'job' }) {
  const [expanded, setExpanded] = useState<number | null>(null)

  if (data.length === 0) return <div className="text-sm text-muted-foreground">No results found.</div>

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{data.length} results</div>
      {data.map((item, i) => (
        <div key={i} className="bg-muted/30 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(expanded === i ? null : i)}>
            <div className="min-w-0 flex-1">
              {type === 'profile' && (
                <>
                  <div className="text-sm font-medium truncate">
                    {item.firstName || item.first_name || ''} {item.lastName || item.last_name || item.name || 'Unknown'}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {item.headline || item.title || ''} {item.companyName || item.company ? `@ ${item.companyName || item.company}` : ''}
                  </div>
                </>
              )}
              {type === 'company' && (
                <>
                  <div className="text-sm font-medium truncate">{item.name || item.companyName || 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {item.industry || ''} {item.employeeCount ? `\u00b7 ${item.employeeCount} employees` : ''}
                  </div>
                </>
              )}
              {type === 'job' && (
                <>
                  <div className="text-sm font-medium truncate">{item.title || item.jobTitle || 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {item.company || item.companyName || ''} {item.location ? `\u00b7 ${item.location}` : ''}
                  </div>
                </>
              )}
            </div>
            <span className="text-xs text-muted-foreground ml-2">{expanded === i ? '\u25b2' : '\u25bc'}</span>
          </div>
          {expanded === i && (
            <pre className="text-xs text-muted-foreground mt-2 overflow-x-auto max-h-40 overflow-y-auto bg-background/50 rounded p-2">
              {JSON.stringify(item, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
