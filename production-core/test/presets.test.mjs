import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, Executor } from '../src/store.mjs';
import {
  createPresetAdapter,
  resolvePresetIntent,
  planPresetCandidates,
  presetSnapshotHash,
  validateMiniAppParameters,
} from '../src/presets.mjs';

const context = { region: 'global', workspace_id: '0' };
// Public documentation contract examples, not claimed live/account availability.
const miniInfo = {
  app_id: 'magic_extend',
  can_create: true,
  params_schema: [
    { name: 'image', type: 'upload', required: true, max_count: 1 },
    { name: 'ratio', type: 'enum', required: true, options: ['16:9', '9:16'] },
  ],
};
function miniIntent() {
  const info = structuredClone(miniInfo);
  return {
    id: 'mini-intent',
    backend: 'preset',
    mode: 'miniapps',
    model: null,
    preset_id: 'magic_extend',
    output_kind: 'image',
    context,
    parameters: { ratio: '16:9' },
    inputs: [
      { kind: 'image', media_path: 'upload/existing.png', ...context, binding: { order: 0 } },
    ],
    preset_snapshot: {
      info,
      context,
      cli_version: '1.4.8',
      analysis: {
        evidence: {
          source: 'official schema example + fixture output attestation',
          info_sha256: presetSnapshotHash(info),
        },
        output: {
          kind: 'image',
          aspects: ['16:9', '9:16'],
          editable_shots: false,
          intermediate_assets: [],
        },
      },
    },
  };
}
function templateIntent() {
  return {
    id: 'template-intent',
    backend: 'preset',
    mode: 'template',
    model: null,
    preset_id: '12345',
    output_kind: 'image',
    context,
    parameters: {},
    inputs: [{ kind: 'image', path: '/local/fixture.png', ...context }],
    preset_snapshot: {
      info: {
        template_id: 12345,
        template_type: 2,
        effect_type: 1,
        supported_features: 0,
        duration: 5,
      },
      context,
      cli_version: '1.4.8',
    },
  };
}
function mocked(responses) {
  const calls = [];
  return {
    calls,
    run: async (args, options) => {
      calls.push({ args, options });
      if (!responses.length) throw new Error('Unexpected command');
      return responses.shift();
    },
  };
}

