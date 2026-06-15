import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { LoadedConfig } from "./config";
import { ratioToSlug, slugify, toPosix } from "./helpers";
import { getDimensionsForRatio } from "./ratios";
import { buildCommandEnv } from "./subprocess";
import type { ClipConfig, RunManifest, RunVariantManifest, SupportedAspectRatio } from "./types";

type MichibikiAspectRatio = "9:16" | "16:9" | "1:1" | "4:5";
type SupportedMichibikiAspectRatio = Extract<SupportedAspectRatio, MichibikiAspectRatio>;
export type MichibikiEngine = "auto" | "editframe" | "hyperframes" | "remotion";
export type MichibikiLicenseMode = "client-work" | "commercial" | "oss" | "personal";
export type MichibikiOutputType = "code" | "mp4" | "preview" | "project" | "webm";
export type MichibikiRemotionMode = "auto" | "monorepo" | "standalone";

type MichibikiAsset = {
  id: string;
  source: string;
  type: "audio" | "image" | "json" | "subtitle" | "url" | "video";
  usage?: "avatar" | "background" | "broll" | "data" | "music" | "voice";
};

type MichibikiScene = {
  assets?: string[];
  description: string;
  durationSec: number;
  id: string;
  order: number;
  text?: string;
};

type MichibikiVideoSpec = {
  assets: MichibikiAsset[];
  constraints: {
    allowCloudRender: boolean;
    enginePreference?: MichibikiEngine;
    licenseMode: MichibikiLicenseMode;
  };
  content: {
    captions?: string[];
    scenes: MichibikiScene[];
    script?: string;
  };
  format: {
    aspectRatio: MichibikiAspectRatio;
    durationSec: number;
    fps: number;
    height: number;
    width: number;
  };
  goal: string;
  id: string;
  output: {
    needsDownload: boolean;
    type: MichibikiOutputType;
  };
  style: {
    mood: string;
    motionStyle: string;
    reference?: string[];
    visualTone: string;
  };
  title: string;
};

type MichibikiHandoffVariant = {
  aspectRatio: SupportedAspectRatio;
  file: string | null;
  language: string;
  renderManifest: string | null;
  skippedReason?: string;
  status: RunVariantManifest["status"];
  videoSpec: string | null;
};

type MichibikiHandoff = {
  configPath?: string;
  generatedAt: string;
  michibiki: {
    commands: {
      decide: string[] | null;
      generate: string[] | null;
      render: string | null;
    };
    engine: MichibikiEngine;
    outputRoot: "outputs/jobs/<job-id>";
    run: {
      command: string[] | null;
      cwd: string | null;
      dryRun: boolean;
      ok: boolean;
      path: string | null;
      ran: boolean;
      status: number | null;
      stderr: string;
      stdout: string;
    };
    note: string;
  };
  primaryVideoSpec: string | null;
  project: RunManifest["project"];
  runManifest?: string | null;
  source: "pixverse-character-pipeline";
  status: "completed" | "failed" | "planned" | "skipped";
  variants: MichibikiHandoffVariant[];
};

export type MichibikiHandoffResult = {
  handoffPath: string;
  ok: boolean;
  primarySpecPath: string | null;
};

type MichibikiOptions = {
  allowCloudRender?: boolean;
  dryRun?: boolean;
  engine?: MichibikiEngine;
  licenseMode?: MichibikiLicenseMode;
  michibikiPath?: string;
  outputType?: MichibikiOutputType;
  remotionMode?: MichibikiRemotionMode;
  runMichibiki?: boolean;
};

const MICHIBIKI_ASPECT_RATIOS: SupportedMichibikiAspectRatio[] = ["16:9", "9:16", "1:1"];

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const relativePath = (fromDir: string, targetPath: string): string =>
  toPosix(relative(fromDir, targetPath));

const handoffStatus = (manifest: RunManifest): MichibikiHandoff["status"] => {
  if (manifest.summary.failed > 0) {
    return "failed";
  }
  if (manifest.summary.planned > 0) {
    return "planned";
  }
  if (manifest.summary.completed > 0) {
    return "completed";
  }
  return "skipped";
};

