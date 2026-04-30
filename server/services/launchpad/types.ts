/**
 * Shared types for the Launchpad module. Mirrors the input/output contract
 * defined in ~/.claude/skills/socialmediamonster/SKILL.md.
 */

// ── Hub-and-Spoke audience tagging ─────────────────────────
// Every clip / calendar entry / longform source is tagged with which
// audience (handle) owns it. This is the core of the hub-and-spoke model:
//   creator_personal = the creator's existing personal handle (the SPOKE)
//   brand_owned      = the new brand-owned handle (the HUB) — where conversion happens
//   shared           = IG Collab / tagged-collab posts that fire to BOTH simultaneously

export type Audience = 'creator_personal' | 'brand_owned' | 'shared';

// ── INPUT: BrandIntake ─────────────────────────────────────

export interface IcpProfile {
  demographic: string;
  psychographic: string;
  where_they_hang_out: string[];
}

export interface CompetitorEntry {
  name: string;
  handle?: string;
  what_we_do_differently: string;
}

export type PrimaryPlatform = 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'twitter';
export type PostingCapacity = 'daily' | 'every_other_day' | '3x_week';
export type PrimaryGoal = 'awareness' | 'list_build' | 'sales' | 'community';
export type MonetizationModel = 'dtc' | 'affiliate' | 'live_selling' | 'wholesale' | 'membership';
export type CategoryStatus = 'new' | 'crowded' | 'declining' | 'emerging';

export interface BrandIntake {
  // Identity
  brand_name: string;
  founder_name: string;
  founder_handle?: string;
  niche: string;
  product_categories: string[];

  // Story
  founder_story: string;
  origin_moment?: string;
  signature_belief: string;

  // Audience
  primary_icp: IcpProfile;
  secondary_icp?: IcpProfile;

  // Competitive
  top_3_competitors: CompetitorEntry[];
  category_status: CategoryStatus;

  // Channels
  primary_platform: PrimaryPlatform;
  secondary_platforms: string[];
  current_followers: Record<string, number>;
  posting_capacity: PostingCapacity;

  // Goals
  launch_date: string;
  primary_goal: PrimaryGoal;
  monetization_model: MonetizationModel[];
  price_point_range: string;
  current_revenue_monthly?: number;

  // Constraints
  brand_voice_dos: string[];
  brand_voice_donts: string[];
  off_limits_topics: string[];
  visual_style_notes?: string;
  legal_constraints?: string[];
}

// ── OUTPUT: StrategyPackage (loose typing — Claude returns JSON validated by shape) ──

export interface StrategyPackage {
  generated_at: string;
  brand_name: string;
  module_1_master_strategy: unknown;
  module_2_icp_psychology: unknown;
  module_3_authority_positioning: unknown;
  module_4_content_pillars: unknown;
  module_5_thirty_day_calendar: unknown;
  module_6_hook_bank: unknown;
  module_7_monetization_funnel: unknown;
}

// ── DB row types ──────────────────────────────────────────

export type LaunchpadStatus =
  | 'invited'
  | 'intake_started'
  | 'intake_complete'
  | 'strategy_generated'
  | 'assets_uploading'
  | 'submitted'
  | 'in_review'
  | 'needs_changes'
  | 'approved'
  | 'rejected'
  | 'launched';

