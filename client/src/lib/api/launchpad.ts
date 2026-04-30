import { request, BASE } from './client';

// Public client-side endpoints (magic-link auth via token in URL)
export const launchpadPublic = {
  getSession: (token: string) => request<{
    brandId: string;
    slug: string;
    brandName: string;
    founderName: string | null;
    founderEmail: string;
    status: string;
    intake: Record<string, unknown> | null;
    missingIntakeFields: string[];
    strategy: Record<string, unknown> | null;
    strategyGeneratedAt: string | null;
    driveFolderUrl: string | null;
    launchDate: string | null;
  }>(`/launchpad-public/session/${encodeURIComponent(token)}`),

  saveIntake: (token: string, intake: Record<string, unknown>) =>
    request<{ ok: boolean; status: string; isComplete: boolean }>(
      `/launchpad-public/intake/${encodeURIComponent(token)}`,
      { method: 'POST', body: JSON.stringify(intake) },
    ),

  generateStrategy: (token: string) =>
    request<{ ok: boolean; partial: boolean; errors?: { module: number; error: string }[] }>(
      `/launchpad-public/generate-strategy/${encodeURIComponent(token)}`,
      { method: 'POST' },
    ),

  updateModule: (token: string, moduleNumber: number, value: unknown) =>
    request<{ ok: boolean }>(
      `/launchpad-public/strategy/${encodeURIComponent(token)}/module/${moduleNumber}`,
      { method: 'PATCH', body: JSON.stringify(value) },
    ),

  uploadAsset: async (token: string, file: File, assetType: string, metadata?: Record<string, unknown>): Promise<{ id: string; url: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('assetType', assetType);
    if (metadata) fd.append('metadata', JSON.stringify(metadata));
    const res = await fetch(`${BASE}/launchpad-public/upload/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },

  listAssets: (token: string) =>
    request<{ assets: { id: string; asset_type: string; filename: string; drive_file_url: string; uploaded_at: string }[] }>(
      `/launchpad-public/assets/${encodeURIComponent(token)}`,
    ),

  listReviews: (token: string) =>
    request<{ reviews: { module_number: number; status: string; feedback: string; reviewed_at: string }[] }>(
      `/launchpad-public/reviews/${encodeURIComponent(token)}`,
    ),

  submit: (token: string) =>
    request<{ ok: boolean }>(`/launchpad-public/submit/${encodeURIComponent(token)}`, { method: 'POST' }),

  // Content Studio
  generateContent: (token: string, options?: { generateLongform?: boolean; chopExistingSources?: boolean; clipsPerSource?: number; autoMapToCalendar?: boolean }) =>
    request<{ generatedSources: number; choppedSources: number; newClips: number; errors: { stage: string; pillar?: number; sourceId?: string; error: string }[] }>(
      `/launchpad-public/content/generate/${encodeURIComponent(token)}`,
      { method: 'POST', body: JSON.stringify(options || {}) },
    ),

  uploadArticle: (token: string, payload: { title: string; body: string; pillarNumber?: number }) =>
    request<{ ok: boolean; sourceId: string }>(
      `/launchpad-public/content/upload-article/${encodeURIComponent(token)}`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  listSources: (token: string) =>
    request<{ sources: Array<{ id: string; sourceType: string; pillarNumber: number | null; title: string; body: string | null; status: string; createdAt: string }> }>(
      `/launchpad-public/content/sources/${encodeURIComponent(token)}`,
    ),

  listClips: (token: string, filter?: { status?: string; pillar?: number }) => {
    const qs = new URLSearchParams();
    if (filter?.status) qs.set('status', filter.status);
    if (filter?.pillar !== undefined) qs.set('pillar', String(filter.pillar));
    const query = qs.toString();
    return request<{ clips: Array<any> }>(
      `/launchpad-public/content/clips/${encodeURIComponent(token)}${query ? '?' + query : ''}`,
    );
  },

  approveClip: (token: string, clipId: string) =>
    request<{ ok: boolean }>(
      `/launchpad-public/content/clips/${encodeURIComponent(token)}/${clipId}/approve`,
      { method: 'POST' },
    ),

  rejectClip: (token: string, clipId: string, feedback: string) =>
    request<{ ok: boolean }>(
      `/launchpad-public/content/clips/${encodeURIComponent(token)}/${clipId}/reject`,
      { method: 'POST', body: JSON.stringify({ feedback }) },
    ),

  reassignClipDay: (token: string, clipId: string, day: number | null) =>
    request<{ ok: boolean }>(
      `/launchpad-public/content/clips/${encodeURIComponent(token)}/${clipId}/day`,
      { method: 'PATCH', body: JSON.stringify({ day }) },
    ),

  regenerateClip: (token: string, clipId: string) =>
    request<{ ok: boolean }>(
      `/launchpad-public/content/clips/${encodeURIComponent(token)}/${clipId}/regenerate`,
      { method: 'POST' },
    ),

  uploadVideo: async (token: string, file: File, opts?: { title?: string; pillarNumber?: number }): Promise<{ ok: boolean; sourceId: string; status: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts?.title) fd.append('title', opts.title);
    if (opts?.pillarNumber !== undefined) fd.append('pillarNumber', String(opts.pillarNumber));
    const res = await fetch(`${BASE}/launchpad-public/content/upload-video/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) throw new Error(`Video upload failed: ${res.status}`);
    return res.json();
  },

  calendarCsvUrl: (token: string) => `${BASE}/launchpad-public/calendar/${encodeURIComponent(token)}/csv`,

  // ── Hub identity (the brand-owned handle, brand kit, storefront, GHL) ──
  getIdentity: (token: string) =>
    request<{ identity: BrandIdentityDto | null }>(
      `/launchpad-public/identity/${encodeURIComponent(token)}`,
    ),

  patchIdentity: (token: string, patch: Partial<BrandIdentityDto>) =>
    request<{ ok: boolean; identity: BrandIdentityDto }>(
      `/launchpad-public/identity/${encodeURIComponent(token)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  // ── BMN PLDS catalog (read-only) ──────────────────────────────
  getCatalog: (
    token: string,
    filter?: {
      source?: CatalogSource;
      category?: string;
      minMargin?: number;
      minNet?: number;
      compliance?: boolean;
      q?: string;
      limit?: number;
      offset?: number;
    },
  ) => {
    const qs = new URLSearchParams();
    if (filter?.source) qs.set('source', filter.source);
    if (filter?.category) qs.set('category', filter.category);
    if (filter?.minMargin !== undefined) qs.set('minMargin', String(filter.minMargin));
    if (filter?.minNet !== undefined) qs.set('minNet', String(filter.minNet));
    if (filter?.compliance !== undefined) qs.set('compliance', String(filter.compliance));
    if (filter?.q) qs.set('q', filter.q);
    if (filter?.limit !== undefined) qs.set('limit', String(filter.limit));
    if (filter?.offset !== undefined) qs.set('offset', String(filter.offset));
    const q = qs.toString();
    return request<{ items: BmnCatalogItemDto[] }>(
      `/launchpad-public/catalog/${encodeURIComponent(token)}${q ? '?' + q : ''}`,
    );
  },

  getCatalogCategories: (token: string, source?: CatalogSource) => {
    const q = source ? `?source=${source}` : '';
    return request<{ categories: string[] }>(
      `/launchpad-public/catalog/${encodeURIComponent(token)}/categories${q}`,
    );
  },

  // ── Per-brand SKU selections ──────────────────────────────────
  getSkus: (token: string) =>
    request<{ skus: BrandSkuDto[] }>(
      `/launchpad-public/skus/${encodeURIComponent(token)}`,
    ),

  putSkus: (
    token: string,
    selections: Array<{
      catalogItemId: string;
      role: 'hero' | 'support' | 'bundle';
      customName?: string;
      customMsrpUsd?: number;
      displayOrder?: number;
    }>,
  ) =>
    request<{ ok: boolean; skus: BrandSkuDto[] }>(
      `/launchpad-public/skus/${encodeURIComponent(token)}`,
      { method: 'PUT', body: JSON.stringify({ selections }) },
    ),
};

// ── DTOs surfaced to the UI ─────────────────────────────────────

export type CatalogSource = 'skincare' | 'cosmetics' | 'selfnamed' | 'supplements';

export interface BmnCatalogItemDto {
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
}

export interface BrandSkuDto {
  id: string;
  brandId: string;
  catalogItemId: string;
  role: 'hero' | 'support' | 'bundle';
  customName: string | null;
  customMsrpUsd: number | null;
  displayOrder: number;
  createdAt: string;
}

export interface BrandIdentityDto {
  brandId: string;
  brandHandles: Record<string, string> | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  brandBioText: string | null;
  bioLinkUrl: string | null;
  bioLinkSlug: string | null;
  founderStoryReelScript: string | null;
  founderStoryReelDriveUrl: string | null;
  hubPostCadence: string | null;
  spokePostCadence: string | null;
  hubContentMix: Record<string, number> | null;
  shopifyCollectionId: string | null;
  shopifyCollectionHandle: string | null;
  shopifyStorefrontUrl: string | null;
  tiktokShopStatus: 'pending' | 'active' | 'disabled';
  amazonBrandRegistryStatus: 'pending' | 'active' | 'disabled';
}

// Admin endpoints (require API key auth)
export const launchpadAdmin = {
  list: (status?: string) =>
    request<{ brands: any[]; count: number }>(`/launchpad/brands${status ? `?status=${status}` : ''}`),

  get: (id: string) =>
    request<{ brand: any; statusLog: any[]; reviews: any[]; assets: any[] }>(`/launchpad/brands/${id}`),

  create: (input: { brandName: string; founderName?: string; founderEmail: string; founderPhone?: string; launchDate?: string; sendEmail?: boolean }) =>
    request<{ brand: any; magicLinkUrl: string; magicLinkExpiresAt: string }>(
      `/launchpad/brands`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  newMagicLink: (brandId: string, send = true) =>
    request<{ id: string; token: string; url: string; expiresAt: string }>(
      `/launchpad/brands/${brandId}/magic-link`,
      { method: 'POST', body: JSON.stringify({ send }) },
    ),

  generateStrategy: (brandId: string) =>
    request<{ ok: boolean; partial: boolean; errors?: { module: number; error: string }[] }>(
      `/launchpad/brands/${brandId}/generate-strategy`,
      { method: 'POST' },
    ),

  reviewModule: (brandId: string, moduleNumber: number, status: 'approved' | 'needs_changes', feedback: string) =>
    request<{ ok: boolean }>(
      `/launchpad/brands/${brandId}/review/${moduleNumber}`,
      { method: 'POST', body: JSON.stringify({ status, feedback }) },
    ),

  approve: (brandId: string) =>
    request<{ ok: boolean }>(`/launchpad/brands/${brandId}/approve`, { method: 'POST' }),

  reject: (brandId: string, reason: string) =>
    request<{ ok: boolean }>(
      `/launchpad/brands/${brandId}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  requestChanges: (brandId: string, note: string) =>
    request<{ ok: boolean }>(
      `/launchpad/brands/${brandId}/request-changes`,
      { method: 'POST', body: JSON.stringify({ note }) },
    ),

  markLaunched: (brandId: string) =>
    request<{ ok: boolean }>(`/launchpad/brands/${brandId}/mark-launched`, { method: 'POST' }),

  // Content Studio admin views
  generateContent: (brandId: string, options?: { generateLongform?: boolean; chopExistingSources?: boolean; clipsPerSource?: number; autoMapToCalendar?: boolean }) =>
    request<{ generatedSources: number; choppedSources: number; newClips: number; errors: any[] }>(
      `/launchpad/brands/${brandId}/content/generate`,
      { method: 'POST', body: JSON.stringify(options || {}) },
    ),

  listClips: (brandId: string) =>
    request<{ clips: any[] }>(`/launchpad/brands/${brandId}/content/clips`),

  listSources: (brandId: string) =>
    request<{ sources: any[] }>(`/launchpad/brands/${brandId}/content/sources`),

  approveClip: (clipId: string) =>
    request<{ ok: boolean }>(`/launchpad/clips/${clipId}/approve`, { method: 'POST' }),

  rejectClip: (clipId: string, feedback: string) =>
    request<{ ok: boolean }>(`/launchpad/clips/${clipId}/reject`, { method: 'POST', body: JSON.stringify({ feedback }) }),

  deliver: (brandId: string, sendEmail = true) =>
    request<{ ok: boolean; links: Record<string, string>; error?: string }>(
      `/launchpad/brands/${brandId}/deliver`,
      { method: 'POST', body: JSON.stringify({ sendEmail }) },
    ),

  calendarCsvUrl: (brandId: string) => `/api/launchpad/brands/${brandId}/calendar.csv`,

  // Pre-load SKUs for a brand BEFORE the magic link is sent — wizard opens
  // in review mode for the creator with these picks pre-filled.
  getSkus: (brandId: string) =>
    request<{ skus: BrandSkuDto[] }>(`/launchpad/brands/${brandId}/skus`),

  putSkus: (
    brandId: string,
    selections: Array<{
      catalogItemId: string;
      role: 'hero' | 'support' | 'bundle';
      customName?: string;
      customMsrpUsd?: number;
      displayOrder?: number;
    }>,
  ) =>
    request<{ ok: boolean; skus: BrandSkuDto[] }>(
      `/launchpad/brands/${brandId}/skus`,
      { method: 'PUT', body: JSON.stringify({ selections }) },
    ),
};