const supportsMichibikiRatio = (ratio: SupportedAspectRatio): ratio is SupportedMichibikiAspectRatio =>
  MICHIBIKI_ASPECT_RATIOS.includes(ratio as SupportedMichibikiAspectRatio);

const normalizeOptions = (options: MichibikiOptions = {}) => ({
  allowCloudRender: options.allowCloudRender ?? false,
  dryRun: options.dryRun ?? false,
  engine: options.engine ?? "editframe",
  licenseMode: options.licenseMode ?? "personal",
  michibikiPath: options.michibikiPath,
  outputType: options.outputType ?? "mp4",
  remotionMode: options.remotionMode,
  runMichibiki: options.runMichibiki ?? false,
});

const buildMichibikiGenerateCommand = (
  specPath: string,
  options: ReturnType<typeof normalizeOptions>,
): string[] => {
  const command = ["pnpm", "michibiki", "generate", "--spec", specPath];

  if (options.engine !== "auto") {
    command.push("--engine", options.engine);
  }

  if (options.licenseMode !== "personal") {
    command.push("--license-mode", options.licenseMode);
  }

  if (options.allowCloudRender) {
    command.push("--allow-cloud-render");
  }

  if (options.remotionMode) {
    command.push("--remotion-mode", options.remotionMode);
  }

  return command;
};

const runMichibikiGenerate = async ({
  command,
  options,
}: {
  command: string[] | null;
  options: ReturnType<typeof normalizeOptions>;
}): Promise<MichibikiHandoff["michibiki"]["run"]> => {
  const cwd = options.michibikiPath ? resolve(options.michibikiPath) : null;
  const base = {
    command,
    cwd,
    dryRun: options.dryRun,
    path: cwd,
    status: null,
    stderr: "",
    stdout: "",
  };

  if (!options.runMichibiki) {
    return {
      ...base,
      ok: true,
      ran: false,
    };
  }

  if (options.dryRun) {
    return {
      ...base,
      ok: true,
      ran: false,
    };
  }

  if (!cwd) {
    throw new Error("--run-michibiki requires --michibiki-path <path-to-michibiki>");
  }

  if (!command) {
    return {
      ...base,
      ok: false,
      ran: false,
      stderr: "No primary Michibiki VideoSpec was generated.",
    };
  }

  await access(resolve(cwd, "package.json"));

  return await new Promise((resolveRun) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: buildCommandEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolveRun({
        ...base,
        ok: false,
        ran: true,
        stderr: error.message,
        stdout,
      });
    });

    child.on("close", (status) => {
      resolveRun({
        ...base,
        ok: status === 0,
        ran: true,
        status,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
      });
    });
  });
};

const variantVideoRelativePath = (variant: RunVariantManifest): string =>
  variant.file ?? `${variant.language}/${ratioToSlug(variant.aspectRatio)}/character.mp4`;

const describeClip = (clip: ClipConfig): string => {
  if (clip.source === "reference") {
    return clip.prompt;
  }
  if (clip.source === "generated") {
    return clip.text ?? clip.overlayText ?? `Generated PixVerse clip ${clip.id}`;
  }
  return clip.overlayText ?? `Local ${clip.source} clip ${clip.id}`;
};

const buildScenes = (
  clips: ClipConfig[],
  assetIdsByClip: Map<string, string[]> = new Map(),
): MichibikiScene[] =>
  clips.map((clip, index) => ({
    ...(assetIdsByClip.get(clip.id)?.length
      ? { assets: assetIdsByClip.get(clip.id) }
      : {}),
    description: describeClip(clip),
    durationSec: clip.durationSeconds,
    id: clip.id,
    order: index + 1,
    ...(clip.overlayText || "text" in clip
      ? { text: clip.overlayText || ("text" in clip ? clip.text : undefined) }
      : {}),
  }));

const buildScript = (clips: ClipConfig[]): string | undefined => {
  const lines = clips.flatMap((clip) =>
    "text" in clip && clip.text ? [clip.text] : [],
  );
  return lines.length > 0 ? lines.join("\n") : undefined;
};

