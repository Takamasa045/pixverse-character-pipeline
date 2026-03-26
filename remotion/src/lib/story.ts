import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import YAML from "yaml";
import { describeConfigForCli, loadProjectConfig } from "./config";
import { DEFAULT_THEME, SUPPORTED_ASPECT_RATIOS } from "./constants";
import { buildPipelinePlan } from "./planner";
import { executePipeline } from "./pipeline";
import { slugify, todayIsoDate } from "./helpers";
import type { OverlayStyle, ProjectConfig, SupportedAspectRatio } from "./types";

type StoryWizardOptions = {
  configOut?: string;
  dryRun?: boolean;
  image?: string;
  images?: string;
  run?: boolean;
};

type StoryBeat = {
  camera: string;
  durationSeconds: number;
  narration: string;
  overlayStyle: OverlayStyle;
  overlayText: string;
  prompt: string;
  role: string;
};

type StoryAnswers = {
  action: "config" | "dry-run" | "run";
  aspectRatio: SupportedAspectRatio;
  bgm: string | null;
  bgmVolume: number;
  configPath: string;
  date: string;
  images: string[];
  locale: string;
  outputDir: string;
  setting: string;
  speakerName: string;
  storyBeats: StoryBeat[];
  theme: typeof DEFAULT_THEME;
  title: string;
  visualMood: string;
};

type StoryPrompt = {
  ask: (question: string) => Promise<string>;
  close: () => void;
};

const ROLE_DEFAULTS = [
  { camera: "lateral tracking", durationSeconds: 4, role: "hook" },
  { camera: "slow push in", durationSeconds: 4, role: "reveal" },
  { camera: "tracking follow", durationSeconds: 4, role: "conflict" },
  { camera: "orbit then pull back", durationSeconds: 4, role: "payoff" },
  { camera: "static close-up", durationSeconds: 3, role: "endcard" },
] as const;

const defaultOutputDirForConfig = (configPath: string): string =>
  basename(dirname(configPath)) === "remotion" ? "../output" : "./output";

const parseImages = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const coercePositiveNumber = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const coerceVolume = (value: string, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, parsed));
};

const defaultSpeakerName = (imagePath: string): string =>
  basename(imagePath, extname(imagePath)) || "speaker";

const lineBreakText = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const punctuated = trimmed.replace(/[。！？!?]\s*/g, "\n");
  if (punctuated.includes("\n")) {
    return punctuated
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  const words = punctuated.split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    const midpoint = Math.ceil(words.length / 2);
    return `${words.slice(0, midpoint).join(" ")}\n${words.slice(midpoint).join(" ")}`;
  }

  if (trimmed.length > 12) {
    const midpoint = Math.ceil(trimmed.length / 2);
    return `${trimmed.slice(0, midpoint)}\n${trimmed.slice(midpoint)}`;
  }

  return trimmed;
};

const buildReferencePrompt = ({
  aspectRatio,
  camera,
  setting,
  summary,
  visualMood,
}: {
  aspectRatio: SupportedAspectRatio;
  camera: string;
  setting: string;
  summary: string;
  visualMood: string;
}): string => {
  const framing = aspectRatio === "9:16" ? "vertical portrait framing" : "medium shot framing";
  return `${summary}. The same character from the reference image is the focus. ${setting}. ${visualMood}. ${camera}, ${framing}, photoreal live-action environment blended with the stylized character.`;
};

export const buildStoryProjectConfig = (answers: StoryAnswers): ProjectConfig => {
  const slug = slugify(answers.title);
  const clipSource = answers.storyBeats.map((beat, index) => ({
    audioVolume: beat.narration ? 0.82 : undefined,
    durationSeconds: beat.durationSeconds,
    hasAudio: Boolean(beat.narration),
    id: `${String(index + 1).padStart(2, "0")}-${beat.role}`,
    overlayStyle: beat.overlayStyle,
    overlayText: beat.overlayText,
    prompt: beat.prompt,
    source: "reference" as const,
    text: beat.narration || undefined,
    ttsSpeaker: beat.narration ? 1 : undefined,
  }));

  return {
    generation: {
      ambientSound: null,
      model: "v5.6",
      prompt: {
        base: `A reference-driven story teaser set in ${answers.setting}. ${answers.visualMood}`,
      },
      quality: "1080p",
      upscale: true,
    },
    locales: {
      [answers.locale]: {
        ...(answers.bgm ? { bgm: resolve(dirname(answers.configPath), answers.bgm) } : {}),
        ...(answers.bgm ? { bgmVolume: answers.bgmVolume } : {}),
        clips: clipSource,
        theme: answers.theme,
      },
    },
    project: {
      date: answers.date,
      slug,
      title: answers.title,
    },
    render: {
      aspectRatios: [answers.aspectRatio],
      fps: 30,
      outputDir: resolve(dirname(answers.configPath), answers.outputDir),
    },
    speaker: {
      images: answers.images.map((image) => resolve(dirname(answers.configPath), image)),
      mode: answers.images.length > 1 ? "reference" : "single",
      name: answers.speakerName,
    },
  };
};

