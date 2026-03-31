import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
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
  assert.equal(projectConfig.config.generation.image.enabled, false);
  assert.equal(projectConfig.config.generation.image.model, "gemini-3.1-flash");
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
