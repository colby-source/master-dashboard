// ── Import all modules ──────────────────────────────────────
import { createLogger } from '../../utils/logger';
const log = createLogger('enrichment');

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
import { autoOptimizeSequence } from './sequence-optimizer';
import { promoteWinningStrategies, autoAddObjectionHandlers } from './playbook-evolver';
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

export type {
  Segment,
  Tier,
  EmailState,
  EmailChannel,
  MxProvider,
  DomainIntel,
  FOSignals,
  TierPResult,
  VendorCall,
  Tier0Result,
  PreflightResult,
  CalibrationRow,
  EstimateInput,
  EstimateOutput,
} from './types-enrichment';

// ── Enrichment v2 modules ───────────────────────────────────
export {
  classifySegment,
  isFreemail,
  isGatekeeperTitle,
  hasFirmNameSignal,
  hasFOPrincipalTitle,
  isOperatorTitle,
  segmentAllowsAutoApproval,
  segmentPdlGate,
  segmentStaleDays,
} from './segment-router';

export {
  runTier0Gates,
  isValidEmailSyntax,
  isDisposable,
  isRoleEmail,
  isPlaceholder,
  inGlobalSuppression,
  inHnwSuppression,
  isDuplicateInFlight,
  addToGlobalSuppression,
} from './tier-0-gates';

export {
  runTier05DomainIntel,
  firmNameSignalMatch,
} from './tier-05-domain-intel';

export {
  gatherDnsIntel,
  getMxProvider,
  hasDmarcRecord,
  hasSpfRecord,
  isOnSpamhausDbl,
  hasMx,
  whoisAgeDays,
} from './dns-intel';

export {
  computeScoreHint,
  minScoreHintForTier2,
} from './score-hint';

export {
  preflight,
  formatPreflight,
} from './preflight';

export {
  estimateBatchCost,
  formatEstimate,
} from './cost-estimator';

export {
  generatePersonalizationHook,
  recordPatternWin,
} from './personalization-hook';

export {
  onReplyClassified,
  segmentReplyPerformance,
  getLookalikeSeeds,
  weeklyLearningDigest,
} from './reply-intelligence';

export {
  cacheGet,
  cacheSet,
  cacheBust,
  DEFAULT_TTL_DAYS,
} from './cache-layer';

export {
  logCostEvent,
  checkCaps,
  withCostLedger,
  todayCostSummary,
  COST_CAPS,
} from './cost-ledger';

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
  // self-learning
  autoOptimizeSequence,
  promoteWinningStrategies,
  autoAddObjectionHandlers,
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
  // self-learning
  autoOptimizeSequence = autoOptimizeSequence;
  promoteWinningStrategies = promoteWinningStrategies;
  autoAddObjectionHandlers = autoAddObjectionHandlers;

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
    log.error('[AutoReply] processScheduledReplies error:', err.message);
  });
}, 30000);

// Process warm nurture for stalled positive threads every 30 minutes
setInterval(() => {
  enrichmentService.processWarmNurture().catch((err: any) => {
    log.error('[WarmNurture] processWarmNurture error:', err.message);
  });
}, 30 * 60 * 1000);

// Poll Instantly Unibox for new replies every 2 minutes
import { pollInstantlyReplies } from './reply-poller';
setInterval(() => {
  pollInstantlyReplies().catch((err: any) => {
    log.error('[ReplyPoller] pollInstantlyReplies error:', err.message);
  });
}, 2 * 60 * 1000);
// Run first poll 10 seconds after startup
setTimeout(() => {
  pollInstantlyReplies().catch((err: any) => {
    log.error('[ReplyPoller] initial poll error:', err.message);
  });
}, 10000);

// Process meeting reminders every 5 minutes
import { processMeetingReminders } from '../meeting-scheduler';
setInterval(() => {
  processMeetingReminders().catch((err: any) => {
    log.error('[MeetingReminder] processMeetingReminders error:', err.message);
  });
}, 5 * 60 * 1000);

// Retry failed Instantly pushes every 15 minutes
import { retryFailedInstantlyPushes } from './pipeline';
setInterval(() => {
  retryFailedInstantlyPushes().catch((err: any) => {
    log.error('[Enrichment] retryFailedInstantlyPushes error:', err.message);
  });
}, 15 * 60 * 1000);

// Sync GHL opportunity stages back to DB every 15 minutes
import { syncGhlOpportunitiesToDb } from './opportunity-pipeline';
setInterval(() => {
  syncGhlOpportunitiesToDb().catch((err: any) => {
    log.error('[GhlSync] syncGhlOpportunitiesToDb error:', err.message);
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
    log.error('[BmnFollowup] runFollowupCycle error:', err.message);
  });
}, 30 * 60 * 1000); // every 30 minutes
// Initial run 15 seconds after startup
setTimeout(() => {
  runFollowupCycle().catch((err: any) => {
    log.error('[BmnFollowup] initial cycle error:', err.message);
  });
}, 15000);

// Daily LinkedIn outreach at 9:00 AM ET
import { linkedInService } from '../linkedin-service';
import { config as appConfig } from '../../config';
import { schedule as cronSchedule } from 'node-cron';
if (appConfig.linkedinAutoSendEnabled) {
  cronSchedule('0 9 * * *', () => {
    linkedInService.runDailyOutreach().catch((err: any) => {
      log.error('[LinkedInOutreach] Daily outreach error:', err.message);
    });
  }, { timezone: 'America/New_York' });
  log.info('[LinkedInOutreach] Daily outreach scheduled — 9:00 AM ET');

  // Check for accepted connections every 4 hours (8 AM, 12 PM, 4 PM, 8 PM ET)
  cronSchedule('0 8,12,16,20 * * *', () => {
    linkedInService.checkAcceptances().catch((err: any) => {
      log.error('[LinkedInSequence] Acceptance check error:', err.message);
    });
  }, { timezone: 'America/New_York' });
  log.info('[LinkedInSequence] Acceptance checker scheduled — every 4h ET');

  // Process DM sequence every 2 hours (9 AM, 11 AM, 1 PM, 3 PM, 5 PM ET)
  cronSchedule('0 9,11,13,15,17 * * *', () => {
    linkedInService.processSequence().catch((err: any) => {
      log.error('[LinkedInSequence] Sequence processing error:', err.message);
    });
  }, { timezone: 'America/New_York' });
  log.info('[LinkedInSequence] DM sequence processor scheduled — every 2h ET (business hours)');
} else {
  log.info('[LinkedInOutreach] Auto-send disabled (set LINKEDIN_AUTO_SEND_ENABLED=true to enable)');
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
      log.error('[CampaignTracker] Snapshot error:', err.message);
    });
  }
}, 2 * 60 * 60 * 1000);

// Run optimization cycle every 4 hours (analyze performance, detect winners, generate insights)
setInterval(() => {
  for (const { companyId } of getTrackedCampaigns()) {
    runOptimizationCycle(companyId).catch((err: any) => {
      log.error('[FeedbackLoop] Optimization cycle error:', err.message);
    });
  }
}, 4 * 60 * 60 * 1000);

// Initial snapshot 30 seconds after startup
setTimeout(() => {
  for (const { campaignId, companyId } of getTrackedCampaigns()) {
    captureCampaignSnapshot(campaignId, companyId).catch((err: any) => {
      log.error('[CampaignTracker] Initial snapshot error:', err.message);
    });
  }
}, 30000);

log.info('[EmailEngine] Personalization engine active — full Claude-powered email generation enabled');
log.info('[CampaignTracker] Performance tracking scheduled — snapshots every 2h, optimization every 4h');
