import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Activity, Pause, Play, CheckCircle2, PlusCircle, Zap } from 'lucide-react';
import { timeAgo } from '../../lib/utils';

const actionConfig: Record<string, { icon: typeof Activity; color: string }> = {
  created: { icon: PlusCircle, color: 'text-green-400' },
  paused: { icon: Pause, color: 'text-yellow-400' },
  activated: { icon: Play, color: 'text-blue-400' },
  completed: { icon: CheckCircle2, color: 'text-emerald-400' },
  synced: { icon: Zap, color: 'text-purple-400' },
};

const defaultAction = { icon: Activity, color: 'text-gray-400' };

export function EventsTimeline() {
  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: api.getEvents,
    refetchInterval: 30000,
  });

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-5 w-5 text-indigo-400" />
        <h3 className="font-semibold text-lg">Activity Timeline</h3>
      </div>

      {events.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-6">No activity recorded yet</div>
      ) : (
        <div className="relative space-y-0 max-h-[350px] overflow-y-auto">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

          {events.slice(0, 30).map((event: any) => {
            const config = actionConfig[event.action] || defaultAction;
            const Icon = config.icon;
            return (
              <div key={event.id} className="relative flex items-start gap-3 py-2 pl-0">
                <div className={`relative z-10 flex-shrink-0 w-[23px] h-[23px] rounded-full bg-card border border-border flex items-center justify-center`}>
                  <Icon className={`h-3 w-3 ${config.color}`} />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="text-sm">
                    <span className="font-medium capitalize">{event.action}</span>
                    {' '}
                    <span className="text-muted-foreground">{event.entity_type}</span>
                    {event.entity_id && <span className="text-muted-foreground"> #{event.entity_id}</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                    {event.source && <span>{event.source}</span>}
                    {event.actor && <><span>·</span><span>{event.actor}</span></>}
                    <span>·</span>
                    <span>{event.created_at ? timeAgo(event.created_at) : ''}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
