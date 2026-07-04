import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadProjectConfig } from "../lib/config";
import {
  buildCreateBaseImageArgs,
  buildCreateBaseVideoArgs,
  buildCreateVoiceArgs,
  buildIdempotencyKey,
  buildCreateReferenceVideoArgs,
  buildCreateUpscaleArgs,
  parseJsonOutput,
} from "../lib/pixverse";

test("parseJsonOutput ignores leading PixVerse warnings", () => {
  const payload = parseJsonOutput(`It's recommended to set 'refreshSTSToken'\n{\n  "video_id": 123,\n  "status": "submitted"\n}`);

  assert.equal(payload.video_id, 123);
  assert.equal(payload.status, "submitted");
});

const valueAfter = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

test("PixVerse video arg builders use the correct model per mode", async () => {
  const generated = await loadProjectConfig(
    resolve(process.cwd(), "../fixtures/generated/project.yaml"),
  );
  const generatedArgs = buildCreateBaseVideoArgs(
    generated.config,
    "16:9",
    "/tmp/base-image.png",
  );

  assert.equal(generated.config.generation.model, "v6");
  assert.equal(generated.config.generation.referenceModel, "v6");
  assert.equal(valueAfter(generatedArgs, "--model"), "v6");
  assert.equal(generatedArgs.includes("--no-audio"), true);

  const reference = await loadProjectConfig(
    resolve(process.cwd(), "../fixtures/reference-story/project.yaml"),
  );
  const referenceClip = reference.config.locales.en.clips[0];

  if (!referenceClip || referenceClip.source !== "reference") {
    throw new Error("reference fixture did not load a reference clip.");
  }

  const referenceArgs = buildCreateReferenceVideoArgs({
    aspectRatio: "9:16",
    clip: referenceClip,
    config: reference.config,
  });
  assert.equal(valueAfter(referenceArgs, "--model"), "v6");
  assert.equal(referenceArgs.includes("--no-audio"), true);

  const sharedReferenceArgs = buildCreateBaseVideoArgs(
    {
      ...reference.config,
      speaker: {
        ...reference.config.speaker,
        images: [
          ...reference.config.speaker.images,
          reference.config.speaker.images[0]!,
        ],
        mode: "reference",
      },
    },
    "9:16",
  );
  assert.equal(valueAfter(sharedReferenceArgs, "--model"), "v6");
  assert.equal(sharedReferenceArgs.includes("--no-audio"), true);
});

test("PixVerse create arg builders add stable idempotency keys when scoped", async () => {
  const generated = await loadProjectConfig(
    resolve(process.cwd(), "../fixtures/generated/project.yaml"),
  );
  const scope = "mixed-generated:retry-safe:16x9:base-video";
  const baseVideoArgs = buildCreateBaseVideoArgs(
    generated.config,
    "16:9",
    "/tmp/base-image.png",
    { idempotencyScope: scope },
  );
  const withoutKey = buildCreateBaseVideoArgs(
    generated.config,
    "16:9",
    "/tmp/base-image.png",
  );
  const expectedKey = buildIdempotencyKey(
    scope,
    withoutKey,
  );

  assert.equal(valueAfter(baseVideoArgs, "--idempotency-key"), expectedKey);
  assert.equal(withoutKey.includes("--idempotency-key"), false);

  const baseImageArgs = buildCreateBaseImageArgs(generated.config, "16:9", {
    idempotencyScope: "mixed-generated:retry-safe:16x9:base-image",
  });
  assert.equal(baseImageArgs.includes("--idempotency-key"), true);

  const firstClip = generated.config.locales.en.clips[0];
  if (!firstClip || firstClip.source !== "generated") {
    throw new Error("generated fixture did not load a generated clip.");
  }

  const voiceArgs = buildCreateVoiceArgs(firstClip, {
    idempotencyScope: "mixed-generated:retry-safe:en:16x9:intro:voice",
  });
  assert.equal(voiceArgs.includes("--idempotency-key"), true);
  assert.equal(valueAfter(voiceArgs, "--text"), firstClip.text);
  assert.equal(valueAfter(voiceArgs, "--voice-id"), undefined);

  const presetVoiceArgs = buildCreateVoiceArgs(
    {
      ...firstClip,
      voiceId: "preset-voice-123",
    },
    {
      idempotencyScope: "mixed-generated:retry-safe:en:16x9:intro:preset-voice",
    },
  );
  assert.equal(valueAfter(presetVoiceArgs, "--voice-id"), "preset-voice-123");

  const upscaleArgs = buildCreateUpscaleArgs("video-123", "720p", {
    idempotencyScope: "mixed-generated:retry-safe:en:16x9:intro:upscale",
  });
  assert.equal(upscaleArgs.includes("--idempotency-key"), true);
});
