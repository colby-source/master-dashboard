import { Router } from 'express';
import { queryAll } from '../db';

const router = Router();

router.get('/', (req, res) => {
  try {
    const events = queryAll('SELECT * FROM events ORDER BY created_at DESC LIMIT 100');
    res.json(events);
  } catch (err: any) {
    console.error('[Routes:Events] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

export default router;
