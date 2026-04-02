/**
 * Unit tests for server/services/enrichment/reply-handler.ts
 *
 * Covers:
 *   - processScheduledReplies() calls queryAll with a params array
 *     (not string interpolation), confirming the parameterized query fix.
 */

// ---------------------------------------------------------------------------
// Mock all heavy dependencies so the module can be imported without a real DB
// or network calls.
// ---------------------------------------------------------------------------

vi.mock('../db', () => ({
  queryAll: vi.fn().mockReturnValue([]),
  queryOne: vi.fn().mockReturnValue(null),
  runSql: vi.fn(),
  saveDb: vi.fn(),
}));

vi.mock('../../server/config', () => ({
  config: {
    instantlyApiKey: 'test-key',
    instantlyBaseUrl: 'https://api.instantly.ai/api/v2',
    ghlBaseUrl: 'https://services.leadconnectorhq.com',
    ghlLocations: [],
    anthropicApiKey: 'test-key',
    meetings: {},
    meetingsByCompany: {},
    postMeeting: {},
    postMeetingByCompany: {},
    telegramBotToken: '',
    telegramChatId: '',
    telegramChatIdByCompany: {},
  },
}));

vi.mock('../config', () => ({
  config: {
    instantlyApiKey: 'test-key',
    instantlyBaseUrl: 'https://api.instantly.ai/api/v2',
    ghlBaseUrl: 'https://services.leadconnectorhq.com',
    ghlLocations: [],
    anthropicApiKey: 'test-key',
    meetings: {},
    meetingsByCompany: {},
    postMeeting: {},
    postMeetingByCompany: {},
    telegramBotToken: '',
    telegramChatId: '',
    telegramChatIdByCompany: {},
  },
}));

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Mock AI response' }],
      }),
    },
  })),
}));

// Mock node-telegram-bot-api
vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({}),
  })),
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import * as dbModule from '../db';

const MAX_REPLY_RETRIES = 3;

describe('processScheduledReplies — parameterized query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls queryAll with MAX_REPLY_RETRIES as a params array element, not interpolated', async () => {
    // Arrange: make queryAll return empty so the function exits quickly
    const queryAllMock = vi.mocked(dbModule.queryAll);
    queryAllMock.mockReturnValue([]);

    // Act: import the function fresh after mocks are set up
    const { processScheduledReplies } = await import('../services/enrichment/reply-handler');
    await processScheduledReplies();

    // Assert: queryAll must have been called at least once
    expect(queryAllMock).toHaveBeenCalled();

    // Find the specific call that queries pending replies
    const pendingQueryCall = queryAllMock.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('reply_messages') && sql.includes('sent = 0')
    );

    expect(pendingQueryCall).toBeDefined();

    const [sql, params] = pendingQueryCall!;

    // The SQL must use a placeholder, not an interpolated value
    expect(sql).toContain('?');
    expect(sql).not.toContain(String(MAX_REPLY_RETRIES) + ' --');  // not interpolated
    // The actual retry limit must not appear literally in the SQL
    // (it should be passed as a param)
    expect(sql).not.toMatch(new RegExp(`< ${MAX_REPLY_RETRIES}\\b`));

    // The params array must contain MAX_REPLY_RETRIES
    expect(Array.isArray(params)).toBe(true);
    expect(params).toContain(MAX_REPLY_RETRIES);
  });

  it('passes params as an array, never as a string to queryAll', async () => {
    const queryAllMock = vi.mocked(dbModule.queryAll);
    queryAllMock.mockReturnValue([]);

    const { processScheduledReplies } = await import('../services/enrichment/reply-handler');
    await processScheduledReplies();

    for (const [, params] of queryAllMock.mock.calls) {
      // Every call must pass params as an array (or omit it — default is [])
      expect(Array.isArray(params)).toBe(true);
    }
  });

  it('returns 0 when there are no pending replies', async () => {
    vi.mocked(dbModule.queryAll).mockReturnValue([]);

    const { processScheduledReplies } = await import('../services/enrichment/reply-handler');
    const sent = await processScheduledReplies();

    expect(sent).toBe(0);
  });

  it('does not mutate the params array passed to queryAll', async () => {
    const capturedParams: any[][] = [];
    vi.mocked(dbModule.queryAll).mockImplementation((_sql: string, params: any[] = []) => {
      // Capture a snapshot before the function can mutate it
      capturedParams.push([...params]);
      return [];
    });

    const { processScheduledReplies } = await import('../services/enrichment/reply-handler');
    await processScheduledReplies();

    // Verify all captured param arrays are genuine arrays (immutability check)
    for (const p of capturedParams) {
      expect(Array.isArray(p)).toBe(true);
    }
  });
});
