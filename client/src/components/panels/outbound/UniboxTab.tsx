import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { Inbox } from 'lucide-react';

export function UniboxTab() {
  const [selectedEmail, setSelectedEmail] = useState<any>(null);

  const { data: unread } = useQuery({
    queryKey: ['instantly-unread'],
    queryFn: () => api.instantlyCountUnread(),
    refetchInterval: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['instantly-emails'],
    queryFn: () => api.instantlyEmails({ limit: 50 }),
  });

  const { data: emailDetail } = useQuery({
    queryKey: ['instantly-email', selectedEmail?.id],
    queryFn: () => api.instantlyEmail(selectedEmail.id),
    enabled: !!selectedEmail?.id,
  });

  const emails = data?.items ?? data ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Inbox className="h-4 w-4 text-orange-400" />
        <span className="font-medium text-sm">Unified Inbox</span>
        {unread?.count > 0 && (
          <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full font-medium">
            {unread.count} unread
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading emails...</div>
      ) : (
        <div className="flex gap-4">
          {/* Email list */}
          <div className="flex-1 space-y-1 max-h-[400px] overflow-y-auto">
            {emails.length === 0 ? (
              <div className="text-muted-foreground text-sm py-8 text-center">No emails in inbox.</div>
            ) : emails.map((e: any, i: number) => (
              <button
                key={e.id ?? i}
                onClick={() => setSelectedEmail(e)}
                className={`w-full text-left p-3 rounded border transition-colors ${
                  selectedEmail?.id === e.id
                    ? 'border-orange-400/50 bg-orange-400/5'
                    : 'border-border/50 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate max-w-[60%]">
                    {e.from_address_email ?? e.from ?? 'Unknown'}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.timestamp ? new Date(e.timestamp).toLocaleDateString() : ''}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">{e.subject ?? '(no subject)'}</div>
                {e.is_unread && <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mt-1" />}
              </button>
            ))}
          </div>
          {/* Email detail */}
          {selectedEmail && (
            <div className="flex-1 border border-border rounded p-4 max-h-[400px] overflow-y-auto">
              <div className="text-sm font-medium mb-1">{emailDetail?.subject ?? selectedEmail.subject ?? '(no subject)'}</div>
              <div className="text-xs text-muted-foreground mb-3">
                From: {emailDetail?.from_address_email ?? selectedEmail.from_address_email ?? 'Unknown'}
              </div>
              <div className="text-sm whitespace-pre-wrap">{emailDetail?.body ?? emailDetail?.text_body ?? selectedEmail.snippet ?? 'Loading...'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
