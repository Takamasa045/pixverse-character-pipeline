import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { buildRenderManifest } from "./manifest";
import {
  createBaseVideo,
  createReferenceVideo,
  createSound,
  createSpeech,
  createUpscale,
  downloadAsset,
  getAvailableCredits,
  waitForTask,
} from "./pixverse";
import { pipelinePublicRoot } from "./paths";
import { buildPipelinePlan } from "./planner";
import { renderVariant } from "./render";
import { getErrorMessage, ratioToSlug, relativeToPublic, timestampForRun, toPosix } from "./helpers";
import type { LoadedConfig } from "./config";
import type {
  ClipStageIds,
  GeneratedClipConfig,
  PipelinePlan,
  ReferenceClipConfig,
  RunManifest,
  RunVariantManifest,
  SupportedAspectRatio,
} from "./types";

type ExecutePipelineOptions = {
  dryRun?: boolean;
  mode: "render" | "run";
  runId?: string;
  targetLanguage?: string;
  targetRatio?: SupportedAspectRatio;
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const copyIntoVariant = async (
  sourceFile: string,
  outputAssetsDir: string,
  stageAssetsDir: string,
  targetName?: string,
): Promise<{ outputPath: string; publicPath: string }> => {
  const filename = targetName ?? basename(sourceFile);
  const outputPath = resolve(outputAssetsDir, filename);
  const stagePath = resolve(stageAssetsDir, filename);

  await mkdir(outputAssetsDir, { recursive: true });
  await mkdir(stageAssetsDir, { recursive: true });
  await copyFile(sourceFile, outputPath);
  await copyFile(sourceFile, stagePath);

  return {
    outputPath,
    publicPath: relativeToPublic(stagePath),
  };
};

const reserveVariantPath = (
  outputAssetsDir: string,
  stageAssetsDir: string,
  targetName: string,
): { outputPath: string; publicPath: string } => {
  const outputPath = resolve(outputAssetsDir, targetName);
  const stagePath = resolve(stageAssetsDir, targetName);

  return {
    outputPath,
    publicPath: relativeToPublic(stagePath),
  };
};

const clipTargetName = (clipId: string, sourcePath: string | null, fallbackExt = ".mp4"): string =>
  `${clipId}${sourcePath ? extname(sourcePath) || fallbackExt : fallbackExt}`;

const createRunSummary = (variants: RunVariantManifest[]): RunManifest["summary"] => ({
  completed: variants.filter((variant) => variant.status === "completed").length,
  failed: variants.filter((variant) => variant.status === "failed").length,
  planned: variants.filter((variant) => variant.status === "planned").length,
  skipped: variants.filter((variant) => variant.status === "skipped").length,
  total: variants.length,
});

const isSelectedVariant = (
  language: string,
  aspectRatio: SupportedAspectRatio,
  options: ExecutePipelineOptions,
): boolean => {
  if (options.targetLanguage && language !== options.targetLanguage) {
    return false;
  }

  if (options.targetRatio && aspectRatio !== options.targetRatio) {
    return false;
  }

  return true;
};

const clipNeedsSpeech = (clip: GeneratedClipConfig | ReferenceClipConfig): boolean =>
  Boolean(clip.text || clip.audioFile);

const prepareGeneratedClip = async ({
  aspectRatio,
  baseVideoId,
  clip,
  config,
  dryRun,
  outputAssetsDir,
  stageAssetsDir,
}: {
  aspectRatio: SupportedAspectRatio;
  baseVideoId: string;
  clip: GeneratedClipConfig;
  config: LoadedConfig["config"];
  dryRun: boolean;
  outputAssetsDir: string;
  stageAssetsDir: string;
}): Promise<{ outputPath: string; publicPath: string; stageIds: ClipStageIds }> => {
  const targetName = clipTargetName(clip.id, null, ".mp4");

  if (dryRun) {
    const reserved = reserveVariantPath(outputAssetsDir, stageAssetsDir, targetName);
    return {
      outputPath: reserved.outputPath,
      publicPath: reserved.publicPath,
      stageIds: { final: null, sound: null, speech: null, upscale: null },
    };
  }

  const speechId = await createSpeech(baseVideoId, clip);
  await waitForTask(speechId);

  let latestId = speechId;
  let soundId: string | null = null;
  let upscaleId: string | null = null;

  if (config.generation.ambientSound) {
    soundId = await createSound(latestId, config.generation.ambientSound);
    await waitForTask(soundId);
    latestId = soundId;
  }

  if (config.generation.upscale) {
    upscaleId = await createUpscale(latestId, config.generation.quality);
    await waitForTask(upscaleId);
    latestId = upscaleId;
  }

  const tempDownloadDir = resolve(outputAssetsDir, ".downloads", ratioToSlug(aspectRatio), clip.id);
  await rm(tempDownloadDir, { force: true, recursive: true });

  const downloadedPath = await downloadAsset(latestId, tempDownloadDir);
  const outputPath = resolve(outputAssetsDir, targetName);
  await mkdir(outputAssetsDir, { recursive: true });
  await rename(downloadedPath, outputPath);

  const stagePath = resolve(stageAssetsDir, targetName);
  await mkdir(stageAssetsDir, { recursive: true });
  await copyFile(outputPath, stagePath);
  await rm(tempDownloadDir, { force: true, recursive: true });

  return {
    outputPath,
    publicPath: relativeToPublic(stagePath),
    stageIds: {
      final: latestId,
      sound: soundId,
      speech: speechId,
      upscale: upscaleId,
    },
  };
};

const prepareReferenceClip = async ({
  aspectRatio,
  clip,
  config,
  dryRun,
  outputAssetsDir,
  stageAssetsDir,
}: {
  aspectRatio: SupportedAspectRatio;
  clip: ReferenceClipConfig;
  config: LoadedConfig["config"];
  dryRun: boolean;
  outputAssetsDir: string;
  stageAssetsDir: string;
}): Promise<{ outputPath: string; publicPath: string; stageIds: ClipStageIds }> => {
  const targetName = clipTargetName(clip.id, null, ".mp4");

  if (dryRun) {
    const reserved = reserveVariantPath(outputAssetsDir, stageAssetsDir, targetName);
    return {
      outputPath: reserved.outputPath,
      publicPath: reserved.publicPath,
      stageIds: { final: null, sound: null, speech: null, upscale: null },
    };
  }

  const baseVideoId = await createReferenceVideo({ aspectRatio, clip, config });
  await waitForTask(baseVideoId);

  let latestId = baseVideoId;
  let speechId: string | null = null;
  let soundId: string | null = null;
  let upscaleId: string | null = null;

  if (clipNeedsSpeech(clip)) {
    speechId = await createSpeech(latestId, clip);
    await waitForTask(speechId);
    latestId = speechId;
  }

  if (config.generation.ambientSound) {
    soundId = await createSound(latestId, config.generation.ambientSound);
    await waitForTask(soundId);
    latestId = soundId;
  }

  if (config.generation.upscale) {
    upscaleId = await createUpscale(latestId, config.generation.quality);
    await waitForTask(upscaleId);
    latestId = upscaleId;
  }

  const tempDownloadDir = resolve(outputAssetsDir, ".downloads", ratioToSlug(aspectRatio), clip.id);
  await rm(tempDownloadDir, { force: true, recursive: true });

  const downloadedPath = await downloadAsset(latestId, tempDownloadDir);
  const outputPath = resolve(outputAssetsDir, targetName);
  await mkdir(outputAssetsDir, { recursive: true });
  await rename(downloadedPath, outputPath);

  const stagePath = resolve(stageAssetsDir, targetName);
  await mkdir(stageAssetsDir, { recursive: true });
  await copyFile(outputPath, stagePath);
  await rm(tempDownloadDir, { force: true, recursive: true });

  return {
    outputPath,
    publicPath: relativeToPublic(stagePath),
    stageIds: {
      final: latestId,
      sound: soundId,
      speech: speechId,
      upscale: upscaleId,
    },
  };
};

const executeVariant = async ({
  aspectRatio,
  baseVideoIds,
  config,
  dryRun,
  language,
  locale,
  runRoot,
  stageRoot,
}: {
  aspectRatio: SupportedAspectRatio;
  baseVideoIds: Map<SupportedAspectRatio, string>;
  config: LoadedConfig;
  dryRun: boolean;
  language: string;
  locale: LoadedConfig["config"]["locales"][string];
  runRoot: string;
  stageRoot: string;
}): Promise<RunVariantManifest> => {
  const ratioSlug = ratioToSlug(aspectRatio);
  const variantOutputDir = resolve(runRoot, language, ratioSlug);
  const variantStageDir = resolve(stageRoot, language, ratioSlug);
  const outputAssetsDir = resolve(variantOutputDir, "assets");
  const stageAssetsDir = resolve(variantStageDir, "assets");
  const usesGeneratedClips = locale.clips.some((clip) => clip.source === "generated");
  const clipAssetPublicPaths: Record<string, string> = {};
  const clipAssets: Record<string, string> = {};
  const clipVideoIds: Record<string, ClipStageIds> = {};

  const speakerTargetName =
    clipTargetName("speaker", config.config.speaker.images[0], extname(config.config.speaker.images[0])) ||
    "speaker.png";
  const speakerImage = dryRun
    ? reserveVariantPath(outputAssetsDir, stageAssetsDir, speakerTargetName)
    : await copyIntoVariant(
        config.config.speaker.images[0],
        outputAssetsDir,
        stageAssetsDir,
        speakerTargetName,
      );

  const bgmAsset =
    locale.bgm === null || locale.bgm === undefined
      ? null
      : dryRun
        ? reserveVariantPath(outputAssetsDir, stageAssetsDir, clipTargetName("bgm", locale.bgm))
        : await copyIntoVariant(
            locale.bgm,
            outputAssetsDir,
            stageAssetsDir,
            clipTargetName("bgm", locale.bgm),
          );

  for (const clip of locale.clips) {
    if (clip.source === "generated") {
      const baseVideoId = baseVideoIds.get(aspectRatio);

      if (!baseVideoId && !dryRun) {
        throw new Error(`Missing base video id for ${language}/${aspectRatio}.`);
      }

      const generated = await prepareGeneratedClip({
        aspectRatio,
        baseVideoId: baseVideoId ?? "dry-run",
        clip,
        config: config.config,
        dryRun,
        outputAssetsDir,
        stageAssetsDir,
      });

      clipAssetPublicPaths[clip.id] = generated.publicPath;
      clipAssets[clip.id] = toPosix(relative(runRoot, generated.outputPath));
      clipVideoIds[clip.id] = generated.stageIds;
      continue;
    }

    if (clip.source === "reference") {
      const generated = await prepareReferenceClip({
        aspectRatio,
        clip,
        config: config.config,
        dryRun,
        outputAssetsDir,
        stageAssetsDir,
      });

      clipAssetPublicPaths[clip.id] = generated.publicPath;
      clipAssets[clip.id] = toPosix(relative(runRoot, generated.outputPath));
      clipVideoIds[clip.id] = generated.stageIds;
      continue;
    }

    const targetName = clipTargetName(
      clip.id,
      clip.asset,
      clip.source === "image" ? ".png" : ".mp4",
    );
    const prepared = dryRun
      ? reserveVariantPath(outputAssetsDir, stageAssetsDir, targetName)
      : await copyIntoVariant(clip.asset, outputAssetsDir, stageAssetsDir, targetName);

    clipAssetPublicPaths[clip.id] = prepared.publicPath;
    clipAssets[clip.id] = toPosix(relative(runRoot, prepared.outputPath));
    clipVideoIds[clip.id] = { final: null, sound: null, speech: null, upscale: null };
  }

  const renderManifest = buildRenderManifest({
    aspectRatio,
    assets: {
      bgmPublicPath: bgmAsset?.publicPath ?? null,
      clipAssetPublicPaths,
      speakerImagePublicPath: speakerImage.publicPath,
    },
    config: config.config,
    language,
    locale,
  });

  const manifestOutputPath = resolve(variantOutputDir, "manifest.render.json");
  const manifestStagePath = resolve(variantStageDir, "manifest.render.json");
  await writeJson(manifestOutputPath, renderManifest);
  await writeJson(manifestStagePath, renderManifest);

  const finalOutputFile = resolve(variantOutputDir, "character.mp4");

  if (!dryRun) {
    await renderVariant({
      manifest: renderManifest,
      manifestPublicPath: relativeToPublic(manifestStagePath),
      outputFile: finalOutputFile,
    });
  }

  return {
    aspectRatio,
    baseVideoId: usesGeneratedClips ? baseVideoIds.get(aspectRatio) ?? null : null,
    clipAssets,
    clipVideoIds,
    error: null,
    file: dryRun ? null : toPosix(relative(runRoot, finalOutputFile)),
    language,
    renderManifest: toPosix(relative(runRoot, manifestOutputPath)),
    status: dryRun ? "planned" : "completed",
  };
};

export const executePipeline = async (
  loaded: LoadedConfig,
  options: ExecutePipelineOptions,
): Promise<{
  plan: PipelinePlan;
  runManifest: RunManifest;
  runManifestPath: string;
  runRoot: string;
}> => {
  const plan = buildPipelinePlan(loaded);
  const selectedVariants = plan.variants.filter((variant) =>
    isSelectedVariant(variant.language, variant.aspectRatio, options),
  );

  if (selectedVariants.length === 0) {
    throw new Error("No variants matched the requested filters.");
  }

  if (
    options.mode === "render" &&
    selectedVariants.some((variant) => variant.usesGeneratedClips || variant.usesReferenceClips)
  ) {
    throw new Error(
      "pipeline:render only supports local video/image clips. Use pipeline:run for generated or reference clips.",
    );
  }

  const runId = options.runId ?? timestampForRun();
  const runRoot = resolve(loaded.config.render.outputDir, loaded.config.project.slug, runId);
  const stageRoot = resolve(pipelinePublicRoot, loaded.config.project.slug, runId);

  await mkdir(runRoot, { recursive: true });
  await mkdir(stageRoot, { recursive: true });

  const requiredRatios = new Set(
    selectedVariants
      .filter((variant) => variant.usesGeneratedClips)
      .map((variant) => variant.aspectRatio),
  );

  const baseVideoIds = new Map<SupportedAspectRatio, string>();

  if (requiredRatios.size > 0 && !options.dryRun) {
    const availableCredits = await getAvailableCredits();

    if (availableCredits < plan.totals.totalJobs) {
      throw new Error(
        `Insufficient PixVerse credits. Required approximately ${plan.totals.totalJobs}, available ${availableCredits}.`,
      );
    }

    for (const aspectRatio of requiredRatios) {
      const baseVideoId = await createBaseVideo(loaded.config, aspectRatio);
      await waitForTask(baseVideoId);
      baseVideoIds.set(aspectRatio, baseVideoId);
    }
  }

  const variants: RunVariantManifest[] = [];

  for (const variant of selectedVariants) {
    const locale = loaded.config.locales[variant.language];

    try {
      const result = await executeVariant({
        aspectRatio: variant.aspectRatio,
        baseVideoIds,
        config: loaded,
        dryRun: options.dryRun ?? false,
        language: variant.language,
        locale,
        runRoot,
        stageRoot,
      });
      variants.push(result);
    } catch (error) {
      variants.push({
        aspectRatio: variant.aspectRatio,
        baseVideoId: variant.usesGeneratedClips ? baseVideoIds.get(variant.aspectRatio) ?? null : null,
        clipAssets: {},
        clipVideoIds: {},
        error: getErrorMessage(error),
        file: null,
        language: variant.language,
        renderManifest: null,
        status: "failed",
      });
    }
  }

  const runManifest: RunManifest = {
    configPath: loaded.configPath,
    generatedAt: new Date().toISOString(),
    project: loaded.config.project,
    sourceFormat: loaded.sourceFormat,
    summary: createRunSummary(variants),
    variants,
  };

  const runManifestPath = resolve(runRoot, "manifest.json");
  await writeJson(runManifestPath, runManifest);

  return {
    plan,
    runManifest,
    runManifestPath,
    runRoot,
  };
};
