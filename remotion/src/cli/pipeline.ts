import { describeConfigForCli, loadProjectConfig } from "../lib/config";
import { getErrorMessage } from "../lib/helpers";
import { executePipeline } from "../lib/pipeline";
import { buildPipelinePlan } from "../lib/planner";
import { runStoryWizard } from "../lib/story";
import type { SupportedAspectRatio } from "../lib/types";

type ParsedArgs = {
  command: "plan" | "render" | "run" | "story" | "validate";
  options: Record<string, string | boolean>;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const [commandRaw, ...rest] = argv;

  if (
    commandRaw !== "validate" &&
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

  const result = await executePipeline(loaded, {
    dryRun: parsed.options["dry-run"] === true,
    mode: parsed.command,
    runId: typeof parsed.options["run-id"] === "string" ? parsed.options["run-id"] : undefined,
    targetLanguage: typeof parsed.options.lang === "string" ? parsed.options.lang : undefined,
    targetRatio: optionalRatio(parsed.options),
  });

  console.log(
    JSON.stringify(
      {
        ok: result.runManifest.summary.failed === 0,
        manifestPath: result.runManifestPath,
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
