import { Router } from 'express';
import { createLogger } from '../utils/logger';
import { handleChat, getChatHistory, clearChatHistory } from '../services/ai-assistant-service';

const log = createLogger('ai-assistant');
const router = Router();

// ── POST /chat — Send a message to the AI assistant ─────────────
router.post('/chat', async (req, res) => {
  try {
    const { message, conversation_id } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }

    const result = await handleChat({ message, conversation_id });
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes('not configured')) {
      return res.status(503).json({ error: err.message });
    }
    log.error('[AI Assistant] chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /history — Get assistant chat history ───────────────────
router.get('/history', (req, res) => {
  const conversationId = (req.query.conversation_id as string) || 'default';
  const history = getChatHistory(conversationId);
  res.json(history);
});

// ── DELETE /history — Clear assistant chat history ──────────────
router.delete('/history', (req, res) => {
  const conversationId = (req.query.conversation_id as string) || 'default';
  clearChatHistory(conversationId);
  res.json({ success: true });
});

export default router;
