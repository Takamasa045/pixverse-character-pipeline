#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { assertProduction, validateProduction, hash } from './contracts.mjs';
import { planProduction, impactAnalysis } from './planner.mjs';
import { Store, Executor } from './store.mjs';
import { registerEntity, resolveEntity, characterBundle } from './character.mjs';
import {
  reviewTake,
  markStale,
  attachTakeFile,
  registerLocalTake,
  reviewDelivery,
} from './review.mjs';
import { syncCanvas, adoptTake } from './sync.mjs';
import {
  createPixVerseAdapter,
  validateCreateIntent,
  cliRunner,
  withContext,
  cliBinary,
} from './pixverse.mjs';
import { createCanvasAdapter } from './canvas.mjs';
import { renderDeliveries, locateIssue, editTimeline } from './finish.mjs';
const argv = process.argv.slice(2),
  position = [],
  options = {};
for (let n = 0; n < argv.length; n++) {
  const a = argv[n];
  if (a.startsWith('--')) {
    const equal = a.indexOf('=');
    if (equal > 0) options[a.slice(2, equal)] = a.slice(equal + 1);
    else {
      const key = a.slice(2);
      options[key] = n + 1 < argv.length && !argv[n + 1].startsWith('--') ? argv[++n] : true;
    }
  } else position.push(a);
}
const [command, target, extra] = position;
const json = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const print = (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function required(key) {
  if (typeof options[key] !== 'string') throw new Error(`--${key} required`);
  return options[key];
}
function flag(key) {
  const v = options[key];
  if (v === undefined || v === 'false') return false;
  if (v === true || v === 'true') return true;
  throw new Error(`--${key} must be true or false`);
}
function production(file) {
  if (!file) throw new Error('production JSON file required');
  if (/\.ya?ml$/i.test(file))
    throw new Error(
      'Legacy YAML requires migrate first; use --legacy only to intentionally run the old runtime',
    );
  const p = json(file),
    root = dirname(resolve(file));
  for (const a of p.assets ?? []) if (a.path) a.path = resolve(root, a.path);
  return assertProduction(p);
}
const resolveIntent = (i) =>
  i.backend === 'create'
    ? validateCreateIntent(i, i.capability_snapshot)
    : (createCanvasAdapter().validate(i), { parameters: i.parameters });
function plan(p) {
  const value = planProduction(p, { resolveIntent }),
    execution_runtime = { binary: cliBinary(), node: process.versions.node };
  return { ...value, execution_runtime, id: hash({ id: value.id, execution_runtime }) };
}
function store() {
  return new Store(resolve(required('db')));
}
const provider = () => ({ create: createPixVerseAdapter(), canvas: createCanvasAdapter() });
async function main() {
  if (!command || command === 'help')
    return print({
      runtime: 'production.v1',
      node: '>=22.18',
      commands: [
        'validate FILE',
        'plan FILE',
        'run FILE --dry-run',
        'approve FILE --db DB --actor HUMAN',
        'run FILE --db DB --approval ID',
        'resume INTENT --db DB',
        'reconcile INTENT --results FILE --evidence TEXT --db DB',
        'retry-approval FILE --from APPROVAL --db DB',
        'download INTENT --provider ID --out DEST --db DB',
        'review TAKE --qa FILE --accept --db DB',
        'attach TAKE --file FILE --evidence TEXT --db DB',
        'adopt FILE --shot ID --take ID --db DB',
        'local-take FILE --db DB',
        'delivery-review BUNDLE --qa FILE',
        'canvas-sync FILE --sync FILE --db DB',
        'character register FILE --db DB',
        'character get ID --revision N --db DB',
        'character bundle FILE --db DB',
        'status PROJECT --db DB',
        'costs PROJECT --db DB',
        'finish FILE --takes FILE --out DIR',
        'issue FILE --start-ms N --end-ms N --kind CATEGORY',
        'export FILE --takes FILE --format shotpack|character --variant ID',
        'edit FILE --patch FILE',
        'migrate FILE --kind character|shotpack|registry|manifest [--context FILE] [--out FILE]',
        'capabilities MODE --model MODEL',
      ],
      note: 'plan/dry-run never call PixVerse; approval must reflect existing human authorization',
    });
  if (command === 'capabilities') {
    const r = await cliRunner()([
      'capabilities',
      'create',
      target,
      '--model',
      required('model'),
      '--json',
    ]);
    if (r.exit_code !== 0) throw new Error(r.stderr ?? 'capability query failed');
    return print(r.raw);
  }
  if (command === 'validate') {
    const v = validateProduction(json(target));
    if (!v.valid) process.exitCode = 1;
    return print(v);
  }
  if (command === 'plan' || (command === 'run' && flag('dry-run'))) {
    const p = production(target),
      value = plan(p);
    return print(command === 'plan' ? value : { dry_run: true, provider_calls: 0, plan: value });
  }
  if (command === 'finish')
    return print(
      await renderDeliveries(production(target), json(required('takes')), {
        outputDir: resolve(required('out')),
        baseDir: dirname(resolve(target)),
        dryRun: flag('dry-run'),
        variantIds: typeof options.variant === 'string' ? [options.variant] : undefined,
      }),
    );
  if (command === 'export') {
    const { exportLegacy } = await import('./compat.mjs');
    return print(
      await exportLegacy(production(target), json(required('takes')), {
        format: required('format'),
        variantId: required('variant'),
        baseDir: dirname(resolve(target)),
      }),
    );
  }
  if (command === 'delivery-review')
    return print(reviewDelivery(json(target), json(required('qa'))));
  if (command === 'issue')
    return print(
      locateIssue(production(target), {
        start_ms: Number(required('start-ms')),
        end_ms: Number(required('end-ms')),
        kind: required('kind'),
        details: options.details ?? '',
      }),
    );
  if (command === 'edit') return print(editTimeline(production(target), json(required('patch'))));
  if (command === 'migrate') {
    const { importLegacy, importRegistry } = await import('./compat.mjs');
    let input;
    if (/\.ya?ml$/i.test(target)) {
      let yaml;
      const require = createRequire(import.meta.url);
      for (const candidate of [
        'yaml',
        resolve(dirname(new URL(import.meta.url).pathname), '../../node_modules/yaml'),
        resolve(dirname(new URL(import.meta.url).pathname), '../../remotion/node_modules/yaml'),
      ])
        try {
          yaml = require(candidate);
          break;
        } catch {}
      if (!yaml)
        throw new Error(
          'YAML parser unavailable. Supply JSON converted with existing tooling; no dependency is installed automatically.',
        );
      input = yaml.parse(readFileSync(resolve(target), 'utf8'));
    } else input = json(target);
    const context = options.context ? json(options.context) : undefined,
      kind = required('kind');
    const value = await (kind === 'registry'
      ? importRegistry(input, { context, baseDir: dirname(resolve(target)) })
      : importLegacy(input, {
          format: kind,
          context,
          baseDir: dirname(resolve(target)),
          ...(options.storyboard ? { storyboard: json(options.storyboard) } : {}),
        }));
    if (options.out) {
      if (existsSync(options.out))
        throw new Error('migration destination exists; choose a new path');
      writeFileSync(options.out, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    }
    return print(value);
  }
  const s = store();
  try {
    if (command === 'approve') {
      const p = production(target);
      s.saveDocument('production', p);
      return print(s.approve(plan(p), required('actor')));
    }
    if (command === 'retry-approval') {
      const p = production(target);
      return print(s.approveRetry(plan(p), required('from')));
    }
    if (command === 'run') {
      const p = production(target),
        execution = plan(p);
      s.saveDocument('production', p);
      const version = await cliRunner()(['--version']);
      s.event('execution_runtime', p.project_id, {
        ...execution.execution_runtime,
        cli_version: version.exit_code === 0 ? (version.stdout?.trim() ?? null) : null,
      });
      // Every run checks the installed Create registry again; changed defaults invalidate the approval.
      for (const i of execution.intents)
        if (i.backend === 'create') {
          const r = await cliRunner()(
            withContext(
              ['capabilities', 'create', i.mode, '--model', i.model, '--json'],
              i.context,
            ),
            { context: i.context },
          );
          if (r.exit_code !== 0 || hash(r.raw) !== hash(i.capability_snapshot))
            throw new Error(
              'Installed capabilities differ from approved snapshot. Replan before generation.',
            );
        }
      return print(
        await new Executor(s, provider()).run(execution, { approval: required('approval') }),
      );
    }
    if (command === 'status')
      return print({
        jobs: s.jobs(target),
        takes: s.takes(target),
        cost_report: s.costReport(target),
      });
    if (command === 'costs') return print(s.costReport(target));
    if (command === 'resume') return print(await new Executor(s, provider()).resume(target));
    if (command === 'reconcile')
      return print(
        await new Executor(s, provider()).reconcile(
          target,
          json(required('results')),
          required('evidence'),
        ),
      );
    if (command === 'download')
      return print(
        await new Executor(s, provider()).download(
          target,
          required('provider'),
          resolve(required('out')),
        ),
      );
    if (command === 'review')
      return print(
        reviewTake(s, target, json(required('qa')), {
          accept: flag('accept'),
          reevaluate: flag('reevaluate'),
        }),
      );
    if (command === 'attach')
      return print(attachTakeFile(s, target, resolve(required('file')), required('evidence')));
    if (command === 'local-take') {
      const input = json(target);
      input.path = resolve(dirname(resolve(target)), input.path);
      return print(registerLocalTake(s, input));
    }
    if (command === 'adopt')
      return print(adoptTake(s, production(target), required('shot'), required('take')));
    if (command === 'canvas-sync')
      return print(syncCanvas(s, production(target), json(required('sync'))));
    if (command === 'stale') {
      const change = json(required('change'));
      return print(markStale(s, target, change, required('reason')));
    }
    if (command === 'impact')
      return print(impactAnalysis(production(target), json(required('changed'))));
    if (command === 'character') {
      if (target === 'register') return print(registerEntity(s, json(extra)));
      if (target === 'get')
        return print(
          resolveEntity(s, extra, options.revision ? Number(options.revision) : undefined),
        );
      if (target === 'bundle') {
        const selection = json(extra);
        return print(
          characterBundle(s, selection.entities ?? selection, {
            context: selection.context,
            performance: selection.performance,
          }),
        );
      }
    }
    throw new Error(`Unknown command ${command}; use help`);
  } finally {
    s.close();
  }
}
main().catch((e) => {
  process.stderr.write(
    JSON.stringify({ error: e.message, ...(e.issues ? { issues: e.issues } : {}) }) + '\n',
  );
  process.exitCode = 1;
});
