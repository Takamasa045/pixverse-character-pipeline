export type OverlayStyle = "title" | "subtitle" | "lower-third" | "endcard" | "none";

export type SupportedAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3";

export type Theme = {
  accent: string;
  background: string;
  text: string;
};

export type GeneratedClipConfig = {
  audioFile?: string | null;
  audioVolume?: number;
  durationSeconds: number;
  hasAudio?: boolean;
  id: string;
  overlayStyle?: OverlayStyle;
  overlayText?: string;
  source: "generated";
  text?: string;
  ttsSpeaker?: number | null;
};

export type ReferenceClipConfig = {
  audioFile?: string | null;
  audioVolume?: number;
  durationSeconds: number;
  hasAudio?: boolean;
  id: string;
  overlayStyle?: OverlayStyle;
  overlayText?: string;
  prompt: string;
  source: "reference";
  text?: string;
  ttsSpeaker?: number | null;
};

export type VideoClipConfig = {
  asset: string;
  audioVolume?: number;
  durationSeconds: number;
  hasAudio?: boolean;
  id: string;
  overlayStyle?: OverlayStyle;
  overlayText?: string;
  source: "video";
};

export type ImageClipConfig = {
  asset: string;
  durationSeconds: number;
  id: string;
  overlayStyle?: OverlayStyle;
  overlayText?: string;
  source: "image";
};

export type ClipConfig =
  | GeneratedClipConfig
  | ReferenceClipConfig
  | VideoClipConfig
  | ImageClipConfig;

export type LocaleConfig = {
  bgm?: string | null;
  bgmVolume?: number;
  clips: ClipConfig[];
  theme?: Theme;
};

export type ProjectConfig = {
  generation: {
    ambientSound: string | null;
    model: string;
    prompt: {
      base: string;
      perRatio?: Partial<Record<SupportedAspectRatio, string>>;
    };
    quality: string;
    upscale: boolean;
  };
  locales: Record<string, LocaleConfig>;
  project: {
    date: string;
    slug: string;
    title: string;
  };
  render: {
    aspectRatios: SupportedAspectRatio[];
    fps: number;
    outputDir: string;
  };
  speaker: {
    images: string[];
    mode: "single" | "reference";
    name: string;
  };
};

export type RenderCut = {
  audioVolume?: number;
  durationInFrames: number;
  hasAudio?: boolean;
  id: string;
  imageSrc: string | null;
  narrationSrc?: string | null;
  overlayStyle: OverlayStyle;
  overlayText: string;
  startFrame: number;
  videoSrc: string | null;
};

export type RenderManifest = {
  aspectRatio: SupportedAspectRatio;
  bgm: string | null;
  bgmVolume: number;
  cuts: RenderCut[];
  durationInFrames: number;
  fps: number;
  height: number;
  language: string;
  narration?: string;
  projectSlug: string;
  speakerImage: string;
  theme: Theme;
  width: number;
};

export type ClipStageIds = {
  final: string | null;
  sound: string | null;
  speech: string | null;
  upscale: string | null;
};

export type RunVariantStatus = "planned" | "completed" | "failed" | "skipped";

export type RunVariantManifest = {
  aspectRatio: SupportedAspectRatio;
  baseVideoId: string | null;
  clipAssets: Record<string, string>;
  clipVideoIds: Record<string, ClipStageIds>;
  error: string | null;
  file: string | null;
  language: string;
  renderManifest: string | null;
  status: RunVariantStatus;
};

export type RunManifest = {
  configPath: string;
  generatedAt: string;
  project: ProjectConfig["project"];
  sourceFormat: "legacy" | "project";
  summary: {
    completed: number;
    failed: number;
    planned: number;
    skipped: number;
    total: number;
  };
  variants: RunVariantManifest[];
};

export type BaseJobPlan = {
  aspectRatio: SupportedAspectRatio;
  prompt: string;
};

export type ReferenceJobPlan = {
  aspectRatio: SupportedAspectRatio;
  clipId: string;
  language: string;
  prompt: string;
};

export type PlannedVariant = {
  aspectRatio: SupportedAspectRatio;
  generatedClipCount: number;
  language: string;
  ratioSlug: string;
  usesGeneratedClips: boolean;
  referenceClipCount: number;
  usesReferenceClips: boolean;
};

export type PipelinePlan = {
  baseJobs: BaseJobPlan[];
  referenceJobs: ReferenceJobPlan[];
  sourceFormat: "legacy" | "project";
  totals: {
    baseJobs: number;
    generatedClipVariants: number;
    referenceJobs: number;
    soundJobs: number;
    speechJobs: number;
    totalJobs: number;
    upscaleJobs: number;
    variants: number;
  };
  variants: PlannedVariant[];
};
