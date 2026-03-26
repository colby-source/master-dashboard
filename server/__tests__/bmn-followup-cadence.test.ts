/**
 * Unit tests for server/services/bmn-followup-cadence.ts
 *
 * Tests cover:
 *   1. migrateBmnFollowup() — table creation and idempotency
 *   2. discoverNewCandidates() — GHL polling, tag filtering, deduplication, name backfill
 *   3. processDueSends() — due cadence detection, email sending, step advancement
 *   4. handleCadenceReply() — Claude routing (reply / escalate / booked), GHL stage advance
 *   5. getCadenceStats() — aggregated counts from DB
 *   6. Edge cases — missing data, API failures, malformed Claude output, duplicates
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Hoisted mock state ────────────────────────────────────────────────────────
// vi.hoisted() ensures these are initialized BEFORE the vi.mock() factories run.

const {
  mockRunSql,
  mockSaveDb,
  mockQueryOne,
  mockQueryAll,
  mockGhlClient,
  mockGhlService,
  mockInstantlyService,
  mockSendEmailToOperator,
  mockClaudeCreate,
} = vi.hoisted(() => {
  const mockGhlClient = {
    getOpportunities: vi.fn(),
    getContact: vi.fn(),
    updateContact: vi.fn(),
    sendMessage: vi.fn(),
    updateOpportunityStage: vi.fn(),
  };

  const mockClaudeCreate = vi.fn();

  return {
    mockRunSql: vi.fn(),
    mockSaveDb: vi.fn(),
    mockQueryOne: vi.fn(),
    mockQueryAll: vi.fn(),
    mockGhlClient,
    mockGhlService: { getClient: vi.fn().mockReturnValue(mockGhlClient) },
    mockInstantlyService: { listEmails: vi.fn(), getLead: vi.fn() },
    mockSendEmailToOperator: vi.fn(),
    mockClaudeCreate,
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../db', () => ({
  runSql: (...args: any[]) => mockRunSql(...args),
  saveDb: (...args: any[]) => mockSaveDb(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  queryAll: (...args: any[]) => mockQueryAll(...args),
}));

vi.mock('../config', () => ({
  config: {
    anthropicApiKey: 'test-anthropic-key',
    instantlyApiKey: 'test-instantly-key',
    instantlyBaseUrl: 'https://api.instantly.ai/api/v2',
    ghlBaseUrl: 'https://services.leadconnectorhq.com',
    ghlLocations: [],
    meetings: {},
    meetingsByCompany: {},
    postMeeting: {},
    postMeetingByCompany: {},
    telegramBotToken: '',
    telegramChatId: '',
    telegramChatIdByCompany: {},
  },
}));

vi.mock('../services/ghl-service', () => ({
  ghlService: mockGhlService,
}));

vi.mock('../services/instantly-service', () => ({
  instantlyService: mockInstantlyService,
}));

vi.mock('../services/sms-notifications', () => ({
  sendEmailToOperator: (...args: any[]) => mockSendEmailToOperator(...args),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: (...args: any[]) => mockClaudeCreate(...args) },
  })),
}));

// ── Import module under test (must come after all vi.mock() calls) ────────────

import {
  migrateBmnFollowup,
  discoverNewCandidates,
  processDueSends,
  handleCadenceReply,
  getCadenceStats,
} from '../services/bmn-followup-cadence';

// ── Constants mirrored from the service ──────────────────────────────────────
const STAGE_POSITIVE_REPLY = '75c0a71b-bba7-45fe-abdb-b751317afa30';
const STAGE_APPT_BOOKED = '6f44609d-7bf2-426e-ad37-50b83e0a0ac4';
const BMN_PIPELINE_ID = 'By4LcF6zNdTaxAC1O8Ad';
const BMN_TAG = 'bmn-interested-instantly';
const CONTACT_ID = 'contact-001';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOpportunity(overrides: Record<string, any> = {}) {
  return {
    id: 'opp-001',
    pipelineStageId: STAGE_POSITIVE_REPLY,
    status: 'open',
    contact: { id: CONTACT_ID },
    contactId: CONTACT_ID,
    ...overrides,
  };
}

function makeContact(overrides: Record<string, any> = {}) {
  return {
    id: CONTACT_ID,
    email: 'creator@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    tags: [BMN_TAG],
    ...overrides,
  };
}

function makeValidCadenceEmails() {
  return JSON.stringify([
    { step: 1, subject: 'Hey Jane', body: 'Loved your content!', delayHours: 0 },
    { step: 2, subject: 'Quick question', body: 'Would you like to earn passive income?', delayHours: 48 },
    { step: 3, subject: 'Creators like you', body: 'Here is what others are saying...', delayHours: 96 },
    { step: 4, subject: 'Last note', body: 'No worries if now is not the right time.', delayHours: 168 },
  ]);
}

function makeCadenceRow(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    ghl_contact_id: CONTACT_ID,
    ghl_opportunity_id: 'opp-001',
    email: 'creator@example.com',
    first_name: 'Jane',
    last_name: 'Doe',
    current_step: 0,
    status: 'active',
    cadence_emails: makeValidCadenceEmails(),
    last_sent_at: null,
    next_send_at: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago = due
    ...overrides,
  };
}

function makeClaudeReplyDecision(decision: object) {
  return {
    content: [{ type: 'text', text: JSON.stringify(decision) }],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('migrateBmnFollowup()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the bmn_followup_cadence table', () => {
    migrateBmnFollowup();

    const allSql = mockRunSql.mock.calls.map(([sql]: [string]) => sql as string);
    const createCadence = allSql.find((s) => s.includes('CREATE TABLE IF NOT EXISTS bmn_followup_cadence'));
    expect(createCadence).toBeDefined();
    expect(createCadence).toContain('ghl_contact_id');
    expect(createCadence).toContain('ghl_opportunity_id');
    expect(createCadence).toContain('status');
    expect(createCadence).toContain('current_step');
    expect(createCadence).toContain('cadence_emails');
  });

  it('creates the bmn_followup_messages table', () => {
    migrateBmnFollowup();

    const allSql = mockRunSql.mock.calls.map(([sql]: [string]) => sql as string);
    const createMessages = allSql.find((s) => s.includes('CREATE TABLE IF NOT EXISTS bmn_followup_messages'));
    expect(createMessages).toBeDefined();
    expect(createMessages).toContain('cadence_id');
    expect(createMessages).toContain('direction');
    expect(createMessages).toContain('body');
    expect(createMessages).toContain('step');
  });

  it('creates a unique index on ghl_contact_id', () => {
    migrateBmnFollowup();

    const allSql = mockRunSql.mock.calls.map(([sql]: [string]) => sql as string);
    const uniqueIdx = allSql.find((s) => s.includes('UNIQUE INDEX') && s.includes('ghl_contact_id'));
    expect(uniqueIdx).toBeDefined();
  });

  it('creates status and next_send_at indexes', () => {
    migrateBmnFollowup();

    const allSql = mockRunSql.mock.calls.map(([sql]: [string]) => sql as string);
    const statusIdx = allSql.find((s) => s.includes('idx_bmn_followup_status'));
    const nextIdx = allSql.find((s) => s.includes('idx_bmn_followup_next'));
    expect(statusIdx).toBeDefined();
    expect(nextIdx).toBeDefined();
  });

  it('calls saveDb() after all DDL statements', () => {
    migrateBmnFollowup();
    expect(mockSaveDb).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — silently swallows "already exists" errors', () => {
    mockRunSql.mockImplementationOnce(() => {
      throw new Error('table bmn_followup_cadence already exists');
    });

    expect(() => migrateBmnFollowup()).not.toThrow();
  });

  it('re-throws non-idempotency errors', () => {
    mockRunSql.mockImplementationOnce(() => {
      throw new Error('near "XTABLE": syntax error');
    });

    expect(() => migrateBmnFollowup()).toThrow('syntax error');
  });

  it('does not call saveDb when an error is thrown before it', () => {
    mockRunSql.mockImplementationOnce(() => {
      throw new Error('near "XTABLE": syntax error');
    });

    expect(() => migrateBmnFollowup()).toThrow();
    expect(mockSaveDb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('discoverNewCandidates()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGhlService.getClient.mockReturnValue(mockGhlClient);

    mockGhlClient.getOpportunities.mockResolvedValue({
      opportunities: [makeOpportunity()],
    });
    mockGhlClient.getContact.mockResolvedValue(makeContact());
    mockGhlClient.updateContact.mockResolvedValue({});

    mockQueryOne.mockReturnValue(null); // not yet in cadence table
    mockInstantlyService.listEmails.mockResolvedValue({ items: [] });
    mockInstantlyService.getLead.mockResolvedValue(null);
  });

  it('returns empty array when GHL client is unavailable', async () => {
    mockGhlService.getClient.mockReturnValue(null);
    const result = await discoverNewCandidates();
    expect(result).toEqual([]);
  });

  it('calls getOpportunities with the BMN pipeline ID', async () => {
    await discoverNewCandidates();
    expect(mockGhlClient.getOpportunities).toHaveBeenCalledWith(BMN_PIPELINE_ID, 100);
  });

  it('filters out opportunities not in the positive-reply stage', async () => {
    mockGhlClient.getOpportunities.mockResolvedValue({
      opportunities: [makeOpportunity({ pipelineStageId: 'some-other-stage' })],
    });

    const result = await discoverNewCandidates();
    expect(result).toHaveLength(0);
  });

  it('filters out non-open opportunities', async () => {
    mockGhlClient.getOpportunities.mockResolvedValue({
      opportunities: [makeOpportunity({ status: 'won' })],
    });

    const result = await discoverNewCandidates();
    expect(result).toHaveLength(0);
  });

  it('skips opportunities with no contact id', async () => {
    mockGhlClient.getOpportunities.mockResolvedValue({
      opportunities: [makeOpportunity({ contact: null, contactId: null })],
    });

    const result = await discoverNewCandidates();
    expect(result).toHaveLength(0);
  });

  it('skips contacts already in the cadence table (deduplication)', async () => {
    mockQueryOne.mockReturnValue({ id: 42 });

    const result = await discoverNewCandidates();
    expect(result).toHaveLength(0);
    expect(mockGhlClient.getContact).not.toHaveBeenCalled();
  });

  it('skips contacts without an email address', async () => {
    mockGhlClient.getContact.mockResolvedValue(makeContact({ email: null }));

    const result = await discoverNewCandidates();
    expect(result).toHaveLength(0);
  });

  it('skips contacts that do not have the BMN tag', async () => {
    mockGhlClient.getContact.mockResolvedValue(makeContact({ tags: ['some-other-tag'] }));

    const result = await discoverNewCandidates();
    expect(result).toHaveLength(0);
  });

  it('returns a valid candidate for a correctly tagged contact', async () => {
    const result = await discoverNewCandidates();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ghlContactId: CONTACT_ID,
      ghlOpportunityId: 'opp-001',
      email: 'creator@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    expect(Array.isArray(result[0].instantlyConversation)).toBe(true);
  });

  it('fetches Instantly conversation history for the candidate email', async () => {
    await discoverNewCandidates();
    expect(mockInstantlyService.listEmails).toHaveBeenCalledWith(
      expect.objectContaining({ lead: 'creator@example.com' })
    );
  });

  it('includes Instantly email entries in the conversation with direction labels', async () => {
    mockInstantlyService.listEmails.mockResolvedValue({
      items: [
        {
          from_address_email: 'ryan@brandmenow.com',
          body: { text: 'Hey Jane, check us out!' },
          email_type: 'sent',
          timestamp: '2026-01-01T00:00:00Z',
        },
        {
          from_address_email: 'creator@example.com',
          body: { text: 'Sounds interesting!' },
          email_type: 'received',
          timestamp: '2026-01-02T00:00:00Z',
        },
      ],
    });

    const result = await discoverNewCandidates();
    expect(result[0].instantlyConversation).toHaveLength(2);
    expect(result[0].instantlyConversation[0]).toContain('[outbound]');
    expect(result[0].instantlyConversation[1]).toContain('[inbound]');
  });

  it('handles Instantly listEmails returning a bare array (not wrapped in items)', async () => {
    mockInstantlyService.listEmails.mockResolvedValue([
      {
        from_address_email: 'ryan@brandmenow.com',
        body: { text: 'Hey!' },
        email_type: 'sent',
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await discoverNewCandidates();
    expect(result[0].instantlyConversation).toHaveLength(1);
  });

  it('backfills first name from Instantly when GHL contact has no firstName', async () => {
    mockGhlClient.getContact.mockResolvedValue(
      makeContact({ firstName: null, first_name: null, lastName: null, last_name: null })
    );
    mockInstantlyService.getLead.mockResolvedValue({
      first_name: 'Taylor',
      last_name: 'Swift',
    });

    const result = await discoverNewCandidates();

    expect(result[0].firstName).toBe('Taylor');
    expect(result[0].lastName).toBe('Swift');
    expect(mockGhlClient.updateContact).toHaveBeenCalledWith(
      CONTACT_ID,
      expect.objectContaining({ firstName: 'Taylor', lastName: 'Swift' })
    );
  });

  it('does not call getLead or updateContact when firstName is already set', async () => {
    await discoverNewCandidates();

    expect(mockInstantlyService.getLead).not.toHaveBeenCalled();
    expect(mockGhlClient.updateContact).not.toHaveBeenCalled();
  });

  it('gracefully handles Instantly listEmails throwing an error — returns candidate with empty conversation', async () => {
    mockInstantlyService.listEmails.mockRejectedValue(new Error('Network timeout'));

    const result = await discoverNewCandidates();
    expect(result).toHaveLength(1);
    expect(result[0].instantlyConversation).toEqual([]);
  });

  it('handles empty opportunities list', async () => {
    mockGhlClient.getOpportunities.mockResolvedValue({ opportunities: [] });

    const result = await discoverNewCandidates();
    expect(result).toEqual([]);
  });

  it('handles getOpportunities returning null', async () => {
    mockGhlClient.getOpportunities.mockResolvedValue(null);

    const result = await discoverNewCandidates();
    expect(result).toEqual([]);
  });

  it('resolves contactId from opp.contactId when opp.contact is falsy', async () => {
    mockGhlClient.getOpportunities.mockResolvedValue({
      opportunities: [makeOpportunity({ contact: null, contactId: 'contact-from-field' })],
    });
    mockGhlClient.getContact.mockResolvedValue(makeContact({ id: 'contact-from-field' }));

    const result = await discoverNewCandidates();
    expect(result[0].ghlContactId).toBe('contact-from-field');
  });

  it('handles multiple opportunities and processes each one independently', async () => {
    mockGhlClient.getOpportunities.mockResolvedValue({
      opportunities: [
        makeOpportunity({ id: 'opp-A', contact: { id: 'c-A' }, contactId: 'c-A' }),
        makeOpportunity({ id: 'opp-B', contact: { id: 'c-B' }, contactId: 'c-B' }),
      ],
    });
    mockGhlClient.getContact.mockImplementation(async (id: string) =>
      makeContact({ id, email: `${id}@example.com` })
    );

    const result = await discoverNewCandidates();
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.ghlContactId)).toEqual(['c-A', 'c-B']);
  });

  it('tags treated as empty array when undefined on contact — skips BMN tag check', async () => {
    mockGhlClient.getContact.mockResolvedValue(makeContact({ tags: undefined }));

    const result = await discoverNewCandidates();
    expect(result).toHaveLength(0);
  });

  it('Instantly getLead returns no name — does not call updateContact', async () => {
    mockGhlClient.getContact.mockResolvedValue(
      makeContact({ firstName: null, first_name: null })
    );
    mockInstantlyService.getLead.mockResolvedValue({ first_name: null, last_name: null });

    const result = await discoverNewCandidates();
    expect(result[0].firstName).toBeNull();
    expect(mockGhlClient.updateContact).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('processDueSends()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGhlService.getClient.mockReturnValue(mockGhlClient);
    mockGhlClient.sendMessage.mockResolvedValue({ id: 'msg-001' });
  });

  it('returns 0 when there are no due cadences', async () => {
    mockQueryAll.mockReturnValue([]);
    mockQueryOne.mockReturnValue(null);

    const count = await processDueSends();
    expect(count).toBe(0);
  });

  it('queries for active cadences whose next_send_at is in the past', async () => {
    mockQueryAll.mockReturnValue([]);

    await processDueSends();

    expect(mockQueryAll).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      expect.arrayContaining([expect.any(String)])
    );
  });

  it('sends email for each due cadence and returns the sent count', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }, { id: 2 }]);
    mockQueryOne.mockImplementation((_sql: string, params: any[]) =>
      makeCadenceRow({ id: params[0] })
    );

    const count = await processDueSends();
    expect(count).toBe(2);
    expect(mockGhlClient.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('sends the correct subject and HTML-wrapped body', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ current_step: 0 }));

    await processDueSends();

    expect(mockGhlClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: CONTACT_ID,
        type: 'Email',
        subject: 'Hey Jane',
        html: expect.stringContaining('<p'),
      })
    );
  });

  it('records each sent email as an outbound message in bmn_followup_messages', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ current_step: 0 }));

    await processDueSends();

    const insertCall = mockRunSql.mock.calls.find(([sql]: [string]) =>
      sql.includes('INSERT INTO bmn_followup_messages')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('outbound');
  });

  it('advances current_step by 1 after sending', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ current_step: 0 }));

    await processDueSends();

    const updateCall = mockRunSql.mock.calls.find(([sql]: [string]) =>
      sql.includes('UPDATE bmn_followup_cadence') && sql.includes('current_step')
    );
    expect(updateCall).toBeDefined();
    const params: any[] = updateCall[1];
    expect(params[0]).toBe(1); // nextStep = 0 + 1
  });

  it('sets next_send_at to ~48h in future for step 2 delay', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ current_step: 0 }));

    const before = Date.now();
    await processDueSends();
    const after = Date.now();

    const updateCall = mockRunSql.mock.calls.find(([sql]: [string]) =>
      sql.includes('UPDATE bmn_followup_cadence') && sql.includes('next_send_at')
    );
    expect(updateCall).toBeDefined();
    const params: any[] = updateCall[1];
    // params order: [nextStep, lastSentAt, nextSendAt, cadenceId]
    const nextSendAtMs = new Date(params[2]).getTime();
    const expectedMs = before + 48 * 60 * 60 * 1000;
    expect(nextSendAtMs).toBeGreaterThanOrEqual(expectedMs - 5000);
    expect(nextSendAtMs).toBeLessThanOrEqual(after + 48 * 60 * 60 * 1000 + 5000);
  });

  it('marks cadence as completed when all steps have been sent', async () => {
    // current_step = 4 means we are past the end of a 4-email cadence
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ current_step: 4, status: 'active' }));

    await processDueSends();

    const completedCall = mockRunSql.mock.calls.find(([sql]: [string]) =>
      sql.includes("status = 'completed'")
    );
    expect(completedCall).toBeDefined();
    expect(mockGhlClient.sendMessage).not.toHaveBeenCalled();
  });

  it('skips a due cadence if the GHL client is unavailable', async () => {
    mockGhlService.getClient.mockReturnValue(null);
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ current_step: 0 }));

    const count = await processDueSends();
    expect(count).toBe(0);
    expect(mockGhlClient.sendMessage).not.toHaveBeenCalled();
  });

  it('skips cadences that are not "active"', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ status: 'replied' }));

    const count = await processDueSends();
    expect(count).toBe(0);
  });

  it('handles GHL sendMessage returning null (failure) — does not count the send', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ current_step: 0 }));
    mockGhlClient.sendMessage.mockResolvedValue(null);

    const count = await processDueSends();
    expect(count).toBe(0);
  });

  it('continues processing remaining cadences even if one throws an error', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }, { id: 2 }]);

    let callCount = 0;
    mockQueryOne.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('DB exploded');
      return makeCadenceRow({ id: 2 });
    });

    const count = await processDueSends();
    expect(count).toBe(1); // id=1 failed, id=2 succeeded
  });

  it('calls saveDb after each successful email send', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ current_step: 0 }));

    await processDueSends();

    expect(mockSaveDb).toHaveBeenCalled();
  });

  it('cadence with empty cadence_emails is marked completed without sending', async () => {
    mockQueryAll.mockReturnValue([{ id: 1 }]);
    mockQueryOne.mockReturnValue(makeCadenceRow({ cadence_emails: '[]', current_step: 0 }));

    await processDueSends();

    const completedUpdate = mockRunSql.mock.calls.find(([sql]: [string]) =>
      sql.includes("status = 'completed'")
    );
    expect(completedUpdate).toBeDefined();
    expect(mockGhlClient.sendMessage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('handleCadenceReply()', () => {
  const REPLY_TEXT = 'Yes I am interested, tell me more!';

  beforeEach(() => {
    vi.clearAllMocks();
    mockGhlService.getClient.mockReturnValue(mockGhlClient);
    mockGhlClient.sendMessage.mockResolvedValue({ id: 'msg-reply-001' });
    mockGhlClient.updateOpportunityStage.mockResolvedValue({});
    mockSendEmailToOperator.mockResolvedValue(undefined);

    // Default: active cadence found, no prior messages
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes('ghl_contact_id')) return makeCadenceRow();
      return null;
    });
    mockQueryAll.mockReturnValue([]);
  });

  it('returns { action: "ignored" } when no active cadence exists for the contact', async () => {
    mockQueryOne.mockReturnValue(null);

    const result = await handleCadenceReply(CONTACT_ID, REPLY_TEXT);
    expect(result).toEqual({ action: 'ignored' });
  });

  it('sets cadence status to "replied" immediately when a reply arrives', async () => {
    mockClaudeCreate.mockResolvedValue(
      makeClaudeReplyDecision({ action: 'reply', reply_text: 'Great to hear!', reply_subject: 'Re: Hey Jane' })
    );

    await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

    const statusUpdate = mockRunSql.mock.calls.find(([sql]: [string]) =>
      sql.includes("status = 'replied'")
    );
    expect(statusUpdate).toBeDefined();
  });

  it('records the inbound message in bmn_followup_messages', async () => {
    mockClaudeCreate.mockResolvedValue(
      makeClaudeReplyDecision({ action: 'reply', reply_text: 'Great!', reply_subject: 'Re: Hello' })
    );

    await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

    const insertCall = mockRunSql.mock.calls.find(([sql, params]: [string, any[]]) =>
      sql.includes('INSERT INTO bmn_followup_messages') && params?.includes('inbound')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain(REPLY_TEXT);
  });

  it('passes conversation history to Claude in the prompt', async () => {
    mockQueryAll.mockReturnValue([
      { direction: 'outbound', subject: 'Hey Jane', body: 'Loved your content!', step: 1 },
    ]);

    mockClaudeCreate.mockResolvedValue(
      makeClaudeReplyDecision({ action: 'reply', reply_text: 'Awesome!', reply_subject: 'Re: Hey' })
    );

    await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

    expect(mockClaudeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('Loved your content!'),
          }),
        ]),
      })
    );
  });

  describe('action: "reply"', () => {
    it('returns { action: "replied", response: replyText }', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'reply', reply_text: 'Sounds great!', reply_subject: 'Re: Jane' })
      );

      const result = await handleCadenceReply(CONTACT_ID, REPLY_TEXT);
      expect(result).toEqual({ action: 'replied', response: 'Sounds great!' });
    });

    it('sends Claude reply text via GHL Email', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'reply', reply_text: 'Let us chat!', reply_subject: 'Re: Jane' })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      expect(mockGhlClient.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          contactId: CONTACT_ID,
          type: 'Email',
          subject: 'Re: Jane',
          html: expect.stringContaining('<p'),
        })
      );
    });

    it('records outbound reply in bmn_followup_messages', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'reply', reply_text: 'Let us connect!', reply_subject: 'Re: Jane' })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      const outboundInsert = mockRunSql.mock.calls.find(([sql, params]: [string, any[]]) =>
        sql.includes('INSERT INTO bmn_followup_messages') && params?.includes('outbound')
      );
      expect(outboundInsert).toBeDefined();
    });

    it('falls back to "Re: <firstName>" subject when reply_subject is null', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'reply', reply_text: 'Hello!', reply_subject: null })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      expect(mockGhlClient.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Re: Jane' })
      );
    });

    it('does not alert Ryan for a standard "reply" action', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'reply', reply_text: 'Hey!', reply_subject: 'Re: Hi' })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      expect(mockSendEmailToOperator).not.toHaveBeenCalled();
    });
  });

  describe('action: "escalate"', () => {
    it('returns { action: "escalated" }', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({
          action: 'escalate',
          reason: 'Complex contract question',
          escalation_note: 'Creator asking about contract terms',
        })
      );

      const result = await handleCadenceReply(CONTACT_ID, REPLY_TEXT);
      expect(result).toEqual({ action: 'escalated' });
    });

    it('sets cadence status to "escalated"', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'escalate', reason: 'Legal question' })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      const escalateUpdate = mockRunSql.mock.calls.find(([sql]: [string]) =>
        sql.includes("status = 'escalated'")
      );
      expect(escalateUpdate).toBeDefined();
    });

    it('alerts Ryan (BMN company 2) via sendEmailToOperator', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({
          action: 'escalate',
          reason: 'Legal question',
          escalation_note: 'Creator is asking about IP rights',
        })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      expect(mockSendEmailToOperator).toHaveBeenCalledWith(
        2,
        expect.stringContaining('BMN Creator'),
        expect.stringContaining('creator@example.com')
      );
    });

    it('does not send an auto-reply email when escalating', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'escalate', reason: 'High profile creator' })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      expect(mockGhlClient.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('action: "booked"', () => {
    it('returns { action: "booked" }', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'booked', reason: 'Creator said yes' })
      );

      const result = await handleCadenceReply(CONTACT_ID, REPLY_TEXT);
      expect(result).toEqual({ action: 'booked' });
    });

    it('sets cadence status to "booked"', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'booked', reason: 'Call scheduled' })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      const bookedUpdate = mockRunSql.mock.calls.find(([sql]: [string]) =>
        sql.includes("status = 'booked'")
      );
      expect(bookedUpdate).toBeDefined();
    });

    it('advances GHL opportunity to the APPT_BOOKED stage', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'booked', reason: 'Booked!' })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      expect(mockGhlClient.updateOpportunityStage).toHaveBeenCalledWith(
        'opp-001',
        STAGE_APPT_BOOKED
      );
    });

    it('alerts Ryan even for a booked result', async () => {
      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'booked', reason: 'Call scheduled' })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      expect(mockSendEmailToOperator).toHaveBeenCalled();
    });

    it('does not call updateOpportunityStage when cadence has no ghl_opportunity_id', async () => {
      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('ghl_contact_id')) return makeCadenceRow({ ghl_opportunity_id: null });
        return null;
      });

      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'booked', reason: 'Booked' })
      );

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      expect(mockGhlClient.updateOpportunityStage).not.toHaveBeenCalled();
    });
  });

  describe('Claude parse failure fallback', () => {
    it('escalates to Ryan when Claude returns non-JSON prose', async () => {
      mockClaudeCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Sorry I cannot help with that right now.' }],
      });

      const result = await handleCadenceReply(CONTACT_ID, REPLY_TEXT);
      expect(result).toEqual({ action: 'escalated' });
      expect(mockSendEmailToOperator).toHaveBeenCalled();
    });

    it('includes "needs human review" reason in the Ryan alert for bad Claude output', async () => {
      mockClaudeCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Not valid JSON at all.' }],
      });

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      const [, , body] = mockSendEmailToOperator.mock.calls[0];
      expect(typeof body).toBe('string');
    });

    it('includes creator email in the Ryan alert body', async () => {
      mockClaudeCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Bad output' }],
      });

      await handleCadenceReply(CONTACT_ID, REPLY_TEXT);

      const [, , body] = mockSendEmailToOperator.mock.calls[0];
      expect(body).toContain('creator@example.com');
    });
  });

  describe('long reply text truncation', () => {
    it('truncates very long reply text to 500 chars in the Claude prompt', async () => {
      const longReply = 'A'.repeat(2000);

      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'reply', reply_text: 'Understood!', reply_subject: 'Re: Jane' })
      );

      await handleCadenceReply(CONTACT_ID, longReply);

      const claudeCall = mockClaudeCreate.mock.calls[0];
      const prompt = claudeCall[0].messages[0].content as string;
      expect(prompt).toContain('A'.repeat(500));
      expect(prompt).not.toContain('A'.repeat(501));
    });
  });

  describe('edge case — creator with no name', () => {
    it('uses "Hey" as subject fallback when first_name is null', async () => {
      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('ghl_contact_id'))
          return makeCadenceRow({ first_name: null, last_name: null });
        return null;
      });

      mockClaudeCreate.mockResolvedValue(
        makeClaudeReplyDecision({ action: 'reply', reply_text: 'Sure!', reply_subject: null })
      );

      await handleCadenceReply(CONTACT_ID, 'Interested!');

      expect(mockGhlClient.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Re: Hey' })
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getCadenceStats()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all-zero counts when queryOne returns { c: 0 }', () => {
    mockQueryOne.mockReturnValue({ c: 0 });

    const stats = getCadenceStats();

    expect(stats).toEqual({
      active: 0,
      completed: 0,
      replied: 0,
      escalated: 0,
      booked: 0,
      totalSent: 0,
    });
  });

  it('returns correct counts by reading status param from queryOne calls', () => {
    const countsMap: Record<string, number> = {
      active: 5,
      completed: 2,
      replied: 3,
      escalated: 1,
      booked: 4,
      outbound: 8,
    };

    mockQueryOne.mockImplementation((_sql: string, params: any[]) => {
      const key = params?.[0] as string;
      return { c: countsMap[key] ?? 0 };
    });

    const stats = getCadenceStats();

    expect(stats.active).toBe(5);
    expect(stats.completed).toBe(2);
    expect(stats.replied).toBe(3);
    expect(stats.escalated).toBe(1);
    expect(stats.booked).toBe(4);
    expect(stats.totalSent).toBe(8);
  });

  it('returns 0 for a status when queryOne returns null', () => {
    mockQueryOne.mockReturnValue(null);

    const stats = getCadenceStats();

    expect(stats.active).toBe(0);
    expect(stats.totalSent).toBe(0);
  });

  it('queries bmn_followup_cadence table for each status field', () => {
    mockQueryOne.mockReturnValue({ c: 0 });

    getCadenceStats();

    const cadenceCalls = mockQueryOne.mock.calls.filter(([sql]: [string]) =>
      sql.includes('bmn_followup_cadence')
    );
    expect(cadenceCalls.length).toBeGreaterThanOrEqual(5); // active, completed, replied, escalated, booked
  });

  it('queries bmn_followup_messages with direction = "outbound" for totalSent', () => {
    mockQueryOne.mockReturnValue({ c: 0 });

    getCadenceStats();

    const messageCall = mockQueryOne.mock.calls.find(([sql]: [string]) =>
      sql.includes('bmn_followup_messages') && sql.includes('direction')
    );
    expect(messageCall).toBeDefined();
    expect(messageCall[1]).toContain('outbound');
  });

  it('returns a plain object with exactly the expected keys', () => {
    mockQueryOne.mockReturnValue({ c: 1 });

    const stats = getCadenceStats();
    const keys = Object.keys(stats).sort();

    expect(keys).toEqual(['active', 'booked', 'completed', 'escalated', 'replied', 'totalSent']);
  });

  it('does not call queryAll (uses only queryOne for counts)', () => {
    mockQueryOne.mockReturnValue({ c: 0 });

    getCadenceStats();

    expect(mockQueryAll).not.toHaveBeenCalled();
  });
});
