import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runCommand } from "../lib/subprocess";

const repoRoot = resolve(process.cwd(), "..");
const outputRoot = resolve(repoRoot, "output");
const pipelineBin = "./bin/pipeline";

const parseTrailingJson = (output: string) => {
  const normalized = output.trim();
  const start = normalized.lastIndexOf("\n{");
  const jsonText = start >= 0 ? normalized.slice(start + 1) : normalized;
  return JSON.parse(jsonText);
};

test("pipeline validate and plan succeed for fixture config", async () => {
  const validate = await runCommand(
    pipelineBin,
    ["validate", "--config", "../fixtures/generated/project.yaml"],
    {
      captureOutput: true,
      cwd: process.cwd(),
    },
  );

  const plan = await runCommand(
    pipelineBin,
    ["plan", "--config", "../fixtures/generated/project.yaml"],
    {
      captureOutput: true,
      cwd: process.cwd(),
    },
  );

  const validatePayload = parseTrailingJson(validate.stdout);
  const planPayload = parseTrailingJson(plan.stdout);

  assert.equal(validatePayload.ok, true);
  assert.equal(validatePayload.generation.model, "v6");
  assert.equal(validatePayload.generation.referenceModel, "v6");
  assert.equal(validatePayload.generation.generateAudio, false);
  assert.equal(validatePayload.generation.image.enabled, true);
  assert.equal(validatePayload.generation.image.model, "gemini-3.1-flash");
  assert.equal(planPayload.ok, true);
  assert.equal(planPayload.plan.totals.imageJobs, 2);
});

test("pipeline run dry-run writes a manifest", async () => {
  const runId = "dry-run-test";
  const runDir = resolve(outputRoot, "mixed-generated", runId);
  await rm(runDir, { force: true, recursive: true });

  const result = await runCommand(
    pipelineBin,
    [
      "run",
      "--config",
      "../fixtures/generated/project.yaml",
      "--dry-run",
      "--run-id",
      runId,
    ],
    {
      captureOutput: true,
      cwd: process.cwd(),
    },
  );

  const payload = parseTrailingJson(result.stdout);
  const manifestPath = payload.manifestPath as string;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.equal(payload.ok, true);
  assert.equal(payload.plan.imageJobs, 2);
  assert.equal(manifest.summary.planned, 4);
  assert.equal(manifest.variants[0].baseImageId, null);
  assert.equal(manifest.variants[0].baseImageAsset, null);
});

test("pipeline run dry-run can write a Michibiki handoff", async () => {
  const runId = "michibiki-handoff-test";
  const runDir = resolve(outputRoot, "mixed-generated", runId);
  await rm(runDir, { force: true, recursive: true });

  const result = await runCommand(
    pipelineBin,
    [
      "run",
      "--config",
      "../fixtures/generated/project.yaml",
      "--dry-run",
      "--run-id",
      runId,
      "--michibiki-handoff",
    ],
    {
      captureOutput: true,
      cwd: process.cwd(),
    },
  );

  const payload = parseTrailingJson(result.stdout);
  const handoffPath = payload.michibikiHandoffPath as string;
  const handoffDir = dirname(handoffPath);
  const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
  const spec = JSON.parse(await readFile(resolve(handoffDir, "video-spec.json"), "utf8"));

  assert.equal(payload.ok, true);
  assert.equal(handoff.source, "pixverse-character-pipeline");
  assert.equal(handoff.status, "planned");
  assert.equal(handoff.michibiki.outputRoot, "outputs/jobs/<job-id>");
  assert.deepEqual(
    handoff.michibiki.commands.generate.slice(0, 4),
    ["pnpm", "michibiki", "generate", "--spec"],
  );
  assert.equal(handoff.michibiki.commands.generate.includes("--outputs"), false);
  assert.equal(handoff.michibiki.commands.generate.includes("editframe"), true);
  assert.equal(handoff.variants.length, 4);
  assert.equal(handoff.variants[0].videoSpec, "video-specs/ja-16x9.json");
  assert.equal(spec.constraints.enginePreference, "editframe");
  assert.equal(spec.assets[0].type, "video");
  assert.equal(spec.assets[0].source, "../ja/16x9/character.mp4");
});

