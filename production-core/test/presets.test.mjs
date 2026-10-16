import test from 'node:test';
import assert from 'node:assert/strict';
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
test('template missing inputs, output override and modern schema are rejected rather than fabricated', () => {
  const intent = templateIntent();
  assert.throws(() => resolvePresetIntent({ ...intent, inputs: [] }), /one image/);
  assert.throws(
    () => resolvePresetIntent({ ...intent, parameters: { duration: 12 } }),
    /override is not verified/,
  );
  intent.preset_snapshot.cli_version = '1.4.9';
  assert.throws(() => resolvePresetIntent(intent), /versioned input\/output schema/);
  const plan = planPresetCandidates({ templates: [intent.preset_snapshot], cli_version: '1.4.9' });
  assert(plan.candidates[0].unknown.includes('versioned_ordered_input_output_contract'));
});
