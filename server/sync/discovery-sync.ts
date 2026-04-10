import { queryAll, queryOne, runSql } from '../db';
import { saveDb } from '../db';

interface DiscoveryCandidate {
  title: string;
  summary: string;
  category: string;
  platform: string;
}

class DiscoverySync {
  async sync() {
    console.log('[Sync:Discoveries] Analyzing data...');
    const discoveries: DiscoveryCandidate[] = [];

    discoveries.push(...this.analyzeCampaigns());
    discoveries.push(...this.analyzeAgents());
    discoveries.push(...this.analyzeTasks());
    discoveries.push(...this.analyzeAlerts());
    discoveries.push(...this.analyzeSystemHealth());
    discoveries.push(...this.analyzeGhlStatus());

    let inserted = 0;
    for (const d of discoveries) {
      const existing = queryOne(
        `SELECT id FROM ai_discoveries WHERE title = ? AND discovered_at > datetime('now', '-24 hours')`,
        [d.title]
      );
      if (existing) continue;

      runSql(
        `INSERT INTO ai_discoveries (title, platform, summary, category) VALUES (?, ?, ?, ?)`,
        [d.title, d.platform, d.summary, d.category]
      );
      inserted++;
    }

    runSql(`DELETE FROM ai_discoveries WHERE saved = 0 AND discovered_at < datetime('now', '-7 days')`);

    if (inserted > 0) saveDb();
    console.log(`[Sync:Discoveries] Generated ${inserted} new insights`);
  }

  private analyzeCampaigns(): DiscoveryCandidate[] {
    const results: DiscoveryCandidate[] = [];
    const campaigns = queryAll(`SELECT * FROM campaigns WHERE stats_json IS NOT NULL`);

    if (campaigns.length === 0) return results;

    // Campaign count summary
    const active = campaigns.filter((c: any) => c.status === 'active');
    const paused = campaigns.filter((c: any) => c.status === 'paused');
    const draft = campaigns.filter((c: any) => c.status === 'draft');
    if (campaigns.length > 0) {
      results.push({
        title: `Campaign overview: ${campaigns.length} total`,
        summary: `${active.length} active, ${paused.length} paused, ${draft.length} draft campaigns across all platforms. ${active.length === 0 ? 'No campaigns currently running — consider activating some.' : ''}`,
        category: 'overview',
        platform: 'instantly',
      });
    }

    // Find top performer by reply rate (lowered threshold to 1 sent)
    let topReply: any = null;
    let topReplyRate = 0;
    let totalReplyRate = 0;
    let activeCampaigns = 0;
    let totalSent = 0;
    let totalOpened = 0;
    let totalReplied = 0;
    let totalBounced = 0;

    for (const c of campaigns) {
      try {
        const stats = JSON.parse(c.stats_json);
        totalSent += stats.sent || 0;
        totalOpened += stats.opened || 0;
        totalReplied += stats.replied || 0;
        totalBounced += stats.bounced || 0;

        const replyRate = parseFloat(stats.reply_rate) || 0;
        if (stats.sent > 0) {
          activeCampaigns++;
          totalReplyRate += replyRate;
          if (replyRate > topReplyRate) {
            topReplyRate = replyRate;
            topReply = { ...c, stats };
          }
        }
      } catch { /* expected */ }
    }

    // Global email stats
    if (totalSent > 0) {
      const globalOpenRate = ((totalOpened / totalSent) * 100).toFixed(1);
      const globalReplyRate = ((totalReplied / totalSent) * 100).toFixed(1);
      const globalBounceRate = ((totalBounced / totalSent) * 100).toFixed(1);
      results.push({
        title: `Email stats: ${totalSent.toLocaleString()} sent`,
        summary: `Global metrics — ${globalOpenRate}% open rate, ${globalReplyRate}% reply rate, ${globalBounceRate}% bounce rate across ${activeCampaigns} campaigns with sends.`,
        category: 'performance',
        platform: 'instantly',
      });
    }

    // Top performer
    if (topReply && activeCampaigns > 1 && topReplyRate > 0) {
      const avgReplyRate = totalReplyRate / activeCampaigns;
      if (topReplyRate > avgReplyRate * 1.3) {
        results.push({
          title: `Top performer: "${topReply.name}"`,
          summary: `${topReplyRate}% reply rate — ${(topReplyRate / Math.max(avgReplyRate, 0.01)).toFixed(1)}x above average (${avgReplyRate.toFixed(1)}%). Study this campaign's messaging.`,
          category: 'performance',
          platform: 'instantly',
        });
      }
    }

    // Find underperformers (lowered from 100 sent to 10)
    for (const c of campaigns) {
      try {
        const stats = JSON.parse(c.stats_json);
        if (stats.sent > 10 && parseFloat(stats.open_rate) < 25) {
          results.push({
            title: `Low open rate: "${c.name}"`,
            summary: `Only ${stats.open_rate}% open rate across ${stats.sent} emails. Consider A/B testing subject lines or checking sender reputation.`,
            category: 'action-needed',
            platform: 'instantly',
          });
          break; // Only show the worst one
        }
      } catch { /* expected */ }
    }

    // High bounce rate campaigns
    for (const c of campaigns) {
      try {
        const stats = JSON.parse(c.stats_json);
        if (stats.sent > 10 && stats.bounced > 0) {
          const bounceRate = (stats.bounced / stats.sent) * 100;
          if (bounceRate > 5) {
            results.push({
              title: `High bounce: "${c.name}" (${bounceRate.toFixed(1)}%)`,
              summary: `${stats.bounced} bounced out of ${stats.sent} sent. Clean your lead list or verify emails before sending.`,
              category: 'action-needed',
              platform: 'instantly',
            });
            break;
          }
        }
      } catch { /* expected */ }
    }

    return results;
  }

