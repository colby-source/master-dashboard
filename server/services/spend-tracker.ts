import { runSql, queryAll, queryOne } from '../db';
import { createAlert } from './alert-service';
import { createLogger } from '../utils/logger';
const log = createLogger('spend-tracker');

// Known provider limits and costs (in cents)
const PROVIDER_LIMITS: Record<string, { monthlyCredits?: number; description: string }> = {
  apollo: { monthlyCredits: 10000, description: 'Apollo (10K credits/month, free tier)' },
  pdl: { description: 'People Data Labs (pay-per-call)' },
  millionverifier: { description: 'MillionVerifier (pay-per-email)' },
  hunter: { description: 'Hunter.io (pay-per-call)' },
  anthropic: { description: 'Anthropic Claude (pay-per-call)' },
  apify: { description: 'Apify (pay-per-run)' },
  anymailfinder: { description: 'Anymailfinder (pay-per-find)' },
};

// Known cost per call type (in cents)
export const KNOWN_COSTS: Record<string, Record<string, number>> = {
  apollo: { enrich_person: 0, enrich_organization: 0 },
  pdl: { enrich_person: 28, enrich_company: 10 },
  millionverifier: { verify_email: 0 }, // $0.0003 — rounds to 0, tracked by count
  hunter: { verify_email: 1, find_email: 3, domain_search: 3 },
  anthropic: { score_lead: 0, generate_reply: 0, suggest_task: 0, chat: 0 },
  apify: { run_actor: 0 },
  anymailfinder: { find_person_email: 0, find_company_emails: 0, verify_email: 0 },
};

// Known credit costs per call type (for credit-based APIs)
const KNOWN_CREDITS: Record<string, Record<string, number>> = {
  apollo: { enrich_person: 1, enrich_organization: 1 },
  anymailfinder: { find_person_email: 1, find_company_emails: 1, verify_email: 0 },
};

/**
 * Log an API call for spend tracking.
 * Fire-and-forget — errors are logged but never thrown.
 */
export function trackApiCall(
  provider: string,
  callType: string,
  costCents?: number,
  creditsUsed?: number,
  leadId?: number
): void {
  try {
    const finalCost = costCents ?? KNOWN_COSTS[provider]?.[callType] ?? 0;
    const finalCredits = creditsUsed ?? KNOWN_CREDITS[provider]?.[callType] ?? null;

    runSql(
      `INSERT INTO api_usage_tracking (provider, call_type, cost_cents, credits_used, lead_id) VALUES (?, ?, ?, ?, ?)`,
      [provider, callType, finalCost, finalCredits, leadId ?? null]
    );

    // Check credit limits asynchronously (don't block the caller)
    if (PROVIDER_LIMITS[provider]?.monthlyCredits) {
      checkCreditsRemaining(provider);
    }
  } catch (err: any) {
    log.error(`[SpendTracker] Failed to track ${provider}/${callType}:`, err.message);
  }
}

/**
 * Get usage summary, optionally filtered by provider and date range.
 */
export function getUsageSummary(
  provider?: string,
  startDate?: string,
  endDate?: string
): any[] {
  let where = '1=1';
  const params: any[] = [];

  if (provider) {
    where += ' AND provider = ?';
    params.push(provider);
  }
  if (startDate) {
    where += ' AND created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    where += ' AND created_at <= ?';
    params.push(endDate);
  }

  return queryAll(
    `SELECT
       provider,
       call_type,
       COUNT(*) as call_count,
       SUM(cost_cents) as total_cost_cents,
       SUM(credits_used) as total_credits
     FROM api_usage_tracking
     WHERE ${where}
     GROUP BY provider, call_type
     ORDER BY provider, call_type`,
    params
  );
}

/**
 * Get spend breakdown for a specific day (defaults to today).
 */
export function getDailySpend(date?: string): any[] {
  const targetDate = date || new Date().toISOString().split('T')[0];

  return queryAll(
    `SELECT
       provider,
       call_type,
       COUNT(*) as call_count,
       SUM(cost_cents) as total_cost_cents,
       SUM(credits_used) as total_credits
     FROM api_usage_tracking
     WHERE date(created_at) = ?
     GROUP BY provider, call_type
     ORDER BY total_cost_cents DESC`,
    [targetDate]
  );
}

/**
 * Get spend for a specific month (defaults to current month).
 * Pass month as 'YYYY-MM' format.
 */
export function getMonthlySpend(month?: string): any[] {
  const targetMonth = month || new Date().toISOString().slice(0, 7);

  return queryAll(
    `SELECT
       provider,
       call_type,
       COUNT(*) as call_count,
       SUM(cost_cents) as total_cost_cents,
       SUM(credits_used) as total_credits
     FROM api_usage_tracking
     WHERE strftime('%Y-%m', created_at) = ?
     GROUP BY provider, call_type
     ORDER BY provider, total_cost_cents DESC`,
    [targetMonth]
  );
}

/**
 * Check if a provider is running low on credits this month.
 * Fires an alert if usage exceeds 80% of the monthly limit.
 */
export function checkCreditsRemaining(provider: string): {
  provider: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  warningLevel: 'ok' | 'warning' | 'critical';
} {
  const limit = PROVIDER_LIMITS[provider]?.monthlyCredits ?? null;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const row = queryOne(
    `SELECT COALESCE(SUM(credits_used), 0) as total_credits
     FROM api_usage_tracking
     WHERE provider = ? AND strftime('%Y-%m', created_at) = ?`,
    [provider, currentMonth]
  );

  const used = row?.total_credits ?? 0;
  const remaining = limit !== null ? limit - used : null;

  let warningLevel: 'ok' | 'warning' | 'critical' = 'ok';

  if (limit !== null) {
    const usagePercent = (used / limit) * 100;

    if (usagePercent >= 95) {
      warningLevel = 'critical';
      createAlert(
        'api_credits_critical',
        'critical',
        `${provider} credits nearly exhausted: ${used}/${limit} used (${Math.round(usagePercent)}%)`,
        'spend-tracker',
        'provider',
        provider
      );
    } else if (usagePercent >= 80) {
      warningLevel = 'warning';
      createAlert(
        'api_credits_warning',
        'warning',
        `${provider} credits running low: ${used}/${limit} used (${Math.round(usagePercent)}%)`,
        'spend-tracker',
        'provider',
        provider
      );
    }
  }

  return { provider, used, limit, remaining, warningLevel };
}
