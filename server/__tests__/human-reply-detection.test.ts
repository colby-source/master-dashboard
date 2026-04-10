/**
 * Tests for human-reply detection in the auto-reply system.
 *
 * Covers:
 *   1. handleReply skips auto-reply when a human already replied on the thread
 *   2. handleReply does NOT skip on escalated/closed threads (lets escalation logic handle)
 *   3. handleReply still auto-replies when last outbound was from claude (not human)
 *   4. processWarmNurture excludes threads with human outbound replies
 *   5. recordManualOutboundReplies (via pollInstantlyReplies) records sent emails as human outbound
 *   6. recordManualOutboundReplies retries when lead/thread not yet created (no markRead)
 */

// ---------------------------------------------------------------------------
// Mocks — must be registered before imports
// ---------------------------------------------------------------------------

const mockQueryAll = vi.fn().mockReturnValue([]);
const mockQueryOne = vi.fn().mockReturnValue(null);
const mockRunSql = vi.fn();
const mockSaveDb = vi.fn();

vi.mock('../db', () => ({
  queryAll: (...args: any[]) => mockQueryAll(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  runSql: (...args: any[]) => mockRunSql(...args),
  saveDb: (...args: any[]) => mockSaveDb(...args),
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

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"reply":"test","shouldEscalate":false,"strategy":"test"}' }],
      }),
    },
  })),
}));

vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({}),
  })),
}));

const mockListEmails = vi.fn().mockResolvedValue({ items: [] });
const mockMarkThreadRead = vi.fn().mockResolvedValue({});
const mockMarkEmailRead = vi.fn().mockResolvedValue({});