test('preset planning compares fixed outputs, editing and intermediate requirements without calls', () => {
  const intent = miniIntent();
  intent.preset_snapshot.available = true;
  const plan = planPresetCandidates({
    requirements: {
      output_kind: 'image',
      aspects: ['16:9'],
      requires_editable_shots: true,
      requires_intermediate_assets: ['per-shot-video'],
      context,
    },
    miniapps: [
      { ...intent.preset_snapshot, parameters: { image: 'upload/existing.png', ratio: '16:9' } },
    ],
  });
  assert.equal(plan.provider_calls, 0);
  assert.equal(plan.candidates[0].status, 'incompatible');
  assert.equal(plan.candidates[0].execution_permitted, false);
  assert(plan.candidates[0].mismatches.includes('editable_shots'));
  assert(plan.candidates[0].mismatches.includes('intermediate_assets'));
});
test('preset planning does not infer identity/voice, semantic fit or availability from a name', () => {
  const p = planPresetCandidates({
    requirements: { intent: 'Keep exactly the same voice', continuity_controls: ['same_voice'] },
    miniapps: [miniIntent().preset_snapshot],
  });
  assert.equal(p.candidates[0].status, 'needs_verification');
  assert(p.candidates[0].unknown.includes('semantic_fit'));
  assert(p.candidates[0].unknown.includes('current_account_availability'));
  const empty = planPresetCandidates();
  assert.equal(empty.discovery_required.length, 2);
  assert.equal(empty.provider_calls, 0);
});
test('fixed duration comparison never rewrites template output constraints', () => {
  const intent = templateIntent(),
    snapshot = intent.preset_snapshot;
  snapshot.available = true;
  snapshot.analysis = {
    evidence: {
      source: 'fixture fixed output declaration',
      info_sha256: presetSnapshotHash(snapshot.info),
    },
    output: { fixed_duration_ms: 5000 },
  };
  const plan = planPresetCandidates({
    requirements: { duration_ms: 12000 },
    templates: [snapshot],
  });
  assert.equal(plan.candidates[0].status, 'incompatible');
  assert.equal(plan.candidates[0].output.fixed_duration_ms, 5000);
});
test('MiniApp schema binds uploaded media paths and preserves exact enum values', () => {
  const intent = miniIntent(),
    resolved = resolvePresetIntent(intent);
  assert.deepEqual(resolved.parameters, { ratio: '16:9', image: 'upload/existing.png' });
  assert.equal(resolved.output_kind, 'image');
  assert.deepEqual(
    resolvePresetIntent({ ...intent, parameters: resolved.parameters }).parameters,
    resolved.parameters,
  );
  assert.throws(() => resolvePresetIntent({ ...intent, parameters: { ratio: 'invalid' } }), /enum/);
  assert.throws(
    () => resolvePresetIntent({ ...intent, parameters: { ratio: '16:9', invented: 'x' } }),
    /Unknown MiniApp/,
  );
});
test('unknown schemas, absent upload provenance and cross-context references fail closed', () => {
  const intent = miniIntent();
  assert.throws(
    () =>
      validateMiniAppParameters(
        { ...miniInfo, params_schema: [{ name: 'thing', type: 'unknown', required: true }] },
        { thing: 'x' },
      ),
    /Unknown MiniApp schema/,
  );
  assert.throws(
    () =>
      resolvePresetIntent({
        ...intent,
        inputs: [],
        parameters: { ratio: '16:9', image: 'https://local.example/image.png' },
      }),
    /provider media path/,
  );
  assert.throws(
    () => resolvePresetIntent({ ...intent, inputs: [{ ...intent.inputs[0], region: 'cn' }] }),
    /context/,
  );
  const noEvidence = structuredClone(intent);
  noEvidence.preset_snapshot.analysis.evidence.info_sha256 = 'bad';
  assert.throws(() => resolvePresetIntent(noEvidence), /output kind needs evidence/);
});
test('MiniApp creation uses its app schema and project identity, never a fake Create model', async () => {
  const intent = miniIntent(),
    m = mocked([
      { exit_code: 0, stdout: '1.4.8\n' },
      { exit_code: 0, raw: { project_id: 987654, status: 'submitted' } },
    ]);
  const adapter = createPresetAdapter({ run: m.run, infoProvider: async () => miniInfo });
  const result = await adapter.submit(intent);
  assert.equal(result.results[0].id, '987654');
  assert.equal(result.results[0].kind, 'image');
  assert.equal(result.results[0].status, 'submitted');
  const args = m.calls[1].args;
  assert.deepEqual(args.slice(0, 2), ['miniapps', 'create']);
  assert(args.includes('--no-wait'));
  assert(!args.includes('--model'));
  assert(!args.includes('--idempotency-key'));
  assert.equal(m.calls.length, 2);
});
test('changed preset schema or CLI version rejects before paid submission', async () => {
  let m = mocked([{ exit_code: 0, stdout: '1.4.8' }]);
  await assert.rejects(
    () =>
      createPresetAdapter({
        run: m.run,
        infoProvider: async () => ({ ...miniInfo, params_schema: [] }),
      }).submit(miniIntent()),
    /changed after approval/,
  );
  assert.equal(m.calls.length, 1);
  m = mocked([{ exit_code: 0, stdout: '1.4.9' }]);
  await assert.rejects(
    () =>
      createPresetAdapter({ run: m.run, infoProvider: async () => miniInfo }).submit(miniIntent()),
    /CLI differs/,
  );
  assert.equal(m.calls.length, 1);
});
test('ambiguous MiniApp response is returned once with no invented idempotency or automatic retry', async () => {
  const m = mocked([
    { exit_code: 0, stdout: '1.4.8' },
    { exit_code: 2, stderr: 'timeout' },
  ]);
  const result = await createPresetAdapter({
    run: m.run,
    infoProvider: async () => miniInfo,
  }).submit(miniIntent());
  assert.deepEqual(result.results, []);
  assert.equal(result.exit_code, 2);
  assert.equal(m.calls.filter((c) => c.args[1] === 'create').length, 1);
});
test('known MiniApp project status inspects primary type, then downloads the same project', async () => {
  const m = mocked([
    {
      exit_code: 0,
      raw: {
        project_id: 987654,
        status: 'completed',
        assets: [{ type: 'image', id: 111, url: 'https://media/image' }],
      },
    },
    { exit_code: 0, raw: { file: '/local/result.png' } },
  ]);
  const adapter = createPresetAdapter({ run: m.run });
  assert.equal((await adapter.status(miniIntent(), '987654')).results[0].status, 'completed');
  assert.equal(
    (await adapter.download(miniIntent(), '987654', '/local/out')).results[0].path,
    '/local/result.png',
  );
  assert(
    m.calls.every(
      (c) => c.args[c.args.indexOf('--type') + 1] === 'miniapps' && !c.args.includes('create'),
    ),
  );
});
test('a MiniApp returning video instead of requested image remains a failed candidate with raw assets retained', async () => {
  const raw = {
    project_id: 987654,
    status: 'completed',
    assets: [
      { type: 'image', id: 111 },
      { type: 'video', id: 112 },
    ],
  };
  const m = mocked([{ exit_code: 0, raw }]);
  const result = await createPresetAdapter({ run: m.run }).status(miniIntent(), '987654');
  assert.equal(result.results[0].status, 'provider_failed');
  assert.equal(result.raw.assets.length, 2);
});
test('legacy template image output, ordered input and stable first-submission key are respected', async () => {
  const intent = templateIntent(),
    m = mocked([
      { exit_code: 0, stdout: '1.4.8' },
      { exit_code: 0, raw: { image_ids: [111, 112], status: 'submitted' } },
    ]);
  const result = await createPresetAdapter({
    run: m.run,
    infoProvider: async () => intent.preset_snapshot.info,
  }).submit(intent);
  assert.deepEqual(
    result.results.map((r) => r.id),
    ['111', '112'],
  );
  assert(result.results.every((r) => r.kind === 'image'));
  assert(m.calls[1].args.includes('--image'));
  assert(m.calls[1].args.includes('--idempotency-key'));
});
test('legacy template missing inputs and output override reject; verified 1.4.9 legacy route works', () => {
  const intent = templateIntent();
  assert.throws(() => resolvePresetIntent({ ...intent, inputs: [] }), /one image/);
  assert.throws(
    () => resolvePresetIntent({ ...intent, parameters: { duration: 12 } }),
    /override is not verified/,
  );
  intent.preset_snapshot.cli_version = '1.4.9';
  assert.equal(resolvePresetIntent(intent).output_kind, 'image');
  const plan = planPresetCandidates({ templates: [intent.preset_snapshot], cli_version: '1.4.9' });
  assert.equal(plan.candidates[0].execution_supported, true);
});

