import { ratioToSlug } from "./helpers";
import type { LoadedConfig } from "./config";
import type { PipelinePlan } from "./types";

const resolvePrompt = (
  loaded: LoadedConfig,
  type: "image" | "video",
  aspectRatio: PipelinePlan["variants"][number]["aspectRatio"],
): string =>
  type === "image"
    ? loaded.config.generation.image.prompt.perRatio?.[aspectRatio] ??
      loaded.config.generation.image.prompt.base
    : loaded.config.generation.prompt.perRatio?.[aspectRatio] ??
      loaded.config.generation.prompt.base;

export const buildPipelinePlan = (loaded: LoadedConfig): PipelinePlan => {
  const generatedClipVariants = Object.values(loaded.config.locales).reduce(
    (sum, locale) =>
      sum +
      locale.clips.filter((clip) => clip.source === "generated").length *
        loaded.config.render.aspectRatios.length,
    0,
  );
  const variants = Object.entries(loaded.config.locales).flatMap(([language, locale]) =>
    loaded.config.render.aspectRatios.map((aspectRatio) => {
      const generatedClipCount = locale.clips.filter((clip) => clip.source === "generated").length;
      const referenceClipCount = locale.clips.filter((clip) => clip.source === "reference").length;

      return {
        aspectRatio,
        generatedClipCount,
        language,
        ratioSlug: ratioToSlug(aspectRatio),
        usesGeneratedClips: generatedClipCount > 0,
        referenceClipCount,
        usesReferenceClips: referenceClipCount > 0,
      };
    }),
  );

  const requiresGeneration = variants.some((variant) => variant.usesGeneratedClips);
  const imageJobs =
    requiresGeneration && loaded.config.generation.image.enabled
      ? loaded.config.render.aspectRatios.map((aspectRatio) => ({
          aspectRatio,
          prompt: resolvePrompt(loaded, "image", aspectRatio),
      }))
    : [];
  const baseJobs = requiresGeneration
    ? loaded.config.render.aspectRatios.map((aspectRatio) => ({
        aspectRatio,
        prompt: resolvePrompt(loaded, "video", aspectRatio),
      }))
    : [];

  const referenceJobs = Object.entries(loaded.config.locales).flatMap(([language, locale]) =>
    loaded.config.render.aspectRatios.flatMap((aspectRatio) =>
      locale.clips
        .filter((clip) => clip.source === "reference")
        .map((clip) => ({
          aspectRatio,
          clipId: clip.id,
          language,
          prompt: clip.prompt,
        })),
    ),
  );

  const speechJobs = Object.values(loaded.config.locales).reduce(
    (sum, locale) =>
      sum +
      locale.clips.filter(
        (clip) =>
          (clip.source === "generated" || clip.source === "reference") &&
          Boolean(clip.text || clip.audioFile),
      ).length *
        loaded.config.render.aspectRatios.length,
    0,
  );
  const mediaProcessingJobs = Object.values(loaded.config.locales).reduce(
    (sum, locale) =>
      sum +
      locale.clips.filter((clip) => clip.source === "generated" || clip.source === "reference")
        .length *
        loaded.config.render.aspectRatios.length,
    0,
  );
  const soundJobs = loaded.config.generation.ambientSound ? mediaProcessingJobs : 0;
  const upscaleJobs = loaded.config.generation.upscale ? mediaProcessingJobs : 0;

  return {
    baseJobs,
    imageJobs,
    referenceJobs,
    sourceFormat: loaded.sourceFormat,
    totals: {
      baseJobs: baseJobs.length,
      generatedClipVariants,
      imageJobs: imageJobs.length,
      referenceJobs: referenceJobs.length,
      soundJobs,
      speechJobs,
      totalJobs:
        imageJobs.length +
        baseJobs.length +
        referenceJobs.length +
        speechJobs +
        soundJobs +
        upscaleJobs,
      upscaleJobs,
      variants: variants.length,
    },
    variants,
  };
};
