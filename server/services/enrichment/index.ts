// ── Import all modules ──────────────────────────────────────

import { scoreLead, getStats, getAutoReplyStats } from './scoring';
import { getCompanyConfig, updateLead, logEvent } from './helpers';
import {
  handleReply,
  processScheduledReplies,
  processWarmNurture,
  getPlaybook,
  getThread,
  getThreadMessages,
  getThreads,
  sendManualReply,
  updateThreadStatus,
} from './reply-handler';
import {
  setupColdEmailPipeline,
  getPipelineConfig,
  createColdEmailOpportunity,
  syncOpportunityStage,
  loseOpportunity,
} from './opportunity-pipeline';
import { generateEmailSequence } from './email-generator';
import { captureCampaignSnapshot, analyzePersonalizationPerformance, getCampaignTrend } from './campaign-tracker';
import { runOptimizationCycle, getLatestInsights, getReplyStrategyInsights } from './feedback-loop';
import {
  enrichLead,
  pushToGhl,
  approveForColdEmail,
  bulkApproveForColdEmail,
  excludeFromColdEmail,
  processLead,
  reEnrichStale,
  checkKnownContact,
  determineColdEmailStatus,
  importKnownContactsFromGhl,
  bulkProcessImport,
  advanceLeadStage,
  fastTrackEventAttendees,
  migrateCampaignWithPersonalization,
} from './pipeline';

// ── Re-export types ─────────────────────────────────────────

export type {
  EnrichmentLead,
  EnrichmentConfig,
  CompanyPlaybook,
  ReplyThread,
  HandleReplyResult,
} from './types';

// ── Re-export all functions ─────────────────────────────────

export {
  // helpers
  getCompanyConfig,
  updateLead,
  logEvent,
  // scoring
  scoreLead,
  getStats,
  getAutoReplyStats,
  // reply-handler
  handleReply,
  processScheduledReplies,
  processWarmNurture,
  getPlaybook,
  getThread,
  getThreadMessages,
  getThreads,
  sendManualReply,
  updateThreadStatus,
  // pipeline
  enrichLead,
  pushToGhl,
  approveForColdEmail,
  bulkApproveForColdEmail,
  excludeFromColdEmail,
  processLead,
  reEnrichStale,
  checkKnownContact,
  determineColdEmailStatus,
  importKnownContactsFromGhl,
  bulkProcessImport,
  advanceLeadStage,
  fastTrackEventAttendees,
  migrateCampaignWithPersonalization,
  // opportunity-pipeline
  setupColdEmailPipeline,
  getPipelineConfig,
  createColdEmailOpportunity,
  syncOpportunityStage,
  loseOpportunity,
  // email generation & optimization
  generateEmailSequence,
  captureCampaignSnapshot,
  analyzePersonalizationPerformance,
  getCampaignTrend,
  runOptimizationCycle,
  getLatestInsights,
};

// ── Compose class for backward compatibility ────────────────
// Consumers import `enrichmentService` singleton and call methods on it.

class EnrichmentService {
  enrichLead = enrichLead;
  scoreLead = scoreLead;
  pushToGhl = pushToGhl;
  approveForColdEmail = approveForColdEmail;
  bulkApproveForColdEmail = bulkApproveForColdEmail;
  excludeFromColdEmail = excludeFromColdEmail;
  processLead = processLead;
  reEnrichStale = reEnrichStale;
  checkKnownContact = checkKnownContact;
  determineColdEmailStatus = determineColdEmailStatus;
  importKnownContactsFromGhl = importKnownContactsFromGhl;
  getStats = getStats;
  getCompanyConfig = getCompanyConfig;
  getAutoReplyStats = getAutoReplyStats;
  processScheduledReplies = processScheduledReplies;
  processWarmNurture = processWarmNurture;
  getPlaybook = getPlaybook;
  getThread = getThread;
  getThreadMessages = getThreadMessages;
  getThreads = getThreads;
  sendManualReply = sendManualReply;
  updateThreadStatus = updateThreadStatus;
  bulkProcessImport = bulkProcessImport;
  advanceLeadStage = advanceLeadStage;
  fastTrackEventAttendees = fastTrackEventAttendees;
  setupColdEmailPipeline = setupColdEmailPipeline;
  getPipelineConfig = getPipelineConfig;
  createColdEmailOpportunity = createColdEmailOpportunity;
  syncOpportunityStage = syncOpportunityStage;
  loseOpportunity = loseOpportunity;
  // email generation & optimization
  generateEmailSequence = generateEmailSequence;
  captureCampaignSnapshot = captureCampaignSnapshot;
  analyzePersonalizationPerformance = analyzePersonalizationPerformance;
  getCampaignTrend = getCampaignTrend;
  runOptimizationCycle = runOptimizationCycle;
  getLatestInsights = getLatestInsights;