const modernFixture = JSON.parse(
  readFileSync(new URL('../fixtures/ordered-template-contract.json', import.meta.url)),
);
function modernIntent() {
  return {
    id: 'ordered-fixture',
    project_id: 'preset-project',
    shot_id: 'effect',
    attempt: 1,
    backend: 'preset',
    mode: 'template',
    model: null,
    preset_id: '12345',
    output_kind: 'video',
    context,
    upper_credits: 220,
    price_evidence: { surface: 'cli', source: 'neutral fixed_cost fixture' },
    parameters: {},
    inputs: [{ kind: 'image', path: '/local/required.png', size_bytes: 10, ...context }],
    preset_snapshot: { info: structuredClone(modernFixture.info), context, cli_version: '1.4.9' },
  };
}
test('ordered template maps required and optional images exactly, preserving explicit empty slots', () => {
  const i = modernIntent();
  assert.deepEqual(resolvePresetIntent(i).parameters.image, ['', '/local/required.png']);
  assert.deepEqual(
    resolvePresetIntent({ ...i, parameters: { image: ['', '/local/required.png'] } }).parameters
      .image,
    ['', '/local/required.png'],
  );
  i.inputs[0].parameter = 'fixture-required';
  assert.deepEqual(resolvePresetIntent(i).parameters.image, ['', '/local/required.png']);
  i.inputs.unshift({
    kind: 'image',
    path: '/local/optional.png',
    size_bytes: 10,
    ...context,
    parameter: 'fixture-optional',
  });
  assert.deepEqual(resolvePresetIntent(i).parameters.image, [
    '/local/optional.png',
    '/local/required.png',
  ]);
  const slots = i.preset_snapshot.info.input_fields;
  slots.splice(1, 0, {
    name: 'Later optional',
    node_id: 'later',
    content_type: 'image',
    required: false,
    max_size: 100,
  });
  i.inputs[0].parameter = 'later';
  assert.throws(() => resolvePresetIntent(i), /Optional image selection/);
});
test('ordered fixed settings reject overrides, missing budgets, old CLI and mismatched declared output', () => {
  for (const key of [
    'quality',
    'duration',
    'aspect_ratio',
    'seed',
    'count',
    'off_peak',
    'idempotency_key',
  ])
    assert.throws(
      () =>
        resolvePresetIntent({
          ...modernIntent(),
          parameters: { [key]: key === 'off_peak' ? false : 1 },
        }),
      /override/,
    );
  for (const upper_credits of [null, 219, undefined])
    assert.throws(
      () => resolvePresetIntent({ ...modernIntent(), upper_credits }),
      /fixed template cost/,
    );
  const i = modernIntent();
  i.preset_snapshot.cli_version = '1.4.8';
  assert.throws(() => resolvePresetIntent(i), /1\.4\.8 cannot submit/);
  assert.throws(
    () => resolvePresetIntent({ ...modernIntent(), output_kind: 'image' }),
    /absent from template/,
  );
});
test('ordered references enforce exact slot context, size, video duration and explicit text limits', () => {
  const i = modernIntent();
  assert.throws(() => resolvePresetIntent({ ...i, inputs: [] }), /required ordered image/);
  assert.throws(
    () => resolvePresetIntent({ ...i, inputs: [{ ...i.inputs[0], size_bytes: undefined }] }),
    /size/,
  );
  assert.throws(
    () => resolvePresetIntent({ ...i, inputs: [{ ...i.inputs[0], size_bytes: 40000000 }] }),
    /size/,
  );
  assert.throws(
    () => resolvePresetIntent({ ...i, parameters: { prompt: 'x'.repeat(5001) } }),
    /silent truncation/,
  );
  i.preset_snapshot.info.input_fields.push({
    name: 'Video',
    node_id: 'vid',
    content_type: 'video',
    required: true,
    max_size: 100,
    min_duration: 1,
    max_duration: 3,
  });
  i.inputs.push({
    kind: 'video',
    provider_id: '999',
    size_bytes: 10,
    duration_ms: 2000,
    ...context,
  });
  assert.equal(resolvePresetIntent(i).parameters.video, '999');
  i.inputs[1].duration_ms = 4000;
  assert.throws(() => resolvePresetIntent(i), /video duration/);
  i.inputs[1].duration_ms = 2000;
  i.preset_snapshot.info.input_fields.push({
    name: 'Video2',
    content_type: 'video',
    required: false,
  });
  assert.throws(() => resolvePresetIntent(i), /more video\/text/);
});
test('ordered candidate comparison binds declared output settings and cost without provider calls', () => {
  const i = modernIntent(),
    snapshot = i.preset_snapshot;
  snapshot.available = true;
  snapshot.analysis = {
    evidence: { source: 'neutral test', info_sha256: presetSnapshotHash(snapshot.info) },
    output: { fixed_duration_ms: 5000 },
  };
  const p = planPresetCandidates({
    requirements: { duration_ms: 5000, output_kind: 'video', aspects: ['9:16'] },
    templates: [{ ...snapshot, inputs: i.inputs }],
  });
  assert.equal(p.provider_calls, 0);
  assert.equal(p.candidates[0].execution_supported, true);
  assert.equal(p.candidates[0].fixed_cost_credits, 220);
  assert.equal(p.candidates[0].output.fixed_duration_ms, 10000);
  assert.equal(p.candidates[0].status, 'incompatible');
  assert.equal(p.candidates[0].execution_permitted, false);
  snapshot.info.output = [];
  assert(
    planPresetCandidates({ templates: [snapshot] }).candidates[0].unknown.includes(
      'fixed_output_schema',
    ),
  );
});
test('ordered submissions preserve mixed output IDs and omit all fixed-control overrides', async () => {
  const i = modernIntent(),
    m = mocked([
      { exit_code: 0, stdout: '1.4.9' },
      { exit_code: 0, raw: modernFixture.submission_response },
    ]);
  const out = await createPresetAdapter({
    run: m.run,
    infoProvider: async () => i.preset_snapshot.info,
  }).submit(i);
  assert.deepEqual(
    out.results.map((r) => [r.id, r.kind]),
    [
      ['111', 'video'],
      ['112', 'image'],
    ],
  );
  assert(!m.calls[1].args.includes('--idempotency-key'));
  assert(!m.calls[1].args.includes('--count'));
  assert.deepEqual(
    m.calls[1].args.slice(
      m.calls[1].args.indexOf('--image') + 1,
      m.calls[1].args.indexOf('--no-wait'),
    ),
    ['', '/local/required.png'],
  );
  assert(out.results.every((r) => r.cost_credits === undefined));
});
test('partial ordered result retains all valid IDs and an unknown-type ID without automatic retry', async () => {
  const i = modernIntent(),
    raw = structuredClone(modernFixture.partial_response);
  raw.response.outputs.push({ media_id: 113, media_type: 'unverified' });
  const m = mocked([
    { exit_code: 0, stdout: '1.4.9' },
    { exit_code: 1, raw },
  ]);
  const out = await createPresetAdapter({
    run: m.run,
    infoProvider: async () => i.preset_snapshot.info,
  }).submit(i);
  assert.deepEqual(
    out.results.map((r) => [r.id, r.kind]),
    [
      ['111', 'video'],
      ['113', 'unknown'],
    ],
  );
  assert(out.error);
  assert.equal(m.calls.length, 2);
});
test('ordered schema and fixed cost drift reject before submission', async () => {
  const i = modernIntent(),
    m = mocked([{ exit_code: 0, stdout: '1.4.9' }]);
  await assert.rejects(
    () =>
      createPresetAdapter({
        run: m.run,
        infoProvider: async () => ({ ...i.preset_snapshot.info, fixed_cost: 221 }),
      }).submit(i),
    /changed after approval/,
  );
  assert.equal(m.calls.length, 1);
});
test('ordered mixed outputs survive DB restart and failed download; resume/download use stored kinds with one submission', async () => {
  const i = modernIntent(),
    dir = mkdtempSync(join(tmpdir(), 'ordered-ledger-')),
    db = join(dir, 'db.sqlite'),
    calls = [];
  let failDownload = true;
  const adapter = createPresetAdapter({
    infoProvider: async () => i.preset_snapshot.info,
    run: async (args) => {
      calls.push(args);
      if (args[0] === '--version') return { exit_code: 0, stdout: '1.4.9' };
      if (args[0] === 'create') return { exit_code: 0, raw: modernFixture.submission_response };
      if (args[0] === 'task') return { exit_code: 0, raw: { status: 'completed' } };
      if (args[0] === 'asset') {
        if (failDownload) {
          failDownload = false;
          throw new Error('local storage unavailable');
        }
        const f = join(dir, args[2] + '.fixture');
        writeFileSync(f, 'local synthetic bytes');
        return { exit_code: 0, raw: { file: f } };
      }
      throw new Error('Unexpected command ' + args.join(' '));
    },
  });
  const plan = {
    id: 'ordered-plan',
    project_id: i.project_id,
    intents: [i],
    blocked: [],
    generation_permitted: true,
    total_upper_credits: 220,
    policy: { max_credits: 220, max_attempts: 1 },
  };
  let s = new Store(db),
    e = new Executor(s, { preset: adapter });
  const approval = s.approve(plan, 'fixture reviewer');
  await e.run(plan, { approval: approval.id });
  s.close();
  s = new Store(db);
  e = new Executor(s, { preset: adapter });
  await e.run(plan, { approval: approval.id });
  await e.resume(i.id);
  assert.deepEqual(
    s.results(i.id).map((r) => [r.id, r.kind, r.status]),
    [
      ['111', 'video', 'completed'],
      ['112', 'image', 'completed'],
    ],
  );
  await assert.rejects(() => e.download(i.id, '112', dir), /storage unavailable/);
  await e.run(plan, { approval: approval.id });
  await e.download(i.id, '112', dir);
  await e.download(i.id, '111', dir);
  assert.equal(calls.filter((a) => a[0] === 'create').length, 1);
  assert.deepEqual(
    calls.filter((a) => a[0] === 'task').map((a) => [a[2], a[a.indexOf('--type') + 1]]),
    [
      ['111', 'video'],
      ['112', 'image'],
    ],
  );
  assert.deepEqual(
    calls.filter((a) => a[0] === 'asset').map((a) => [a[2], a[a.indexOf('--type') + 1]]),
    [
      ['112', 'image'],
      ['112', 'image'],
      ['111', 'video'],
    ],
  );
  assert.equal(s.costReport(i.project_id).actual_credits, null);
  assert.equal(s.exposure(i.project_id), 220);
  s.close();
});

test('ordered unknown fixed metadata cannot be filled by conflicting local analysis', () => {
  const i = modernIntent(),
    snap = i.preset_snapshot;
  snap.info.output = [{ type: 'video' }];
  snap.analysis = {
    evidence: { source: 'fixture attestation', info_sha256: presetSnapshotHash(snap.info) },
    output: { fixed_duration_ms: 1000, aspects: ['1:1'] },
  };
  const p = planPresetCandidates({
    requirements: { duration_ms: 1000, aspects: ['1:1'] },
    templates: [snap],
  });
  assert.equal(p.candidates[0].output.fixed_duration_ms, null);
  assert.equal(p.candidates[0].output.aspects, null);
  assert(p.candidates[0].unknown.includes('duration_ms'));
  assert(p.candidates[0].unknown.includes('aspects'));
});