const stringifyProjectConfig = (config: ProjectConfig): string =>
  YAML.stringify({
    generation: {
      ambientSound: config.generation.ambientSound,
      model: config.generation.model,
      prompt: config.generation.prompt,
      quality: config.generation.quality,
      upscale: config.generation.upscale,
    },
    locales: Object.fromEntries(
      Object.entries(config.locales).map(([language, locale]) => [
        language,
        {
          ...(locale.bgm ? { bgm: locale.bgm } : {}),
          ...(locale.bgm ? { bgmVolume: locale.bgmVolume } : {}),
          clips: locale.clips,
          theme: locale.theme,
        },
      ]),
    ),
    project: config.project,
    render: config.render,
    speaker: config.speaker,
  });

const createStoryPrompt = async (): Promise<StoryPrompt> => {
  if (process.stdin.isTTY) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return {
      ask: async (question: string): Promise<string> => await readline.question(question),
      close: (): void => {
        readline.close();
      },
    };
  }

  process.stdin.setEncoding("utf8");

  let pipedInput = "";
  for await (const chunk of process.stdin) {
    pipedInput += chunk;
  }

  const lines = pipedInput.replace(/\r\n/g, "\n").split("\n");
  let lineIndex = 0;

  return {
    ask: async (question: string): Promise<string> => {
      process.stdout.write(question);

      if (lineIndex >= lines.length) {
        throw new Error(`Missing piped answer for prompt: ${question.trim()}`);
      }

      const answer = lines[lineIndex] ?? "";
      lineIndex += 1;
      return answer;
    },
    close: (): void => undefined,
  };
};

const askWithDefault = async (
  ask: (question: string) => Promise<string>,
  label: string,
  defaultValue: string,
): Promise<string> => {
  const prompt = defaultValue ? `${label} [${defaultValue}]: ` : `${label}: `;
  const answer = (await ask(prompt)).trim();
  return answer || defaultValue;
};

const askRequired = async (
  ask: (question: string) => Promise<string>,
  label: string,
  defaultValue = "",
): Promise<string> => {
  while (true) {
    const prompt = defaultValue ? `${label} [${defaultValue}]: ` : `${label}: `;
    const answer = (await ask(prompt)).trim();
    const resolved = answer || defaultValue;

    if (resolved) {
      return resolved;
    }
  }
};

