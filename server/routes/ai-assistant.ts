import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { queryAll, queryOne, runSql, saveDb } from '../db';

const router = Router();

// ── Tool Definitions ─────────────────────────────────────────────
const tools: Anthropic.Tool[] = [
  {
    name: 'search_contacts',
    description: 'Search enrichment leads/contacts by name, email, company, status, score, or source. Returns a list of matching contacts with key fields.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term (name, email, or company)' },
        status: { type: 'string', description: 'Filter by status: new, enriched, scored, pushed, excluded' },
        score_label: { type: 'string', description: 'Filter by score: hot, warm, cold, disqualified' },
        source: { type: 'string', description: 'Filter by source: meta_ad, rb2b, manual, import, linkedin, instagram' },
        company_id: { type: 'number', description: 'Filter by company ID (1=Granite Park Capital, 2=Brand Me Now, 4=Tikkun)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_contact_details',
    description: 'Get full details for a specific contact/lead including enrichment data, scoring, events, and email threads.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'The enrichment lead ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_lead',
    description: 'Create a new lead/contact in the enrichment pipeline.',
    input_schema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Email address (required)' },
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
        company_id: { type: 'number', description: 'Company ID (1=Granite Park Capital, 2=Brand Me Now, 4=Tikkun)' },
        source: { type: 'string', description: 'Lead source (manual, import, meta_ad, rb2b, linkedin, instagram)' },
        phone: { type: 'string', description: 'Phone number' },
      },
      required: ['email', 'company_id'],
    },
  },
  {
    name: 'enrich_contact',
    description: 'Trigger data enrichment for a contact (PDL person/company lookup + Hunter email verification).',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'The enrichment lead ID to enrich' },
      },
      required: ['id'],
    },
  },
  {
    name: 'score_contact',
    description: 'Trigger AI scoring for a contact. Uses Claude to evaluate lead quality 0-100.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'The enrichment lead ID to score' },
      },
      required: ['id'],
    },
  },
  {
    name: 'push_to_ghl',
    description: 'Push a contact to GoHighLevel CRM. Creates or updates the GHL contact with enrichment data and tags.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'The enrichment lead ID to push' },
      },
      required: ['id'],
    },
  },
  {
    name: 'approve_cold_email',
    description: 'Approve a contact for cold email outreach via Instantly. Pushes lead to specified campaign.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'The enrichment lead ID' },
        campaign_id: { type: 'string', description: 'The Instantly campaign ID to push to' },
      },
      required: ['id', 'campaign_id'],
    },
  },
  {
    name: 'exclude_cold_email',
    description: 'Exclude a contact from cold email outreach with a reason.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'The enrichment lead ID' },
        reason: { type: 'string', description: 'Reason for exclusion' },
      },
      required: ['id'],
    },
  },
  {
    name: 'process_lead',
    description: 'Run the full enrichment pipeline on a lead: enrich → score → push to GHL → evaluate for cold email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'The enrichment lead ID to process' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_campaigns',
    description: 'Get all email campaigns with stats (open rate, reply rate, sent count). Can filter by company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'number', description: 'Filter by company ID' },
      },
      required: [],
    },
  },
  {
    name: 'get_campaign_detail',
    description: 'Get detailed info for a specific campaign including sequence steps, per-step analytics, and contacts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Campaign ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'pause_campaign',
    description: 'Pause an active email campaign.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Campaign ID to pause' },
      },
      required: ['id'],
    },
  },
  {
    name: 'activate_campaign',
    description: 'Activate/resume a paused email campaign.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Campaign ID to activate' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_tasks',
    description: 'Get all tasks. Can filter by status (todo, in_progress, done) or priority (high, medium, low).',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Filter: todo, in_progress, done' },
        priority: { type: 'string', description: 'Filter: high, medium, low' },
      },
      required: [],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task in the task board.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', description: 'Priority: high, medium, low' },
        company_id: { type: 'number', description: 'Company ID' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Task ID to complete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_alerts',
    description: 'Get all active (unacknowledged) alerts from the system.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'acknowledge_alert',
    description: 'Acknowledge/dismiss an alert.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Alert ID to acknowledge' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_dashboard_summary',
    description: 'Get the executive dashboard summary: active campaigns, open tasks, active alerts, agent status, enrichment stats.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_enrichment_stats',
    description: 'Get enrichment pipeline statistics: total leads, enriched, scored, pushed to GHL, cold email status breakdown.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'number', description: 'Filter by company ID' },
      },
      required: [],
    },
  },
  {
    name: 'get_agents',
    description: 'Get all automation agents with their status, success rate, and last run time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'number', description: 'Filter by company ID' },
      },
      required: [],
    },
  },
  {
    name: 'get_reply_threads',
    description: 'Get email reply threads. Can filter by status (active, escalated, converted, closed).',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'number', description: 'Filter by company ID' },
        status: { type: 'string', description: 'Filter: active, escalated, converted, closed' },
      },
      required: [],
    },
  },
  {
    name: 'send_manual_reply',
    description: 'Send a manual email reply in a conversation thread.',
    input_schema: {
      type: 'object' as const,
      properties: {
        thread_id: { type: 'number', description: 'Reply thread ID' },
        body: { type: 'string', description: 'Email body text to send' },
      },
      required: ['thread_id', 'body'],
    },
  },
  {
    name: 'get_competitors',
    description: 'Get tracked competitors and their recent changes.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'navigate_to',
    description: 'Tell the user to navigate to a specific page in the dashboard. Returns a navigation instruction the frontend will handle.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'The route path, e.g. /contacts, /campaigns, /enrichment, /tasks, /analytics, /settings' },
        reason: { type: 'string', description: 'Why the user should navigate there' },
      },
      required: ['path'],
    },
  },
  // ── Yacht Event Tools ─────────────────────────────────────────
  {
    name: 'list_yacht_events',
    description: 'List all yacht events with attendee counts and check-in stats.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Filter by status: upcoming, active, completed' },
      },
      required: [],
    },
  },
  {
    name: 'get_yacht_event',
    description: 'Get full details for a yacht event including all attendees, check-in status, and stats.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Event ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_yacht_event',
    description: 'Create a new yacht event (mixer, investor dinner, etc). Returns event ID and check-in code.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Event name, e.g. "Yacht Mixer — March 12"' },
        event_date: { type: 'string', description: 'Event date in YYYY-MM-DD format' },
        location: { type: 'string', description: 'Location (default: The Deck at Island Gardens, Miami)' },
        max_capacity: { type: 'number', description: 'Max attendees (default: 50)' },
        notes: { type: 'string', description: 'Internal notes about the event' },
      },
      required: ['name', 'event_date'],
    },
  },
  {
    name: 'add_yacht_attendees',
    description: 'Add attendees to a yacht event. Provide an array of attendee objects with email, first_name, last_name, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'number', description: 'Event ID' },
        attendees: {
          type: 'array',
          description: 'Array of attendee objects',
          items: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              first_name: { type: 'string' },
              last_name: { type: 'string' },
              phone: { type: 'string' },
              company: { type: 'string' },
              vip: { type: 'boolean' },
            },
            required: ['email'],
          },
        },
      },
      required: ['event_id', 'attendees'],
    },
  },
  {
    name: 'import_yacht_attendees_from_ghl',
    description: 'Import attendees for a yacht event from GHL by tag. Searches GHL for contacts with the specified tag and adds them as attendees.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'number', description: 'Event ID' },
        tag: { type: 'string', description: 'GHL tag to search for (default: "approved for event")' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'get_yacht_checkin_stats',
    description: 'Get real-time check-in statistics for an active yacht event: total attendees, checked in, pending, VIPs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'number', description: 'Event ID' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'get_yacht_qr_url',
    description: 'Get the QR code check-in URL and printable page URL for a yacht event.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'number', description: 'Event ID' },
        base_url: { type: 'string', description: 'Public base URL (e.g. ngrok URL). If not provided, uses localhost.' },
      },
      required: ['event_id'],
    },
  },
  // ── Email Deliverability & Warmup Tools ───────────────────
  {
    name: 'get_domain_health',
    description: 'Get email domain health status including SPF/DKIM/DMARC, blacklist status, bounce rates, spam rates, and overall health score. Optionally filter by domain.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Specific domain to check (e.g., granitepark.co). If omitted, returns all domains.' },
      },
    },
  },
  {
    name: 'get_warmup_status',
    description: 'Get the current warmup status of Instantly email accounts — how many are warming, ready, and estimated ready date.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'run_domain_health_check',
    description: 'Trigger an immediate domain health check (DNS, blacklist, metrics). Use when user asks to check deliverability now.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Specific domain to check. If omitted, checks all domains.' },
      },
    },
  },
  // ── Post-Meeting Follow-Up Tools ─────────────────────────
  {
    name: 'list_post_meeting_followups',
    description: 'List meeting transcripts with their post-meeting follow-up status. Filter by status or follow-up type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        followup_status: { type: 'string', description: 'Filter: pending, scheduled, sent, skipped' },
        followup_type: { type: 'string', description: 'Filter: data_room, nurture, polite_close' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'get_meeting_analysis',
    description: 'Get the full Claude analysis for a meeting transcript including sentiment, likelihood, next steps, and follow-up email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        transcript_id: { type: 'number', description: 'Meeting transcript ID' },
      },
      required: ['transcript_id'],
    },
  },
  {
    name: 'update_followup_status',
    description: 'Update the follow-up status or reschedule a post-meeting follow-up email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        transcript_id: { type: 'number', description: 'Meeting transcript ID' },
        status: { type: 'string', description: 'New status: pending, scheduled, sent, skipped' },
        reschedule_hours: { type: 'number', description: 'Reschedule follow-up N hours from now' },
      },
      required: ['transcript_id'],
    },
  },
];

