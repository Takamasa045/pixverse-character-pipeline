import { DEFAULT_THEME } from "./constants";
import { getDimensionsForRatio } from "./ratios";
import type { ClipConfig, LocaleConfig, ProjectConfig, RenderManifest, SupportedAspectRatio } from "./types";

type BuildRenderManifestArgs = {
  aspectRatio: SupportedAspectRatio;
  assets: {
    bgmPublicPath: string | null;
    clipAssetPublicPaths: Record<string, string>;
    speakerImagePublicPath: string;
  };
  config: ProjectConfig;
  language: string;
  locale: LocaleConfig;
};

export const buildRenderManifest = ({
  aspectRatio,
  assets,
  config,
  language,
  locale,
}: BuildRenderManifestArgs): RenderManifest => {
  const { width, height } = getDimensionsForRatio(aspectRatio);
  let currentFrame = 0;

  const cuts = locale.clips.map((clip: ClipConfig) => {
    const durationInFrames = Math.max(1, Math.round(clip.durationSeconds * config.render.fps));
    const publicPath = assets.clipAssetPublicPaths[clip.id] ?? null;

    const cut = {
      audioVolume: clip.source === "image" ? undefined : clip.audioVolume,
      durationInFrames,
      hasAudio: clip.source === "image" ? false : clip.hasAudio ?? clip.source === "generated",
      id: clip.id,
      imageSrc: clip.source === "image" ? publicPath : null,
      overlayStyle: clip.overlayStyle ?? "none",
      overlayText: clip.overlayText ?? "",
      startFrame: currentFrame,
      videoSrc: clip.source === "image" ? null : publicPath,
    };

    currentFrame += durationInFrames;
    return cut;
  });

  return {
    aspectRatio,
    bgm: assets.bgmPublicPath,
    bgmVolume: locale.bgmVolume ?? 0.15,
    cuts,
    durationInFrames: currentFrame,
    fps: config.render.fps,
    height,
    language,
    projectSlug: config.project.slug,
    speakerImage: assets.speakerImagePublicPath,
    theme: locale.theme ?? DEFAULT_THEME,
    width,
    narration: undefined,
  };
};
