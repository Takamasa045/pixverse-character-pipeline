import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { remotionRoot } from "./paths";
import { runCommand } from "./subprocess";
import type {
  GeneratedClipConfig,
  ProjectConfig,
  ReferenceClipConfig,
  PromptConfig,
  SupportedAspectRatio,
} from "./types";

type PixverseAssetType = "image" | "video";

const localPixverseBinary = resolve(
  remotionRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "pixverse.cmd" : "pixverse",
);

const pixverseBinary = () => {
  const configuredBinary = process.env.PIXVERSE_BIN?.trim();

  if (configuredBinary) {
    return configuredBinary;
  }

  return existsSync(localPixverseBinary) ? localPixverseBinary : "pixverse";
};

export const parseJsonOutput = (stdout: string): Record<string, unknown> => {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const lines = trimmed.split("\n");
    const jsonStart = lines.findIndex((line) => line.trim().startsWith("{"));

    if (jsonStart === -1) {
      throw new Error(`PixVerse response did not contain JSON: ${trimmed}`);
    }

    return JSON.parse(lines.slice(jsonStart).join("\n")) as Record<string, unknown>;
  }
};

const extractTaskId = (payload: Record<string, unknown>): string => {
  const value =
    payload.video_id ??
    payload.image_id ??
    payload.asset_id ??
    payload.task_id ??
    payload.id;
  if (!value) {
    throw new Error(`PixVerse response did not contain an asset id: ${JSON.stringify(payload)}`);
  }

  return String(value);
};

const runPixverse = async (args: string[]): Promise<Record<string, unknown>> => {
  const { stdout } = await runCommand(pixverseBinary(), [...args, "--json"], {
    captureOutput: true,
    cwd: remotionRoot,
  });
  return parseJsonOutput(stdout);
};

export const getAvailableCredits = async (): Promise<number> => {
  const payload = await runPixverse(["account", "info"]);
  const credits = payload.credits;

  if (typeof credits === "object" && credits && "total" in credits) {
    return Number((credits as Record<string, unknown>).total ?? 0);
  }

  return 0;
};

const maxGeneratedDuration = (config: ProjectConfig): number =>
  Math.max(
    1,
    ...Object.values(config.locales).flatMap((locale) =>
      locale.clips
        .filter((clip) => clip.source === "generated")
        .map((clip) => Math.round(clip.durationSeconds)),
    ),
  );

const resolvePrompt = (prompt: PromptConfig, aspectRatio: SupportedAspectRatio): string =>
  prompt.perRatio?.[aspectRatio] ?? prompt.base;

const audioFlag = (config: ProjectConfig): string =>
  config.generation.generateAudio ? "--audio" : "--no-audio";

const findDownloadedAsset = async (
  destinationDirectory: string,
  extensions?: string[],
): Promise<string> => {
  const entries = await readdir(destinationDirectory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && !entry.name.startsWith("."));

  if (files.length === 0) {
    throw new Error(`PixVerse download did not produce a file in ${destinationDirectory}.`);
  }

  if (extensions && extensions.length > 0) {
    const normalizedExtensions = new Set(extensions.map((extension) => extension.toLowerCase()));
    const matched = files.find((file) =>
      normalizedExtensions.has(extname(file.name).toLowerCase()),
    );

    if (matched) {
      return resolve(destinationDirectory, matched.name);
    }
  }

  return resolve(destinationDirectory, files[0]!.name);
};

export const createBaseImage = async (
  config: ProjectConfig,
  aspectRatio: SupportedAspectRatio,
): Promise<string> => {
  const prompt = resolvePrompt(config.generation.image.prompt, aspectRatio);
  const useMultipleImages = config.speaker.images.length > 1;
  const args =
    useMultipleImages
      ? [
          "create",
          "image",
          "--images",
          ...config.speaker.images,
          "--prompt",
          prompt,
          "--model",
          config.generation.image.model,
          "--quality",
          config.generation.image.quality,
          "--aspect-ratio",
          aspectRatio,
          "--no-wait",
        ]
      : [
          "create",
          "image",
          "--image",
          config.speaker.images[0],
          "--prompt",
          prompt,
          "--model",
          config.generation.image.model,
          "--quality",
          config.generation.image.quality,
          "--aspect-ratio",
          aspectRatio,
          "--no-wait",
        ];

  const payload = await runPixverse(args);
  return extractTaskId(payload);
};