  private analyzeAgents(): DiscoveryCandidate[] {
    const results: DiscoveryCandidate[] = [];
    const agents = queryAll(`SELECT * FROM agents`);

    if (agents.length === 0) return results;

    const activeAgents = agents.filter((a: any) => a.status === 'active');
    const pausedAgents = agents.filter((a: any) => a.status === 'paused' || a.status === 'inactive');

    results.push({
      title: `${agents.length} agents tracked`,
      summary: `${activeAgents.length} active, ${pausedAgents.length} paused/inactive. Types: ${[...new Set(agents.map((a: any) => a.type))].join(', ')}.`,
      category: 'overview',
      platform: 'system',
    });

    // Stale agents
    for (const agent of agents) {
      if (agent.status === 'active' && agent.last_run) {
        const lastRun = new Date(agent.last_run + 'Z');
        const hoursAgo = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60);
        if (hoursAgo > 48) {
          results.push({
            title: `Stale agent: "${agent.name}"`,
            summary: `Marked active but hasn't run in ${Math.floor(hoursAgo)} hours. May need investigation.`,
            category: 'action-needed',
            platform: agent.type,
          });
        }
      }
    }

    // Low success rate
    const lowSuccess = activeAgents.filter((a: any) => a.success_rate < 95);
    if (lowSuccess.length > 0) {
      results.push({
        title: `${lowSuccess.length} agent${lowSuccess.length > 1 ? 's' : ''} below 95% success`,
        summary: lowSuccess.map((a: any) => `${a.name}: ${a.success_rate}%`).join(', '),
        category: 'action-needed',
        platform: 'system',
      });
    }

