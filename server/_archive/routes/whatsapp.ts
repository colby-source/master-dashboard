import { Router, Request, Response } from 'express';
import { whatsappService } from '../services/whatsapp-service';
import { config } from '../config';
import { createLogger } from '../utils/logger';
const log = createLogger('whatsapp');

const router = Router();

// ── Send Messages ────────────────────────────────────────────

router.post('/send/text', async (req: Request, res: Response) => {
  try {
    const { to, body, previewUrl } = req.body;
    res.json(await whatsappService.sendText(to, body, { previewUrl }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/send/template', async (req: Request, res: Response) => {
  try {
    const { to, templateName, language, components } = req.body;
    res.json(await whatsappService.sendTemplate(to, templateName, language || 'en_US', components));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/send/image', async (req: Request, res: Response) => {
  try {
    const { to, link, id, caption } = req.body;
    res.json(await whatsappService.sendImage(to, { link, id, caption }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/send/document', async (req: Request, res: Response) => {
  try {
    const { to, link, id, caption, filename } = req.body;
    res.json(await whatsappService.sendDocument(to, { link, id, caption, filename }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/send/video', async (req: Request, res: Response) => {
  try {
    const { to, link, id, caption } = req.body;
    res.json(await whatsappService.sendVideo(to, { link, id, caption }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/send/audio', async (req: Request, res: Response) => {
  try {
    const { to, link, id } = req.body;
    res.json(await whatsappService.sendAudio(to, { link, id }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/send/location', async (req: Request, res: Response) => {
  try {
    const { to, latitude, longitude, name, address } = req.body;
    res.json(await whatsappService.sendLocation(to, { latitude, longitude, name, address }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/send/buttons', async (req: Request, res: Response) => {
  try {
    const { to, body, buttons, header, footer } = req.body;
    res.json(await whatsappService.sendButtons(to, body, buttons, { header, footer }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/send/list', async (req: Request, res: Response) => {
  try {
    const { to, body, buttonText, sections, header, footer } = req.body;
    res.json(await whatsappService.sendList(to, body, buttonText, sections, { header, footer }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/send/reaction', async (req: Request, res: Response) => {
  try {
    const { to, messageId, emoji } = req.body;
    res.json(await whatsappService.sendReaction(to, messageId, emoji));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/mark-read', async (req: Request, res: Response) => {
  try {
    res.json(await whatsappService.markAsRead(req.body.messageId));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Media ────────────────────────────────────────────────────

router.get('/media/:mediaId', async (req: Request, res: Response) => {
  try { res.json(await whatsappService.getMediaUrl(req.params.mediaId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/media/:mediaId', async (req: Request, res: Response) => {
  try { res.json(await whatsappService.deleteMedia(req.params.mediaId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Templates ────────────────────────────────────────────────

router.get('/templates', async (req: Request, res: Response) => {
  try {
    res.json(await whatsappService.listTemplates({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      status: req.query.status as string,
    }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/templates', async (req: Request, res: Response) => {
  try { res.json(await whatsappService.createTemplate(req.body)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/templates/:name', async (req: Request, res: Response) => {
  try { res.json(await whatsappService.deleteTemplate(req.params.name)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Phone Numbers ────────────────────────────────────────────

router.get('/phone-numbers', async (_req: Request, res: Response) => {
  try { res.json(await whatsappService.listPhoneNumbers()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/phone-numbers/:id', async (req: Request, res: Response) => {
  try { res.json(await whatsappService.getPhoneNumber(req.params.id)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Business Profile ─────────────────────────────────────────

router.get('/profile', async (_req: Request, res: Response) => {
  try { res.json(await whatsappService.getBusinessProfile()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/profile', async (req: Request, res: Response) => {
  try { res.json(await whatsappService.updateBusinessProfile(req.body)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Webhook ──────────────────────────────────────────────────

router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.whatsappWebhookVerifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

router.post('/webhook', (req: Request, res: Response) => {
  const parsed = whatsappService.parseWebhook(req.body);
  // Log incoming messages for now; extend with DB storage / real-time push later
  if (parsed.messages.length > 0) {
    log.info(`[WhatsApp] ${parsed.messages.length} incoming message(s)`);
    for (const msg of parsed.messages) {
      log.info(`  from=${msg.from} type=${msg.type} ${msg.text?.body ?? ''}`);
    }
  }
  if (parsed.statuses.length > 0) {
    log.info(`[WhatsApp] ${parsed.statuses.length} status update(s)`);
  }
  // Must respond 200 quickly or Meta retries
  res.sendStatus(200);
});

export default router;
