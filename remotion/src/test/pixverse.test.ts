import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadProjectConfig } from "../lib/config";
import {
  buildCreateBaseVideoArgs,
  buildCreateReferenceVideoArgs,
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
  assert.equal(generated.config.generation.referenceModel, "pixverse-c1");
  assert.equal(valueAfter(generatedArgs, "--model"), "v6");

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
  assert.equal(valueAfter(referenceArgs, "--model"), "pixverse-c1");

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
  assert.equal(valueAfter(sharedReferenceArgs, "--model"), "pixverse-c1");
});
