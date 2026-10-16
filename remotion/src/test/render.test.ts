import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { safeBrowserArguments, stageRenderManifest } from "../lib/render";
import type { RenderManifest } from "../lib/types";

test("legacy browser retains sandbox and origin protections", () => {
  assert.deepEqual(
    safeBrowserArguments([
      "about:blank",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security=true",
      "--ignore-certificate-errors",
      "--allow-running-insecure-content",
      "--disable-site-isolation-trials",
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
      "--disable-client-side-phishing-detection",
      "--disable-features=IsolateOrigins,site-per-process,Translate",
      "--headless=old",
      "--remote-debugging-port=0",
      "--user-data-dir=/tmp/own-profile",
    ]),
    [
      "about:blank",
      "--disable-features=Translate",
      "--headless=old",
      "--remote-debugging-port=0",
      "--user-data-dir=/tmp/own-profile",
    ],
  );
});

test("render staging copies referenced local assets only and preserves source files", async (t) => {
  const source = await mkdtemp(resolve(tmpdir(), "pixverse-render-source-"));
  const target = await mkdtemp(resolve(tmpdir(), "pixverse-render-target-"));
  t.after(async () => {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });
  await writeFile(resolve(source, "one.svg"), "neutral fixture");
  await writeFile(resolve(source, "unrelated.mp4"), "do not copy this");
  const manifest = {
    speakerImage: "one.svg",
    bgm: null,
    cuts: [
      { id: "a", imageSrc: "one.svg", videoSrc: null, narrationSrc: null },
      { id: "b", imageSrc: "one.svg", videoSrc: null, narrationSrc: null },
    ],
  } as RenderManifest;
  await stageRenderManifest(manifest, target, source);
  assert.deepEqual((await readdir(target)).sort(), ["asset-0.svg", "manifest.json"]);
  const staged = JSON.parse(await readFile(resolve(target, "manifest.json"), "utf8"));
  assert.equal(staged.speakerImage, staged.cuts[0].imageSrc);
  assert.equal(staged.cuts[1].imageSrc, staged.cuts[0].imageSrc);
  assert.equal(await readFile(resolve(source, "unrelated.mp4"), "utf8"), "do not copy this");
  assert.equal(manifest.speakerImage, "one.svg");
  await writeFile(resolve(target, "outside.mp4"), "outside fixture");
  await symlink(resolve(target, "outside.mp4"), resolve(source, "escape.mp4"));
  await assert.rejects(
    stageRenderManifest(
      { ...manifest, speakerImage: "../bad", cuts: [] },
      resolve(target, "bad"),
      source,
    ),
  );
  await assert.rejects(
    stageRenderManifest(
      { ...manifest, speakerImage: "escape.mp4", cuts: [] },
      resolve(target, "link"),
      source,
    ),
    /escapes/,
  );
  await assert.rejects(
    stageRenderManifest(
      { ...manifest, speakerImage: "https://example.com/x", cuts: [] },
      resolve(target, "url"),
      source,
    ),
    /local public/,
  );
});
