import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import {
  Target, Users, Building2, Linkedin, Mail,
  ChevronDown, ChevronRight, ExternalLink, UserCheck, Calendar,
  Zap, Crown, Star
} from 'lucide-react';

interface BtrContact {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  linkedin: string;
  segment: string;
  tier: string;
  assignedTo: string;
  status: string;
  interests: string[];
  tags: string[];
}

interface BtrDashboard {
  contacts: BtrContact[];
  stats: {
    total: number;
    byTier: Record<string, number>;
    bySegment: Record<string, number>;
    byAssignee: Record<string, number>;
    byStatus: Record<string, number>;
  };
  daysUntil: number;
  conferenceDate: string;
  pipeline: { id: string; stages: { id: string; name: string; color: string }[] };
}

const TIER_COLORS: Record<string, string> = {
  'Tier 1': 'bg-red-500/20 text-red-400 border-red-500/30',
  'Tier 2': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Tier 3': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const SEGMENT_COLORS: Record<string, string> = {
  Builder: 'bg-orange-500/20 text-orange-400',
  Investor: 'bg-green-500/20 text-green-400',
  Lender: 'bg-blue-500/20 text-blue-400',
  Operator: 'bg-purple-500/20 text-purple-400',
};

const STATUS_OPTIONS = [
  'pre-outreach',
  'linkedin-sent',
  'linkedin-connected',
  'email-sent',
  'email-replied',
  'meeting-scheduled',
  'met-at-conference',
  'proposal-sent',
  'follow-up',
  'won',
];

