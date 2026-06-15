import { describeConfigForCli, loadProjectConfig } from "../lib/config";
import { getErrorMessage } from "../lib/helpers";
import {
  exportMichibikiHandoff,
  type MichibikiEngine,
  type MichibikiLicenseMode,
  type MichibikiOutputType,
  type MichibikiRemotionMode,
} from "../lib/michibiki";
import { executePipeline } from "../lib/pipeline";
import { buildPipelinePlan } from "../lib/planner";
import { runStoryWizard } from "../lib/story";
import type { SupportedAspectRatio } from "../lib/types";

type ParsedArgs = {
  command: "export" | "plan" | "render" | "run" | "story" | "validate";
  options: Record<string, string | boolean>;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const [commandRaw, ...rest] = argv;

  if (
    commandRaw !== "validate" &&
    commandRaw !== "export" &&
    commandRaw !== "plan" &&
    commandRaw !== "run" &&
    commandRaw !== "render" &&
    commandRaw !== "story"
  ) {
    throw new Error(`Unknown command: ${commandRaw ?? "(missing)"}`);
  }

  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const next = rest[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return {
    command: commandRaw,
    options,
  };
};

const requiredOption = (options: Record<string, string | boolean>, key: string): string => {
  const value = options[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required option --${key}`);
  }

  return value;
};

const stringOption = (
  options: Record<string, string | boolean>,
  key: string,
): string | undefined => {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
};

const oneOfOption = <T extends string>(
  options: Record<string, string | boolean>,
  key: string,
  allowed: readonly T[],
): T | undefined => {
  const value = stringOption(options, key);

  if (value === undefined) {
    return undefined;
  }

  if (!allowed.includes(value as T)) {
    throw new Error(`Invalid --${key}: ${value}. Expected one of: ${allowed.join(", ")}`);
  }

  return value as T;
};

const optionalRatio = (
  options: Record<string, string | boolean>,
): SupportedAspectRatio | undefined => {
  const value = options.ratio;
  return typeof value === "string" ? (value as SupportedAspectRatio) : undefined;
};

const main = async (): Promise<void> => {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === "story") {
    await runStoryWizard({
      configOut: typeof parsed.options["config-out"] === "string" ? parsed.options["config-out"] : undefined,
      dryRun: parsed.options["dry-run"] === true,
      image: typeof parsed.options.image === "string" ? parsed.options.image : undefined,
      images: typeof parsed.options.images === "string" ? parsed.options.images : undefined,
      run: parsed.options.run === true,
    });
    return;
  }

  const configPath = requiredOption(parsed.options, "config");
  const loaded = await loadProjectConfig(configPath);

  if (parsed.command === "validate") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          ...describeConfigForCli(loaded),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (parsed.command === "plan") {
    const plan = buildPipelinePlan(loaded);
    console.log(JSON.stringify({ ok: true, plan }, null, 2));
    return;
  }

  if (parsed.command === "export") {
    const handoff = await exportMichibikiHandoff({
      config: loaded.config,
      configPath: loaded.configPath,
      options: {
        allowCloudRender: parsed.options["allow-cloud-render"] === true,
        dryRun: parsed.options["dry-run"] === true,
        engine: oneOfOption<MichibikiEngine>(
          parsed.options,
          "engine",
          ["auto", "editframe", "hyperframes", "remotion"],
        ),
        licenseMode: oneOfOption<MichibikiLicenseMode>(
          parsed.options,
          "license-mode",
          ["client-work", "commercial", "oss", "personal"],
        ),
        michibikiPath: stringOption(parsed.options, "michibiki-path"),
        outputType: oneOfOption<MichibikiOutputType>(
          parsed.options,
          "output-type",
          ["code", "mp4", "preview", "project", "webm"],
        ),
        remotionMode: oneOfOption<MichibikiRemotionMode>(
          parsed.options,
          "remotion-mode",
          ["auto", "monorepo", "standalone"],
        ),
        runMichibiki: parsed.options["run-michibiki"] === true,
      },
      outputDir: stringOption(parsed.options, "michibiki-handoff-dir"),
    });

    console.log(
      JSON.stringify(
        {
          ok: handoff.ok,
          michibikiHandoffPath: handoff.handoffPath,
          videoSpecPath: handoff.primarySpecPath,
        },
        null,
        2,
      ),
    );
    process.exitCode = handoff.ok ? 0 : 1;
    return;
  }

  const result = await executePipeline(loaded, {
    dryRun: parsed.options["dry-run"] === true,
    michibikiHandoff:
      parsed.options["michibiki-handoff"] === true ||
      parsed.options["run-michibiki"] === true ||
      typeof parsed.options["michibiki-handoff-dir"] === "string"
        ? {
            engine: oneOfOption<MichibikiEngine>(
              parsed.options,
              "michibiki-engine",
              ["auto", "editframe", "hyperframes", "remotion"],
            ),
            enabled: true,
            michibikiPath: stringOption(parsed.options, "michibiki-path"),
            outputDir:
              typeof parsed.options["michibiki-handoff-dir"] === "string"
                ? parsed.options["michibiki-handoff-dir"]
                : undefined,
            remotionMode: oneOfOption<MichibikiRemotionMode>(
              parsed.options,
              "remotion-mode",
              ["auto", "monorepo", "standalone"],
            ),
            runMichibiki: parsed.options["run-michibiki"] === true,
          }
        : undefined,
    mode: parsed.command,
    runId: typeof parsed.options["run-id"] === "string" ? parsed.options["run-id"] : undefined,
    targetLanguage: typeof parsed.options.lang === "string" ? parsed.options.lang : undefined,
    targetRatio: optionalRatio(parsed.options),
  });

  console.log(
    JSON.stringify(
      {
        ok:
          result.runManifest.summary.failed === 0 &&
          result.michibikiHandoffOk !== false,
        manifestPath: result.runManifestPath,
        ...(result.michibikiHandoffPath
          ? { michibikiHandoffPath: result.michibikiHandoffPath }
          : {}),
        plan: result.plan.totals,
        summary: result.runManifest.summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(getErrorMessage(error));
  process.exit(1);
});
