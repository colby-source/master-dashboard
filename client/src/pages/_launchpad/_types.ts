/**
 * Wizard-side types. Mirrors server/services/launchpad/types.ts BrandIntake
 * but is Partial — the wizard saves incrementally so every field starts blank.
 *
 * Keep this in sync with the server types. The REQUIRED_INTAKE_FIELDS array
 * in LaunchpadPublicPage.tsx is the source of truth for which fields the
 * server enforces before strategy generation.
 */

import type { launchpadPublic } from '../../lib/api/launchpad';

export type Session = Awaited<ReturnType<typeof launchpadPublic.getSession>>;

export interface IcpProfile {
  demographic?: string;
  psychographic?: string;
  where_they_hang_out?: string[];
}

export interface CompetitorEntry {
  name?: string;
  handle?: string;
  what_we_do_differently?: string;
}

export type PrimaryPlatform = 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'twitter';
export type PostingCapacity = 'daily' | 'every_other_day' | '3x_week';
export type PrimaryGoal = 'awareness' | 'list_build' | 'sales' | 'community';
export type CategoryStatus = 'new' | 'crowded' | 'declining' | 'emerging';

export interface IntakeData {
  // Identity
  brand_name?: string;
  founder_name?: string;
  founder_handle?: string;
  niche?: string;
  product_categories?: string[];

  // Story
  founder_story?: string;
  origin_moment?: string;
  signature_belief?: string;

  // Audience
  primary_icp?: IcpProfile;

  // Competitive
  top_3_competitors?: CompetitorEntry[];
  category_status?: CategoryStatus | '';

  // Channels
  primary_platform?: PrimaryPlatform | '';
  secondary_platforms?: string[];
  posting_capacity?: PostingCapacity | '';

  // Goals
  launch_date?: string;
  primary_goal?: PrimaryGoal | '';
  monetization_model?: string[];
  price_point_range?: string;

  // Constraints
  brand_voice_dos?: string[];
  brand_voice_donts?: string[];
  off_limits_topics?: string[];
  visual_style_notes?: string;
  legal_constraints?: string[];

  // Compliance acks (Phase 2) — { gate_id: ISO timestamp }
  compliance_acks?: Record<string, string>;

  // ── Admin pre-bake fields ────────────────────────────────
  // Set by the admin BEFORE sending the magic link. Creator sees read-only
  // review sections instead of data-entry forms when these are present.

  /** ISO timestamp set by admin when brand direction is sealed and ready */
  admin_prep_sealed?: string;

  /** Creator per-section comments. { [sectionId]: string } */
  creator_feedback?: Record<string, string>;

  /**
   * Creator explicit section sign-offs.
   * { brand_direction: ISO | null, assets: ISO | null, products: ISO | null }
   */
  review_signoffs?: {
    brand_direction?: string | null;
    assets?: string | null;
    products?: string | null;
  };
}

export type IntakePatch = Partial<IntakeData>;

export interface StepProps {
  intake: IntakeData;
  update: (patch: IntakePatch) => void;
}

export interface StepWithNestedProps extends StepProps {
  updateNested: (path: string[], value: unknown) => void;
}

// ── Clip (Content Studio) ──
// The full Clip shape lives in server/services/launchpad/types.ts. The wizard
// only consumes a subset; widen as needed.
export interface ClipDto {
  id: string;
  format: string;
  pillarNumber: number;
  clipType: string;
  hook: string;
  body: string;
  cta?: string;
  visualDirection?: string;
  driveFileUrl?: string;
  assignedDay: number | null;
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'regenerating';
  approvalFeedback?: string;
}

export interface SourceDto {
  id: string;
  sourceType: string;
  pillarNumber: number | null;
  title: string;
  status: string;
}
