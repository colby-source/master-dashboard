import { Router, Request, Response, NextFunction } from 'express';
import { anymailfinderClient } from '../services/anymailfinder-client';

const router = Router();

// POST /find-person — find email by name + domain
router.post('/find-person', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!anymailfinderClient.available) {
      return res.status(503).json({ error: 'Anymailfinder API key not configured' });
    }

    const { domain, company_name, full_name, first_name, last_name } = req.body;
    if (!domain && !company_name) {
      return res.status(400).json({ error: 'domain or company_name is required' });
    }
    if (!full_name && !(first_name && last_name)) {
      return res.status(400).json({ error: 'full_name or first_name + last_name is required' });
    }

    const result = await anymailfinderClient.findPersonEmail({
      domain, company_name, full_name, first_name, last_name,
    });
    res.json(result || { email: null, email_status: 'not_found', valid_email: null });
  } catch (err) {
    next(err);
  }
});

// POST /find-company — find up to 20 emails at a company
router.post('/find-company', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!anymailfinderClient.available) {
      return res.status(503).json({ error: 'Anymailfinder API key not configured' });
    }

    const { domain, company_name, email_type } = req.body;
    if (!domain && !company_name) {
      return res.status(400).json({ error: 'domain or company_name is required' });
    }

    const result = await anymailfinderClient.findCompanyEmails({ domain, company_name, email_type });
    res.json(result || { email_status: 'not_found', emails: [], valid_emails: [] });
  } catch (err) {
    next(err);
  }
});

// POST /verify — verify a single email
router.post('/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!anymailfinderClient.available) {
      return res.status(503).json({ error: 'Anymailfinder API key not configured' });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const result = await anymailfinderClient.verifyEmail(email);
    res.json(result || { email, email_status: 'risky' });
  } catch (err) {
    next(err);
  }
});

// GET /status — check if Anymailfinder is configured
router.get('/status', (_req: Request, res: Response) => {
  res.json({ available: anymailfinderClient.available });
});

export default router;
