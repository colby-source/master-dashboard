import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { toast } from 'sonner';
import {
  Search, Mail, Phone, Building2, Tag, ChevronDown, ChevronRight,
  StickyNote, CheckSquare, Square, Workflow,
} from 'lucide-react';

interface Props {
  companyId?: number;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelection: () => void;
}

export function GhlContactsTab({ companyId, selectedIds, onToggleSelect, onSelectAll, onClearSelection }: Props) {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: contactsData, isLoading } = useQuery({
    queryKey: ['ghl-cmd-contacts', companyId, search],
    queryFn: () => api.getGhlContacts(companyId, search || undefined),
    refetchInterval: 120000,
  });

  const { data: notesData } = useQuery({
    queryKey: ['ghl-contact-notes', expandedId, companyId],
    queryFn: () => api.getGhlContactNotes(expandedId!, companyId),
    enabled: !!expandedId,
  });

  const addNoteMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.addGhlContactNote(id, body, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ghl-contact-notes'] });
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });

  const contacts = contactsData?.contacts || [];
  const allIds = contacts.map((c: any) => c.id);
  const allSelected = contacts.length > 0 && contacts.every((c: any) => selectedIds.has(c.id));

  return (
    <div className="space-y-3">
      {/* Search + select-all */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts by name, email, phone..."
            className="w-full pl-8 pr-3 py-2 bg-muted border border-border rounded-md text-sm focus:outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={() => allSelected ? onClearSelection() : onSelectAll(allIds)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs bg-muted border border-border rounded-md hover:bg-muted/80"
        >
          {allSelected ? <CheckSquare className="h-3.5 w-3.5 text-accent" /> : <Square className="h-3.5 w-3.5" />}
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="text-xs text-accent font-medium">
          {selectedIds.size} contact{selectedIds.size !== 1 ? 's' : ''} selected
        </div>
      )}

      {/* Contact list */}
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {isLoading ? (
          <div className="text-muted-foreground text-sm text-center py-8">Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div className="text-muted-foreground text-sm text-center py-8">No contacts found</div>
        ) : (
          contacts.map((contact: any) => {
            const isSelected = selectedIds.has(contact.id);
            const isExpanded = expandedId === contact.id;
            return (
              <div key={contact.id} className={`rounded-lg border ${isSelected ? 'border-accent/50 bg-accent/5' : 'border-transparent'}`}>
                <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 cursor-pointer">
                  {/* Checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(contact.id); }}
                    className="flex-shrink-0"
                  >
                    {isSelected
                      ? <CheckSquare className="h-4 w-4 text-accent" />
                      : <Square className="h-4 w-4 text-muted-foreground" />}
                  </button>

                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold flex-shrink-0"
                    onClick={() => setExpandedId(isExpanded ? null : contact.id)}
                  >
                    {(contact.firstName?.[0] || contact.email?.[0] || '?').toUpperCase()}
                  </div>

                  {/* Info */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : contact.id)}
                  >
                    <div className="text-sm font-medium truncate">
                      {[contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || 'Unknown'}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {contact.email && <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{contact.email}</span>}
                      {contact.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{contact.phone}</span>}
                      {contact.companyName && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{contact.companyName}</span>}
                    </div>
                  </div>

                  {/* Tags + expand */}
                  <div className="flex items-center gap-1.5">
                    {contact.tags?.slice(0, 2).map((tag: string) => (
                      <span key={tag} className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">{tag}</span>
                    ))}
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="ml-14 p-3 bg-muted/30 rounded-b-lg space-y-2">
                    {contact.tags?.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        {contact.tags.map((tag: string) => (
                          <span key={tag} className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">{tag}</span>
                        ))}
                      </div>
                    )}
                    {/* Notes */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground"><StickyNote className="h-3 w-3" /> Notes</div>
                      {(notesData || []).slice(0, 3).map((note: any) => (
                        <div key={note.id} className="text-xs p-1.5 bg-card rounded">{note.body?.slice(0, 120)}</div>
                      ))}
                      <input
                        type="text"
                        placeholder="Add note..."
                        className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:outline-none"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                            addNoteMutation.mutate({ id: contact.id, body: (e.target as HTMLInputElement).value });
                            (e.target as HTMLInputElement).value = '';
                          }
                        }}
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button className="text-xs px-2 py-1 bg-accent/20 text-accent rounded hover:bg-accent/30 flex items-center gap-1">
                        <Workflow className="h-3 w-3" /> Add to Workflow
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {contactsData?.meta?.total > 0 && (
        <div className="text-xs text-muted-foreground text-center">
          Showing {contacts.length} of {contactsData.meta.total} contacts
        </div>
      )}
    </div>
  );
}