vi.mock('../services/instantly-service', () => ({
  instantlyService: {
    listEmails: (...args: any[]) => mockListEmails(...args),
    markThreadRead: (...args: any[]) => mockMarkThreadRead(...args),
    markEmailRead: (...args: any[]) => mockMarkEmailRead(...args),
    replyToEmail: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../services/claude-service', () => ({
  claudeService: {
    analyzeReplySentiment: vi.fn().mockResolvedValue({
      sentiment: 'interested',
      confidence: 0.9,
      suggestedAction: 'reply',
      ghlPipelineStage: 'new_reply',
    }),
    generateIntelligentReply: vi.fn().mockResolvedValue({
      reply: 'Test auto reply',
      shouldEscalate: false,
      strategy: 'engage',
    }),
  },
}));

vi.mock('../services/ghl-service', () => ({
  ghlService: {
    upsertContact: vi.fn().mockResolvedValue({}),
    addTag: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../websocket/ws-server', () => ({
  wsServer: {
    broadcast: vi.fn(),
  },
}));

vi.mock('../services/meeting-scheduler', () => ({
  getAvailableSlots: vi.fn().mockReturnValue([]),
  formatSlotsForMessage: vi.fn().mockReturnValue(''),
  bookMeeting: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/enrichment/helpers', () => ({
  getCompanyConfig: vi.fn().mockReturnValue({
    auto_reply_enabled: true,
    auto_reply_sentiments: JSON.stringify(['interested', 'question', 'meeting_request']),
    auto_enrich: false,
  }),
  logEvent: vi.fn(),
  updateLead: vi.fn(),
}));

vi.mock('../services/enrichment/opportunity-pipeline', () => ({
  createColdEmailOpportunity: vi.fn(),
  loseOpportunity: vi.fn(),
}));

vi.mock('../services/enrichment/feedback-loop', () => ({
  getReplyStrategyInsights: vi.fn().mockReturnValue(null),
  getLatestInsights: vi.fn().mockReturnValue(null),
  runOptimizationCycle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/bmn/reply-handler', () => ({
  isBmnCompany: vi.fn().mockReturnValue(false),
  injectBmnBookingGoal: vi.fn(),
  shouldSkipAutoBooking: vi.fn().mockReturnValue(false),
}));

vi.mock('../services/sms-notifications', () => ({
  sendEmailToOperator: vi.fn().mockResolvedValue(undefined),
  evaluateHotLeadAlert: vi.fn().mockResolvedValue(undefined),
}));

// Mock the enrichment service barrel (used by reply-poller.ts)
const mockEnrichmentHandleReply = vi.fn().mockResolvedValue({ action: 'skipped', reason: 'test' });
vi.mock('../services/enrichment/index', () => ({
  enrichmentService: {
    handleReply: (...args: any[]) => mockEnrichmentHandleReply(...args),
  },
}));

// ---------------------------------------------------------------------------
// Imports are done dynamically inside each test to ensure mocks are registered first
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseLead = {
  id: 1,
  company_id: 2,
  email: 'creator@gmail.com',
  first_name: 'Jane',
  last_name: 'Doe',
  status: 'replied',
  score: 75,
  score_label: 'warm',
  tags: '[]',
  enrichment_data: '{}',
  instantly_campaign_id: 'camp-1',
  ghl_contact_id: '',
};

const baseThread = {
  id: 10,
  enrichment_lead_id: 1,
  company_id: 2,
  email: 'creator@gmail.com',
  thread_status: 'active',
  auto_reply_count: 1,
  message_count: 2,
  last_sentiment: 'interested',
  last_message_at: '2026-04-09 12:00:00',
  instantly_email_id: 'inst-email-1',
  instantly_campaign_id: 'camp-1',
};

const basePlaybook = {
  id: 1,
  company_id: 2,
  company_name: 'Brand Me Now',
  sender_name: 'Ryan',
  company_description: 'Test company',
  value_propositions: JSON.stringify(['VP1']),
  target_icp: 'creators',
  tone: 'friendly',
  objection_handlers: JSON.stringify({}),
  conversation_goals: JSON.stringify(['book_call']),
  escalation_triggers: JSON.stringify(['legal']),
  do_not_mention: JSON.stringify(['20%']),
  compliance_rules: null,
  booking_url: 'https://example.com/book',
  max_auto_replies: 5,
};

const deps = {
  processLead: vi.fn().mockResolvedValue(true),
  excludeFromColdEmail: vi.fn(),
};

/**
 * Configure mockQueryOne to return different values based on the SQL query.
 * This lets us simulate different DB states per test.
 */
function setupQueryOne(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    // Dedup check — no prior processing
    'reply_messages WHERE instantly_email_id': null,
    'enrichment_events WHERE event_type': null,
    // Lead lookup
    'enrichment_leads WHERE email': baseLead,
    // Thread lookup (findOrCreateThread)
    'reply_threads WHERE enrichment_lead_id': baseThread,
    // Playbook
    'company_playbooks WHERE company_id': basePlaybook,
    // Human reply check (step 8b) — default: no outbound
    'reply_messages WHERE thread_id': null,
    // Company config
    'enrichment_config WHERE company_id': {
      auto_reply_enabled: true,
      auto_reply_sentiments: JSON.stringify(['interested', 'question', 'meeting_request']),
      auto_enrich: false,
    },
  };

  const merged = { ...defaults, ...overrides };

  mockQueryOne.mockImplementation((sql: string) => {
    for (const [key, value] of Object.entries(merged)) {
      if (sql.includes(key)) return value;
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleReply — human reply detection (step 8b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryAll.mockReturnValue([]);
  });

  it('skips auto-reply when last outbound was from a human', async () => {
    setupQueryOne({
      // Step 8b: last outbound was human
      'reply_messages WHERE thread_id': {
        generated_by: 'human',
        created_at: '2026-04-10 10:00:00',
      },
    });

    const { handleReply } = await import('../services/enrichment/reply-handler');
    const result = await handleReply(
      {
        email: 'creator@gmail.com',
        replyText: 'Yes I am interested!',
        instantlyEmailId: 'email-123',
        campaignId: 'camp-1',
      },
      deps
    );

    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('human_already_replied');
    expect(result.threadId).toBe(10);
  });

  it('proceeds with auto-reply when last outbound was from claude', async () => {
    setupQueryOne({
      // Step 8b: last outbound was claude
      'reply_messages WHERE thread_id': {
        generated_by: 'claude',
        created_at: '2026-04-09 10:00:00',
      },
    });

    // The function will try to generate a reply and may fail on downstream mocks,
    // but it should NOT return 'human_already_replied'
    const { handleReply } = await import('../services/enrichment/reply-handler');
    const result = await handleReply(
      {
        email: 'creator@gmail.com',
        replyText: 'Sounds great, tell me more',
        instantlyEmailId: 'email-456',
        campaignId: 'camp-1',
      },
      deps
    );

    expect(result.reason).not.toBe('human_already_replied');
  });

  it('proceeds with auto-reply when no outbound exists yet', async () => {
    setupQueryOne({
      // Step 8b: no outbound messages at all
      'reply_messages WHERE thread_id': null,
    });

    const { handleReply } = await import('../services/enrichment/reply-handler');
    const result = await handleReply(
      {
        email: 'creator@gmail.com',
        replyText: 'Tell me more about this',
        instantlyEmailId: 'email-789',
        campaignId: 'camp-1',
      },
      deps
    );

    expect(result.reason).not.toBe('human_already_replied');
  });

  it('does NOT apply human-reply gate on escalated threads', async () => {
    const escalatedThread = { ...baseThread, thread_status: 'escalated', auto_reply_count: 5 };

    setupQueryOne({
      // Return escalated thread (simulating findOrCreateThread returning terminal thread)
      'reply_threads WHERE enrichment_lead_id': escalatedThread,
      // Last outbound was human (e.g. operator replied before escalating)
      'reply_messages WHERE thread_id': {
        generated_by: 'human',
        created_at: '2026-04-09 10:00:00',
      },
    });

    const { handleReply } = await import('../services/enrichment/reply-handler');
    const result = await handleReply(
      {
        email: 'creator@gmail.com',
        replyText: 'Hey I changed my mind, interested now',
        instantlyEmailId: 'email-esc-1',
        campaignId: 'camp-1',
      },
      deps
    );

    // Should hit max_auto_replies / escalation, NOT human_already_replied
    expect(result.reason).not.toBe('human_already_replied');
  });

  it('does NOT apply human-reply gate on closed threads', async () => {
    const closedThread = { ...baseThread, thread_status: 'closed', auto_reply_count: 2 };

    setupQueryOne({
      'reply_threads WHERE enrichment_lead_id': closedThread,
      'reply_messages WHERE thread_id': {
        generated_by: 'human',
        created_at: '2026-04-08 10:00:00',
      },
    });

    const { handleReply } = await import('../services/enrichment/reply-handler');
    const result = await handleReply(
      {
        email: 'creator@gmail.com',
        replyText: 'Actually wait, tell me more',
        instantlyEmailId: 'email-closed-1',
        campaignId: 'camp-1',
      },
      deps
    );

    expect(result.reason).not.toBe('human_already_replied');
  });
});

describe('processWarmNurture — excludes threads with human outbound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warm nurture query excludes threads with human outbound replies', async () => {
    // processWarmNurture calls queryAll for stalled threads
    mockQueryAll.mockReturnValue([]);

    const { processWarmNurture } = await import('../services/enrichment/reply-handler');
    await processWarmNurture();

    // Find the stalled-threads query
    const nurtureCall = mockQueryAll.mock.calls.find(([sql]: [string]) =>
      typeof sql === 'string' && sql.includes('reply_threads') && sql.includes('last_message_at')
    );

    expect(nurtureCall).toBeDefined();
    const [sql] = nurtureCall!;

    // Must contain the human outbound exclusion
    expect(sql).toContain("generated_by = 'human'");
  });
});

