/**
 * Tests for server/services/enrichment/opportunity-pipeline.ts
 *
 * Covers:
 *   - resolvePipeline(): 3-tier lookup (exact campaign → default → legacy)
 *   - createOpportunity(): GHL opportunity creation with correct pipeline/stage routing
 *   - createColdEmailOpportunity(): deprecated wrapper delegates correctly
 *   - syncOpportunityStage(): funnel stage → GHL stage mapping
 *   - loseOpportunity(): marks opportunity as lost
 *   - getCompanyPipelines(): admin query
 *   - GPC-specific: $250K monetary value, Cold Email Response Pipeline, all 7 stages
 *   - BMN-specific: campaign-level routing, agency vs creator funnels
 */


// ── Mock Setup (hoisted) ──────────────────────────────────────

const {
  mockQueryOne,
  mockQueryAll,
  mockRunSql,
  mockSaveDb,
  mockGetClient,
  mockBroadcast,
} = vi.hoisted(() => ({
  mockQueryOne: vi.fn(),
  mockQueryAll: vi.fn(),
  mockRunSql: vi.fn(),
  mockSaveDb: vi.fn(),
  mockGetClient: vi.fn(),
  mockBroadcast: vi.fn(),
}));

vi.mock('../db', () => ({
  queryOne: (...args: any[]) => mockQueryOne(...args),
  queryAll: (...args: any[]) => mockQueryAll(...args),
  runSql: (...args: any[]) => mockRunSql(...args),
  saveDb: (...args: any[]) => mockSaveDb(...args),
}));

vi.mock('../services/ghl-service', () => ({
  ghlService: {
    getClient: (...args: any[]) => mockGetClient(...args),
  },
}));

