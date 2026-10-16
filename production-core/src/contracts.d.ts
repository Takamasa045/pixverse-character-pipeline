export type Context = {
  region: string;
  workspace_id: string;
};
export type ReferenceRole = 'identity' | 'appearance' | 'motion' | 'layout' | 'audio' | 'timing';
export type QA = {
  technical: 'pass' | 'fail';
  creative: 'pass' | 'fail';
  continuity: 'pass' | 'fail';
  audio: 'pass' | 'fail' | 'not_applicable';
  reviewer: string;
  notes: string;
};
export interface Asset {
  id: string;
  kind: 'image' | 'video' | 'audio';
  path?: string;
  sha256?: string;
  provider_id?: string;
  region: string;
  workspace_id: string;
  provenance: unknown;
  status?: 'accepted' | 'candidate';
}
export interface ReferenceBinding {
  asset: string;
  role: ReferenceRole;
  order: number;
  target?: string;
  controls?: Record<string, unknown>;
}
export interface GenerationIntent {
  id: string;
  project_id: string;
  shot_id: string;
  attempt: number;
  backend: 'create' | 'canvas';
  mode: string;
  model: string;
  parameters: Record<string, unknown>;
  inputs: (Asset & { binding?: ReferenceBinding })[];
  owners?: string[];
  entity_revisions?: { id: string; revision: number }[];
  context: Context;
  upper_credits: number | null;
  price_evidence: unknown;
  capability_snapshot: unknown;
  canvas?: Record<string, unknown>;
}
export interface Take {
  id: string;
  project_id: string;
  shot_id: string;
  intent_id: string | null;
  provider_id: string;
  kind: 'image' | 'video' | 'audio';
  path?: string;
  sha256?: string;
  status: 'completed' | 'downloaded' | 'reviewed' | 'accepted';
  stale: boolean;
  qa: QA | null;
  provenance: unknown;
}
export interface AdapterResult {
  results: {
    id: string;
    status: 'submitted' | 'running' | 'completed' | 'provider_failed';
    kind: string;
    url?: string;
    path?: string;
    cost_credits?: number;
  }[];
  exit_code?: number;
  error?: unknown;
  raw?: unknown;
}
export interface Adapter {
  submit(intent: GenerationIntent): Promise<AdapterResult>;
  status(intent: GenerationIntent, id: string): Promise<AdapterResult>;
  download(intent: GenerationIntent, id: string, destination: string): Promise<AdapterResult>;
}
export interface EntityRevision {
  id: string;
  revision: number;
  kind: 'character' | 'voice' | 'wardrobe' | 'location' | 'prop';
  name: string;
  status: 'accepted';
  reviewer: string;
  context: Context;
  references: (Asset & { status: 'accepted' })[];
  links?: {
    id: string;
    revision: number;
  }[];
}
export interface ShotSpec {
  shot_id: string;
  purpose: string;
  prompt?: string;
  edit_duration_ms: number;
  entry_state: Record<string, unknown>;
  exit_state: Record<string, unknown>;
  camera: string;
  audio: {
    intent: string;
    strict_dialogue?: boolean;
    visible_mouth?: boolean;
    same_voice?: boolean;
    verified_sync_evidence?: unknown;
  };
  references: ReferenceBinding[];
  generation_strategy: 'editable_shot' | 'single_take' | 'native_sequence';
  take_id?: string;
  entity_revisions?: { id: string; revision: number }[];
  generation?: GenerationSpec;
}
export interface GenerationSpec {
  backend: 'create' | 'canvas';
  mode: string;
  model: string;
  attempt?: number;
  parameters?: Record<string, unknown>;
  upper_credits?: number | null;
  price_evidence?: unknown;
  capability_snapshot?: unknown;
  canvas?: Record<string, unknown>;
}
export interface EditTimeline {
  fps: number;
  clips: {
    shot_id: string;
    take_id: string;
    source_in_ms: number;
    duration_ms: number;
    audio?: boolean;
    volume?: number;
    locale?: string;
    variant_id?: string;
    delivery_id?: string;
  }[];
  audio: Record<string, unknown>[];
  captions: {
    start_ms: number;
    end_ms: number;
    text: string;
    locale?: string;
    variant_id?: string;
    delivery_id?: string;
  }[];
}
export interface Production {
  schema_version: 'production.v1';
  project_id: string;
  revision: number;
  context: Context;
  brief: {
    original: string;
    intent: string;
    assumptions: string[];
    deliveries: {
      id: string;
      locale: string;
      aspect: string;
      duration_ms: number;
      width?: number;
      height?: number;
      timeline?: EditTimeline;
      caption_mode?: 'off' | 'sidecar';
    }[];
  };
  entities: {
    id: string;
    revision: number;
  }[];
  assets: Asset[];
  shots: ShotSpec[];
  jobs?: {
    shot_id: string;
    purpose: string;
    generation: GenerationSpec;
    locale?: string;
    voice_revision?: string | number;
    performance?: unknown;
    references?: ReferenceBinding[];
    entity_revisions?: { id: string; revision: number }[];
  }[];
  execution_policy: {
    allowed_scope: 'planning_only' | 'generation';
    max_credits: number | null;
    max_attempts: number;
  };
  timeline: EditTimeline;
}
