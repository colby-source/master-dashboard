// ── Telegram Notification Service ────────────────────────────
// Primary channel for CMO digests, health alerts, and rich notifications.
// SMS is reserved for critical-only short alerts.

import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';

let bot: TelegramBot | null = null;

function getBot(): TelegramBot | null {
  if (bot) return bot;
  if (!config.telegramBotToken) {
    console.warn('[Telegram] No TELEGRAM_BOT_TOKEN set — notifications disabled');
    return null;
  }
  // polling: false — we only send messages, don't listen for commands
  bot = new TelegramBot(config.telegramBotToken, { polling: false });
  console.log('[Telegram] Bot initialized (send-only mode)');
  return bot;
}

// ── Send to a specific chat ──────────────────────────────────

export async function sendTelegram(
  chatId: string,
  message: string,
  options?: { parse_mode?: 'Markdown' | 'HTML'; disable_web_page_preview?: boolean },
): Promise<boolean> {
  const client = getBot();
  if (!client || !chatId) {
    console.warn('[Telegram] Cannot send — bot or chatId not configured');
    return false;
  }

  try {
    await client.sendMessage(chatId, message, {
      parse_mode: options?.parse_mode || 'Markdown',
      disable_web_page_preview: options?.disable_web_page_preview ?? true,
    });
    return true;
  } catch (err: any) {
    console.error('[Telegram] Send failed:', err.message);
    return false;
  }
}

// ── Send to operator by company ID ───────────────────────────

export async function sendTelegramToOperator(
  companyId: number,
  message: string,
  options?: { parse_mode?: 'Markdown' | 'HTML'; disable_web_page_preview?: boolean },
): Promise<boolean> {
  const chatId = config.telegramChatIdByCompany[companyId] || config.telegramChatId;
  if (!chatId) {
    console.warn(`[Telegram] No chat ID for company ${companyId} — skipping`);
    return false;
  }
  return sendTelegram(chatId, message, options);
}

// ── Convenience: send to default (Colby) ─────────────────────

export async function sendTelegramToDefault(
  message: string,
  options?: { parse_mode?: 'Markdown' | 'HTML'; disable_web_page_preview?: boolean },
): Promise<boolean> {
  return sendTelegram(config.telegramChatId, message, options);
}

// ── Check if Telegram is configured ──────────────────────────

export function isTelegramConfigured(): boolean {
  return Boolean(config.telegramBotToken && config.telegramChatId);
}
