import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadProjectConfig } from "../lib/config";

test("project.yaml and spokesperson.yaml normalize to the same internal config", async () => {
  const projectConfig = await loadProjectConfig(
    resolve(process.cwd(), "../fixtures/legacy/project.yaml"),
  );
  const legacyConfig = await loadProjectConfig(
    resolve(process.cwd(), "../fixtures/legacy/spokesperson.yaml"),
  );

  assert.deepEqual(projectConfig.config, legacyConfig.config);
  assert.equal(projectConfig.config.generation.model, "v6");
  assert.equal(projectConfig.config.generation.referenceModel, "pixverse-c1");
  assert.equal(projectConfig.config.generation.image.enabled, true);
  assert.equal(projectConfig.config.generation.image.model, "gemini-3.1-flash");
  assert.equal(projectConfig.config.generation.quality, "720p");
  assert.equal(projectConfig.config.generation.image.quality, "1080p");
});

test("generated fixture enables base image generation and falls back to video prompt", async () => {
  const generatedConfig = await loadProjectConfig(
    resolve(process.cwd(), "../fixtures/generated/project.yaml"),
  );

  assert.equal(generatedConfig.config.generation.image.enabled, true);
  assert.equal(generatedConfig.config.generation.image.model, "gemini-3.1-flash");
  assert.equal(generatedConfig.config.generation.image.quality, "1080p");
  assert.equal(
    generatedConfig.config.generation.image.prompt.base,
    generatedConfig.config.generation.prompt.base,
  );
});

test("multiple speaker images default to single mode and keep i2i enabled", async (t) => {
  const tempDir = await mkdtemp(resolve(tmpdir(), "pixverse-multi-image-"));
  t.after(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  const configPath = resolve(tempDir, "project.yaml");
  await writeFile(
    configPath,
    `
project:
  slug: multi-image-default
  title: Multi Image Default
  date: "2026-04-01"

speaker:
  images:
    - ${resolve(process.cwd(), "../fixtures/shared/assets/speaker.svg")}
    - ${resolve(process.cwd(), "../fixtures/shared/assets/speaker.svg")}

locales:
  en:
    clips:
      - id: opener
        source: generated
        durationSeconds: 2
        text: Hello there.

render:
  aspectRatios: ["16:9"]

generation:
  image:
    enabled: true
`,
    "utf8",
  );

  const loaded = await loadProjectConfig(configPath);
  assert.equal(loaded.config.speaker.mode, "single");
  assert.equal(loaded.config.speaker.images.length, 2);
  assert.equal(loaded.config.generation.image.enabled, true);
  assert.equal(loaded.config.generation.image.model, "gemini-3.1-flash");
  assert.equal(loaded.config.generation.model, "v6");
  assert.equal(loaded.config.generation.referenceModel, "pixverse-c1");
});

test("21:9 is accepted for V6-compatible wide renders", async (t) => {
  const tempDir = await mkdtemp(resolve(tmpdir(), "pixverse-wide-ratio-"));
  t.after(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  const configPath = resolve(tempDir, "project.yaml");
  await writeFile(
    configPath,
    `
project:
  slug: wide-ratio
  title: Wide Ratio
  date: "2026-05-05"

speaker:
  images:
    - ${resolve(process.cwd(), "../fixtures/shared/assets/speaker.svg")}

locales:
  en:
    clips:
      - id: opener
        source: generated
        durationSeconds: 2
        text: Wide render.

render:
  aspectRatios: ["21:9"]
`,
    "utf8",
  );

  const loaded = await loadProjectConfig(configPath);
  assert.deepEqual(loaded.config.render.aspectRatios, ["21:9"]);
});