const buildCaptions = (clips: ClipConfig[]): string[] | undefined => {
  const captions = clips.flatMap((clip) => (clip.overlayText ? [clip.overlayText] : []));
  return captions.length > 0 ? captions : undefined;
};

const addUniqueAsset = (
  assets: MichibikiAsset[],
  seenSources: Set<string>,
  specDir: string,
  asset: MichibikiAsset,
): string | null => {
  const resolvedSource = asset.source;
  if (seenSources.has(resolvedSource)) {
    return null;
  }

  assets.push({
    ...asset,
    source: relativePath(specDir, resolvedSource),
  });
  seenSources.add(resolvedSource);
  return asset.id;
};

const buildConfigAssets = ({
  config,
  language,
  specDir,
}: {
  config: LoadedConfig["config"];
  language: string;
  specDir: string;
}): { assetIdsByClip: Map<string, string[]>; assets: MichibikiAsset[] } => {
  const locale = config.locales[language];
  const assets: MichibikiAsset[] = [];
  const seenSources = new Set<string>();
  const assetIdsByClip = new Map<string, string[]>();
  const speakerAssetIds = config.speaker.images.flatMap((source, index) => {
    const id = addUniqueAsset(assets, seenSources, specDir, {
      id: `speaker-${index + 1}`,
      source,
      type: "image",
      usage: "avatar",
    });
    return id ? [id] : [];
  });

  if (locale.bgm) {
    addUniqueAsset(assets, seenSources, specDir, {
      id: `${language}-bgm`,
      source: locale.bgm,
      type: "audio",
      usage: "music",
    });
  }

  for (const clip of locale.clips) {
    const clipAssetIds: string[] = [];

    if (clip.source === "video") {
      const id = addUniqueAsset(assets, seenSources, specDir, {
        id: `${clip.id}-video`,
        source: clip.asset,
        type: "video",
        usage: "broll",
      });
      if (id) {
        clipAssetIds.push(id);
      }
    }

    if (clip.source === "image") {
      const id = addUniqueAsset(assets, seenSources, specDir, {
        id: `${clip.id}-image`,
        source: clip.asset,
        type: "image",
        usage: "background",
      });
      if (id) {
        clipAssetIds.push(id);
      }
    }

    if ("audioFile" in clip && clip.audioFile) {
      const id = addUniqueAsset(assets, seenSources, specDir, {
        id: `${clip.id}-audio`,
        source: clip.audioFile,
        type: "audio",
        usage: "voice",
      });
      if (id) {
        clipAssetIds.push(id);
      }
    }

    if (clipAssetIds.length === 0 && speakerAssetIds.length > 0) {
      clipAssetIds.push(...speakerAssetIds);
    }

    if (clipAssetIds.length > 0) {
      assetIdsByClip.set(clip.id, clipAssetIds);
    }
  }

  return { assetIdsByClip, assets };
};

