import { createRequire } from "node:module";
import { constants } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { publicRoot, remotionRoot } from "./paths";
import type { RenderManifest } from "./types";

type RenderVariantArgs = {
  manifest: RenderManifest;
  manifestPublicPath: string;
  outputFile: string;
};

// Remotion 4.0.373 supplies these by default. Keep Chromium's sandbox and origin
// protections enabled even when the caller uses that legacy renderer.
export const safeBrowserArguments = (args: string[]): string[] => {
  const denied = new Set([
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-web-security",
    "--ignore-certificate-errors",
    "--allow-running-insecure-content",
    "--disable-site-isolation-trials",
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--disable-client-side-phishing-detection",
    "--unsafely-treat-insecure-origin-as-secure",
  ]);
  return args
    .filter((arg) => !denied.has(arg.split("=")[0]))
    .flatMap((arg) => {
      if (!arg.startsWith("--disable-features=")) return [arg];
      const features = arg
        .slice("--disable-features=".length)
        .split(",")
        .filter((feature) => !["IsolateOrigins", "site-per-process"].includes(feature));
      return features.length ? [`--disable-features=${features.join(",")}`] : [];
    });
};

export const stageRenderManifest = async (
  manifest: RenderManifest,
  destination: string,
  sourceRoot = publicRoot,
): Promise<void> => {
  const staged = new Map<string, string>();
  const root = await realpath(sourceRoot);
  await mkdir(destination, { recursive: true });
  const asset = async (path: string | null | undefined): Promise<string | null> => {
    if (!path) return null;
    if (staged.has(path)) return staged.get(path)!;
    if (isAbsolute(path) || /^\w+:/.test(path))
      throw new Error("Render assets must be local public paths");
    const source = await realpath(resolve(root, path));
    const child = relative(root, source);
    if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error("Render asset escapes the public directory");
    }
    const target = `asset-${staged.size}${extname(path)}`;
    await copyFile(source, resolve(destination, target), constants.COPYFILE_EXCL);
    staged.set(path, target);
    return target;
  };
  const cuts = [];
  for (const cut of manifest.cuts) {
    cuts.push({
      ...cut,
      imageSrc: await asset(cut.imageSrc),
      videoSrc: await asset(cut.videoSrc),
      narrationSrc: await asset(cut.narrationSrc),
    });
  }
  const copy = {
    ...manifest,
    speakerImage: await asset(manifest.speakerImage),
    bgm: await asset(manifest.bgm),
    narration: await asset(manifest.narration),
    cuts,
  };
  await writeFile(resolve(destination, "manifest.json"), JSON.stringify(copy));
};

const resolveBrowser = async (): Promise<string> => {
  const requested = process.env.REMOTION_BROWSER_EXECUTABLE;
  const platform = process.platform === "darwin" ? "mac" : process.platform;
  const candidates = requested
    ? [resolve(requested)]
    : [
        resolve(
          remotionRoot,
          "node_modules",
          ".remotion",
          "chrome-headless-shell",
          `${platform}-${process.arch}`,
          `chrome-headless-shell-${platform}-${process.arch}`,
          process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell",
        ),
      ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next existing binary */
    }
  }
  throw new Error(
    "No existing render browser found. Set REMOTION_BROWSER_EXECUTABLE to an installed Chrome Headless Shell; no browser is downloaded automatically.",
  );
};

export const renderVariant = async ({ manifest, outputFile }: RenderVariantArgs): Promise<void> => {
  const browser = await resolveBrowser();
  const originalCwd = process.cwd();
  const scratch = await mkdtemp(resolve(tmpdir(), "pixverse-remotion-render-"));
  try {
    const publicDir = resolve(scratch, "public");
    await stageRenderManifest(manifest, publicDir);
    const wrapper = resolve(scratch, "browser.cjs");
    await writeFile(
      wrapper,
      `#!${process.execPath}\nconst {spawn}=require('node:child_process');\nconst safeBrowserArguments=${safeBrowserArguments.toString()};\nconst child=spawn(${JSON.stringify(browser)},safeBrowserArguments(process.argv.slice(2)),{stdio:'inherit'});\nfor(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));\nchild.on('error',error=>{console.error(error);process.exit(1)});\nchild.on('exit',(code)=>process.exit(code??1));\n`,
      { mode: 0o700 },
    );
    // Use the public bundler API directly: CLI --bundle-cache=false also deletes
    // existing caches in this version. The API's enableCaching:false never calls
    // the CLI cache-cleanup path. All generated files stay in our own scratch dir.
    const require = createRequire(
      await realpath(resolve(remotionRoot, "node_modules", "@remotion", "cli", "package.json")),
    );
    const { bundle } = require("@remotion/bundler");
    const { selectComposition, renderMedia } = require("@remotion/renderer");
    const serveUrl = await bundle({
      entryPoint: resolve(remotionRoot, "src", "index.ts"),
      rootDir: remotionRoot,
      outDir: resolve(scratch, "bundle"),
      publicDir,
      enableCaching: false,
    });
    const inputProps = { manifestPath: "manifest.json" };
    const composition = await selectComposition({
      serveUrl,
      id: "CharacterVideo",
      inputProps,
      browserExecutable: wrapper,
      timeoutInMilliseconds: 120000,
    });
    await mkdir(dirname(outputFile), { recursive: true });
    await renderMedia({
      composition: {
        ...composition,
        width: manifest.width,
        height: manifest.height,
        fps: manifest.fps,
        durationInFrames: manifest.durationInFrames,
      },
      inputProps,
      serveUrl,
      codec: "h264",
      outputLocation: outputFile,
      browserExecutable: wrapper,
      concurrency: 1,
      overwrite: false,
      timeoutInMilliseconds: 120000,
    });
  } finally {
    process.chdir(originalCwd);
    await rm(scratch, { recursive: true, force: true });
  }
};
