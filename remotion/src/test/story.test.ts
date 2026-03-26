import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { buildStoryProjectConfig } from "../lib/story";

test("buildStoryProjectConfig creates reference clips for each beat", () => {
  const config = buildStoryProjectConfig({
    action: "config",
    aspectRatio: "9:16",
    bgm: null,
    bgmVolume: 0.35,
    configPath: resolve(process.cwd(), "./wizard.story.yaml"),
    date: "2026-03-26",
    images: ["../fixtures/shared/assets/speaker.svg"],
    locale: "ja",
    outputDir: "../output",
    setting: "A foggy shrine at night",
    speakerName: "Story Guide",
    storyBeats: [
      {
        camera: "lateral tracking",
        durationSeconds: 3,
        narration: "A seal begins to crack.",
        overlayStyle: "subtitle",
        overlayText: "A seal begins\nto crack.",
        prompt:
          "The shrine gate trembles. The same character from the reference image is the focus.",
        role: "hook",
      },
      {
        camera: "slow push in",
        durationSeconds: 4,
        narration: "",
        overlayStyle: "subtitle",
        overlayText: "The guide appears",
        prompt:
          "The guide appears in front of the gate. The same character from the reference image is the focus.",
        role: "reveal",
      },
    ],
    theme: {
      accent: "#8b5cf6",
      background: "#120f1d",
      text: "#f8f7ff",
    },
    title: "Wizard Story",
    visualMood: "Dark and cinematic",
  });

  assert.equal(config.locales.ja.clips.length, 2);
  assert.equal(config.locales.ja.clips[0]?.source, "reference");
  assert.equal(config.locales.ja.clips[0]?.text, "A seal begins to crack.");
  assert.equal(config.locales.ja.clips[1]?.source, "reference");
  assert.equal(config.locales.ja.clips[1]?.text, undefined);
});

test("story command writes a reference-story config from interactive answers", async (t) => {
  const configPath = resolve(process.cwd(), "story-wizard-test.yaml");
  await rm(configPath, { force: true });
  t.after(async () => {
    await rm(configPath, { force: true });
  });

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli/pipeline.ts", "story", "--config-out", configPath],
    {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const answers = [
    "../fixtures/shared/assets/speaker.svg",
    "Wizard Interactive Story",
    "2026-03-26",
    "Story Guide",
    "ja",
    "9:16",
    "A moonlit shrine with drifting fog",
    "Dark, cinematic, mystical purple energy",
    "3",
    "hook",
    "The shrine gate trembles with purple light",
    "夜の社で封印が軋みはじめる。",
    "3",
    "lateral tracking",
    "reveal",
    "The guide steps into frame and faces camera",
    "呪符の術師が静かに目を開く。",
    "4",
    "slow push in",
    "payoff",
    "A barrier opens behind the guide",
    "結界の向こうへ物語が動き出す。",
    "4",
    "orbit then pull back",
    "",
    "config",
  ];

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdin.end(`${answers.join("\n")}\n`);

  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolveExit(code ?? 1));
  });

  assert.equal(stderr, "");
  assert.equal(exitCode, 0);
  assert.match(stdout, /Character image path\(s\)/);

  const parsed = YAML.parse(await readFile(configPath, "utf8")) as {
    locales: Record<string, { clips: Array<{ prompt: string; source: string }> }>;
    project: { title: string };
  };

  assert.equal(parsed.project.title, "Wizard Interactive Story");
  assert.equal(parsed.locales.ja.clips.length, 3);
  assert.equal(parsed.locales.ja.clips[0]?.source, "reference");
  assert.match(parsed.locales.ja.clips[0]?.prompt ?? "", /The same character from the reference image/);
});