const buildVideoSpec = ({
  allowCloudRender,
  config,
  engine,
  finalVideoPath,
  licenseMode,
  outputType,
  renderManifestPath,
  runRoot,
  specDir,
  variant,
}: {
  allowCloudRender: boolean;
  config: LoadedConfig["config"];
  engine: MichibikiEngine;
  finalVideoPath?: string;
  licenseMode: MichibikiLicenseMode;
  outputType: MichibikiOutputType;
  renderManifestPath?: string | null;
  runRoot?: string;
  specDir: string;
  variant: RunVariantManifest;
}): MichibikiVideoSpec => {
  if (!supportsMichibikiRatio(variant.aspectRatio)) {
    throw new Error(`Unsupported Michibiki aspect ratio: ${variant.aspectRatio}`);
  }

  const locale = config.locales[variant.language];
  const { height, width } = getDimensionsForRatio(variant.aspectRatio);
  const durationSec = locale.clips.reduce((sum, clip) => sum + clip.durationSeconds, 0);
  const captions = buildCaptions(locale.clips);
  const script = buildScript(locale.clips);
  const configAssets = buildConfigAssets({
    config,
    language: variant.language,
    specDir,
  });
  const videoPath = finalVideoPath ?? (runRoot ? resolve(runRoot, variantVideoRelativePath(variant)) : null);
  const resolvedRenderManifestPath =
    renderManifestPath ?? (runRoot && variant.renderManifest
      ? resolve(runRoot, variant.renderManifest)
      : null);
  const finalVideoAssets: MichibikiAsset[] = videoPath
    ? [
        {
          id: "pixverse-final-video",
          source: relativePath(specDir, videoPath),
          type: "video",
          usage: "broll",
        },
      ]
    : [];
  const renderManifestAssets: MichibikiAsset[] = resolvedRenderManifestPath
    ? [
        {
          id: "pixverse-render-manifest",
          source: relativePath(specDir, resolvedRenderManifestPath),
          type: "json",
          usage: "data",
        },
      ]
    : [];
  const assetIdsByClip = videoPath
    ? new Map(locale.clips.map((clip) => [clip.id, ["pixverse-final-video"]]))
    : configAssets.assetIdsByClip;

  return {
    assets: [
      ...finalVideoAssets,
      ...renderManifestAssets,
      ...(videoPath ? [] : configAssets.assets),
    ],
    constraints: {
      allowCloudRender,
      enginePreference: engine,
      licenseMode,
    },
    content: {
      ...(captions ? { captions } : {}),
      scenes: buildScenes(locale.clips, assetIdsByClip),
      ...(script ? { script } : {}),
    },
    format: {
      aspectRatio: variant.aspectRatio,
      durationSec,
      fps: config.render.fps,
      height,
      width,
    },
    goal: videoPath
      ? "Continue, edit, or repurpose a PixVerse Character Pipeline render in Michibiki."
      : [
          "Generate a downstream video project from this PixVerse Character Pipeline config in Michibiki.",
          "Preserve the locale, aspect ratio, clip order, scene descriptions, captions, and timing.",
          config.generation.prompt.base,
        ].join(" "),
    id: slugify(
      `${config.project.slug}-${variant.language}-${ratioToSlug(variant.aspectRatio)}`,
    ),
    output: {
      needsDownload: outputType === "mp4" || outputType === "webm",
      type: outputType,
    },
    style: {
      mood: "polished",
      motionStyle: videoPath
        ? "PixVerse generated character footage prepared for downstream editing"
        : "Michibiki-generated video project from PixVerse Character Pipeline timing and prompts",
      reference: ["PixVerse Character Pipeline"],
      visualTone: "photoreal character video",
    },
    title: `${config.project.title} (${variant.language} ${variant.aspectRatio})`,
  };
};

