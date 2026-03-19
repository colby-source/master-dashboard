export interface Company {
  id: number;
  name: string;
  type: string;
  ghl_location_id: string | null;
  instantly_tag: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: number;
  external_id: string | null;
  name: string;
  company_id: number | null;
  platform: string;
  status: string;
  stats_json: string | null;
  daily_limit: number | null;
  account_count: number;
  last_synced: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: number;
  external_id: string | null;
  name: string;
  company_id: number | null;
  type: string;
  status: string;
  config_json: string | null;
  last_run: string | null;
  success_rate: number;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  company_id: number | null;
  source: string;
  source_id: string | null;
  assignee: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: number;
  type: string;
  severity: string;
  message: string;
  source: string | null;
  entity_type: string | null;
  entity_id: string | null;
  acknowledged: number;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface Metric {
  id: number;
  company_id: number | null;
  metric_type: string;
  value: number;
  recorded_at: string;
}

export interface AiDiscovery {
  id: number;
  title: string;
  source_url: string | null;
  platform: string | null;
  summary: string | null;
  category: string | null;
  saved: number;
  discovered_at: string;
}