    return results;
  }

  private analyzeTasks(): DiscoveryCandidate[] {
    const results: DiscoveryCandidate[] = [];

    const taskCounts = queryOne(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) as todo,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
      FROM tasks`
    );

    if (taskCounts && taskCounts.total > 0) {
      results.push({
        title: `Tasks: ${taskCounts.todo} to-do, ${taskCounts.in_progress} in progress, ${taskCounts.done} done`,
        summary: `${taskCounts.total} total tasks. ${taskCounts.todo > 5 ? 'Backlog is growing — consider prioritizing.' : 'Backlog looks manageable.'}`,
        category: 'overview',
        platform: 'system',
      });
    }

    // Overdue tasks (lowered from 3 to 1)
    const overdue = queryOne(
      `SELECT COUNT(*) as count FROM tasks WHERE status != 'done' AND due_date IS NOT NULL AND due_date < datetime('now')`
    );
    if (overdue?.count > 0) {
      results.push({
        title: `${overdue.count} overdue task${overdue.count > 1 ? 's' : ''}`,
        summary: `Task${overdue.count > 1 ? 's have' : ' has'} passed ${overdue.count > 1 ? 'their' : 'its'} due date. Re-prioritize or extend deadlines.`,
        category: 'action-needed',
        platform: 'system',
      });
    }

    // Task completion trend
    const recentDone = queryOne(
      `SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND completed_at > datetime('now', '-7 days')`
    );
    const previousDone = queryOne(
      `SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND completed_at BETWEEN datetime('now', '-14 days') AND datetime('now', '-7 days')`
    );
    if (recentDone?.count > 0 && previousDone?.count > 0) {
      const change = ((recentDone.count - previousDone.count) / previousDone.count) * 100;
      if (Math.abs(change) > 20) {
        results.push({
          title: change > 0 ? 'Task velocity increasing' : 'Task velocity decreasing',
          summary: `${recentDone.count} tasks this week vs ${previousDone.count} last week (${change > 0 ? '+' : ''}${change.toFixed(0)}%).`,
          category: change > 0 ? 'trend' : 'action-needed',
          platform: 'system',
        });
      }
    }

    return results;
  }

  private analyzeAlerts(): DiscoveryCandidate[] {
    const results: DiscoveryCandidate[] = [];

    const recentAlerts = queryOne(
      `SELECT COUNT(*) as count FROM alerts WHERE created_at > datetime('now', '-24 hours')`
    );
    if (recentAlerts?.count > 5) {
      results.push({
        title: `${recentAlerts.count} alerts in 24h`,
        summary: `Alert volume is ${recentAlerts.count > 15 ? 'very high' : 'elevated'}. Review and triage to prevent alert fatigue.`,
        category: 'action-needed',
        platform: 'system',
      });
    }

    const unacked = queryOne(`SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0`);
    if (unacked?.count > 3) {
      results.push({
        title: `${unacked.count} unacknowledged alerts`,
        summary: `Triage and acknowledge resolved alerts to keep the feed actionable.`,
        category: 'action-needed',
        platform: 'system',
      });
    }

    return results;
  }

  private analyzeSystemHealth(): DiscoveryCandidate[] {
    const results: DiscoveryCandidate[] = [];

    // Check integrations
    const integrations = queryAll(`SELECT * FROM integrations`);
    const errored = integrations.filter((i: any) => i.status === 'error');
    const active = integrations.filter((i: any) => i.status === 'active');

    if (integrations.length > 0) {
      results.push({
        title: `Integrations: ${active.length}/${integrations.length} healthy`,
        summary: errored.length > 0
          ? `Issues with: ${errored.map((i: any) => i.name).join(', ')}. Check API keys and permissions.`
          : `All ${active.length} integrations running normally.`,
        category: errored.length > 0 ? 'action-needed' : 'overview',
        platform: 'system',
      });
    }

    // OpenClaw health
    const latestOcHealth = queryOne(
      `SELECT value FROM metrics WHERE metric_type = 'openclaw_online' ORDER BY recorded_at DESC LIMIT 1`
    );
    if (latestOcHealth) {
      const isOnline = latestOcHealth.value === 1;
      if (!isOnline) {
        results.push({
          title: 'OpenClaw gateway offline',
          summary: 'The OpenClaw ACP gateway is not responding. Check the physical connection and gateway service.',
          category: 'action-needed',
          platform: 'openclaw',
        });
      }
    }

    return results;
  }

  private analyzeGhlStatus(): DiscoveryCandidate[] {
    const results: DiscoveryCandidate[] = [];

    // Check for GHL access issues from latest metrics
    const ghlContacts = queryAll(
      `SELECT company_id, value FROM metrics WHERE metric_type = 'total_contacts'
       AND recorded_at > datetime('now', '-2 hours')
       ORDER BY recorded_at DESC`
    );

    if (ghlContacts.length > 0) {
      const companies = queryAll(`SELECT id, name FROM companies`);
      const companyMap = Object.fromEntries(companies.map((c: any) => [c.id, c.name]));
      const summary = ghlContacts
        .filter((m: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.company_id === m.company_id) === i)
        .map((m: any) => `${companyMap[m.company_id] || `Company ${m.company_id}`}: ${m.value}`)
        .join(', ');

      if (summary) {
        results.push({
          title: 'GHL Contact counts',
          summary: `Latest contact totals — ${summary}`,
          category: 'overview',
          platform: 'ghl',
        });
      }
    }

    return results;
  }
}

export const discoverySync = new DiscoverySync();
