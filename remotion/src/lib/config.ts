import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import YAML from "yaml";
import {
  DEFAULT_ASPECT_RATIOS,
  DEFAULT_FPS,
  DEFAULT_GENERATION,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_THEME,
  SUPPORTED_ASPECT_RATIOS,
} from "./constants";
import { getErrorMessage, isRecord, slugify, todayIsoDate } from "./helpers";
import type {
  ClipConfig,
  LocaleConfig,
  OverlayStyle,
  ProjectConfig,
  SupportedAspectRatio,
  Theme,
} from "./types";

export type LoadedConfig = {
  config: ProjectConfig;
  configDir: string;
  configPath: string;
  sourceFormat: "legacy" | "project";
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asUnitVolume = (value: unknown): number | undefined => {
  const parsed = asNumber(value);

  if (parsed === undefined) {
    return undefined;
  }

  return Math.max(0, Math.min(1, parsed));
};

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const asOverlayStyle = (value: unknown): OverlayStyle => {
  const normalized = asString(value);
  const allowed: OverlayStyle[] = ["title", "subtitle", "lower-third", "endcard", "none"];
  return allowed.includes(normalized as OverlayStyle) ? (normalized as OverlayStyle) : "none";
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
};

const resolvePathFromConfig = (configDir: string, inputPath: string): string =>
  resolve(configDir, inputPath);

const resolveOptionalPath = (configDir: string, input: unknown): string | null => {
  const value = asString(input);
  return value ? resolvePathFromConfig(configDir, value) : null;
};

const normalizeTheme = (value: unknown): Theme => {
  if (!isRecord(value)) {
    return DEFAULT_THEME;
  }

  return {
    accent: asString(value.accent) ?? DEFAULT_THEME.accent,
    background: asString(value.background) ?? DEFAULT_THEME.background,
    text: asString(value.text) ?? DEFAULT_THEME.text,
  };
};

const normalizeGeneratedClip = (
  value: Record<string, unknown>,
  configDir: string,
  defaults: { durationSeconds: number },
): ClipConfig => {
  const audioVolume = asUnitVolume(value.audioVolume);

  return {
    audioFile: resolveOptionalPath(configDir, value.audioFile),
    ...(audioVolume === undefined ? {} : { audioVolume }),
    durationSeconds: asNumber(value.durationSeconds) ?? defaults.durationSeconds,
    hasAudio: asBoolean(value.hasAudio) ?? true,
    id: asString(value.id) ?? "primary",
    overlayStyle: asOverlayStyle(value.overlayStyle),
    overlayText: asString(value.overlayText) ?? "",
    source: "generated",
    text: asString(value.text),
    ttsSpeaker: asNumber(value.ttsSpeaker) ?? 1,
  };
};

const normalizeReferenceClip = (
  value: Record<string, unknown>,
  configDir: string,
  defaults: { durationSeconds: number },
): ClipConfig => {
  const audioFile = resolveOptionalPath(configDir, value.audioFile);
  const text = asString(value.text);
  const audioVolume = asUnitVolume(value.audioVolume);

  return {
    audioFile,
    ...(audioVolume === undefined ? {} : { audioVolume }),
    durationSeconds: asNumber(value.durationSeconds) ?? defaults.durationSeconds,
    hasAudio: asBoolean(value.hasAudio) ?? Boolean(audioFile || text),
    id: asString(value.id) ?? "reference",
    overlayStyle: asOverlayStyle(value.overlayStyle),
    overlayText: asString(value.overlayText) ?? "",
    prompt: asString(value.prompt) ?? "",
    source: "reference",
    text,
    ttsSpeaker: asNumber(value.ttsSpeaker) ?? 1,
  };
};

const normalizeAssetClip = (
  value: Record<string, unknown>,
  configDir: string,
  defaults: { durationSeconds: number },
  source: "image" | "video",
): ClipConfig => {
  const asset = asString(value.asset);
  const audioVolume = source === "video" ? asUnitVolume(value.audioVolume) : undefined;

  return {
    asset: asset ? resolvePathFromConfig(configDir, asset) : "",
    ...(audioVolume === undefined ? {} : { audioVolume }),
    durationSeconds: asNumber(value.durationSeconds) ?? defaults.durationSeconds,
    hasAudio: source === "video" ? asBoolean(value.hasAudio) ?? false : false,
    id: asString(value.id) ?? `clip-${source}`,
    overlayStyle: asOverlayStyle(value.overlayStyle),
    overlayText: asString(value.overlayText) ?? "",
    source,
  };
};

const normalizeClip = (
  value: unknown,
  configDir: string,
  defaults: { durationSeconds: number },
): ClipConfig => {
  if (!isRecord(value)) {
    throw new Error("Each clip must be an object.");
  }

  const source = asString(value.source);

  if (source === "generated") {
    return normalizeGeneratedClip(value, configDir, defaults);
  }

  if (source === "reference") {
    return normalizeReferenceClip(value, configDir, defaults);
  }

  if (source === "video" || source === "image") {
    return normalizeAssetClip(value, configDir, defaults, source);
  }

  throw new Error(`Unsupported clip source: ${String(value.source)}`);
};

const normalizeLocale = (
  value: unknown,
  configDir: string,
  defaults: { durationSeconds: number },
): LocaleConfig => {
  if (!isRecord(value)) {
    throw new Error("Locale config must be an object.");
  }

  const clipsRaw = Array.isArray(value.clips) ? value.clips : [];

  return {
    bgm: resolveOptionalPath(configDir, value.bgm),
    bgmVolume: asNumber(value.bgmVolume) ?? 0.15,
    clips: clipsRaw.map((clip) => normalizeClip(clip, configDir, defaults)),
    theme: normalizeTheme(value.theme),
  };
};

const normalizeProjectConfig = (raw: Record<string, unknown>, configDir: string): ProjectConfig => {
  const projectRaw = isRecord(raw.project) ? raw.project : {};
  const speakerRaw = isRecord(raw.speaker) ? raw.speaker : {};
  const renderRaw = isRecord(raw.render) ? raw.render : {};
  const generationRaw = isRecord(raw.generation) ? raw.generation : {};
  const promptRaw = isRecord(generationRaw.prompt) ? generationRaw.prompt : {};
  const localesRaw = isRecord(raw.locales) ? raw.locales : {};

  const title = asString(projectRaw.title) ?? "Untitled Project";
  const speakerImages = asStringArray(speakerRaw.images).map((imagePath) =>
    resolvePathFromConfig(configDir, imagePath),
  );
  const mode =
    asString(speakerRaw.mode) === "reference"
      ? "reference"
      : speakerImages.length > 1
        ? "reference"
        : "single";

  const aspectRatios = asStringArray(renderRaw.aspectRatios).filter((ratio): ratio is SupportedAspectRatio =>
    SUPPORTED_ASPECT_RATIOS.includes(ratio as SupportedAspectRatio),
  );

  const defaults = {
    durationSeconds: 5,
  };

  const locales = Object.fromEntries(
    Object.entries(localesRaw).map(([language, localeValue]) => [
      language,
      normalizeLocale(localeValue, configDir, defaults),
    ]),
  );

  return {
    generation: {
      ambientSound: asString(generationRaw.ambientSound) ?? DEFAULT_GENERATION.ambientSound,
      model: asString(generationRaw.model) ?? DEFAULT_GENERATION.model,
      prompt: {
        base: asString(promptRaw.base) ?? DEFAULT_GENERATION.prompt.base,
        perRatio: isRecord(promptRaw.perRatio)
          ? Object.fromEntries(
              Object.entries(promptRaw.perRatio)
                .filter(([ratio, prompt]) =>
                  SUPPORTED_ASPECT_RATIOS.includes(ratio as SupportedAspectRatio) &&
                  Boolean(asString(prompt)),
                )
                .map(([ratio, prompt]) => [ratio, asString(prompt)!]),
            )
          : undefined,
      },
      quality: asString(generationRaw.quality) ?? DEFAULT_GENERATION.quality,
      upscale: asBoolean(generationRaw.upscale) ?? DEFAULT_GENERATION.upscale,
    },
    locales,
    project: {
      date: asString(projectRaw.date) ?? todayIsoDate(),
      slug: asString(projectRaw.slug) ?? slugify(title),
      title,
    },
    render: {
      aspectRatios: aspectRatios.length > 0 ? aspectRatios : DEFAULT_ASPECT_RATIOS,
      fps: asNumber(renderRaw.fps) ?? DEFAULT_FPS,
      outputDir: resolvePathFromConfig(
        configDir,
        asString(renderRaw.outputDir) ?? DEFAULT_OUTPUT_DIR,
      ),
    },
    speaker: {
      images: speakerImages,
      mode,
      name:
        asString(speakerRaw.name) ??
        basename(speakerImages[0] ?? "speaker", extname(speakerImages[0] ?? "")),
    },
  };
};

const normalizeLegacyConfig = (raw: Record<string, unknown>, configDir: string): ProjectConfig => {
  const speakerRaw = isRecord(raw.speaker) ? raw.speaker : {};
  const announcementRaw = isRecord(raw.announcement) ? raw.announcement : {};
  const scriptsRaw = isRecord(raw.scripts) ? raw.scripts : {};
  const outputRaw = isRecord(raw.output) ? raw.output : {};
  const promptRaw = isRecord(raw.prompt) ? raw.prompt : {};

  const title = asString(announcementRaw.topic) ?? "Untitled Project";
  const durationSeconds = asNumber(outputRaw.duration) ?? 5;
  const speakerImages = asStringArray(speakerRaw.images).map((imagePath) =>
    resolvePathFromConfig(configDir, imagePath),
  );

  const locales = Object.fromEntries(
    Object.entries(scriptsRaw).map(([language, scriptValue]) => {
      if (!isRecord(scriptValue)) {
        throw new Error(`Legacy script for ${language} must be an object.`);
      }

      const audioMode = asString(scriptValue.audio_mode) ?? "tts";
      const audioFile =
        audioMode === "file" ? resolveOptionalPath(configDir, scriptValue.audio_file) : null;

      return [
        language,
        {
          bgm: null,
          bgmVolume: 0.15,
          clips: [
            {
              audioFile,
              durationSeconds,
              hasAudio: true,
              id: "primary",
              overlayStyle: "none",
              overlayText: "",
              source: "generated",
              text: asString(scriptValue.text),
              ttsSpeaker: audioMode === "tts" ? asNumber(scriptValue.tts_speaker) ?? 1 : null,
            },
          ],
          theme: DEFAULT_THEME,
        } satisfies LocaleConfig,
      ];
    }),
  );

  const aspectRatios = asStringArray(outputRaw.aspect_ratios).filter((ratio): ratio is SupportedAspectRatio =>
    SUPPORTED_ASPECT_RATIOS.includes(ratio as SupportedAspectRatio),
  );

  return {
    generation: {
      ambientSound: asString(outputRaw.ambient_sound) ?? DEFAULT_GENERATION.ambientSound,
      model: asString(outputRaw.model) ?? DEFAULT_GENERATION.model,
      prompt: {
        base: asString(promptRaw.base) ?? DEFAULT_GENERATION.prompt.base,
        perRatio: isRecord(promptRaw.per_ratio)
          ? Object.fromEntries(
              Object.entries(promptRaw.per_ratio)
                .filter(([ratio, prompt]) =>
                  SUPPORTED_ASPECT_RATIOS.includes(ratio as SupportedAspectRatio) &&
                  Boolean(asString(prompt)),
                )
                .map(([ratio, prompt]) => [ratio, asString(prompt)!]),
            )
          : undefined,
      },
      quality: asString(outputRaw.quality) ?? DEFAULT_GENERATION.quality,
      upscale: asBoolean(outputRaw.upscale) ?? DEFAULT_GENERATION.upscale,
    },
    locales,
    project: {
      date: asString(announcementRaw.date) ?? todayIsoDate(),
      slug: slugify(title),
      title,
    },
    render: {
      aspectRatios: aspectRatios.length > 0 ? aspectRatios : DEFAULT_ASPECT_RATIOS,
      fps: DEFAULT_FPS,
      outputDir: resolvePathFromConfig(
        configDir,
        asString(outputRaw.dest) ?? DEFAULT_OUTPUT_DIR,
      ),
    },
    speaker: {
      images: speakerImages,
      mode:
        asString(speakerRaw.mode) === "reference"
          ? "reference"
          : speakerImages.length > 1
            ? "reference"
            : "single",
      name:
        asString(speakerRaw.name) ??
        basename(speakerImages[0] ?? "speaker", extname(speakerImages[0] ?? "")),
    },
  };
};

export const validateProjectConfig = (config: ProjectConfig): void => {
  if (!config.project.slug) {
    throw new Error("project.slug is required.");
  }

  if (config.speaker.images.length < 1 || config.speaker.images.length > 7) {
    throw new Error("speaker.images must contain between 1 and 7 paths.");
  }

  if (config.speaker.mode === "single" && config.speaker.images.length !== 1) {
    throw new Error("speaker.mode=single requires exactly one image.");
  }

  if (config.speaker.mode === "reference" && config.speaker.images.length < 2) {
    throw new Error("speaker.mode=reference requires 2-7 images.");
  }

  for (const speakerImage of config.speaker.images) {
    if (!existsSync(speakerImage)) {
      throw new Error(`Missing speaker image: ${speakerImage}`);
    }
  }

  if (config.render.aspectRatios.length === 0) {
    throw new Error("render.aspectRatios must contain at least one ratio.");
  }

  if (Object.keys(config.locales).length === 0) {
    throw new Error("At least one locale is required.");
  }

  for (const [language, locale] of Object.entries(config.locales)) {
    if (locale.bgm && !existsSync(locale.bgm)) {
      throw new Error(`Missing bgm for ${language}: ${locale.bgm}`);
    }

    if (locale.clips.length === 0) {
      throw new Error(`Locale ${language} must contain at least one clip.`);
    }

    for (const clip of locale.clips) {
      if (!clip.id) {
        throw new Error(`Locale ${language} contains a clip without id.`);
      }

      if (!Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0) {
        throw new Error(`Clip ${language}/${clip.id} must have a positive durationSeconds.`);
      }

      if (clip.source === "generated" || clip.source === "reference") {
        if (clip.source === "reference" && !clip.prompt) {
          throw new Error(`Reference clip ${language}/${clip.id} requires prompt.`);
        }

        if (!clip.text && !clip.audioFile) {
          if (clip.source === "generated") {
            throw new Error(`Generated clip ${language}/${clip.id} requires text or audioFile.`);
          }
        }

        if (clip.audioFile && !existsSync(clip.audioFile)) {
          throw new Error(`Missing audioFile for ${language}/${clip.id}: ${clip.audioFile}`);
        }
      }

      if ((clip.source === "video" || clip.source === "image") && !existsSync(clip.asset)) {
        throw new Error(`Missing asset for ${language}/${clip.id}: ${clip.asset}`);
      }
    }
  }
};

export const loadProjectConfig = async (configPath: string): Promise<LoadedConfig> => {
  const resolvedPath = resolve(configPath);
  const configDir = dirname(resolvedPath);
  const rawText = await readFile(resolvedPath, "utf8");
  const parsed = YAML.parse(rawText);

  if (!isRecord(parsed)) {
    throw new Error("Config root must be an object.");
  }

  const sourceFormat = parsed.locales || parsed.project ? "project" : "legacy";
  const config =
    sourceFormat === "project"
      ? normalizeProjectConfig(parsed, configDir)
      : normalizeLegacyConfig(parsed, configDir);

  validateProjectConfig(config);

  return {
    config,
    configDir,
    configPath: resolvedPath,
    sourceFormat,
  };
};

export const describeConfigForCli = (loaded: LoadedConfig) => ({
  aspectRatios: loaded.config.render.aspectRatios,
  locales: Object.keys(loaded.config.locales),
  outputDir: loaded.config.render.outputDir,
  project: loaded.config.project,
  sourceFormat: loaded.sourceFormat,
  speaker: {
    imageCount: loaded.config.speaker.images.length,
    mode: loaded.config.speaker.mode,
    name: loaded.config.speaker.name,
  },
});

export const formatConfigError = (error: unknown): Error =>
  new Error(`Invalid config: ${getErrorMessage(error)}`);