const collectStoryAnswers = async (options: StoryWizardOptions): Promise<StoryAnswers> => {
  const prompt = await createStoryPrompt();
  const ask = prompt.ask;

  try {
    const imagesDefault =
      options.images?.trim() || options.image?.trim() || "";
    const images = parseImages(
      await askRequired(
        ask,
        "Character image path(s) (comma-separated)",
        imagesDefault,
      ),
    );
    const firstImage = images[0] ?? "character.png";
    const title = await askWithDefault(ask, "Project title", "Character Story");
    const slug = slugify(title);
    const configPath = resolve(
      options.configOut?.trim() || `./${slug}.story.yaml`,
    );
    const date = await askWithDefault(ask, "Project date", todayIsoDate());
    const speakerName = await askWithDefault(
      ask,
      "Character name",
      defaultSpeakerName(firstImage),
    );
    const locale = await askWithDefault(ask, "Locale", "ja");
    const ratioAnswer = await askWithDefault(ask, "Aspect ratio", "9:16");
    const aspectRatio = SUPPORTED_ASPECT_RATIOS.includes(ratioAnswer as SupportedAspectRatio)
      ? (ratioAnswer as SupportedAspectRatio)
      : "9:16";
    const setting = await askWithDefault(
      ask,
      "Setting / stage",
      "A moonlit shrine at night with drifting fog and purple spiritual energy",
    );
    const visualMood = await askWithDefault(
      ask,
      "Visual mood",
      "Mysterious, cinematic, tense, elegant, photoreal live-action atmosphere",
    );
    const cutCount = Math.min(
      5,
      Math.max(3, Math.round(coercePositiveNumber(await askWithDefault(ask, "Number of cuts", "4"), 4))),
    );

    const storyBeats: StoryBeat[] = [];
    for (let index = 0; index < cutCount; index += 1) {
      const defaults = ROLE_DEFAULTS[index] ?? ROLE_DEFAULTS[ROLE_DEFAULTS.length - 1];
      const role = await askWithDefault(
        ask,
        `Cut ${index + 1} role`,
        defaults.role,
      );
      const summary = await askRequired(
        ask,
        `Cut ${index + 1} scene summary`,
        role === "hook"
          ? "A sealed gate trembles as spiritual light leaks into the shrine path"
          : role === "reveal"
            ? "The character steps into frame and faces the camera"
            : role === "conflict"
              ? "The character unleashes a talisman strike through the darkness"
              : role === "payoff"
                ? "The shrine barrier opens and the character stands before it"
                : "The character holds a final pose as the story resolves",
      );
      const narration = await askWithDefault(ask, `Cut ${index + 1} narration`, "");
      const durationSeconds = coercePositiveNumber(
        await askWithDefault(
          ask,
          `Cut ${index + 1} duration seconds`,
          String(defaults.durationSeconds),
        ),
        defaults.durationSeconds,
      );
      const camera = await askWithDefault(
        ask,
        `Cut ${index + 1} camera`,
        defaults.camera,
      );

      storyBeats.push({
        camera,
        durationSeconds,
        narration,
        overlayStyle: "subtitle",
        overlayText: lineBreakText(narration || summary),
        prompt: buildReferencePrompt({
          aspectRatio,
          camera,
          setting,
          summary,
          visualMood,
        }),
        role: slugify(role),
      });
    }

    const bgm = (await askWithDefault(ask, "BGM path (blank for none)", "")).trim() || null;
    const bgmVolume = bgm
      ? coerceVolume(await askWithDefault(ask, "BGM volume", "0.35"), 0.35)
      : 0.35;
    const action = options.run
      ? "run"
      : options.dryRun
        ? "dry-run"
        : ((await askWithDefault(ask, "Next step (config / dry-run / run)", "config")) as
            | "config"
            | "dry-run"
            | "run");

    return {
      action: action === "run" || action === "dry-run" ? action : "config",
      aspectRatio,
      bgm,
      bgmVolume,
      configPath,
      date,
      images,
      locale,
      outputDir: defaultOutputDirForConfig(configPath),
      setting,
      speakerName,
      storyBeats,
      theme: {
        accent: "#8b5cf6",
        background: "#120f1d",
        text: "#f8f7ff",
      },
      title,
      visualMood,
    };
  } finally {
    prompt.close();
  }
};

export const runStoryWizard = async (options: StoryWizardOptions): Promise<void> => {
  const answers = await collectStoryAnswers(options);
  const config = buildStoryProjectConfig(answers);
  const yaml = stringifyProjectConfig(config);

  await mkdir(dirname(answers.configPath), { recursive: true });
  await writeFile(answers.configPath, yaml, "utf8");

  const loaded = await loadProjectConfig(answers.configPath);
  const plan = buildPipelinePlan(loaded);

  console.log(
    JSON.stringify(
      {
        ok: true,
        configPath: answers.configPath,
        config: describeConfigForCli(loaded),
        plan: plan.totals,
      },
      null,
      2,
    ),
  );

  if (answers.action === "config") {
    return;
  }

  const result = await executePipeline(loaded, {
    dryRun: answers.action === "dry-run",
    mode: "run",
  });

  console.log(
    JSON.stringify(
      {
        ok: result.runManifest.summary.failed === 0,
        manifestPath: result.runManifestPath,
        plan: result.plan.totals,
        summary: result.runManifest.summary,
      },
      null,
      2,
    ),
  );
};