  async handleReply(params: {
    email: string;
    replyText: string;
    instantlyEmailId?: string;
    campaignId?: string;
    eaccount?: string;
    preClassifiedSentiment?: import('./types').InstantlySentiment;
  }) {
    return handleReply(params, {
      processLead,
      excludeFromColdEmail,
    });
  }
}

export const enrichmentService = new EnrichmentService();

// Process scheduled replies every 30 seconds
setInterval(() => {
  enrichmentService.processScheduledReplies().catch((err: any) => {
    console.error('[AutoReply] processScheduledReplies error:', err.message);
  });
}, 30000);

// Process warm nurture for stalled positive threads every 30 minutes
setInterval(() => {
  enrichmentService.processWarmNurture().catch((err: any) => {
    console.error('[WarmNurture] processWarmNurture error:', err.message);
  });
}, 30 * 60 * 1000);

// Poll Instantly Unibox for new replies every 2 minutes
import { pollInstantlyReplies } from './reply-poller';
setInterval(() => {
  pollInstantlyReplies().catch((err: any) => {
    console.error('[ReplyPoller] pollInstantlyReplies error:', err.message);
  });
}, 2 * 60 * 1000);
// Run first poll 10 seconds after startup
setTimeout(() => {
  pollInstantlyReplies().catch((err: any) => {
    console.error('[ReplyPoller] initial poll error:', err.message);
  });
}, 10000);

// Process meeting reminders every 5 minutes
import { processMeetingReminders } from '../meeting-scheduler';
setInterval(() => {
  processMeetingReminders().catch((err: any) => {
    console.error('[MeetingReminder] processMeetingReminders error:', err.message);
  });
}, 5 * 60 * 1000);

// Retry failed Instantly pushes every 15 minutes
import { retryFailedInstantlyPushes } from './pipeline';
setInterval(() => {
  retryFailedInstantlyPushes().catch((err: any) => {
    console.error('[Enrichment] retryFailedInstantlyPushes error:', err.message);
  });
}, 15 * 60 * 1000);

// Sync GHL opportunity stages back to DB every 15 minutes
import { syncGhlOpportunitiesToDb } from './opportunity-pipeline';
setInterval(() => {
  syncGhlOpportunitiesToDb().catch((err: any) => {
    console.error('[GhlSync] syncGhlOpportunitiesToDb error:', err.message);
  });
}, 15 * 60 * 1000);

// Initialize SMS notifications (daily report + hot lead alerts)
import { initSmsNotifications } from '../sms-notifications';
initSmsNotifications();

// Initialize CMO health monitor (trend-based early warnings — 7:30 AM, 12:30 PM, 5:30 PM ET)
import { initCmoHealthMonitor } from '../cmo-health-monitor';
initCmoHealthMonitor();

