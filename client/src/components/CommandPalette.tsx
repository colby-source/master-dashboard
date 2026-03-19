import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  Search, Mail, Bot, CheckSquare, AlertTriangle, Radar, BarChart3,
  LayoutDashboard, Users, Send, PenTool, Database, GitBranch,
  Settings, Megaphone, Linkedin, Instagram, MessageSquare,
  Globe, Cpu, Compass,
} from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: typeof Search;
  category: string;
  action?: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const pendingChordRef = useRef<string | null>(null);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { data: campaigns = [] } = useQuery({ queryKey: ['campaigns'], queryFn: () => api.getCampaigns() });
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: () => api.getAgents() });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => api.getTasks() });
  const { data: alerts = [] } = useQuery({ queryKey: ['alerts'], queryFn: api.getAlerts });
  const { data: competitors = [] } = useQuery({ queryKey: ['competitors'], queryFn: api.getCompetitors });

  // Navigation chord map: g + key → route
  const chordMap: Record<string, string> = {
    d: '/',
    c: '/contacts',
    k: '/campaigns',
    o: '/outbound',
    w: '/writer',
    e: '/enrichment',
    p: '/pipelines',
    a: '/agents',
    t: '/tasks',
    n: '/analytics',
    s: '/settings',
    r: '/reports',
  };

  // Keyboard shortcut + chord navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setSelected(0);
        return;
      }
      if (e.key === 'Escape') { setOpen(false); return; }

      // Chord shortcuts (only when not in an input)
      if (!isEditable && !open) {
        if (pendingChordRef.current === 'g') {
          const route = chordMap[e.key];
          if (route) {
            e.preventDefault();
            navigate(route);
          }
          pendingChordRef.current = null;
          clearTimeout(chordTimerRef.current);
          return;
        }
        if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          pendingChordRef.current = 'g';
          clearTimeout(chordTimerRef.current);
          chordTimerRef.current = setTimeout(() => { pendingChordRef.current = null; }, 500);
          return;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(chordTimerRef.current);
    };
  }, [open, navigate]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const all: CommandItem[] = [];

    // Campaigns
    campaigns.forEach((c: any) =>
      all.push({
        id: `campaign-${c.id}`,
        label: c.name,
        sublabel: `${c.status} · ${c.stats?.open_rate || 0}% open · ${c.stats?.reply_rate || 0}% reply`,
        icon: Mail,
        category: 'Campaigns',
        action: () => navigate(`/campaigns/${c.id}`),
      })
    );

    // Agents
    agents.forEach((a: any) =>
      all.push({
        id: `agent-${a.id}`,
        label: a.name,
        sublabel: `${a.status} · ${a.success_rate}% success`,
        icon: Bot,
        category: 'Agents',
      })
    );

    // Tasks
    tasks.filter((t: any) => t.status !== 'done').forEach((t: any) =>
      all.push({
        id: `task-${t.id}`,
        label: t.title,
        sublabel: `${t.priority} · ${t.status}`,
        icon: CheckSquare,
        category: 'Tasks',
      })
    );

    // Alerts
    alerts.forEach((a: any) =>
      all.push({
        id: `alert-${a.id}`,
        label: a.message,
        sublabel: `${a.severity} · ${a.source}`,
        icon: AlertTriangle,
        category: 'Alerts',
      })
    );

    // Competitors
    competitors.forEach((c: any) =>
      all.push({
        id: `competitor-${c.id}`,
        label: c.name,
        sublabel: c.url,
        icon: Radar,
        category: 'Competitors',
      })
    );

    // Navigation
    const navItems: { id: string; label: string; sublabel: string; icon: typeof Search; path: string }[] = [
      { id: 'nav-dashboard', label: 'Dashboard', sublabel: 'g d', icon: LayoutDashboard, path: '/' },
      { id: 'nav-contacts', label: 'Contacts', sublabel: 'g c', icon: Users, path: '/contacts' },
      { id: 'nav-campaigns', label: 'Campaigns', sublabel: 'g k', icon: Mail, path: '/campaigns' },
      { id: 'nav-outbound', label: 'Outbound Hub', sublabel: 'g o', icon: Send, path: '/outbound' },
      { id: 'nav-writer', label: 'Campaign Writer', sublabel: 'g w', icon: PenTool, path: '/writer' },
      { id: 'nav-enrichment', label: 'Enrichment', sublabel: 'g e', icon: Database, path: '/enrichment' },
      { id: 'nav-pipelines', label: 'Pipelines', sublabel: 'g p', icon: GitBranch, path: '/pipelines' },
      { id: 'nav-agents', label: 'Agents', sublabel: 'g a', icon: Cpu, path: '/agents' },
      { id: 'nav-tasks', label: 'Tasks', sublabel: 'g t', icon: CheckSquare, path: '/tasks' },
      { id: 'nav-analytics', label: 'Analytics', sublabel: 'g n', icon: BarChart3, path: '/analytics' },
      { id: 'nav-discoveries', label: 'AI Discoveries', sublabel: '', icon: Compass, path: '/discoveries' },
      { id: 'nav-competitors', label: 'Competitors', sublabel: '', icon: Radar, path: '/competitors' },
      { id: 'nav-scraping', label: 'Scraping', sublabel: '', icon: Globe, path: '/scraping' },
      { id: 'nav-meta', label: 'Meta Ads', sublabel: '', icon: Megaphone, path: '/meta-ads' },
      { id: 'nav-linkedin', label: 'LinkedIn', sublabel: '', icon: Linkedin, path: '/linkedin' },
      { id: 'nav-instagram', label: 'Instagram', sublabel: '', icon: Instagram, path: '/instagram' },
      { id: 'nav-whatsapp', label: 'WhatsApp', sublabel: '', icon: MessageSquare, path: '/whatsapp' },
      { id: 'nav-settings', label: 'Settings', sublabel: 'g s', icon: Settings, path: '/settings' },
    ];
    navItems.forEach((n) =>
      all.push({
        id: n.id,
        label: n.label,
        sublabel: n.sublabel || undefined,
        icon: n.icon,
        category: 'Navigation',
        action: () => navigate(n.path),
      })
    );

    // Quick actions
    all.push({
      id: 'action-refresh',
      label: 'Refresh all data',
      icon: BarChart3,
      category: 'Actions',
      action: () => window.location.reload(),
    });

    return all;
  }, [campaigns, agents, tasks, alerts, competitors, navigate]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 15);
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.sublabel?.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    ).slice(0, 15);
  }, [items, query]);

  useEffect(() => setSelected(0), [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && filtered[selected]) {
      filtered[selected].action?.();
      setOpen(false);
    }
  };

  if (!open) return null;

  // Group by category
  const grouped = filtered.reduce<Record<string, CommandItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  let globalIdx = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search campaigns, tasks, agents..."
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
          <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        <div className="max-h-[350px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="text-muted-foreground text-sm text-center py-6">No results found</div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <div className="px-4 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {category}
                </div>
                {items.map((item) => {
                  globalIdx++;
                  const idx = globalIdx;
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 px-4 py-2 cursor-pointer ${
                        idx === selected ? 'bg-accent/20 text-foreground' : 'text-foreground hover:bg-muted/50'
                      }`}
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => { item.action?.(); setOpen(false); }}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{item.label}</div>
                        {item.sublabel && (
                          <div className="text-[10px] text-muted-foreground truncate">{item.sublabel}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span><kbd className="bg-muted px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="bg-muted px-1 py-0.5 rounded">↵</kbd> select</span>
          <span><kbd className="bg-muted px-1 py-0.5 rounded">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