// ── Tool Executors ───────────────────────────────────────────────

async function executeTool(name: string, input: any): Promise<string> {
  switch (name) {
    case 'search_contacts': {
      const { query, status, score_label, source, company_id, limit = 20 } = input;
      let sql = 'SELECT id, email, first_name, last_name, status, score, score_label, source, company_id, created_at FROM enrichment_leads WHERE 1=1';
      const params: any[] = [];
      if (query) {
        sql += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
        const q = `%${query}%`;
        params.push(q, q, q);
      }
      if (status) { sql += ' AND status = ?'; params.push(status); }
      if (score_label) { sql += ' AND score_label = ?'; params.push(score_label); }
      if (source) { sql += ' AND source = ?'; params.push(source); }
      if (company_id) { sql += ' AND company_id = ?'; params.push(company_id); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const leads = queryAll(sql, params);
      return JSON.stringify({ count: leads.length, leads });
    }

    case 'get_contact_details': {
      const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [input.id]);
      if (!lead) return JSON.stringify({ error: 'Contact not found' });
      const enrichment = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : null;
      const events = queryAll(
        'SELECT * FROM enrichment_events WHERE enrichment_lead_id = ? ORDER BY created_at DESC LIMIT 30',
        [input.id]
      );
      const threads = queryAll(
        'SELECT * FROM reply_threads WHERE enrichment_lead_id = ? ORDER BY updated_at DESC',
        [input.id]
      );
      return JSON.stringify({
        lead: { ...lead, enrichment_data: undefined },
        enrichment,
        events: events.map((e: any) => ({ ...e, payload: e.payload ? JSON.parse(e.payload) : null })),
        threads,
      });
    }

    case 'create_lead': {
      const { email, first_name, last_name, company_id, source = 'manual', phone } = input;
      const existing = queryOne('SELECT id FROM enrichment_leads WHERE email = ? AND company_id = ?', [email, company_id]);
      if (existing) return JSON.stringify({ error: 'Lead with this email already exists', existing_id: existing.id });
      runSql(
        `INSERT INTO enrichment_leads (email, first_name, last_name, company_id, source, phone, status) VALUES (?, ?, ?, ?, ?, ?, 'new')`,
        [email, first_name || null, last_name || null, company_id, source, phone || null]
      );
      saveDb();
      const newLead = queryOne('SELECT id, email, first_name, last_name, status FROM enrichment_leads WHERE email = ? AND company_id = ?', [email, company_id]);
      return JSON.stringify({ success: true, lead: newLead });
    }

    case 'enrich_contact': {
      const lead = queryOne('SELECT id, email, status FROM enrichment_leads WHERE id = ?', [input.id]);
      if (!lead) return JSON.stringify({ error: 'Contact not found' });
      // Trigger enrichment via internal API call
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/enrichment/leads/${input.id}/enrich`, { method: 'POST' });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: `Enrichment triggered for lead ${input.id}`, result: data });
      } catch (err: any) {
        return JSON.stringify({ error: `Enrichment failed: ${err.message}` });
      }
    }

    case 'score_contact': {
      const lead = queryOne('SELECT id, email, status FROM enrichment_leads WHERE id = ?', [input.id]);
      if (!lead) return JSON.stringify({ error: 'Contact not found' });
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/enrichment/leads/${input.id}/score`, { method: 'POST' });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: `Scoring triggered for lead ${input.id}`, result: data });
      } catch (err: any) {
        return JSON.stringify({ error: `Scoring failed: ${err.message}` });
      }
    }

    case 'push_to_ghl': {
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/enrichment/leads/${input.id}/push-ghl`, { method: 'POST' });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: `Pushed lead ${input.id} to GHL`, result: data });
      } catch (err: any) {
        return JSON.stringify({ error: `GHL push failed: ${err.message}` });
      }
    }

    case 'approve_cold_email': {
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/enrichment/leads/${input.id}/approve-cold-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaign_id: input.campaign_id }),
        });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: `Lead ${input.id} approved for cold email`, result: data });
      } catch (err: any) {
        return JSON.stringify({ error: `Cold email approval failed: ${err.message}` });
      }
    }

    case 'exclude_cold_email': {
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/enrichment/leads/${input.id}/exclude-cold-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: input.reason || 'Excluded via AI assistant' }),
        });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: `Lead ${input.id} excluded from cold email`, result: data });
      } catch (err: any) {
        return JSON.stringify({ error: `Exclusion failed: ${err.message}` });
      }
    }

    case 'process_lead': {
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/enrichment/leads/${input.id}/process`, { method: 'POST' });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: `Full pipeline processing triggered for lead ${input.id}`, result: data });
      } catch (err: any) {
        return JSON.stringify({ error: `Processing failed: ${err.message}` });
      }
    }

    case 'get_campaigns': {
      let sql = 'SELECT ca.*, c.name as company_name FROM campaigns ca LEFT JOIN companies c ON ca.company_id = c.id';
      const params: any[] = [];
      if (input.company_id) {
        sql += ' WHERE ca.company_id = ?';
        params.push(input.company_id);
      }
      sql += ' ORDER BY ca.id DESC';
      const campaigns = queryAll(sql, params).map((c: any) => ({
        ...c,
        stats: c.stats_json ? JSON.parse(c.stats_json) : null,
        stats_json: undefined,
      }));
      return JSON.stringify({ count: campaigns.length, campaigns });
    }

    case 'get_campaign_detail': {
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/campaigns/${input.id}/detail`);
        const data = await resp.json();
        return JSON.stringify(data);
      } catch (err: any) {
        return JSON.stringify({ error: `Failed to get campaign detail: ${err.message}` });
      }
    }

    case 'pause_campaign': {
      runSql('UPDATE campaigns SET status = ? WHERE id = ?', ['paused', input.id]);
      saveDb();
      return JSON.stringify({ success: true, message: `Campaign ${input.id} paused` });
    }

    case 'activate_campaign': {
      runSql('UPDATE campaigns SET status = ? WHERE id = ?', ['active', input.id]);
      saveDb();
      return JSON.stringify({ success: true, message: `Campaign ${input.id} activated` });
    }

    case 'get_tasks': {
      let sql = 'SELECT * FROM tasks WHERE 1=1';
      const params: any[] = [];
      if (input.status) { sql += ' AND status = ?'; params.push(input.status); }
      if (input.priority) { sql += ' AND priority = ?'; params.push(input.priority); }
      sql += ' ORDER BY CASE priority WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, created_at DESC';
      const tasks = queryAll(sql, params);
      return JSON.stringify({ count: tasks.length, tasks });
    }

    case 'create_task': {
      runSql(
        'INSERT INTO tasks (title, description, priority, status, company_id) VALUES (?, ?, ?, ?, ?)',
        [input.title, input.description || '', input.priority || 'medium', 'todo', input.company_id || null]
      );
      saveDb();
      const task = queryOne('SELECT * FROM tasks ORDER BY id DESC LIMIT 1');
      return JSON.stringify({ success: true, task });
    }

    case 'complete_task': {
      const task = queryOne('SELECT * FROM tasks WHERE id = ?', [input.id]);
      if (!task) return JSON.stringify({ error: 'Task not found' });
      runSql('UPDATE tasks SET status = ? WHERE id = ?', ['done', input.id]);
      saveDb();
      return JSON.stringify({ success: true, message: `Task "${task.title}" marked as done` });
    }

    case 'get_alerts': {
      const alerts = queryAll('SELECT * FROM alerts WHERE acknowledged = 0 ORDER BY created_at DESC');
      return JSON.stringify({ count: alerts.length, alerts });
    }

    case 'acknowledge_alert': {
      runSql('UPDATE alerts SET acknowledged = 1 WHERE id = ?', [input.id]);
      saveDb();
      return JSON.stringify({ success: true, message: `Alert ${input.id} acknowledged` });
    }

    case 'get_dashboard_summary': {
      const summary = queryOne(`SELECT
        (SELECT COUNT(*) FROM campaigns WHERE status = 'active') as active_campaigns,
        (SELECT COUNT(*) FROM campaigns) as total_campaigns,
        (SELECT COUNT(*) FROM tasks WHERE status != 'done') as open_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'done') as completed_tasks,
        (SELECT COUNT(*) FROM alerts WHERE acknowledged = 0) as active_alerts,
        (SELECT COUNT(*) FROM agents WHERE status = 'active') as active_agents,
        (SELECT COUNT(*) FROM agents) as total_agents,
        (SELECT COUNT(*) FROM enrichment_leads) as total_leads,
        (SELECT COUNT(*) FROM enrichment_leads WHERE status = 'enriched' OR status = 'scored' OR status = 'pushed') as enriched_leads,
        (SELECT COUNT(*) FROM enrichment_leads WHERE score_label = 'hot') as hot_leads,
        (SELECT COUNT(*) FROM enrichment_leads WHERE score_label = 'warm') as warm_leads,
        (SELECT COUNT(*) FROM reply_threads WHERE status = 'active') as active_threads,
        (SELECT COUNT(*) FROM reply_threads WHERE status = 'escalated') as escalated_threads
      `);
      const companies = queryAll('SELECT id, name, color FROM companies');
      return JSON.stringify({ summary, companies });
    }

    case 'get_enrichment_stats': {
      let sql = 'SELECT company_id';
      sql += ", COUNT(*) as total";
      sql += ", SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads";
      sql += ", SUM(CASE WHEN status = 'enriched' THEN 1 ELSE 0 END) as enriched";
      sql += ", SUM(CASE WHEN status = 'scored' THEN 1 ELSE 0 END) as scored";
      sql += ", SUM(CASE WHEN status = 'pushed' THEN 1 ELSE 0 END) as pushed";
      sql += ", SUM(CASE WHEN status = 'excluded' THEN 1 ELSE 0 END) as excluded";
      sql += ", SUM(CASE WHEN score_label = 'hot' THEN 1 ELSE 0 END) as hot";
      sql += ", SUM(CASE WHEN score_label = 'warm' THEN 1 ELSE 0 END) as warm";
      sql += ", SUM(CASE WHEN score_label = 'cold' THEN 1 ELSE 0 END) as cold";
      sql += ", SUM(CASE WHEN instantly_push_status = 'pushed' THEN 1 ELSE 0 END) as cold_email_pushed";
      sql += " FROM enrichment_leads";
      const params: any[] = [];
      if (input.company_id) {
        sql += ' WHERE company_id = ?';
        params.push(input.company_id);
      }
      sql += ' GROUP BY company_id';
      const stats = queryAll(sql, params);
      return JSON.stringify({ stats });
    }

    case 'get_agents': {
      let sql = 'SELECT * FROM agents';
      const params: any[] = [];
      if (input.company_id) {
        sql += ' WHERE company_id = ?';
        params.push(input.company_id);
      }
      const agents = queryAll(sql, params);
      return JSON.stringify({ count: agents.length, agents });
    }

    case 'get_reply_threads': {
      let sql = 'SELECT rt.*, el.email, el.first_name, el.last_name FROM reply_threads rt LEFT JOIN enrichment_leads el ON rt.enrichment_lead_id = el.id WHERE 1=1';
      const params: any[] = [];
      if (input.company_id) { sql += ' AND rt.company_id = ?'; params.push(input.company_id); }
      if (input.status) { sql += ' AND rt.status = ?'; params.push(input.status); }
      sql += ' ORDER BY rt.updated_at DESC LIMIT 30';
      const threads = queryAll(sql, params);
      return JSON.stringify({ count: threads.length, threads });
    }

    case 'send_manual_reply': {
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/enrichment/threads/${input.thread_id}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: input.body }),
        });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: 'Reply sent', result: data });
      } catch (err: any) {
        return JSON.stringify({ error: `Send reply failed: ${err.message}` });
      }
    }

    case 'get_competitors': {
      const competitors = queryAll('SELECT * FROM competitors ORDER BY id DESC');
      const result = competitors.map((c: any) => {
        const changes = queryAll('SELECT * FROM competitor_changes WHERE competitor_id = ? ORDER BY detected_at DESC LIMIT 5', [c.id]);
        return { ...c, recent_changes: changes };
      });
      return JSON.stringify({ count: result.length, competitors: result });
    }

    case 'navigate_to': {
      return JSON.stringify({
        action: 'navigate',
        path: input.path,
        reason: input.reason || `Navigating to ${input.path}`,
      });
    }

    // ── Yacht Event Executors ──────────────────────────────────
    case 'list_yacht_events': {
      let sql = 'SELECT ye.*, (SELECT COUNT(*) FROM yacht_event_attendees WHERE event_id = ye.id) as total_attendees, (SELECT COUNT(*) FROM yacht_event_attendees WHERE event_id = ye.id AND status = \'checked_in\') as checked_in FROM yacht_events ye';
      const params: any[] = [];
      if (input.status) {
        sql += ' WHERE ye.status = ?';
        params.push(input.status);
      }
      sql += ' ORDER BY ye.event_date DESC';
      const events = queryAll(sql, params);
      return JSON.stringify({ count: events.length, events });
    }

    case 'get_yacht_event': {
      const event = queryOne('SELECT * FROM yacht_events WHERE id = ?', [input.id]);
      if (!event) return JSON.stringify({ error: 'Event not found' });
      const attendees = queryAll('SELECT * FROM yacht_event_attendees WHERE event_id = ? ORDER BY status DESC, last_name ASC', [input.id]);
      const checkedIn = attendees.filter((a: any) => a.status === 'checked_in').length;
      const vips = attendees.filter((a: any) => a.vip_flag === 1).length;
      return JSON.stringify({
        event,
        stats: { total: attendees.length, checked_in: checkedIn, pending: attendees.length - checkedIn, vips },
        attendees,
      });
    }

    case 'create_yacht_event': {
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/yacht-events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: input.name,
            eventDate: input.event_date,
            location: input.location,
            maxCapacity: input.max_capacity,
            notes: input.notes,
          }),
        });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: `Event "${input.name}" created`, event: data });
      } catch (err: any) {
        return JSON.stringify({ error: `Failed to create event: ${err.message}` });
      }
    }

    case 'add_yacht_attendees': {
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/yacht-events/${input.event_id}/attendees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attendees: input.attendees }),
        });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: `Added attendees to event ${input.event_id}`, result: data });
      } catch (err: any) {
        return JSON.stringify({ error: `Failed to add attendees: ${err.message}` });
      }
    }

    case 'import_yacht_attendees_from_ghl': {
      try {
        const resp = await fetch(`http://localhost:${config.port}/api/yacht-events/${input.event_id}/import-ghl`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag: input.tag || 'approved for event' }),
        });
        const data = await resp.json();
        return JSON.stringify({ success: true, message: `Imported GHL contacts tagged "${input.tag || 'approved for event'}" to event ${input.event_id}`, result: data });
      } catch (err: any) {
        return JSON.stringify({ error: `GHL import failed: ${err.message}` });
      }
    }

    case 'get_yacht_checkin_stats': {
      const event = queryOne('SELECT * FROM yacht_events WHERE id = ?', [input.event_id]);
      if (!event) return JSON.stringify({ error: 'Event not found' });
      const attendees = queryAll('SELECT * FROM yacht_event_attendees WHERE event_id = ?', [input.event_id]);
      const checkedIn = attendees.filter((a: any) => a.status === 'checked_in');
      const vips = attendees.filter((a: any) => a.vip_flag === 1);
      const vipsCheckedIn = checkedIn.filter((a: any) => a.vip_flag === 1);
      return JSON.stringify({
        event_name: event.name,
        event_date: event.event_date,
        status: event.status,
        total_attendees: attendees.length,
        checked_in: checkedIn.length,
        pending: attendees.length - checkedIn.length,
        check_in_rate: attendees.length > 0 ? `${Math.round((checkedIn.length / attendees.length) * 100)}%` : '0%',
        total_vips: vips.length,
        vips_checked_in: vipsCheckedIn.length,
        recent_checkins: checkedIn.slice(-5).map((a: any) => ({
          name: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
          email: a.email,
          checked_in_at: a.checked_in_at,
        })),
      });
    }

    case 'get_yacht_qr_url': {
      const event = queryOne('SELECT id, check_in_code, name FROM yacht_events WHERE id = ?', [input.event_id]);
      if (!event) return JSON.stringify({ error: 'Event not found' });
      const baseUrl = input.base_url || `http://localhost:${config.port}`;
      return JSON.stringify({
        event_name: event.name,
        check_in_url: `${baseUrl}/yacht-checkin/${event.check_in_code}`,
        qr_code_png: `${baseUrl}/api/yacht-events/${event.id}/qr?baseUrl=${encodeURIComponent(baseUrl)}`,
        printable_page: `${baseUrl}/api/yacht-events/${event.id}/qr-page?baseUrl=${encodeURIComponent(baseUrl)}`,
        instructions: 'Print the QR page and display at the event entrance. Guests scan with their phone camera to check in.',
      });
    }

    // ── Email Deliverability & Warmup Executors ─────────────
    case 'get_domain_health': {
      const { domainHealthService } = await import('../services/domain-health-service');
      if (input.domain) {
        const history = domainHealthService.getDomainHistory(input.domain, 1);
        if (history.length === 0) return JSON.stringify({ error: `No health data for domain "${input.domain}". Run a health check first.` });
        const snap = history[0];
        return JSON.stringify({
          domain: snap.domain,
          health_score: snap.health_score,
          spf_valid: !!snap.spf_valid,
          dkim_valid: !!snap.dkim_valid,
          dmarc_valid: !!snap.dmarc_valid,
          blacklisted: !!snap.blacklisted,
          blacklist_details: snap.blacklist_details ? JSON.parse(snap.blacklist_details) : [],
          account_count: snap.account_count,
          accounts_warming: snap.accounts_warming,
          accounts_ready: snap.accounts_ready,
          avg_open_rate: snap.avg_open_rate,
          avg_bounce_rate: snap.avg_bounce_rate,
          avg_spam_rate: snap.avg_spam_rate,
          total_sent_7d: snap.total_sent_7d,
          checked_at: snap.checked_at,
        });
      }
      const summary = domainHealthService.getSummary();
      const snapshots = domainHealthService.getLatestSnapshots();
      return JSON.stringify({
        summary,
        domains: snapshots.map((s: any) => ({
          domain: s.domain,
          health_score: s.health_score,
          spf: !!s.spf_valid,
          dkim: !!s.dkim_valid,
          dmarc: !!s.dmarc_valid,
          blacklisted: !!s.blacklisted,
          accounts: s.account_count,
          warming: s.accounts_warming,
          ready: s.accounts_ready,
          bounce_rate: s.avg_bounce_rate,
          spam_rate: s.avg_spam_rate,
          checked_at: s.checked_at,
        })),
      });
    }

    case 'get_warmup_status': {
      const warmupRow = queryOne('SELECT status_json FROM warmup_status WHERE id = 1');
      if (!warmupRow?.status_json) return JSON.stringify({ status: 'No warmup data yet. The monitor runs every 6 hours.' });
      return warmupRow.status_json;
    }

    case 'run_domain_health_check': {
      const { domainHealthService } = await import('../services/domain-health-service');
      const results = await domainHealthService.fullHealthCheck(input.domain || undefined);
      return JSON.stringify({
        checked: results.length,
        domains: results.map((r: any) => ({
          domain: r.domain,
          health_score: r.health_score,
          dns: r.dns,
          blacklisted: r.blacklist?.blacklisted,
          metrics: r.metrics,
          auto_actions: r.auto_actions,
        })),
      });
    }

    // ── Post-Meeting Follow-Up Executors ───────────────────
    case 'list_post_meeting_followups': {
      let sql = `SELECT mt.id, mt.meeting_date, mt.duration_minutes, mt.followup_status, mt.followup_type, mt.followup_scheduled_at, mt.opportunity_value,
                        el.first_name, el.last_name, el.email, el.score, el.score_label,
                        json_extract(mt.analysis, '$.investment_likelihood') as likelihood,
                        json_extract(mt.analysis, '$.sentiment') as sentiment
                 FROM meeting_transcripts mt
                 LEFT JOIN enrichment_leads el ON mt.lead_id = el.id
                 WHERE 1=1`;
      const params: any[] = [];
      if (input.followup_status) { sql += ' AND mt.followup_status = ?'; params.push(input.followup_status); }
      if (input.followup_type) { sql += ' AND mt.followup_type = ?'; params.push(input.followup_type); }
      sql += ' ORDER BY mt.created_at DESC LIMIT ?';
      params.push(input.limit || 20);
      const results = queryAll(sql, params);
      return JSON.stringify({ followups: results, total: results.length });
    }

    case 'get_meeting_analysis': {
      const mt = queryOne('SELECT * FROM meeting_transcripts WHERE id = ?', [input.transcript_id]);
      if (!mt) return JSON.stringify({ error: 'Transcript not found' });
      const lead = mt.lead_id ? queryOne('SELECT first_name, last_name, email, score, score_label, status FROM enrichment_leads WHERE id = ?', [mt.lead_id]) : null;
      let analysis: any = {};
      try { analysis = mt.analysis ? JSON.parse(mt.analysis) : {}; } catch { analysis = {}; }
      let nextSteps: any = [];
      try { nextSteps = mt.next_steps ? JSON.parse(mt.next_steps) : []; } catch { nextSteps = []; }
      return JSON.stringify({
        transcript_id: mt.id,
        meeting_date: mt.meeting_date,
        duration_minutes: mt.duration_minutes,
        lead: lead || null,
        sentiment: analysis.sentiment,
        investment_likelihood: analysis.investment_likelihood,
        accredited_confirmed: analysis.accredited_confirmed,
        investment_timeline: analysis.investment_timeline,
        key_topics: analysis.key_topics || [],
        objections: analysis.objections || [],
        next_steps: nextSteps,
        personalized_follow_up: analysis.personalized_follow_up,
        sequence_recommendation: mt.sequence_assigned,
        followup_status: mt.followup_status,
        followup_type: mt.followup_type,
        followup_scheduled_at: mt.followup_scheduled_at,
        opportunity_value: mt.opportunity_value,
      });
    }

    case 'update_followup_status': {
      const mt = queryOne('SELECT id, followup_thread_id FROM meeting_transcripts WHERE id = ?', [input.transcript_id]);
      if (!mt) return JSON.stringify({ error: 'Transcript not found' });
      const updates: string[] = [];
      const params: any[] = [];
      if (input.status) {
        updates.push('followup_status = ?');
        params.push(input.status);
      }
      if (input.reschedule_hours) {
        const newSchedule = new Date(Date.now() + input.reschedule_hours * 60 * 60 * 1000).toISOString();
        updates.push('followup_scheduled_at = ?');
        params.push(newSchedule);
        updates.push("followup_status = 'scheduled'");
        // Also update the reply_message scheduled_at if there's a pending one
        if (mt.followup_thread_id) {
          runSql(
            `UPDATE reply_messages SET scheduled_at = ? WHERE thread_id = ? AND sent = 0 AND strategy LIKE 'post_meeting_%' ORDER BY id DESC LIMIT 1`,
            [newSchedule, mt.followup_thread_id]
          );
        }
      }
      if (updates.length === 0) return JSON.stringify({ error: 'No updates provided' });
      params.push(input.transcript_id);
      runSql(`UPDATE meeting_transcripts SET ${updates.join(', ')} WHERE id = ?`, params);
      saveDb();
      return JSON.stringify({ success: true, transcript_id: input.transcript_id, updates: input });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ── Main Endpoint ────────────────────────────────────────────────

router.post('/chat', async (req, res) => {
  try {
    if (!config.anthropicApiKey) {
      return res.status(503).json({ error: 'Claude API not configured. Set ANTHROPIC_API_KEY.' });
    }

    const { message, conversation_id } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    // Load recent conversation history
    const history = queryAll(
      'SELECT role, content FROM assistant_chat_history WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 20',
      [conversation_id || 'default']
    );

    // Save user message
    runSql(
      'INSERT INTO assistant_chat_history (conversation_id, role, content) VALUES (?, ?, ?)',
      [conversation_id || 'default', 'user', message]
    );

    // Build messages
    const messages: Anthropic.MessageParam[] = [
      ...history.map((h: any) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: message },
    ];

    // Load company playbooks for dynamic context instead of hardcoding
    const companyPlaybooks = queryAll('SELECT company_id, company_name, company_description, target_icp FROM company_playbooks');
    const companyDescriptions = companyPlaybooks.map((p: any) =>
      `- ${p.company_name} (ID: ${p.company_id}) — ${p.company_description}`
    ).join('\n');

    const systemPrompt = `You are the AI Command Center assistant for a multi-company sales operations dashboard. You can execute real actions on the dashboard using the tools provided.

COMPANIES:
${companyDescriptions || '- Granite Park Capital (ID: 1)\n- Brand Me Now (ID: 2)'}

IMPORTANT — COMPANY ISOLATION:
- Each company has its own leads, pipelines, campaigns, and playbooks. NEVER mix company data.
- When a user asks about leads, campaigns, or pipeline data, always clarify or determine which company they mean.
- Granite Park Capital (GPC) is an investment fund — its leads are investors. Do NOT reference GPC fund details, yacht events, accredited investor requirements, or investment terms when working with any other company.
- Brand Me Now (BMN) is a brand creation platform — its leads are influencers, creators, and agencies. Do NOT reference BMN creator funnels or brand-building when working with GPC.

COMPLIANCE GUARDRAILS (GPC ONLY — do NOT apply to other companies):
- NEVER guarantee specific returns. Use "targeting" or "projected" — never "will earn" or "guaranteed returns"
- NEVER provide legal, tax, or financial advice. Escalate to Marc or appropriate professional.
- ALWAYS confirm accredited investor status before sharing detailed fund materials
- NEVER share PPM, subscription docs, or specific investor information via AI — escalate to Marc
- If a prospect asks about risks, be transparent: real estate investments carry risks including illiquidity, market risk, and potential loss of principal
- All outbound communications must include or reference: "This is not an offer to sell or solicitation to buy. For accredited investors only."
- If unsure about compliance, ALWAYS escalate rather than guess
- Do NOT auto-send emails containing fund terms without human review

CAPABILITIES:
- Search, view, create, enrich, and score contacts/leads
- View and control email campaigns (pause, activate)
- Manage tasks (create, complete, list)
- View and acknowledge alerts
- View dashboard analytics and enrichment pipeline stats
- View email reply threads and send replies
- Monitor competitors
- Navigate the user to specific dashboard pages

GUIDELINES:
- Be concise and actionable. Use the tools to get real data before answering.
- When the user asks about contacts, campaigns, or data — always use the appropriate tool to fetch live data.
- When the user asks you to DO something (enrich, score, create, pause, etc.) — use the tool to execute it and confirm the result.
- Format responses with clear structure. Use bullet points for lists.
- If an action has consequences (pausing campaigns, sending emails), briefly confirm what you're about to do.
- Reference specific IDs and names so the user knows exactly what you acted on.
- When suggesting navigation, use the navigate_to tool so the frontend can handle it.`;

    // Run tool-use loop (max 5 iterations)
    let currentMessages = messages;
    const actionsPerformed: { tool: string; input: any; result: any }[] = [];
    let finalText = '';

    for (let iteration = 0; iteration < 5; iteration++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        tools,
        messages: currentMessages,
      });

      // Collect text and tool use blocks
      const textBlocks = response.content.filter((b) => b.type === 'text');
      const toolBlocks = response.content.filter((b) => b.type === 'tool_use');

      if (textBlocks.length > 0) {
        finalText += textBlocks.map((b) => (b as Anthropic.TextBlock).text).join('\n');
      }

      // If no tool calls, we're done
      if (toolBlocks.length === 0 || response.stop_reason === 'end_turn') {
        break;
      }

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolBlocks) {
        const toolBlock = block as Anthropic.ToolUseBlock;
        const result = await executeTool(toolBlock.name, toolBlock.input);
        actionsPerformed.push({ tool: toolBlock.name, input: toolBlock.input, result: JSON.parse(result) });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: result,
        });
      }

      // Add assistant response and tool results for next iteration
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];
    }

    // Save assistant response
    runSql(
      'INSERT INTO assistant_chat_history (conversation_id, role, content) VALUES (?, ?, ?)',
      [conversation_id || 'default', 'assistant', finalText]
    );
    saveDb();

    // Extract navigation actions
    const navigationAction = actionsPerformed.find((a) => a.tool === 'navigate_to');

    res.json({
      response: finalText,
      actions: actionsPerformed.map((a) => ({ tool: a.tool, input: a.input })),
      navigation: navigationAction?.result || null,
    });
  } catch (err: any) {
    console.error('[AI Assistant] chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get assistant chat history
router.get('/history', (req, res) => {
  const conversationId = (req.query.conversation_id as string) || 'default';
  const history = queryAll(
    'SELECT * FROM assistant_chat_history WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100',
    [conversationId]
  );
  res.json(history);
});

// Clear assistant chat history
router.delete('/history', (req, res) => {
  const conversationId = (req.query.conversation_id as string) || 'default';
  runSql('DELETE FROM assistant_chat_history WHERE conversation_id = ?', [conversationId]);
  saveDb();
  res.json({ success: true });
});

export default router;