export function BtrConferencePanel() {
  const [filterTier, setFilterTier] = useState<string | null>(null);
  const [filterSegment, setFilterSegment] = useState<string | null>(null);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [expandedContact, setExpandedContact] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<BtrDashboard>({
    queryKey: ['btr-dashboard'],
    queryFn: api.getBtrDashboard,
    refetchInterval: 30000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.updateBtrContactStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['btr-dashboard'] });
      toast.success('Status updated');
    },
    onError: () => toast.error('Failed to update status'),
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, assignee }: { id: string; assignee: string }) =>
      api.reassignBtrContact(id, assignee),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['btr-dashboard'] });
      toast.success('Contact reassigned');
    },
    onError: () => toast.error('Failed to reassign'),
  });

  if (isLoading || !data) {
    return (
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="text-muted-foreground text-sm text-center py-8">Loading BTR Conference data...</div>
      </div>
    );
  }

  const { contacts, stats, daysUntil } = data;

  // Apply filters
  let filtered = contacts;
  if (filterTier) filtered = filtered.filter(c => c.tier === filterTier);
  if (filterSegment) filtered = filtered.filter(c => c.segment === filterSegment);
  if (filterAssignee) filtered = filtered.filter(c => c.assignedTo === filterAssignee);

  // Sort: Tier 1 first, then by segment
  filtered.sort((a, b) => {
    const tierOrder = { 'Tier 1': 0, 'Tier 2': 1, 'Tier 3': 2 };
    const ta = tierOrder[a.tier as keyof typeof tierOrder] ?? 3;
    const tb = tierOrder[b.tier as keyof typeof tierOrder] ?? 3;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  // Colby's contacts vs Ryan's
  const colbyContacts = contacts.filter(c => c.assignedTo === 'colby');
  const ryanContacts = contacts.filter(c => c.assignedTo === 'ryan');

  // Outreach progress
  const contacted = contacts.filter(c => c.status !== 'pre-outreach').length;
  const meetings = contacts.filter(c =>
    ['meeting-scheduled', 'met-at-conference'].includes(c.status)
  ).length;

  return (
    <div className="bg-card border-2 border-red-500/30 rounded-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <Target className="h-6 w-6 text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-lg">BTR Conference Nashville</h3>
            <div className="text-xs text-muted-foreground">March 16-17 | Grand Hyatt Nashville</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Countdown */}
          <div className={`text-center px-4 py-2 rounded-lg border ${
            daysUntil <= 3 ? 'bg-red-500/20 border-red-500/50 text-red-400' :
            daysUntil <= 7 ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' :
            'bg-blue-500/20 border-blue-500/50 text-blue-400'
          }`}>
            <div className="text-2xl font-bold">{daysUntil}</div>
            <div className="text-[10px] uppercase tracking-wider">days left</div>
          </div>
          {/* View toggle */}
          <div className="flex gap-1 bg-muted rounded-md p-0.5">
            <button onClick={() => setView('list')} className={`px-2 py-1 text-xs rounded ${view === 'list' ? 'bg-accent text-white' : 'text-muted-foreground'}`}>List</button>
            <button onClick={() => setView('kanban')} className={`px-2 py-1 text-xs rounded ${view === 'kanban' ? 'bg-accent text-white' : 'text-muted-foreground'}`}>Kanban</button>
          </div>
        </div>
      </div>

      {/* Two-Person Attack Structure */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Crown className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-semibold text-blue-400">Colby — Inside (Panels + Meetings)</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold">{colbyContacts.length}</div>
              <div className="text-[10px] text-muted-foreground">Targets</div>
            </div>
            <div>
              <div className="text-lg font-bold">{colbyContacts.filter(c => c.status !== 'pre-outreach').length}</div>
              <div className="text-[10px] text-muted-foreground">Contacted</div>
            </div>
            <div>
              <div className="text-lg font-bold">{colbyContacts.filter(c => c.status === 'meeting-scheduled').length}</div>
              <div className="text-[10px] text-muted-foreground">Meetings</div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">Track A: Capital/Investor panels | Books meetings for Ryan outside</div>
        </div>
        <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-green-400" />
            <span className="text-sm font-semibold text-green-400">Ryan — Outside (Closer + Follow-ups)</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold">{ryanContacts.length}</div>
              <div className="text-[10px] text-muted-foreground">Targets</div>
            </div>
            <div>
              <div className="text-lg font-bold">{ryanContacts.filter(c => c.status !== 'pre-outreach').length}</div>
              <div className="text-[10px] text-muted-foreground">Contacted</div>
            </div>
            <div>
              <div className="text-lg font-bold">{ryanContacts.filter(c => c.status === 'meeting-scheduled').length}</div>
              <div className="text-[10px] text-muted-foreground">Meetings</div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">Track B: Builder/Ops panels | Takes meetings booked by Colby</div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-6 gap-2 mb-4">
        <div className="text-center p-2 bg-muted rounded-lg">
          <div className="text-lg font-bold">{stats.total}</div>
          <div className="text-[10px] text-muted-foreground">Total</div>
        </div>
        <div className="text-center p-2 bg-red-500/10 rounded-lg cursor-pointer hover:bg-red-500/20" onClick={() => setFilterTier(filterTier === 'Tier 1' ? null : 'Tier 1')}>
          <div className="text-lg font-bold text-red-400">{stats.byTier['Tier 1'] || 0}</div>
          <div className="text-[10px] text-red-400">Tier 1</div>
        </div>
        <div className="text-center p-2 bg-yellow-500/10 rounded-lg cursor-pointer hover:bg-yellow-500/20" onClick={() => setFilterTier(filterTier === 'Tier 2' ? null : 'Tier 2')}>
          <div className="text-lg font-bold text-yellow-400">{stats.byTier['Tier 2'] || 0}</div>
          <div className="text-[10px] text-yellow-400">Tier 2</div>
        </div>
        <div className="text-center p-2 bg-green-500/10 rounded-lg">
          <div className="text-lg font-bold text-green-400">{contacted}</div>
          <div className="text-[10px] text-green-400">Contacted</div>
        </div>
        <div className="text-center p-2 bg-purple-500/10 rounded-lg">
          <div className="text-lg font-bold text-purple-400">{meetings}</div>
          <div className="text-[10px] text-purple-400">Meetings</div>
        </div>
        <div className="text-center p-2 bg-muted rounded-lg">
          <div className="text-lg font-bold">{Math.round((contacted / stats.total) * 100)}%</div>
          <div className="text-[10px] text-muted-foreground">Outreach</div>
        </div>
      </div>

      {/* Outreach Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Outreach Progress</span>
          <span>{contacted}/{stats.total} contacted</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all"
            style={{ width: `${(contacted / stats.total) * 100}%` }}
          />
        </div>
      </div>

      {/* Segment Filter */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button
          onClick={() => { setFilterSegment(null); setFilterAssignee(null); setFilterTier(null); }}
          className={`text-xs px-2 py-1 rounded-md border ${!filterSegment && !filterAssignee && !filterTier ? 'border-accent text-accent bg-accent/10' : 'border-border text-muted-foreground'}`}
        >All</button>
        {['Builder', 'Investor', 'Lender', 'Operator'].map(seg => (
          <button
            key={seg}
            onClick={() => setFilterSegment(filterSegment === seg ? null : seg)}
            className={`text-xs px-2 py-1 rounded-md border ${filterSegment === seg ? 'border-accent text-accent bg-accent/10' : 'border-border text-muted-foreground'}`}
          >{seg} ({stats.bySegment[seg] || 0})</button>
        ))}
        <span className="text-muted-foreground">|</span>
        <button
          onClick={() => setFilterAssignee(filterAssignee === 'colby' ? null : 'colby')}
          className={`text-xs px-2 py-1 rounded-md border ${filterAssignee === 'colby' ? 'border-blue-400 text-blue-400 bg-blue-500/10' : 'border-border text-muted-foreground'}`}
        >Colby ({stats.byAssignee.colby || 0})</button>
        <button
          onClick={() => setFilterAssignee(filterAssignee === 'ryan' ? null : 'ryan')}
          className={`text-xs px-2 py-1 rounded-md border ${filterAssignee === 'ryan' ? 'border-green-400 text-green-400 bg-green-500/10' : 'border-border text-muted-foreground'}`}
        >Ryan ({stats.byAssignee.ryan || 0})</button>
      </div>

      {/* Contact List */}
      <div className="space-y-1 max-h-[600px] overflow-y-auto">
        {filtered.map((contact) => {
          const isExpanded = expandedContact === contact.id;
          const linkedinUrl = contact.linkedin?.startsWith('http') ? contact.linkedin : `https://www.linkedin.com/in/${contact.linkedin?.replace('linkedin.com/in/', '')}`;

          return (
            <div key={contact.id} className={`border rounded-lg overflow-hidden ${
              contact.tier === 'Tier 1' ? 'border-red-500/20' :
              contact.tier === 'Tier 2' ? 'border-yellow-500/20' : 'border-border'
            }`}>
              <div
                className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-muted/50"
                onClick={() => setExpandedContact(isExpanded ? null : contact.id)}
              >
                {/* Tier badge */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${TIER_COLORS[contact.tier] || 'bg-muted text-muted-foreground'}`}>
                  {contact.tier === 'Tier 1' ? <Star className="h-3.5 w-3.5" /> : contact.tier?.replace('Tier ', 'T')}
                </div>

                {/* Name + company */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{contact.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${SEGMENT_COLORS[contact.segment] || 'bg-muted'}`}>{contact.segment}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {contact.title} @ {contact.company}
                  </div>
                </div>

                {/* Assignee */}
                <div className={`text-[10px] px-1.5 py-0.5 rounded ${
                  contact.assignedTo === 'colby' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
                }`}>
                  {contact.assignedTo}
                </div>

                {/* Status */}
                <select
                  value={contact.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    statusMutation.mutate({ id: contact.id, status: e.target.value });
                  }}
                  className="text-[10px] bg-muted border border-border rounded px-1.5 py-1 focus:outline-none cursor-pointer"
                >
                  {STATUS_OPTIONS.map(s => (
                    <option key={s} value={s}>{s.replace(/-/g, ' ')}</option>
                  ))}
                </select>

                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>

              {/* Expanded */}
              {isExpanded && (
                <div className="border-t border-border p-3 bg-muted/30 space-y-3">
                  {/* Quick actions */}
                  <div className="flex gap-2 flex-wrap">
                    {contact.linkedin && (
                      <a
                        href={linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-600/20 text-blue-400 rounded-md hover:bg-blue-600/30"
                      >
                        <Linkedin className="h-3 w-3" /> Open LinkedIn <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-green-500/20 text-green-400 rounded-md hover:bg-green-500/30"
                      >
                        <Mail className="h-3 w-3" /> Send Email
                      </a>
                    )}
                    <button className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-purple-500/20 text-purple-400 rounded-md hover:bg-purple-500/30">
                      <Calendar className="h-3 w-3" /> Schedule Meeting
                    </button>
                    <button
                      onClick={() => assignMutation.mutate({
                        id: contact.id,
                        assignee: contact.assignedTo === 'colby' ? 'ryan' : 'colby'
                      })}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-muted text-muted-foreground rounded-md hover:bg-muted/80"
                    >
                      <UserCheck className="h-3 w-3" /> Reassign to {contact.assignedTo === 'colby' ? 'Ryan' : 'Colby'}
                    </button>
                  </div>

                  {/* Info grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Building2 className="h-3 w-3" /> {contact.company}
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users className="h-3 w-3" /> {contact.title}
                    </div>
                  </div>

                  {/* Interests */}
                  {contact.interests.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {contact.interests.map(interest => (
                        <span key={interest} className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">{interest}</span>
                      ))}
                    </div>
                  )}

                  {/* Tags */}
                  <div className="flex gap-1 flex-wrap">
                    {contact.tags.slice(0, 6).map(tag => (
                      <span key={tag} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center mt-3 text-xs text-muted-foreground">
        <span>Showing {filtered.length} of {stats.total} contacts</span>
        <span>Pipeline: BTR Conference | Last updated: {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