export interface LaunchpadBrandRow {
  id: string;
  slug: string;
  brand_name: string;
  founder_name: string | null;
  founder_email: string;
  founder_phone: string | null;
  status: LaunchpadStatus;
  intake_data: string | null;       // JSON string
  strategy_package: string | null;  // JSON string
  strategy_generated_at: string | null;
  strategy_generation_error: string | null;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
  launch_date: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LaunchpadBrand {
  id: string;
  slug: string;
  brandName: string;
  founderName: string | null;
  founderEmail: string;
  founderPhone: string | null;
  status: LaunchpadStatus;
  intake: BrandIntake | null;
  strategy: StrategyPackage | null;
  strategyGeneratedAt: string | null;
  strategyGenerationError: string | null;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  launchDate: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  launchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function rowToBrand(row: LaunchpadBrandRow): LaunchpadBrand {
  return {
    id: row.id,
    slug: row.slug,
    brandName: row.brand_name,
    founderName: row.founder_name,
    founderEmail: row.founder_email,
    founderPhone: row.founder_phone,
    status: row.status,
    intake: row.intake_data ? safeParse<BrandIntake>(row.intake_data) : null,
    strategy: row.strategy_package ? safeParse<StrategyPackage>(row.strategy_package) : null,
    strategyGeneratedAt: row.strategy_generated_at,
    strategyGenerationError: row.strategy_generation_error,
    driveFolderId: row.drive_folder_id,
    driveFolderUrl: row.drive_folder_url,
    launchDate: row.launch_date,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    launchedAt: row.launched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeParse<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// ── Content Studio (long-form → short-form) ────────────────

export type LongformSourceType = 'generated_script' | 'uploaded_video' | 'uploaded_audio' | 'uploaded_article';
export type LongformStatus = 'pending_processing' | 'processing' | 'ready' | 'error';

export interface LongformSource {
  id: string;
  brandId: string;
  sourceType: LongformSourceType;
  pillarNumber: number | null;
  audience: Audience;
  title: string;
  body: string | null;
  durationSeconds: number | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: LongformStatus;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type ClipType = 'video_clip' | 'carousel' | 'quote' | 'single_post' | 'thread';
export type ClipFormat = 'reel' | 'carousel' | 'static' | 'story' | 'long_video';
export type ClipApprovalStatus = 'pending' | 'approved' | 'rejected' | 'regenerating';

export interface Clip {
  id: string;
  brandId: string;
  sourceId: string | null;
  clipType: ClipType;
  format: ClipFormat;
  audience: Audience;
  hook: string;
  body: string;
  cta: string | null;
  visualDirection: string | null;
  hashtags: string[] | null;
  pillarNumber: number | null;
  assignedDay: number | null;
  bestPostTime: string | null;
  approvalStatus: ClipApprovalStatus;
  approvalFeedback: string | null;
  reviewedAt: string | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  sourceStartSeconds: number | null;
  sourceEndSeconds: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface LongformSourceRow {
  id: string;
  brand_id: string;
  source_type: LongformSourceType;
  pillar_number: number | null;
  audience: Audience;
  title: string;
  body: string | null;
  duration_seconds: number | null;
  drive_file_id: string | null;
  drive_file_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: LongformStatus;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  error: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClipRow {
  id: string;
  brand_id: string;
  source_id: string | null;
  clip_type: ClipType;
  format: ClipFormat;
  audience: Audience;
  hook: string;
  body: string;
  cta: string | null;
  visual_direction: string | null;
  hashtags: string | null;
  pillar_number: number | null;
  assigned_day: number | null;
  best_post_time: string | null;
  approval_status: ClipApprovalStatus;
  approval_feedback: string | null;
  reviewed_at: string | null;
  drive_file_id: string | null;
  drive_file_url: string | null;
  source_start_seconds: number | null;
  source_end_seconds: number | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToLongformSource(row: LongformSourceRow): LongformSource {
  return {
    id: row.id,
    brandId: row.brand_id,
    sourceType: row.source_type,
    pillarNumber: row.pillar_number,
    audience: row.audience ?? 'creator_personal',
    title: row.title,
    body: row.body,
    durationSeconds: row.duration_seconds,
    driveFileId: row.drive_file_id,
    driveFileUrl: row.drive_file_url,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    processingStartedAt: row.processing_started_at,
    processingCompletedAt: row.processing_completed_at,
    error: row.error,
    metadata: row.metadata ? safeParse<Record<string, unknown>>(row.metadata) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToClip(row: ClipRow): Clip {
  return {
    id: row.id,
    brandId: row.brand_id,
    sourceId: row.source_id,
    clipType: row.clip_type,
    format: row.format,
    audience: row.audience ?? 'creator_personal',
    hook: row.hook,
    body: row.body,
    cta: row.cta,
    visualDirection: row.visual_direction,
    hashtags: row.hashtags ? safeParse<string[]>(row.hashtags) : null,
    pillarNumber: row.pillar_number,
    assignedDay: row.assigned_day,
    bestPostTime: row.best_post_time,
    approvalStatus: row.approval_status,
    approvalFeedback: row.approval_feedback,
    reviewedAt: row.reviewed_at,
    driveFileId: row.drive_file_id,
    driveFileUrl: row.drive_file_url,
    sourceStartSeconds: row.source_start_seconds,
    sourceEndSeconds: row.source_end_seconds,
    metadata: row.metadata ? safeParse<Record<string, unknown>>(row.metadata) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Hub identity (the brand-owned handle + storefront + automation) ──

export type MarketplaceStatus = 'pending' | 'active' | 'disabled';
export type SkuRole = 'hero' | 'support' | 'bundle';

/** Map of platform → "@handle" (e.g. { instagram: "@quinnswellness", tiktok: "@quinnswellness" }) */
export type BrandHandles = Partial<Record<PrimaryPlatform | string, string>>;

/** Mix of content posted on the brand-owned handle. Numbers must sum to 1.0. */
export interface HubContentMix {
  ugc?: number;
  education?: number;
  founder_clips?: number;
  memes?: number;
  product?: number;
  [key: string]: number | undefined;
}

/** GHL workflow IDs for the 6 mandatory retention flows (cloned per brand from a master template). */
export interface GhlWorkflowIds {
  welcome?: string;
  cart_abandon?: string;
  browse_abandon?: string;
  post_purchase?: string;
  replenish_d45?: string;
  win_back?: string;
}

export interface BrandIdentity {
  brandId: string;
  brandHandles: BrandHandles | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  logoDriveFileId: string | null;
  brandKitDriveUrl: string | null;
  brandBioText: string | null;
  bioLinkUrl: string | null;
  bioLinkSlug: string | null;
  founderStoryReelScript: string | null;
  founderStoryReelDriveUrl: string | null;
  hubPostCadence: string | null;
  spokePostCadence: string | null;
  hubContentMix: HubContentMix | null;
  shopifyCollectionId: string | null;
  shopifyCollectionHandle: string | null;
  shopifyStorefrontUrl: string | null;
  tiktokShopStatus: MarketplaceStatus;
  amazonBrandRegistryStatus: MarketplaceStatus;
  ghlPipelineId: string | null;
  ghlWorkflowIds: GhlWorkflowIds | null;
  ghlSmsNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandIdentityRow {
  brand_id: string;
  brand_handles: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  logo_drive_file_id: string | null;
  brand_kit_drive_url: string | null;
  brand_bio_text: string | null;
  bio_link_url: string | null;
  bio_link_slug: string | null;
  founder_story_reel_script: string | null;
  founder_story_reel_drive_url: string | null;
  hub_post_cadence: string | null;
  spoke_post_cadence: string | null;
  hub_content_mix: string | null;
  shopify_collection_id: string | null;
  shopify_collection_handle: string | null;
  shopify_storefront_url: string | null;
  tiktok_shop_status: MarketplaceStatus;
  amazon_brand_registry_status: MarketplaceStatus;
  ghl_pipeline_id: string | null;
  ghl_workflow_ids: string | null;
  ghl_sms_number: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToBrandIdentity(row: BrandIdentityRow): BrandIdentity {
  return {
    brandId: row.brand_id,
    brandHandles: row.brand_handles ? safeParse<BrandHandles>(row.brand_handles) : null,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    accentColor: row.accent_color,
    logoDriveFileId: row.logo_drive_file_id,
    brandKitDriveUrl: row.brand_kit_drive_url,
    brandBioText: row.brand_bio_text,
    bioLinkUrl: row.bio_link_url,
    bioLinkSlug: row.bio_link_slug,
    founderStoryReelScript: row.founder_story_reel_script,
    founderStoryReelDriveUrl: row.founder_story_reel_drive_url,
    hubPostCadence: row.hub_post_cadence,
    spokePostCadence: row.spoke_post_cadence,
    hubContentMix: row.hub_content_mix ? safeParse<HubContentMix>(row.hub_content_mix) : null,
    shopifyCollectionId: row.shopify_collection_id,
    shopifyCollectionHandle: row.shopify_collection_handle,
    shopifyStorefrontUrl: row.shopify_storefront_url,
    tiktokShopStatus: row.tiktok_shop_status,
    amazonBrandRegistryStatus: row.amazon_brand_registry_status,
    ghlPipelineId: row.ghl_pipeline_id,
    ghlWorkflowIds: row.ghl_workflow_ids ? safeParse<GhlWorkflowIds>(row.ghl_workflow_ids) : null,
    ghlSmsNumber: row.ghl_sms_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Per-brand SKU selections from the BMN PLDS catalog ──

export interface BrandSku {
  id: string;
  brandId: string;
  catalogItemId: string;
  role: SkuRole;
  customName: string | null;
  customMsrpUsd: number | null;
  displayOrder: number;
  createdAt: string;
}

export interface BrandSkuRow {
  id: string;
  brand_id: string;
  catalog_item_id: string;
  role: SkuRole;
  custom_name: string | null;
  custom_msrp_usd: number | null;
  display_order: number;
  created_at: string;
}

export function rowToBrandSku(row: BrandSkuRow): BrandSku {
  return {
    id: row.id,
    brandId: row.brand_id,
    catalogItemId: row.catalog_item_id,
    role: row.role,
    customName: row.custom_name,
    customMsrpUsd: row.custom_msrp_usd,
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

// ── BMN PLDS catalog ──

export type CatalogSource = 'skincare' | 'cosmetics' | 'selfnamed' | 'supplements';

export interface BmnCatalogItem {
  id: string;
  catalogSource: CatalogSource;
  supplierName: string | null;
  category: string | null;
  productName: string;
  sizeOrVolume: string | null;
  totalLandedCost: number | null;
  msrpUsd: number | null;
  grossProfitUsd: number | null;
  grossMarginPct: number | null;
  influencerPayout25Usd: number | null;
  bmnNetUsd: number | null;
  bmnNetPct: number | null;
  moq: number | null;
  moqNotes: string | null;
  labelOnDemand: boolean;
  ships2to3Days: boolean;
  requiresComplianceReview: boolean;
  complianceNotes: string | null;
  rawMetadata: Record<string, unknown> | null;
  sourceSyncedAt: string;
  createdAt: string;
}

export interface BmnCatalogRow {
  id: string;
  catalog_source: CatalogSource;
  supplier_name: string | null;
  category: string | null;
  product_name: string;
  size_or_volume: string | null;
  total_landed_cost: number | null;
  msrp_usd: number | null;
  gross_profit_usd: number | null;
  gross_margin_pct: number | null;
  influencer_payout_25_usd: number | null;
  bmn_net_usd: number | null;
  bmn_net_pct: number | null;
  moq: number | null;
  moq_notes: string | null;
  label_on_demand: number;
  ships_2_3_days: number;
  requires_compliance_review: number;
  compliance_notes: string | null;
  raw_metadata: string | null;
  source_synced_at: string;
  created_at: string;
}

export function rowToCatalogItem(row: BmnCatalogRow): BmnCatalogItem {
  return {
    id: row.id,
    catalogSource: row.catalog_source,
    supplierName: row.supplier_name,
    category: row.category,
    productName: row.product_name,
    sizeOrVolume: row.size_or_volume,
    totalLandedCost: row.total_landed_cost,
    msrpUsd: row.msrp_usd,
    grossProfitUsd: row.gross_profit_usd,
    grossMarginPct: row.gross_margin_pct,
    influencerPayout25Usd: row.influencer_payout_25_usd,
    bmnNetUsd: row.bmn_net_usd,
    bmnNetPct: row.bmn_net_pct,
    moq: row.moq,
    moqNotes: row.moq_notes,
    labelOnDemand: row.label_on_demand === 1,
    ships2to3Days: row.ships_2_3_days === 1,
    requiresComplianceReview: row.requires_compliance_review === 1,
    complianceNotes: row.compliance_notes,
    rawMetadata: row.raw_metadata ? safeParse<Record<string, unknown>>(row.raw_metadata) : null,
    sourceSyncedAt: row.source_synced_at,
    createdAt: row.created_at,
  };
}
