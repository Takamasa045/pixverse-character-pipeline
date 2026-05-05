import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadProjectConfig } from "../lib/config";
import { buildRenderManifest } from "../lib/manifest";

test("render manifest is deterministic for local asset config", async () => {
  const loaded = await loadProjectConfig(resolve(process.cwd(), "../fixtures/basic/project.yaml"));
  const locale = loaded.config.locales.en;

  const manifest = buildRenderManifest({
    aspectRatio: "16:9",
    assets: {
      bgmPublicPath: null,
      clipAssetPublicPaths: {
        intro: "preview/intro.mp4",
        endcard: "preview/endcard.svg",
      },
      speakerImagePublicPath: "preview/speaker.svg",
    },
    config: loaded.config,
    language: "en",
    locale,
  });

  assert.equal(manifest.durationInFrames, 105);
  assert.equal(manifest.cuts[0].startFrame, 0);
  assert.equal(manifest.cuts[0].durationInFrames, 60);
  assert.equal(manifest.cuts[1].startFrame, 60);
  assert.equal(manifest.cuts[1].durationInFrames, 45);
  assert.equal(manifest.width, 1920);
  assert.equal(manifest.height, 1080);
});

test("render manifest supports 21:9 dimensions", async () => {
  const loaded = await loadProjectConfig(resolve(process.cwd(), "../fixtures/basic/project.yaml"));
  const locale = loaded.config.locales.en;

  const manifest = buildRenderManifest({
    aspectRatio: "21:9",
    assets: {
      bgmPublicPath: null,
      clipAssetPublicPaths: {
        intro: "preview/intro.mp4",
        endcard: "preview/endcard.svg",
      },
      speakerImagePublicPath: "preview/speaker.svg",
    },
    config: loaded.config,
    language: "en",
    locale,
  });

  assert.equal(manifest.width, 2520);
  assert.equal(manifest.height, 1080);
});
