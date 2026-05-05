/**
 * yacht-events.ts — Yacht mixer event routes.
 *
 * Public routes (no auth): /api/yacht-checkin/*
 * Admin routes (auth): /api/yacht-events/*
 *
 * Business logic lives in ../services/yacht-event-service.ts
 */

import { Router } from 'express';
import { createLogger } from '../utils/logger';
import * as svc from '../services/yacht-event-service';
import { buildCheckinPageHtml } from './yacht-checkin-page';

const log = createLogger('yacht-events');

// ── Guest-Facing Check-In Page (serves HTML when QR is scanned) ──

export const yachtCheckinPageRouter = Router();

/** GET /yacht-checkin/:code — Serve the mobile check-in page */
yachtCheckinPageRouter.get('/:code', (req, res) => {
  const code = req.params.code;
  const html = buildCheckinPageHtml(code);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ── Public Check-In API Routes (no auth, guests scan QR) ──────────

export const yachtCheckinRouter = Router();

/** GET /api/yacht-checkin/:code — Get event info for check-in page */
yachtCheckinRouter.get('/:code', (req, res) => {
  try {
    const event = svc.findEventByCheckInCode(req.params.code);

    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status === 'cancelled') return res.status(410).json({ error: 'This event has been cancelled' });
    if (event.status === 'completed') return res.status(410).json({ error: 'This event has ended' });

    res.json({
      event: {
        name: event.name,
        date: event.event_date,
        location: event.location,
        yacht: event.yacht_name,
        status: event.status,
      },
      checkedIn: svc.getCheckedInCount(event.id),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/yacht-checkin/:code — Guest registers & checks in via QR form */
yachtCheckinRouter.post('/:code', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, company, investorType, rulesAccepted } = req.body;
    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }

    const event = svc.findEventByCheckInCode(req.params.code);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status === 'cancelled' || event.status === 'completed') {
      return res.status(410).json({ error: 'This event is no longer active' });
    }

    const result = svc.checkinGuest(event, { firstName, lastName, email, phone, company, investorType, rulesAccepted });
    res.json(result);
  } catch (err: any) {
    log.error('Check-in error:', err.message);
    res.status(500).json({ error: 'Check-in failed. Please try again or speak with the event coordinator.' });
  }
});

// ── Admin Routes (behind auth) ────────────────────────────────────

export const yachtEventsRouter = Router();

/** GET /api/yacht-events — List all events */
yachtEventsRouter.get('/', (_req, res) => {
  try {
    res.json(svc.listEventsWithCounts());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/yacht-events — Create a new event */
yachtEventsRouter.post('/', (req, res) => {
  try {
    const { name, eventDate, location, yachtName, maxCapacity, notes } = req.body;
    if (!name || !eventDate) return res.status(400).json({ error: 'name and eventDate required' });

    const result = svc.createEvent({ name, eventDate, location, yachtName, maxCapacity, notes });
    if (result?.error) return res.status(result.status || 500).json({ error: result.error });

    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/yacht-events/:id — Get event with attendees */
yachtEventsRouter.get('/:id', (req, res) => {
  try {
    const data = svc.getEventWithAttendees(req.params.id);
    if (!data) return res.status(404).json({ error: 'Event not found' });

    res.json({ ...data.event, attendees: data.attendees });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/yacht-events/:id — Update event */
yachtEventsRouter.put('/:id', (req, res) => {
  try {
    const { name, eventDate, location, yachtName, maxCapacity, status, notes } = req.body;
    const result = svc.updateEvent(req.params.id, { name, eventDate, location, yachtName, maxCapacity, status, notes });
    if (result?.error) return res.status(result.status || 400).json({ error: result.error });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/yacht-events/:id/attendees — Add attendees (single or bulk) */
yachtEventsRouter.post('/:id/attendees', (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const event = svc.findEventById(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const attendees = Array.isArray(req.body) ? req.body : [req.body];
    res.json(svc.addAttendees(eventId, attendees));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/yacht-events/:id/attendees/:attendeeId — Remove attendee */
yachtEventsRouter.delete('/:id/attendees/:attendeeId', (req, res) => {
  try {
    svc.removeAttendee(req.params.id, req.params.attendeeId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/yacht-events/:id/import-ghl — Import attendees from GHL by tag */
yachtEventsRouter.post('/:id/import-ghl', async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const event = svc.findEventById(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const result = await svc.importFromGhl(eventId, req.body.tag, req.body.companyId);
    if ('error' in result) return res.status(500).json(result);

    res.json(result);
  } catch (err: any) {
    log.error('GHL import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/yacht-events/:id/qr — Generate QR code for event */
yachtEventsRouter.get('/:id/qr', async (req, res) => {
  try {
    const event = svc.findEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const baseUrl = req.query.baseUrl as string || `${req.protocol}://${req.get('host')}`;
    const checkinUrl = svc.buildCheckinUrl(event, baseUrl);

    if (req.query.format === 'svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(await svc.generateQrSvg(checkinUrl));
    } else {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="yacht-checkin-${event.check_in_code}.png"`);
      res.send(await svc.generateQrPng(checkinUrl));
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/yacht-events/:id/qr-page — Generate printable QR code page (HTML) */
yachtEventsRouter.get('/:id/qr-page', async (req, res) => {
  try {
    const event = svc.findEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const baseUrl = req.query.baseUrl as string || `${req.protocol}://${req.get('host')}`;
    const checkinUrl = svc.buildCheckinUrl(event, baseUrl);
    const qrDataUrl = await svc.generateQrDataUrl(checkinUrl);

    res.setHeader('Content-Type', 'text/html');
    res.send(svc.buildQrPageHtml(event, qrDataUrl));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