export const buildCreateBaseVideoArgs = (
  config: ProjectConfig,
  aspectRatio: SupportedAspectRatio,
  sourceImagePath?: string,
): string[] => {
  const prompt = resolvePrompt(config.generation.prompt, aspectRatio);
  const duration = String(maxGeneratedDuration(config));

  if (sourceImagePath) {
    return [
      "create",
      "video",
      "--image",
      sourceImagePath,
      "--prompt",
      prompt,
      "--model",
      config.generation.model,
      "--quality",
      config.generation.quality,
      "--duration",
      duration,
      "--aspect-ratio",
      aspectRatio,
      audioFlag(config),
      "--no-wait",
    ];
  }

  if (config.speaker.mode === "reference") {
    return [
      "create",
      "reference",
      "--images",
      ...config.speaker.images,
      "--prompt",
      prompt,
      "--model",
      config.generation.referenceModel,
      "--quality",
      config.generation.quality,
      "--duration",
      duration,
      "--aspect-ratio",
      aspectRatio,
      audioFlag(config),
      "--no-wait",
    ];
  }

  return [
    "create",
    "video",
    "--image",
    config.speaker.images[0],
    "--prompt",
    prompt,
    "--model",
    config.generation.model,
    "--quality",
    config.generation.quality,
    "--duration",
    duration,
    "--aspect-ratio",
    aspectRatio,
    audioFlag(config),
    "--no-wait",
  ];
};

export const createBaseVideo = async (
  config: ProjectConfig,
  aspectRatio: SupportedAspectRatio,
  sourceImagePath?: string,
): Promise<string> => {
  const payload = await runPixverse(
    buildCreateBaseVideoArgs(config, aspectRatio, sourceImagePath),
  );
  return extractTaskId(payload);
};

export const buildCreateReferenceVideoArgs = ({
  aspectRatio,
  clip,
  config,
}: {
  aspectRatio: SupportedAspectRatio;
  clip: ReferenceClipConfig;
  config: ProjectConfig;
}): string[] => [
  "create",
  "reference",
  "--images",
  ...config.speaker.images,
  "--prompt",
  clip.prompt,
  "--model",
  config.generation.referenceModel,
  "--quality",
  config.generation.quality,
  "--duration",
  String(Math.max(1, Math.round(clip.durationSeconds))),
  "--aspect-ratio",
  aspectRatio,
  audioFlag(config),
  "--no-wait",
];

export const createReferenceVideo = async ({
  aspectRatio,
  clip,
  config,
}: {
  aspectRatio: SupportedAspectRatio;
  clip: ReferenceClipConfig;
  config: ProjectConfig;
}): Promise<string> => {
  const payload = await runPixverse(
    buildCreateReferenceVideoArgs({ aspectRatio, clip, config }),
  );
  return extractTaskId(payload);
};

export const waitForTask = async (
  assetId: string,
  assetType: PixverseAssetType = "video",
): Promise<void> => {
  await runPixverse(["task", "wait", assetId, "--type", assetType]);
};

export const createSpeech = async (
  baseVideoId: string,
  clip: GeneratedClipConfig | ReferenceClipConfig,
): Promise<string> => {
  const args = ["create", "speech", "--video", baseVideoId];

  if (clip.audioFile) {
    args.push("--audio", clip.audioFile);
  } else if (clip.text) {
    args.push("--tts-text", clip.text, "--tts-speaker", String(clip.ttsSpeaker ?? 1));
  } else {
    throw new Error(`Generated clip ${clip.id} requires text or audioFile.`);
  }

  args.push("--no-wait");

  const payload = await runPixverse(args);
  return extractTaskId(payload);
};

export const createUpscale = async (videoId: string, quality: string): Promise<string> => {
  const payload = await runPixverse([
    "create",
    "upscale",
    "--video",
    videoId,
    "--quality",
    quality,
    "--no-wait",
  ]);

  return extractTaskId(payload);
};

export const downloadAsset = async (
  assetId: string,
  destinationDirectory: string,
  options?: {
    assetType?: PixverseAssetType;
    extensions?: string[];
  },
): Promise<string> => {
  await mkdir(destinationDirectory, { recursive: true });
  await runPixverse([
    "asset",
    "download",
    assetId,
    "--dest",
    destinationDirectory,
    ...(options?.assetType ? ["--type", options.assetType] : []),
  ]);
  return findDownloadedAsset(destinationDirectory, options?.extensions);
};
