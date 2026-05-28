import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { remotionRoot } from "./paths";
import { runCommand } from "./subprocess";
import type { RenderManifest } from "./types";

type RenderVariantArgs = {
  manifest: RenderManifest;
  manifestPublicPath: string;
  outputFile: string;
};

export const renderVariant = async ({
  manifest,
  manifestPublicPath,
  outputFile,
}: RenderVariantArgs): Promise<void> => {
  const remotionCliEntry = resolve(remotionRoot, "node_modules", "@remotion", "cli", "remotion-cli.js");

  await mkdir(dirname(outputFile), { recursive: true });

  await runCommand(
    process.execPath,
    [
      remotionCliEntry,
      "render",
      "src/index.ts",
      "CharacterVideo",
      outputFile,
      "--props",
      JSON.stringify({ manifestPath: manifestPublicPath }),
      "--frames",
      `0-${Math.max(0, manifest.durationInFrames - 1)}`,
      "--width",
      String(manifest.width),
      "--height",
      String(manifest.height),
      "--timeout",
      "120000",
    ],
    {
      captureOutput: true,
      cwd: remotionRoot,
    },
  );
};