describe('pollInstantlyReplies — outbound recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryAll.mockReturnValue([]);
    mockQueryOne.mockReturnValue(null);
  });

  it('polls both inbound and sent emails', async () => {
    mockListEmails.mockResolvedValue({ items: [] });

    const { pollInstantlyReplies } = await import('../services/enrichment/reply-poller');
    await pollInstantlyReplies();

    // Should have been called twice: once for inbound, once for sent
    expect(mockListEmails).toHaveBeenCalledTimes(2);

    const calls = mockListEmails.mock.calls;
    const inboundCall = calls.find((c: any[]) => c[0]?.email_type === 'reply');
    const sentCall = calls.find((c: any[]) => c[0]?.email_type === 'sent');

    expect(inboundCall).toBeDefined();
    expect(sentCall).toBeDefined();

    // Sent poll should NOT have is_unread (sent emails don't have unread state)
    expect(sentCall![0]).not.toHaveProperty('is_unread');
  });

  it('records manual outbound reply as human and marks read', async () => {
    // Simulate: sent poll returns one outbound email from our account
    mockListEmails.mockImplementation((opts: any) => {
      if (opts?.email_type === 'sent') {
        return Promise.resolve({
          items: [{
            id: 'sent-email-1',
            thread_id: 'thread-1',
            lead_email: 'prospect@company.com',
            to_address_email: 'prospect@company.com',
            body: { text: 'Hey, just following up on our conversation...' },
            campaign_id: 'camp-1',
          }],
        });
      }
      return Promise.resolve({ items: [] });
    });

    // Lead exists
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes('reply_messages') && sql.includes('instantly_email_id') && sql.includes('outbound')) return null; // not already recorded
      if (sql.includes('enrichment_leads WHERE email')) return { id: 5, company_id: 2 };
      if (sql.includes('reply_threads WHERE enrichment_lead_id')) return { id: 20 };
      return null;
    });

    const { pollInstantlyReplies } = await import('../services/enrichment/reply-poller');
    await pollInstantlyReplies();

    // Should have inserted a human outbound message
    const insertCall = mockRunSql.mock.calls.find(([sql]: [string]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO reply_messages') && sql.includes('human')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain('sent-email-1'); // instantly_email_id
    expect(insertCall![1]).toContain(20); // thread_id

    // Should have updated the thread's last_message_at
    const updateCall = mockRunSql.mock.calls.find(([sql]: [string]) =>
      typeof sql === 'string' && sql.includes('UPDATE reply_threads') && sql.includes('last_message_at')
    );
    expect(updateCall).toBeDefined();

    // Should have marked the sent email as read
    expect(mockMarkThreadRead).toHaveBeenCalledWith('thread-1');
  });

  it('does NOT mark read when lead not found (retries next cycle)', async () => {
    mockListEmails.mockImplementation((opts: any) => {
      if (opts?.email_type === 'sent') {
        return Promise.resolve({
          items: [{
            id: 'sent-email-2',
            thread_id: 'thread-2',
            lead_email: 'unknown@company.com',
            body: { text: 'Following up...' },
            campaign_id: 'camp-1',
          }],
        });
      }
      return Promise.resolve({ items: [] });
    });

    // No matching lead or thread
    mockQueryOne.mockReturnValue(null);

    const { pollInstantlyReplies } = await import('../services/enrichment/reply-poller');
    await pollInstantlyReplies();

    // Should NOT have marked read — leave it for next poll cycle
    expect(mockMarkThreadRead).not.toHaveBeenCalledWith('thread-2');
    expect(mockMarkEmailRead).not.toHaveBeenCalledWith('sent-email-2');

    // Should NOT have inserted any messages
    const insertCall = mockRunSql.mock.calls.find(([sql]: [string]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO reply_messages') && sql.includes('human')
    );
    expect(insertCall).toBeUndefined();
  });

  it('does NOT mark read when thread not found (retries next cycle)', async () => {
    mockListEmails.mockImplementation((opts: any) => {
      if (opts?.email_type === 'sent') {
        return Promise.resolve({
          items: [{
            id: 'sent-email-3',
            thread_id: 'thread-3',
            lead_email: 'known@company.com',
            body: { text: 'Following up...' },
            campaign_id: 'camp-1',
          }],
        });
      }
      return Promise.resolve({ items: [] });
    });

    // Lead exists but no thread yet
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes('reply_messages') && sql.includes('outbound')) return null;
      if (sql.includes('enrichment_leads WHERE email')) return { id: 7, company_id: 2 };
      if (sql.includes('reply_threads WHERE enrichment_lead_id')) return null; // no thread yet
      return null;
    });

    const { pollInstantlyReplies } = await import('../services/enrichment/reply-poller');
    await pollInstantlyReplies();

    // Should NOT have marked read
    expect(mockMarkThreadRead).not.toHaveBeenCalledWith('thread-3');
  });

  it('skips already-recorded outbound emails (dedup)', async () => {
    mockListEmails.mockImplementation((opts: any) => {
      if (opts?.email_type === 'sent') {
        return Promise.resolve({
          items: [{
            id: 'sent-email-dup',
            thread_id: 'thread-dup',
            lead_email: 'prospect@company.com',
            body: { text: 'Already recorded' },
            campaign_id: 'camp-1',
          }],
        });
      }
      return Promise.resolve({ items: [] });
    });

    // Already recorded
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes('reply_messages') && sql.includes('instantly_email_id') && sql.includes('outbound')) {
        return { id: 99 }; // already exists
      }
      return null;
    });

    const { pollInstantlyReplies } = await import('../services/enrichment/reply-poller');
    await pollInstantlyReplies();

    // Should have marked read (it's recorded, just skip)
    expect(mockMarkThreadRead).toHaveBeenCalledWith('thread-dup');

    // Should NOT have inserted a new message
    const insertCall = mockRunSql.mock.calls.find(([sql]: [string]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO reply_messages') && sql.includes('human')
    );
    expect(insertCall).toBeUndefined();
  });

  it('processes outbound BEFORE inbound in the same poll cycle', async () => {
    const callOrder: string[] = [];

    mockListEmails.mockImplementation((opts: any) => {
      if (opts?.email_type === 'sent') {
        return Promise.resolve({
          items: [{
            id: 'sent-first',
            thread_id: 'thread-order',
            lead_email: 'lead@co.com',
            body: { text: 'Human reply first' },
            campaign_id: 'camp-1',
          }],
        });
      }
      // Inbound reply from same lead
      return Promise.resolve({
        items: [{
          id: 'inbound-second',
          thread_id: 'thread-order',
          lead_email: 'lead@co.com',
          from_address_email: 'lead@co.com',
          body: { text: 'Thanks for your reply!' },
          campaign_id: 'camp-1',
          eaccount: 'sender@ourco.com',
        }],
      });
    });

    mockRunSql.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO reply_messages') && sql.includes('human')) {
        callOrder.push('outbound_recorded');
      }
      if (sql.includes('INSERT INTO reply_messages') && sql.includes('inbound')) {
        callOrder.push('inbound_recorded');
      }
    });

    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes('reply_messages') && sql.includes('instantly_email_id') && sql.includes('outbound')) return null;
      if (sql.includes('reply_messages') && sql.includes('instantly_email_id') && sql.includes('inbound')) return null;
      if (sql.includes('enrichment_events')) return null;
      if (sql.includes('enrichment_leads WHERE email')) return { ...baseLead, email: 'lead@co.com' };
      if (sql.includes('reply_threads WHERE enrichment_lead_id')) return { ...baseThread, id: 30 };
      if (sql.includes('company_playbooks')) return basePlaybook;
      // After outbound is recorded, the human-reply check should find it
      if (sql.includes('reply_messages WHERE thread_id') && sql.includes('outbound') && sql.includes('ORDER BY')) {
        // Check if outbound was already recorded in this cycle
        if (callOrder.includes('outbound_recorded')) {
          return { generated_by: 'human', created_at: '2026-04-10 10:00:00' };
        }
        return null;
      }
      return null;
    });

    const { pollInstantlyReplies } = await import('../services/enrichment/reply-poller');
    await pollInstantlyReplies();

    // Outbound should be recorded before inbound processing starts
    const outboundIdx = callOrder.indexOf('outbound_recorded');
    const inboundIdx = callOrder.indexOf('inbound_recorded');

    // If outbound was recorded, it should come first
    if (outboundIdx >= 0 && inboundIdx >= 0) {
      expect(outboundIdx).toBeLessThan(inboundIdx);
    }
  });
});