export const writeMichibikiHandoff = async ({
  config,
  outputDir,
  options,
  runManifest,
  runManifestPath,
  runRoot,
}: {
  config: LoadedConfig["config"];
  outputDir?: string;
  options?: MichibikiOptions;
  runManifest: RunManifest;
  runManifestPath: string;
  runRoot: string;
}): Promise<MichibikiHandoffResult> => {
  const normalizedOptions = normalizeOptions(options);
  const handoffDir = outputDir ? resolve(outputDir) : resolve(runRoot, "michibiki");
  const specDir = resolve(handoffDir, "video-specs");
  await mkdir(specDir, { recursive: true });

  const variants: MichibikiHandoffVariant[] = [];
  let primarySpecPath: string | null = null;
  let primarySpecRelativePath: string | null = null;

  for (const variant of runManifest.variants) {
    if (!supportsMichibikiRatio(variant.aspectRatio)) {
      variants.push({
        aspectRatio: variant.aspectRatio,
        file: variant.file,
        language: variant.language,
        renderManifest: variant.renderManifest,
        skippedReason: "PixVerse handoff currently emits Michibiki specs for 16:9, 9:16, and 1:1 variants.",
        status: variant.status,
        videoSpec: null,
      });
      continue;
    }

    const specFileName = `${variant.language}-${ratioToSlug(variant.aspectRatio)}.json`;
    const specPath = resolve(specDir, specFileName);
    const spec = buildVideoSpec({
      allowCloudRender: normalizedOptions.allowCloudRender,
      config,
      engine: normalizedOptions.engine,
      licenseMode: normalizedOptions.licenseMode,
      outputType: normalizedOptions.outputType,
      runRoot,
      specDir,
      variant,
    });
    await writeJson(specPath, spec);

    if (!primarySpecPath) {
      const rootSpecPath = resolve(handoffDir, "video-spec.json");
      const rootSpec = buildVideoSpec({
        allowCloudRender: normalizedOptions.allowCloudRender,
        config,
        engine: normalizedOptions.engine,
        licenseMode: normalizedOptions.licenseMode,
        outputType: normalizedOptions.outputType,
        runRoot,
        specDir: handoffDir,
        variant,
      });
      await writeJson(rootSpecPath, rootSpec);
      primarySpecPath = rootSpecPath;
      primarySpecRelativePath = "video-spec.json";
    }

    variants.push({
      aspectRatio: variant.aspectRatio,
      file: variant.file,
      language: variant.language,
      renderManifest: variant.renderManifest,
      status: variant.status,
      videoSpec: toPosix(relative(handoffDir, specPath)),
    });
  }

  const generateCommand = primarySpecPath
    ? buildMichibikiGenerateCommand(primarySpecPath, normalizedOptions)
    : null;
  const run = await runMichibikiGenerate({
    command: generateCommand,
    options: normalizedOptions,
  });
  const handoff: MichibikiHandoff = {
    generatedAt: new Date().toISOString(),
    michibiki: {
      commands: {
        decide: primarySpecPath
          ? ["pnpm", "michibiki", "decide", "--spec", primarySpecPath]
          : null,
        generate: generateCommand,
        render: "pnpm michibiki render --job outputs/jobs/<job-id> --confirm-render",
      },
      engine: normalizedOptions.engine,
      outputRoot: "outputs/jobs/<job-id>",
      run,
      note: "Run these commands from the Michibiki repository. Generated projects, previews, and final renders stay under Michibiki outputs/jobs, not this handoff directory.",
    },
    primaryVideoSpec: primarySpecRelativePath,
    project: runManifest.project,
    runManifest: relativePath(handoffDir, runManifestPath),
    source: "pixverse-character-pipeline",
    status: handoffStatus(runManifest),
    variants,
  };

  const handoffPath = resolve(handoffDir, "handoff.json");
  await writeJson(handoffPath, handoff);
  await writeFile(
    resolve(handoffDir, "README.md"),
    [
      "# Michibiki Handoff",
      "",
      "This folder was generated by PixVerse Character Pipeline for optional Michibiki continuation.",
      "",
      "Use the primary spec for engine selection or downstream editing:",
      "",
      "```bash",
      "cd /path/to/michibiki",
      ...(primarySpecPath
        ? [
            `pnpm michibiki decide --spec ${primarySpecPath}`,
            `pnpm michibiki generate --spec ${primarySpecPath} --engine editframe`,
          ]
        : ["# No supported primary video-spec.json was generated."]),
      "```",
      "",
      "Michibiki saves generated projects, previews, and render outputs under `outputs/jobs/<job-id>/` in the Michibiki repository.",
      "",
      "See `handoff.json` for all locale / aspect-ratio variants.",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    handoffPath,
    ok: run.ok,
    primarySpecPath,
  };
};

const plannedVariant = (
  language: string,
  aspectRatio: SupportedAspectRatio,
): RunVariantManifest => ({
  aspectRatio,
  baseImageAsset: null,
  baseImageId: null,
  baseVideoId: null,
  clipAssets: {},
  clipVideoIds: {},
  error: null,
  file: null,
  language,
  renderManifest: null,
  status: "planned",
});

export const exportMichibikiHandoff = async ({
  config,
  configPath,
  outputDir,
  options,
}: {
  config: LoadedConfig["config"];
  configPath: string;
  outputDir?: string;
  options?: MichibikiOptions;
}): Promise<MichibikiHandoffResult> => {
  const normalizedOptions = normalizeOptions(options);
  const handoffDir = outputDir
    ? resolve(outputDir)
    : resolve(config.render.outputDir, config.project.slug, "michibiki");
  const specDir = resolve(handoffDir, "video-specs");
  await mkdir(specDir, { recursive: true });

  const variants: MichibikiHandoffVariant[] = [];
  let primarySpecPath: string | null = null;
  let primarySpecRelativePath: string | null = null;

  for (const language of Object.keys(config.locales)) {
    for (const aspectRatio of config.render.aspectRatios) {
      const variant = plannedVariant(language, aspectRatio);

      if (!supportsMichibikiRatio(aspectRatio)) {
        variants.push({
          aspectRatio,
          file: null,
          language,
          renderManifest: null,
          skippedReason: "Michibiki supports config export specs for 16:9, 9:16, and 1:1 variants from this pipeline.",
          status: "skipped",
          videoSpec: null,
        });
        continue;
      }

      const specFileName = `${language}-${ratioToSlug(aspectRatio)}.json`;
      const specPath = resolve(specDir, specFileName);
      const spec = buildVideoSpec({
        allowCloudRender: normalizedOptions.allowCloudRender,
        config,
        engine: normalizedOptions.engine,
        licenseMode: normalizedOptions.licenseMode,
        outputType: normalizedOptions.outputType,
        specDir,
        variant,
      });
      await writeJson(specPath, spec);

      if (!primarySpecPath) {
        const rootSpecPath = resolve(handoffDir, "video-spec.json");
        const rootSpec = buildVideoSpec({
          allowCloudRender: normalizedOptions.allowCloudRender,
          config,
          engine: normalizedOptions.engine,
          licenseMode: normalizedOptions.licenseMode,
          outputType: normalizedOptions.outputType,
          specDir: handoffDir,
          variant,
        });
        await writeJson(rootSpecPath, rootSpec);
        primarySpecPath = rootSpecPath;
        primarySpecRelativePath = "video-spec.json";
      }

      variants.push({
        aspectRatio,
        file: null,
        language,
        renderManifest: null,
        status: "planned",
        videoSpec: toPosix(relative(handoffDir, specPath)),
      });
    }
  }

  const generateCommand = primarySpecPath
    ? buildMichibikiGenerateCommand(primarySpecPath, normalizedOptions)
    : null;
  const run = await runMichibikiGenerate({
    command: generateCommand,
    options: normalizedOptions,
  });
  const handoff: MichibikiHandoff = {
    configPath,
    generatedAt: new Date().toISOString(),
    michibiki: {
      commands: {
        decide: primarySpecPath
          ? ["pnpm", "michibiki", "decide", "--spec", primarySpecPath]
          : null,
        generate: generateCommand,
        render: "pnpm michibiki render --job outputs/jobs/<job-id> --confirm-render",
      },
      engine: normalizedOptions.engine,
      outputRoot: "outputs/jobs/<job-id>",
      run,
      note: "This export lets Michibiki generate the downstream Remotion, HyperFrames, or Editframe project. Preview and final render remain explicit Michibiki-side steps.",
    },
    primaryVideoSpec: primarySpecRelativePath,
    project: config.project,
    runManifest: null,
    source: "pixverse-character-pipeline",
    status: "planned",
    variants,
  };

  const handoffPath = resolve(handoffDir, "handoff.json");
  await writeJson(handoffPath, handoff);
  await writeFile(
    resolve(handoffDir, "README.md"),
    [
      "# Michibiki Export",
      "",
      "This folder was generated by PixVerse Character Pipeline for Michibiki project generation.",
      "",
      "Use the primary spec from the Michibiki repository:",
      "",
      "```bash",
      "cd /path/to/michibiki",
      ...(primarySpecPath
        ? [
            `pnpm michibiki decide --spec ${primarySpecPath}`,
            `pnpm michibiki generate --spec ${primarySpecPath}${
              normalizedOptions.engine === "auto" ? "" : ` --engine ${normalizedOptions.engine}`
            }`,
          ]
        : ["# No supported primary video-spec.json was generated."]),
      "```",
      "",
      "This step creates a Michibiki job/project only. Run `pnpm michibiki preview --job ...` and `pnpm michibiki render --job ... --confirm-render` separately when approved.",
      "",
      "See `handoff.json` for all locale / aspect-ratio variants.",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    handoffPath,
    ok: run.ok,
    primarySpecPath,
  };
};