// ── BMN Follow-Up Cadence (polls GHL → Claude personalized emails → book calls) ──
import { migrateBmnFollowup, runFollowupCycle } from '../bmn/cadence';
migrateBmnFollowup();
setInterval(() => {
  runFollowupCycle().catch((err: any) => {
    console.error('[BmnFollowup] runFollowupCycle error:', err.message);
  });
}, 30 * 60 * 1000); // every 30 minutes
// Initial run 15 seconds after startup
setTimeout(() => {
  runFollowupCycle().catch((err: any) => {
    console.error('[BmnFollowup] initial cycle error:', err.message);
  });
}, 15000);

// Daily LinkedIn outreach at 9:00 AM ET
import { linkedInService } from '../linkedin-service';
import { config as appConfig } from '../../config';
import { schedule as cronSchedule } from 'node-cron';
if (appConfig.linkedinAutoSendEnabled) {
  cronSchedule('0 9 * * *', () => {
    linkedInService.runDailyOutreach().catch((err: any) => {
      console.error('[LinkedInOutreach] Daily outreach error:', err.message);
    });
  }, { timezone: 'America/New_York' });
  console.log('[LinkedInOutreach] Daily outreach scheduled — 9:00 AM ET');

  // Check for accepted connections every 4 hours (8 AM, 12 PM, 4 PM, 8 PM ET)
  cronSchedule('0 8,12,16,20 * * *', () => {
    linkedInService.checkAcceptances().catch((err: any) => {
      console.error('[LinkedInSequence] Acceptance check error:', err.message);
    });
  }, { timezone: 'America/New_York' });
  console.log('[LinkedInSequence] Acceptance checker scheduled — every 4h ET');

  // Process DM sequence every 2 hours (9 AM, 11 AM, 1 PM, 3 PM, 5 PM ET)
  cronSchedule('0 9,11,13,15,17 * * *', () => {
    linkedInService.processSequence().catch((err: any) => {
      console.error('[LinkedInSequence] Sequence processing error:', err.message);
    });
  }, { timezone: 'America/New_York' });
  console.log('[LinkedInSequence] DM sequence processor scheduled — every 2h ET (business hours)');
} else {
  console.log('[LinkedInOutreach] Auto-send disabled (set LINKEDIN_AUTO_SEND_ENABLED=true to enable)');
}

// ── Campaign Performance Tracking & Self-Optimization ──────
// Dynamically track all companies with active campaigns
import { queryAll as trackerQueryAll } from '../../db';

function getTrackedCampaigns(): Array<{ campaignId: string; companyId: number }> {
  const rows = trackerQueryAll(
    `SELECT company_id, target_instantly_campaign_id
     FROM enrichment_config
     WHERE target_instantly_campaign_id IS NOT NULL`
  );
  return rows.map((r: any) => ({
    campaignId: r.target_instantly_campaign_id,
    companyId: r.company_id,
  }));
}

// Capture campaign snapshots every 2 hours
setInterval(() => {
  for (const { campaignId, companyId } of getTrackedCampaigns()) {
    captureCampaignSnapshot(campaignId, companyId).catch((err: any) => {
      console.error('[CampaignTracker] Snapshot error:', err.message);
    });
  }
}, 2 * 60 * 60 * 1000);

// Run optimization cycle every 4 hours (analyze performance, detect winners, generate insights)
setInterval(() => {
  for (const { companyId } of getTrackedCampaigns()) {
    runOptimizationCycle(companyId).catch((err: any) => {
      console.error('[FeedbackLoop] Optimization cycle error:', err.message);
    });
  }
}, 4 * 60 * 60 * 1000);

// Initial snapshot 30 seconds after startup
setTimeout(() => {
  for (const { campaignId, companyId } of getTrackedCampaigns()) {
    captureCampaignSnapshot(campaignId, companyId).catch((err: any) => {
      console.error('[CampaignTracker] Initial snapshot error:', err.message);
    });
  }
}, 30000);

console.log('[EmailEngine] Personalization engine active — full Claude-powered email generation enabled');
console.log('[CampaignTracker] Performance tracking scheduled — snapshots every 2h, optimization every 4h');
