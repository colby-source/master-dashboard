export interface EnrichmentLead {
  id: number;
  company_id: number;
  ghl_contact_id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  source: string;
  status: string;
  enrichment_data: string | null;
  score: number | null;
  score_label: string | null;
  score_reasoning: string | null;
  tags: string | null;
  ghl_push_status: string;
  ghl_opportunity_id: string | null;
  instantly_push_status: string;
  instantly_campaign_id: string | null;
  linkedin_outreach_status: string;
  linkedin_message: string | null;
  is_known_contact: number;
  error_message: string | null;
  retry_count: number;
  enriched_at: string | null;
  scored_at: string | null;
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnrichmentConfig {
  company_id: number;
  enabled: number;
  auto_enrich: number;
  auto_push_ghl: number;
  cold_email_requires_approval: number;
  score_threshold_hot: number;
  score_threshold_warm: number;
  scoring_prompt: string | null;
  target_instantly_campaign_id: string | null;
  ghl_tag_prefix: string;
  auto_reply_enabled: number;
  auto_reply_sentiments: string;
  ghl_pipeline_id: string | null;
  ghl_pipeline_stages: string | null;
  default_campaign_id: string | null;
  auto_approve_threshold: number;
  ghl_interested_workflow_id: string | null;
  ghl_meeting_workflow_id: string | null;
}

export interface GhlPipelineStageMap {
  new_reply: string;
  qualified: string;
  meeting_scheduled: string;
  meeting_completed: string;
  proposal_sent: string;
  won: string;
  lost: string;
}

/** BMN Agency Partner Funnel stages */
export interface BmnAgencyStageMap {
  positive_reply: string;
  engaged: string;
  discovery_scheduled: string;
  discovery_completed: string;
  proposal_sent: string;
  negotiation: string;
  agreement_signed: string;
  onboarding: string;
  lost: string;
}

/** BMN Creator Investment Funnel stages */
export interface BmnCreatorStageMap {
  positive_reply: string;
  appt_booked: string;
  application_received: string;
  brand_builder_started: string;
  brand_builder_finished: string;
  manual_review: string;
  approved: string;
  rejected: string;
}

/** Generic stage map — union of all pipeline stage types */
export type AnyStageMap = Record<string, string>;

/** Company pipeline config row */
export interface CompanyPipeline {
  id: number;
  company_id: number;
  pipeline_name: string;
  ghl_pipeline_id: string;
  instantly_campaign_id: string | null;
  stage_map: string;        // JSON string → AnyStageMap
  monetary_value: number;
  is_default: number;
}

export interface CompanyPlaybook {
  id: number;
  company_id: number;
  company_description: string;
  value_propositions: string;
  target_icp: string;
  tone: string;
  objection_handlers: string | null;
  conversation_goals: string | null;
  escalation_triggers: string | null;
  do_not_mention: string | null;
  booking_url: string | null;
  max_auto_replies: number;
}

export interface ReplyThread {
  id: number;
  enrichment_lead_id: number;
  company_id: number;
  email: string;
  instantly_email_id: string | null;
  instantly_campaign_id: string | null;
  thread_status: string;
  message_count: number;
  auto_reply_count: number;
  last_sentiment: string | null;
  last_message_at: string | null;
  escalation_reason: string | null;
  conversion_type: string | null;
}

export interface HandleReplyResult {
  action: 'auto_replied' | 'escalated' | 'skipped' | 'enriching' | 'ooo_reengagement_scheduled';
  replyText?: string;
  reason?: string;
  threadId?: number;
  sentiment?: string;
}