vi.mock('../websocket/ws-server', () => ({
  wsServer: {
    broadcast: (...args: any[]) => mockBroadcast(...args),
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

vi.mock('../services/enrichment/helpers', () => ({
  updateLead: vi.fn(),
  logEvent: vi.fn(),
  getCompanyConfig: vi.fn().mockReturnValue(null),
}));

// ── Import after mocks ───────────────────────────────────────

import {
  resolvePipeline,
  createOpportunity,
  createColdEmailOpportunity,
  syncOpportunityStage,
  loseOpportunity,
  getCompanyPipelines,
} from '../services/enrichment/opportunity-pipeline';

import { getCompanyConfig } from '../services/enrichment/helpers';

// ── Test Data ────────────────────────────────────────────────

const GPC_COMPANY_ID = 1;
const BMN_COMPANY_ID = 2;

const GPC_CAMPAIGN_ID = '2e3af84a-8f6f-4446-981c-f10bb2348216';
const GPC_PIPELINE_ID = 'hN3fT6V8135hCKJs8oXN';

const GPC_STAGE_MAP = {
  new_reply: '626aaea5-7a02-4634-a54a-f652fa4e2468',
  qualified: '975e30cc-03f6-436b-ac42-0bbf06b01f66',
  meeting_scheduled: 'd6e7a458-ac49-42c1-a656-fa002eb924a7',
  meeting_completed: '562069cc-59d7-453f-b9af-dfd101d86337',
  proposal_sent: 'c1061437-b448-45b4-bf14-8017ed6721e1',
  won: 'aec87c1a-9f79-4b73-9d91-0224ada21f9c',
  lost: '09d39d51-65f5-4a7d-bdcb-c57f49d022da',
};

const GPC_PIPELINE_ROW = {
  id: 3,
  company_id: GPC_COMPANY_ID,
  pipeline_name: 'Cold Email Response Pipeline',
  ghl_pipeline_id: GPC_PIPELINE_ID,
  instantly_campaign_id: GPC_CAMPAIGN_ID,
  stage_map: JSON.stringify(GPC_STAGE_MAP),
  monetary_value: 250000,
  is_default: 1,
};

const BMN_AGENCY_CAMPAIGN_ID = '3f481ba8-ea1f-48af-afa7-2e2179cb78bd';
const BMN_AGENCY_PIPELINE_ID = 'ChG0j1v34xGZDI7bp9Km';

const BMN_AGENCY_STAGE_MAP = {
  positive_reply: 'stage-a1',
  engaged: 'stage-a2',
  discovery_scheduled: 'stage-a3',
  discovery_completed: 'stage-a4',
  proposal_sent: 'stage-a5',
  negotiation: 'stage-a6',
  agreement_signed: 'stage-a7',
  onboarding: 'stage-a8',
  lost: 'stage-a9',
};

const BMN_AGENCY_ROW = {
  id: 2,
  company_id: BMN_COMPANY_ID,
  pipeline_name: 'Agency Partner Funnel',
  ghl_pipeline_id: BMN_AGENCY_PIPELINE_ID,
  instantly_campaign_id: BMN_AGENCY_CAMPAIGN_ID,
  stage_map: JSON.stringify(BMN_AGENCY_STAGE_MAP),
  monetary_value: 500,
  is_default: 0,
};

const BMN_CREATOR_CAMPAIGN_ID = '542243a5-f75a-441a-b311-f5ff0dbf8e3e';

const BMN_CREATOR_STAGE_MAP = {
  positive_reply: 'stage-c1',
  appt_booked: 'stage-c2',
  application_received: 'stage-c3',
  brand_builder_started: 'stage-c4',
  brand_builder_finished: 'stage-c5',
  manual_review: 'stage-c6',
  approved: 'stage-c7',
  rejected: 'stage-c8',
};

const BMN_CREATOR_ROW = {
  id: 1,
  company_id: BMN_COMPANY_ID,
  pipeline_name: 'Creator Investment Funnel',
  ghl_pipeline_id: 'By4LcF6zNdTaxAC1O8Ad',
  instantly_campaign_id: BMN_CREATOR_CAMPAIGN_ID,
  stage_map: JSON.stringify(BMN_CREATOR_STAGE_MAP),
  monetary_value: 500,
  is_default: 0,
};

// ── Helpers ──────────────────────────────────────────────────

function setupPipelineMocks(options: {
  exactMatch?: any;
  defaultMatch?: any;
  legacyConfig?: any;
} = {}) {
  mockQueryOne.mockImplementation((sql: string, params: any[]) => {
    // Exact campaign match
    if (sql.includes('company_pipelines') && sql.includes('instantly_campaign_id')) {
      return options.exactMatch ?? null;
    }
    // Default pipeline match
    if (sql.includes('company_pipelines') && sql.includes('is_default')) {
      return options.defaultMatch ?? null;
    }
    // enrichment_config (legacy)
    if (sql.includes('enrichment_config')) {
      return options.legacyConfig ?? null;
    }
    // Lead lookup
    if (sql.includes('enrichment_leads')) {
      return null;
    }
    return null;
  });
}

function makeLead(overrides: Record<string, any> = {}) {
  return {
    id: 100,
    company_id: GPC_COMPANY_ID,
    email: 'investor@example.com',
    first_name: 'John',
    last_name: 'Smith',
    instantly_campaign_id: GPC_CAMPAIGN_ID,
    ghl_opportunity_id: null,
    enrichment_data: JSON.stringify({
      pdl_person: { job_company_name: 'Smith Capital' },
    }),
    ...overrides,
  };
}

function makeGhlClient(overrides: Record<string, any> = {}) {
  return {
    createOpportunity: vi.fn().mockResolvedValue({ id: 'opp-new-123' }),
    updateOpportunityStage: vi.fn().mockResolvedValue({}),
    updateOpportunity: vi.fn().mockResolvedValue({}),
    getOpportunities: vi.fn().mockResolvedValue({ opportunities: [] }),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('opportunity-pipeline', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryOne.mockReturnValue(null);
    mockQueryAll.mockReturnValue([]);
    vi.mocked(getCompanyConfig).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────────
  // resolvePipeline
  // ────────────────────────────────────────────────────────────

  describe('resolvePipeline', () => {
    describe('tier 1: exact campaign match', () => {
      it('returns GPC Cold Email Response Pipeline for exact campaign ID', () => {
        setupPipelineMocks({ exactMatch: GPC_PIPELINE_ROW });

        const result = resolvePipeline(GPC_COMPANY_ID, GPC_CAMPAIGN_ID);

        expect(result).not.toBeNull();
        expect(result!.pipelineId).toBe(GPC_PIPELINE_ID);
        expect(result!.pipelineName).toBe('Cold Email Response Pipeline');
        expect(result!.monetaryValue).toBe(250000);
        expect(result!.stages).toEqual(GPC_STAGE_MAP);
      });

      it('returns BMN Agency Partner Funnel for agency campaign', () => {
        setupPipelineMocks({ exactMatch: BMN_AGENCY_ROW });

        const result = resolvePipeline(BMN_COMPANY_ID, BMN_AGENCY_CAMPAIGN_ID);

        expect(result).not.toBeNull();
        expect(result!.pipelineId).toBe(BMN_AGENCY_PIPELINE_ID);
        expect(result!.pipelineName).toBe('Agency Partner Funnel');
        expect(result!.monetaryValue).toBe(500);
        expect(result!.stages).toEqual(BMN_AGENCY_STAGE_MAP);
      });

      it('returns BMN Creator Investment Funnel for creator campaign', () => {
        setupPipelineMocks({ exactMatch: BMN_CREATOR_ROW });

        const result = resolvePipeline(BMN_COMPANY_ID, BMN_CREATOR_CAMPAIGN_ID);

        expect(result).not.toBeNull();
        expect(result!.pipelineName).toBe('Creator Investment Funnel');
        expect(result!.stages).toEqual(BMN_CREATOR_STAGE_MAP);
      });

      it('queries with correct SQL and params for exact match', () => {
        setupPipelineMocks({ exactMatch: GPC_PIPELINE_ROW });

        resolvePipeline(GPC_COMPANY_ID, GPC_CAMPAIGN_ID);

        const exactCall = mockQueryOne.mock.calls.find(
          ([sql]: [string]) => sql.includes('instantly_campaign_id')
        );
        expect(exactCall).toBeDefined();
        expect(exactCall![1]).toEqual([GPC_COMPANY_ID, GPC_CAMPAIGN_ID]);
      });
    });

    describe('tier 2: default pipeline fallback', () => {
      it('falls back to default GPC pipeline for unknown campaign', () => {
        setupPipelineMocks({ defaultMatch: GPC_PIPELINE_ROW });

        const result = resolvePipeline(GPC_COMPANY_ID, 'unknown-campaign-id');

        expect(result).not.toBeNull();
        expect(result!.pipelineId).toBe(GPC_PIPELINE_ID);
        expect(result!.monetaryValue).toBe(250000);
      });

      it('falls back to default when campaignId is null', () => {
        setupPipelineMocks({ defaultMatch: GPC_PIPELINE_ROW });

        const result = resolvePipeline(GPC_COMPANY_ID, null);

        expect(result).not.toBeNull();
        expect(result!.pipelineId).toBe(GPC_PIPELINE_ID);
      });

      it('falls back to default when campaignId is undefined', () => {
        setupPipelineMocks({ defaultMatch: GPC_PIPELINE_ROW });

        const result = resolvePipeline(GPC_COMPANY_ID);

        expect(result).not.toBeNull();
        expect(result!.pipelineId).toBe(GPC_PIPELINE_ID);
      });

      it('skips exact match query when campaignId is falsy', () => {
        setupPipelineMocks({ defaultMatch: GPC_PIPELINE_ROW });

        resolvePipeline(GPC_COMPANY_ID, null);

        // Should NOT query with instantly_campaign_id when campaignId is null
        const exactCall = mockQueryOne.mock.calls.find(
          ([sql]: [string]) => sql.includes('instantly_campaign_id')
        );
        expect(exactCall).toBeUndefined();
      });
    });

    describe('tier 3: legacy enrichment_config fallback', () => {
      it('falls back to legacy config when no company_pipelines rows exist', () => {
        const mockGetConfig = vi.mocked(getCompanyConfig);
        mockGetConfig.mockReturnValue({
          company_id: GPC_COMPANY_ID,
          ghl_pipeline_id: 'legacy-pipe-id',
          ghl_pipeline_stages: JSON.stringify({ new_reply: 'legacy-stage-1' }),
        } as any);

        setupPipelineMocks();

        const result = resolvePipeline(GPC_COMPANY_ID, 'some-campaign');

        expect(result).not.toBeNull();
        expect(result!.pipelineId).toBe('legacy-pipe-id');
        expect(result!.pipelineName).toBe('Cold Email Response Pipeline');
      });

      it('returns $250K monetary value for GPC via legacy path', () => {
        const mockGetConfig = vi.mocked(getCompanyConfig);
        mockGetConfig.mockReturnValue({
          company_id: GPC_COMPANY_ID,
          ghl_pipeline_id: 'legacy-pipe',
          ghl_pipeline_stages: JSON.stringify({ new_reply: 'stage-1' }),
        } as any);

        setupPipelineMocks();

        const result = resolvePipeline(GPC_COMPANY_ID);

        expect(result!.monetaryValue).toBe(250000);
      });

      it('returns $500 monetary value for BMN via legacy path', () => {
        const mockGetConfig = vi.mocked(getCompanyConfig);
        mockGetConfig.mockReturnValue({
          company_id: BMN_COMPANY_ID,
          ghl_pipeline_id: 'legacy-pipe',
          ghl_pipeline_stages: JSON.stringify({ positive_reply: 'stage-1' }),
        } as any);

        setupPipelineMocks();

        const result = resolvePipeline(BMN_COMPANY_ID);

        expect(result!.monetaryValue).toBe(500);
      });

      it('returns $1000 default for unknown company via legacy path', () => {
        const mockGetConfig = vi.mocked(getCompanyConfig);
        mockGetConfig.mockReturnValue({
          company_id: 99,
          ghl_pipeline_id: 'legacy-pipe',
          ghl_pipeline_stages: JSON.stringify({ new: 'stage-1' }),
        } as any);

        setupPipelineMocks();

        const result = resolvePipeline(99);

        expect(result!.monetaryValue).toBe(1000);
      });
    });

    describe('null returns', () => {
      it('returns null when no pipeline config exists at any tier', () => {
        setupPipelineMocks();

        const result = resolvePipeline(GPC_COMPANY_ID, GPC_CAMPAIGN_ID);

        expect(result).toBeNull();
      });

      it('returns null when legacy config has null pipeline ID', () => {
        const mockGetConfig = vi.mocked(getCompanyConfig);
        mockGetConfig.mockReturnValue({
          company_id: GPC_COMPANY_ID,
          ghl_pipeline_id: null,
          ghl_pipeline_stages: null,
        } as any);

        setupPipelineMocks();

        const result = resolvePipeline(GPC_COMPANY_ID);

        expect(result).toBeNull();
      });

      it('returns null when legacy config has invalid JSON stages', () => {
        const mockGetConfig = vi.mocked(getCompanyConfig);
        mockGetConfig.mockReturnValue({
          company_id: GPC_COMPANY_ID,
          ghl_pipeline_id: 'pipe-id',
          ghl_pipeline_stages: 'not-valid-json{{{',
        } as any);

        setupPipelineMocks();

        const result = resolvePipeline(GPC_COMPANY_ID);

        expect(result).toBeNull();
      });
    });

    describe('stage_map JSON parsing', () => {
      it('correctly parses all 7 GPC stages from JSON', () => {
        setupPipelineMocks({ exactMatch: GPC_PIPELINE_ROW });

        const result = resolvePipeline(GPC_COMPANY_ID, GPC_CAMPAIGN_ID);

        expect(Object.keys(result!.stages)).toHaveLength(7);
        expect(result!.stages.new_reply).toBe('626aaea5-7a02-4634-a54a-f652fa4e2468');
        expect(result!.stages.qualified).toBe('975e30cc-03f6-436b-ac42-0bbf06b01f66');
        expect(result!.stages.meeting_scheduled).toBe('d6e7a458-ac49-42c1-a656-fa002eb924a7');
        expect(result!.stages.meeting_completed).toBe('562069cc-59d7-453f-b9af-dfd101d86337');
        expect(result!.stages.proposal_sent).toBe('c1061437-b448-45b4-bf14-8017ed6721e1');
        expect(result!.stages.won).toBe('aec87c1a-9f79-4b73-9d91-0224ada21f9c');
        expect(result!.stages.lost).toBe('09d39d51-65f5-4a7d-bdcb-c57f49d022da');
      });

      it('correctly parses BMN agency stages from JSON', () => {
        setupPipelineMocks({ exactMatch: BMN_AGENCY_ROW });

        const result = resolvePipeline(BMN_COMPANY_ID, BMN_AGENCY_CAMPAIGN_ID);

        expect(Object.keys(result!.stages)).toHaveLength(9);
        expect(result!.stages.positive_reply).toBe('stage-a1');
        expect(result!.stages.agreement_signed).toBe('stage-a7');
        expect(result!.stages.lost).toBe('stage-a9');
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // createOpportunity
  // ────────────────────────────────────────────────────────────

  describe('createOpportunity', () => {
    it('creates a GPC opportunity with $250K value in Cold Email Response Pipeline', async () => {
      const lead = makeLead();
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        if (sql.includes('is_default')) return null;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      const result = await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(result).toBe('opp-new-123');
      expect(ghlClient.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineId: GPC_PIPELINE_ID,
          stageId: GPC_STAGE_MAP.new_reply,
          contactId: 'ghl-contact-001',
          monetaryValue: 250000,
          status: 'open',
        })
      );
    });

    it('routes meeting_request sentiment to qualified stage (first match in stage map)', async () => {
      // Implementation finds first key matching: includes('booked'), includes('scheduled'), or === 'qualified'
      // In GPC stage map, 'qualified' appears before 'meeting_scheduled' in key order, so it wins.
      const lead = makeLead();
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await createOpportunity(100, 'ghl-contact-001', 'meeting_request');

      expect(ghlClient.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          stageId: GPC_STAGE_MAP.qualified,
        })
      );
    });

    it('routes positive sentiment to new_reply stage for GPC', async () => {
      const lead = makeLead();
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(ghlClient.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          stageId: GPC_STAGE_MAP.new_reply,
        })
      );
    });

    it('routes positive sentiment to positive_reply stage for BMN', async () => {
      const lead = makeLead({
        company_id: BMN_COMPANY_ID,
        instantly_campaign_id: BMN_CREATOR_CAMPAIGN_ID,
      });
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return BMN_CREATOR_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(ghlClient.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          stageId: BMN_CREATOR_STAGE_MAP.positive_reply,
        })
      );
    });

    it('uses lead.instantly_campaign_id when no campaignId passed', async () => {
      const lead = makeLead();
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string, params?: any[]) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) {
          // Verify it queries with the lead's campaign ID
          expect(params![1]).toBe(GPC_CAMPAIGN_ID);
          return GPC_PIPELINE_ROW;
        }
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      // No campaignId argument — should use lead.instantly_campaign_id
      await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(ghlClient.createOpportunity).toHaveBeenCalled();
    });

    it('returns null when lead not found', async () => {
      mockQueryOne.mockReturnValue(null);

      const result = await createOpportunity(999, 'ghl-contact-001', 'positive');

      expect(result).toBeNull();
    });

    it('returns null when no pipeline configured', async () => {
      const lead = makeLead({ company_id: 99 });

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        return null;
      });

      const result = await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(result).toBeNull();
    });

    it('returns null when no GHL client for company', async () => {
      const lead = makeLead();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(null);

      const result = await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(result).toBeNull();
    });

    it('updates existing opportunity instead of creating duplicate', async () => {
      const lead = makeLead({ ghl_opportunity_id: 'existing-opp-id' });
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      const result = await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(result).toBe('existing-opp-id');
      expect(ghlClient.updateOpportunityStage).toHaveBeenCalledWith(
        'existing-opp-id',
        GPC_STAGE_MAP.new_reply
      );
      expect(ghlClient.createOpportunity).not.toHaveBeenCalled();
    });

    it('creates new opportunity if updating existing fails', async () => {
      const lead = makeLead({ ghl_opportunity_id: 'broken-opp-id' });
      const ghlClient = makeGhlClient({
        updateOpportunityStage: vi.fn().mockRejectedValue(new Error('Not found')),
      });

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      const result = await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(result).toBe('opp-new-123');
      expect(ghlClient.createOpportunity).toHaveBeenCalled();
    });

    it('saves DB and broadcasts WebSocket after creating opportunity', async () => {
      const lead = makeLead();
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await createOpportunity(100, 'ghl-contact-001', 'positive');

      // Should update lead with opportunity ID
      const updateCall = mockRunSql.mock.calls.find(
        ([sql]: [string]) => sql.includes('ghl_opportunity_id')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toContain('opp-new-123');

      expect(mockSaveDb).toHaveBeenCalled();

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ghl_opportunity_created',
          leadId: 100,
          opportunityId: 'opp-new-123',
          pipelineName: 'Cold Email Response Pipeline',
        })
      );
    });

    it('builds opportunity name with company name from enrichment data', async () => {
      const lead = makeLead();
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(ghlClient.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'John Smith (Smith Capital) — Cold Email Response Pipeline',
        })
      );
    });

    it('builds opportunity name without company when enrichment_data is empty', async () => {
      const lead = makeLead({ enrichment_data: null });
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(ghlClient.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'John Smith — Cold Email Response Pipeline',
        })
      );
    });

    it('returns null when GHL API fails to create opportunity', async () => {
      const lead = makeLead();
      const ghlClient = makeGhlClient({
        createOpportunity: vi.fn().mockResolvedValue(null),
      });

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      const result = await createOpportunity(100, 'ghl-contact-001', 'positive');

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // createColdEmailOpportunity (deprecated wrapper)
  // ────────────────────────────────────────────────────────────

  describe('createColdEmailOpportunity', () => {
    it('delegates to createOpportunity without explicit campaignId', async () => {
      const lead = makeLead();
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      const result = await createColdEmailOpportunity(100, 'ghl-contact-001', 'positive');

      expect(result).toBe('opp-new-123');
      expect(ghlClient.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineId: GPC_PIPELINE_ID,
          monetaryValue: 250000,
        })
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // syncOpportunityStage
  // ────────────────────────────────────────────────────────────

  describe('syncOpportunityStage', () => {
    it('updates GHL opportunity to meeting_scheduled when funnel stage is meeting_set', async () => {
      const lead = {
        company_id: GPC_COMPANY_ID,
        ghl_opportunity_id: 'opp-123',
        instantly_campaign_id: GPC_CAMPAIGN_ID,
      };
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        if (sql.includes('is_default')) return null;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await syncOpportunityStage(100, 'meeting_set');

      expect(ghlClient.updateOpportunityStage).toHaveBeenCalledWith(
        'opp-123',
        GPC_STAGE_MAP.meeting_scheduled
      );
    });

    it('maps committed funnel stage to won for GPC', async () => {
      const lead = {
        company_id: GPC_COMPANY_ID,
        ghl_opportunity_id: 'opp-123',
        instantly_campaign_id: GPC_CAMPAIGN_ID,
      };
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await syncOpportunityStage(100, 'committed');

      expect(ghlClient.updateOpportunityStage).toHaveBeenCalledWith(
        'opp-123',
        GPC_STAGE_MAP.won
      );
    });

    it('maps discovery_call_scheduled to discovery_scheduled for BMN agency', async () => {
      const lead = {
        company_id: BMN_COMPANY_ID,
        ghl_opportunity_id: 'opp-456',
        instantly_campaign_id: BMN_AGENCY_CAMPAIGN_ID,
      };
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return BMN_AGENCY_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await syncOpportunityStage(100, 'discovery_call_scheduled');

      expect(ghlClient.updateOpportunityStage).toHaveBeenCalledWith(
        'opp-456',
        BMN_AGENCY_STAGE_MAP.discovery_scheduled
      );
    });

    it('does nothing for unmapped funnel stage', async () => {
      const ghlClient = makeGhlClient();
      mockGetClient.mockReturnValue(ghlClient);

      await syncOpportunityStage(100, 'some_random_stage');

      expect(ghlClient.updateOpportunityStage).not.toHaveBeenCalled();
    });

    it('does nothing when lead has no GHL opportunity', async () => {
      const lead = {
        company_id: GPC_COMPANY_ID,
        ghl_opportunity_id: null,
        instantly_campaign_id: GPC_CAMPAIGN_ID,
      };
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await syncOpportunityStage(100, 'meeting_set');

      expect(ghlClient.updateOpportunityStage).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────
  // loseOpportunity
  // ────────────────────────────────────────────────────────────

  describe('loseOpportunity', () => {
    it('marks GPC opportunity as lost with correct stage', async () => {
      const lead = {
        company_id: GPC_COMPANY_ID,
        ghl_opportunity_id: 'opp-123',
        instantly_campaign_id: GPC_CAMPAIGN_ID,
      };
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await loseOpportunity(100, 'not interested');

      expect(ghlClient.updateOpportunity).toHaveBeenCalledWith('opp-123', {
        stageId: GPC_STAGE_MAP.lost,
        status: 'lost',
      });
    });

    it('uses rejected stage for BMN creator pipeline', async () => {
      const lead = {
        company_id: BMN_COMPANY_ID,
        ghl_opportunity_id: 'opp-456',
        instantly_campaign_id: BMN_CREATOR_CAMPAIGN_ID,
      };
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return BMN_CREATOR_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await loseOpportunity(100, 'rejected by review');

      expect(ghlClient.updateOpportunity).toHaveBeenCalledWith('opp-456', {
        stageId: BMN_CREATOR_STAGE_MAP.rejected,
        status: 'lost',
      });
    });

    it('does nothing when lead has no opportunity', async () => {
      const lead = {
        company_id: GPC_COMPANY_ID,
        ghl_opportunity_id: null,
        instantly_campaign_id: GPC_CAMPAIGN_ID,
      };
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await loseOpportunity(100, 'not interested');

      expect(ghlClient.updateOpportunity).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────
  // getCompanyPipelines
  // ────────────────────────────────────────────────────────────

  describe('getCompanyPipelines', () => {
    it('queries with correct company_id and order', () => {
      mockQueryAll.mockReturnValue([GPC_PIPELINE_ROW]);

      const result = getCompanyPipelines(GPC_COMPANY_ID);

      expect(result).toEqual([GPC_PIPELINE_ROW]);
      expect(mockQueryAll).toHaveBeenCalledWith(
        expect.stringContaining('company_id = ?'),
        [GPC_COMPANY_ID]
      );
      expect(mockQueryAll).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY is_default DESC'),
        expect.any(Array)
      );
    });

    it('returns empty array when no pipelines configured', () => {
      mockQueryAll.mockReturnValue([]);

      const result = getCompanyPipelines(99);

      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────
  // End-to-end: GPC reply flow
  // ────────────────────────────────────────────────────────────

  describe('GPC reply flow (integration)', () => {
    it('full path: GPC positive reply → Cold Email Response Pipeline → New Reply stage → $250K', async () => {
      const lead = makeLead();
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      const oppId = await createOpportunity(100, 'ghl-contact-001', 'positive');

      // Opportunity created
      expect(oppId).toBe('opp-new-123');

      // Correct pipeline
      const createCall = ghlClient.createOpportunity.mock.calls[0][0];
      expect(createCall.pipelineId).toBe(GPC_PIPELINE_ID);
      expect(createCall.stageId).toBe(GPC_STAGE_MAP.new_reply);
      expect(createCall.monetaryValue).toBe(250000);
      expect(createCall.status).toBe('open');

      // DB updated
      expect(mockRunSql).toHaveBeenCalledWith(
        expect.stringContaining('ghl_opportunity_id'),
        expect.arrayContaining(['opp-new-123', 100])
      );

      // WebSocket broadcast
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ghl_opportunity_created',
          pipelineName: 'Cold Email Response Pipeline',
        })
      );
    });

    it('full path: GPC meeting_request reply → qualified stage (first match)', async () => {
      const lead = makeLead();
      const ghlClient = makeGhlClient();

      mockQueryOne.mockImplementation((sql: string) => {
        if (sql.includes('enrichment_leads')) return lead;
        if (sql.includes('instantly_campaign_id')) return GPC_PIPELINE_ROW;
        return null;
      });
      mockGetClient.mockReturnValue(ghlClient);

      await createOpportunity(100, 'ghl-contact-001', 'meeting_request');

      const createCall = ghlClient.createOpportunity.mock.calls[0][0];
      expect(createCall.stageId).toBe(GPC_STAGE_MAP.qualified);
    });
  });
});
