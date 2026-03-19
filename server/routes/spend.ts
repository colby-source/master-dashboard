import { Router } from 'express';
import {
  getUsageSummary,
  getDailySpend,
  getMonthlySpend,
  checkCreditsRemaining,
} from '../services/spend-tracker';

const router = Router();

// GET /api/spend/summary — current month summary by provider
router.get('/summary', (_req, res) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const summary = getUsageSummary(undefined, `${currentMonth}-01`);

    // Also include credit checks for credit-based providers
    const creditChecks = ['apollo'].map((provider) => checkCreditsRemaining(provider));

    res.json({ month: currentMonth, usage: summary, credits: creditChecks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/spend/daily?date=YYYY-MM-DD — today's breakdown (or specific date)
router.get('/daily', (req, res) => {
  try {
    const date = req.query.date as string | undefined;
    const breakdown = getDailySpend(date);
    const targetDate = date || new Date().toISOString().split('T')[0];

    res.json({ date: targetDate, breakdown });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/spend/monthly?months=3 — last N months of spend
router.get('/monthly', (req, res) => {
  try {
    const monthCount = Math.min(parseInt(req.query.months as string) || 3, 12);
    const months: { month: string; usage: any[] }[] = [];

    for (let i = 0; i < monthCount; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStr = d.toISOString().slice(0, 7);
      months.push({ month: monthStr, usage: getMonthlySpend(monthStr) });
    }

    res.json({ months });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
