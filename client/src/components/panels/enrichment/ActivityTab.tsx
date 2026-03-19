import { Activity } from 'lucide-react'
import { timeAgo } from '../../../lib/utils'

export function ActivityTab({ events }: { events: any[] }) {
  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {events.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">No recent activity</div>
      ) : (
        events.map((evt: any) => (
          <div key={evt.id} className="flex items-start gap-3 p-2 rounded-lg bg-muted/30">
            <Activity className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm">{evt.event_type?.replace(/_/g, ' ')}</div>
              {evt.event_data && (
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {typeof evt.event_data === 'string' ? evt.event_data : JSON.stringify(evt.event_data)}
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {evt.created_at ? timeAgo(evt.created_at) : ''}
            </span>
          </div>
        ))
      )}
    </div>
  )
}
