import 'dotenv/config';

function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (!val && fallback === undefined) {
    console.warn(`Warning: Missing env var ${key}`);
    return '';
  }
  return val || fallback || '';
}

export const config = {
  port: parseInt(env('PORT', '3001')),
  dbPath: env('DB_PATH', './data/master-dashboard.db'),
  instantlyApiKey: env('INSTANTLY_API_KEY'),
  instantlyBaseUrl: 'https://api.instantly.ai/api/v2',
  ghlBaseUrl: env('GHL_BASE_URL', 'https://services.leadconnectorhq.com'),
  ghlLocations: [
    { name: 'Granite Park Capital', companyId: 1, apiKey: env('GHL_API_KEY'), locationId: env('GHL_LOCATION_ID') },
    { name: 'Brand Me Now', companyId: 2, apiKey: env('GHL_API_KEY_BNN'), locationId: env('GHL_LOCATION_ID_BNN') },
    { name: 'Tikkun', companyId: 4, apiKey: env('GHL_API_KEY_TIKKUN'), locationId: env('GHL_LOCATION_ID_TIKKUN') },
  ],
  openclawEnabled: env('OPENCLAW_ENABLED', 'true') === 'true',
  openclawGatewayUrl: env('OPENCLAW_GATEWAY_URL', 'ws://192.168.1.220:18789'),
  openclawToken: env('OPENCLAW_TOKEN'),
  metaAccessToken: env('META_ACCESS_TOKEN'),
  metaDeveloperKey: env('META_DEVELOPER_KEY'),
  metaAdAccountId: env('META_AD_ACCOUNT_ID'),
  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  geminiApiKey: env('GEMINI_API_KEY'),
  apifyApiKey: env('APIFY_API_KEY'),
  apifyBaseUrl: 'https://api.apify.com/v2',
  whatsappAccessToken: env('WHATSAPP_ACCESS_TOKEN'),
  whatsappPhoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
  whatsappBusinessAccountId: env('WHATSAPP_BUSINESS_ACCOUNT_ID'),
  whatsappWebhookVerifyToken: env('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'master-dashboard-wa-hook'),
  metaBaseUrl: 'https://graph.facebook.com/v19.0',
  competitors: env('COMPETITOR_URLS', '').split(',').filter(Boolean),
  syncIntervalMs: parseInt(env('SYNC_INTERVAL_MS', '60000')),

  // Enrichment
  pdlApiKey: env('PDL_API_KEY'),
  pdlBaseUrl: env('PDL_BASE_URL', 'https://api.peopledatalabs.com/v5'),
  hunterApiKey: env('HUNTER_API_KEY'),
  hunterBaseUrl: env('HUNTER_BASE_URL', 'https://api.hunter.io/v2'),
  anymailfinderApiKey: env('ANYMAILFINDER_API_KEY'),
  anymailfinderBaseUrl: env('ANYMAILFINDER_BASE_URL', 'https://api.anymailfinder.com/v5.1'),
  apolloApiKey: env('APOLLO_API_KEY'),
  apolloBaseUrl: 'https://api.apollo.io/api/v1',
  millionverifierApiKey: env('MILLIONVERIFIER_API_KEY'),
  millionverifierBaseUrl: 'https://api.millionverifier.com/api/v3',
  rb2bWebhookSecret: env('RB2B_WEBHOOK_SECRET'),
  ghlWebhookSecret: env('GHL_WEBHOOK_SECRET'),
  metaWebhookSecret: env('META_WEBHOOK_SECRET'),
  instantlyWebhookSecret: env('INSTANTLY_WEBHOOK_SECRET'),
  n8nWebhookSecret: env('N8N_WEBHOOK_SECRET'),
  n8nWebhookBaseUrl: env('N8N_WEBHOOK_BASE_URL', 'http://localhost:5678'),
  // LinkedIn outreach (Apify connection requests)
  linkedinLiAtCookie: env('LINKEDIN_LI_AT', ''),
  linkedinJsessionId: env('LINKEDIN_JSESSIONID', ''),
  linkedinDailyLimit: parseInt(env('LINKEDIN_DAILY_LIMIT', '20')),
  linkedinAutoSendEnabled: env('LINKEDIN_AUTO_SEND_ENABLED', 'false') === 'true',

  enrichmentAutoEnabled: env('ENRICHMENT_AUTO_ENABLED', 'true') === 'true',
  enrichmentStaleDays: parseInt(env('ENRICHMENT_STALE_DAYS', '90')),

  // Meeting scheduling — per-company calendar configs
  meetings: {
    calendarId: 'HiJ2M2Xnf0ZRbGCFCAgs', // Default (GPC) calendar
    meetingDays: [2, 3, 4], // Tuesday=2, Wednesday=3, Thursday=4
    meetingStartHour: 11,
    meetingEndHour: 16,
    meetingDurationMinutes: 30,
    timezone: 'America/New_York',
    lookAheadWeeks: 2,
  },
  meetingsByCompany: {
    1: { calendarId: 'HiJ2M2Xnf0ZRbGCFCAgs' }, // Granite Park Capital
    2: { calendarId: env('GHL_CALENDAR_ID_BMN', '') }, // Brand Me Now
  } as Record<number, { calendarId: string }>,

  // Post-meeting follow-up — per-company configs
  postMeeting: {
    dataRoomUrl: env('DATA_ROOM_URL', ''),
    followUpDelayHours: parseInt(env('POST_MEETING_FOLLOWUP_DELAY_HOURS', '4')),
    minimumInvestment: 250000,
    fromEmail: env('POST_MEETING_FROM_EMAIL', 'marc@granitepark.co'),
  },
  postMeetingByCompany: {
    1: { fromEmail: env('POST_MEETING_FROM_EMAIL', 'marc@granitepark.co'), dataRoomUrl: env('DATA_ROOM_URL', '') },
    2: { fromEmail: env('POST_MEETING_FROM_EMAIL_BMN', ''), dataRoomUrl: env('DATA_ROOM_URL_BMN', '') },
  } as Record<number, { fromEmail: string; dataRoomUrl: string }>,

  // Telegram notifications
  telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
  telegramChatId: env('TELEGRAM_CHAT_ID'),             // Colby's chat ID
  telegramChatIdByCompany: {
    1: env('TELEGRAM_CHAT_ID', ''),                      // GPC → Colby
    2: env('TELEGRAM_CHAT_ID_BMN', ''),                  // BMN → Ryan (or fallback to Colby)
  } as Record<number, string>,

  // Daily Reports
  report: {
    enabled: env('REPORT_ENABLED', 'false') === 'true',
    recipients: env('REPORT_RECIPIENTS', '').split(',').filter(Boolean),
    fromEmail: env('REPORT_FROM_EMAIL', 'colby@granitepark.co'),
  },
  reportByCompany: {
    1: {
      fromEmail: env('REPORT_FROM_EMAIL', 'colby@granitepark.co'),
      recipients: env('REPORT_RECIPIENTS', '').split(',').filter(Boolean),
    },
    2: {
      fromEmail: env('REPORT_FROM_EMAIL_BMN', ''),
      recipients: env('REPORT_RECIPIENTS_BMN', '').split(',').filter(Boolean),
    },
  } as Record<number, { fromEmail: string; recipients: string[] }>,
};