test("pipeline export writes a Michibiki VideoSpec for downstream project generation", async () => {
  const handoffDir = resolve(outputRoot, "mixed-generated", "michibiki-export-test");
  await rm(handoffDir, { force: true, recursive: true });

  const result = await runCommand(
    pipelineBin,
    [
      "export",
      "--config",
      "../fixtures/generated/project.yaml",
      "--engine",
      "remotion",
      "--remotion-mode",
      "standalone",
      "--michibiki-handoff-dir",
      handoffDir,
      "--michibiki-path",
      "/tmp/michibiki-placeholder",
      "--run-michibiki",
      "--dry-run",
    ],
    {
      captureOutput: true,
      cwd: process.cwd(),
    },
  );

  const payload = parseTrailingJson(result.stdout);
  const handoffPath = payload.michibikiHandoffPath as string;
  const specPath = payload.videoSpecPath as string;
  const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
  const spec = JSON.parse(await readFile(specPath, "utf8"));

  assert.equal(payload.ok, true);
  assert.equal(specPath, resolve(handoffDir, "video-spec.json"));
  assert.equal(handoff.source, "pixverse-character-pipeline");
  assert.equal(handoff.status, "planned");
  assert.equal(handoff.runManifest, null);
  assert.equal(handoff.michibiki.engine, "remotion");
  assert.equal(handoff.michibiki.run.ran, false);
  assert.equal(handoff.michibiki.run.dryRun, true);
  assert.equal(handoff.michibiki.commands.generate.includes("remotion"), true);
  assert.equal(handoff.michibiki.commands.generate.includes("standalone"), true);
  assert.equal(spec.constraints.enginePreference, "remotion");
  assert.equal(spec.assets.some((asset: { type: string }) => asset.type === "image"), true);
  assert.equal(spec.assets.some((asset: { type: string }) => asset.type === "video"), true);
  assert.equal(spec.assets[0].source.startsWith("/"), false);
});

test("pipeline run dry-run allows generated clips without narration", async () => {
  const runId = "silent-generated-dry-run";
  const runDir = resolve(outputRoot, "silent-generated", runId);
  await rm(runDir, { force: true, recursive: true });

  const result = await runCommand(
    pipelineBin,
    [
      "run",
      "--config",
      "../fixtures/generated/silent-project.yaml",
      "--dry-run",
      "--run-id",
      runId,
    ],
    {
      captureOutput: true,
      cwd: process.cwd(),
    },
  );

  const payload = parseTrailingJson(result.stdout);
  const manifest = JSON.parse(await readFile(payload.manifestPath, "utf8"));

  assert.equal(payload.ok, true);
  assert.equal(payload.plan.speechJobs, 0);
  assert.equal(manifest.summary.planned, 1);
});

test("pipeline run dry-run supports reference clips without invoking PixVerse", async () => {
  const runId = "reference-story-dry-run";
  const runDir = resolve(outputRoot, "reference-story-fixture", runId);
  await rm(runDir, { force: true, recursive: true });

  const result = await runCommand(
    pipelineBin,
    [
      "run",
      "--config",
      "../fixtures/reference-story/project.yaml",
      "--dry-run",
      "--run-id",
      runId,
    ],
    {
      captureOutput: true,
      cwd: process.cwd(),
    },
  );

  const payload = parseTrailingJson(result.stdout);
  const manifest = JSON.parse(await readFile(payload.manifestPath, "utf8"));

  assert.equal(payload.ok, true);
  assert.equal(payload.plan.referenceJobs, 2);
  assert.equal(manifest.summary.planned, 1);
  assert.equal(manifest.variants[0]?.clipAssets.hook, "en/9x16/assets/hook.mp4");
});

test("pipeline render rejects reference clips", async () => {
  await assert.rejects(
    async () =>
      await runCommand(
        pipelineBin,
        ["render", "--config", "../fixtures/reference-story/project.yaml"],
        {
          captureOutput: true,
          cwd: process.cwd(),
        },
      ),
    /pipeline:render only supports local video\/image clips\. Use pipeline:run for generated or reference clips\./,
  );
});

test("pipeline render produces an mp4 for local assets", async () => {
  const runId = "render-smoke";
  const runDir = resolve(outputRoot, "local-smoke", runId);
  await rm(runDir, { force: true, recursive: true });

  const result = await runCommand(
    pipelineBin,
    [
      "render",
      "--config",
      "../fixtures/basic/project.yaml",
      "--lang",
      "en",
      "--ratio",
      "16:9",
      "--run-id",
      runId,
    ],
    {
      captureOutput: true,
      cwd: process.cwd(),
    },
  );

  const payload = parseTrailingJson(result.stdout);
  const manifest = JSON.parse(await readFile(payload.manifestPath, "utf8"));
  const file = manifest.variants[0].file as string;
  const absoluteVideoPath = resolve(runDir, file);

  await access(absoluteVideoPath);
  assert.equal(payload.ok, true);
});
