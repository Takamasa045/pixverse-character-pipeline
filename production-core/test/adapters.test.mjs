import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeCreateCapability,
  resolveCreateInputs,
  validateCreateIntent,
  buildCreateCommand,
  normalizeCreateResult,
  createPixVerseAdapter,
  mediaId,
} from '../src/pixverse.mjs';
import {
  mergeCanvasGraph,
  validateCanvasPatch,
  prepareCanvasPatch,
  applyCanvasPatch,
  dispatchCanvasPatch,
  createCanvasAdapter,
} from '../src/canvas.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const video = fixture('create-video-v6');
const reference = fixture('create-reference-v6');
const image = fixture('create-image-nano');
const voice = fixture('create-voice-minimax');
const canvasCaps = fixture('canvas-seedance25');
const seedReference = canvasCaps.nodes[0].routes.find(
  (r) => r.selector === 'reference_to_video',
).cli;
const context = { region: 'global', workspace_id: '0' };
const baseIntent = () => ({
  id: 'intent-001',
  backend: 'create',
  mode: 'video',
  model: 'v6',
  parameters: { prompt: 'A cat waits', duration: 5, audio: false, multi_shot: false },
  inputs: [],
  context,
});
const graph = (nodes, version = 1, edges = []) => ({
  project_id: '9999999999999999999999',
  edit_version: version,
  nodes,
  edges,
});
const agentNode = (node_id, extra = {}) => ({
  node_id,
  node_type: 'video_generate',
  source: 'agent',
  model: 'seedance-2.5',
  payload: { gen_type: 'text_to_video', prompt: 'A cat waits', duration: 4 },
  history_id: '1000',
  ...extra,
});
const canvasIntent = () => ({
  id: 'canvas-intent',
  backend: 'canvas',
  mode: 'video',
  model: 'seedance-2.5',
  parameters: {},
  inputs: [],
  context,
  canvas: {
    project_id: '9999999999999999999999',
    node_id: 'video_1',
    baseline_history_id: '1000',
    capability_snapshot: canvasCaps,
    patch: {
      schema_version: 'canvas_agent_graph.v1',
      base_edit_version: 2,
      nodes: [
        {
          node_id: 'video_1',
          node_type: 'video_generate',
          model: 'seedance-2.5',
          payload: { gen_type: 'text_to_video', prompt: 'A cat waits', duration: 4 },
        },
      ],
    },
  },
});
function mockRun(responses) {
  const calls = [];
  const run = async (args, options) => {
    calls.push({ args, options });
    if (!responses.length) throw new Error('Unexpected CLI call');
    return responses.shift();
  };
  return { run, calls };
}

test('normalizes selected installed model without a model table', () => {
  const normalized = normalizeCreateCapability(video, { mode: 'video', model: 'v6' });
  assert.equal(normalized.parameters.audio.default, true);
  assert.throws(
    () => normalizeCreateCapability(video, { mode: 'video', model: 'invented' }),
    /absent/,
  );
  assert.throws(() => normalizeCreateCapability(video, { mode: 'image', model: 'v6' }), /mismatch/);
});
test('explicit audio/multi-shot OFF survives default-on capabilities and CLI argv', () => {
  const intent = baseIntent();
  const { parameters } = validateCreateIntent(intent, video);
  assert.equal(parameters.audio, false);
  assert.equal(parameters.multi_shot, false);
  const args = buildCreateCommand(intent, video);
  assert(args.includes('--no-audio'));
  assert(args.includes('--no-multi-shot'));
  assert(args.includes('--no-wait'));
  assert(args.includes('--json'));
  assert.equal(args[args.indexOf('--idempotency-key') + 1], intent.id);
  assert.equal(args[args.indexOf('--workspace-id') + 1], '0');
});
test('parameters which CLI would adjust are rejected before approval', () => {
  assert.throws(
    () =>
      validateCreateIntent(
        { ...baseIntent(), parameters: { prompt: 'Cat', duration: 123 } },
        video,
      ),
    /Illegal duration/,
  );
  assert.throws(
    () =>
      validateCreateIntent(
        { ...baseIntent(), parameters: { prompt: 'Cat', unknown: true } },
        video,
      ),
    /Unknown/,
  );
  assert.throws(
    () =>
      validateCreateIntent(
        { ...baseIntent(), parameters: { prompt: 'Cat', audio: 'false' } },
        video,
      ),
    /boolean/,
  );
  assert.throws(
    () => validateCreateIntent({ ...baseIntent(), parameters: { prompt: 'Cat', count: 0 } }, video),
    /range/,
  );
});
test('capability and reference context mismatches fail closed', () => {
  const intent = {
    ...baseIntent(),
    inputs: [{ kind: 'image', provider_id: '101', region: 'cn', workspace_id: '0' }],
  };
  assert.throws(() => validateCreateIntent(intent, video), /region/);
  intent.inputs[0].region = 'global';
  intent.inputs[0].workspace_id = '88';
  assert.throws(() => validateCreateIntent(intent, video), /workspace/);
  intent.inputs[0].workspace_id = undefined;
  assert.throws(() => validateCreateIntent(intent, video), /context is unknown/);
});
test('ordered mixed refs preserve bindings, input identity and explicit OFF', () => {
  const intent = {
    ...baseIntent(),
    mode: 'reference',
    model: 'seedance-2.5',
    parameters: { prompt: 'Move slowly' },
    inputs: [
      { kind: 'image', provider_id: '102', ...context, binding: { order: 2 } },
      { kind: 'video', provider_id: '103', ...context, binding: { order: 1 } },
      { kind: 'image', provider_id: '101', ...context, binding: { order: 0 } },
      { kind: 'audio', provider_id: '104', ...context, binding: { order: 3 } },
    ],
  };
  const resolved = validateCreateIntent(intent, seedReference).parameters;
  assert.deepEqual(resolved.images, ['101', '102']);
  assert.deepEqual(resolved.videos, ['103']);
  assert.deepEqual(resolved.audios, ['104']);
  const again = resolveCreateInputs({ ...intent, parameters: resolved });
  assert.deepEqual(again, resolved);
  assert.throws(
    () => resolveCreateInputs({ ...intent, parameters: { images: ['different'] } }),
    /Conflicting/,
  );
});
test('single media resolution is idempotent after planner hashing', () => {
  const intent = { ...baseIntent(), inputs: [{ kind: 'image', path: '/cat.png' }] };
  const resolved = validateCreateIntent(intent, video).parameters;
  assert.deepEqual(resolveCreateInputs({ ...intent, parameters: resolved }), resolved);
});
test('unsupported mixed references and command fields are not silently dropped', () => {
  const intent = {
    ...baseIntent(),
    mode: 'reference',
    parameters: { prompt: 'Move', images: ['101'], audios: ['102'] },
  };
  assert.throws(() => validateCreateIntent(intent, reference), /Unsupported.*audios/);
  assert.throws(
    () =>
      validateCreateIntent(
        { ...intent, parameters: { prompt: 'Move', images: ['101'], task_type: 'edit' } },
        reference,
      ),
    /Unsupported.*task_type/,
  );
  assert.throws(
    () => validateCreateIntent({ ...intent, parameters: { prompt: 'Move' } }, reference),
    /reference is required/,
  );
  assert.throws(
    () =>
      validateCreateIntent(
        { ...baseIntent(), parameters: { prompt: 'Cat', image: 'http://example.com/cat.png' } },
        video,
      ),
    /HTTP/,
  );
});
test('executor owns output, waiting, request identity and JSON flags', () => {
  for (const key of ['wait', 'json', 'output', 'idempotency_key', 'client_request_id'])
    assert.throws(
      () =>
        validateCreateIntent({ ...baseIntent(), parameters: { prompt: 'Cat', [key]: 'x' } }, video),
      /executor-owned/,
    );
});
test('voice request IDs are tracing only, and voice reference is mandatory', () => {
  const intent = {
    ...baseIntent(),
    mode: 'voice',
    model: 'speech-2.8-hd',
    parameters: { text: 'Hello', voice_id: 'preset-1' },
  };
  const args = buildCreateCommand(intent, voice);
  assert(args.includes('--client-request-id'));
  assert(!args.includes('--idempotency-key'));
  assert.throws(
    () => validateCreateIntent({ ...intent, parameters: { text: 'Hello' } }, voice),
    /voice_id/,
  );
});
test('image capability has its own limits and output kind', () => {
  const intent = {
    ...baseIntent(),
    mode: 'image',
    model: 'gemini-nano-banana-2.1',
    parameters: { prompt: 'Cat', images: Array(15).fill('100') },
  };
  assert.throws(() => validateCreateIntent(intent, image), /Too many/);
});
test('nonzero partial output retains all submitted/success/failed IDs and unknown cost', () => {
  const output = normalizeCreateResult(
    {
      status: 'partial',
      video_ids: [111, 112, 113],
      items: [{ video_id: 111, status: 'completed', video_url: 'https://a', cost_credits: 10 }],
      failed_ids: [112],
    },
    'video',
    5,
  );
  assert.equal(output.exit_code, 5);
  assert.equal(output.results.length, 3);
  assert.equal(output.results.find((r) => r.id === '111').status, 'completed');
  assert.equal(output.results.find((r) => r.id === '112').status, 'provider_failed');
  assert.equal(output.results.find((r) => r.id === '113').status, 'submitted');
  assert(!('cost_credits' in output.results.find((r) => r.id === '113')));
});
test('single, batch status and unsafe media IDs use distinct contracts', () => {
  assert.equal(
    normalizeCreateResult({ image_id: 111, status: 'completed', image_url: 'https://a' }, 'image')
      .results[0].kind,
    'image',
  );
  const results = normalizeCreateResult(
    { 111: { status_code: 1 }, 112: { error: 'missing' } },
    'video',
  ).results;
  assert.deepEqual(
    results.map((r) => r.status),
    ['completed', 'provider_failed'],
  );
  assert.throws(() => mediaId(9007199254740992), /Unsafe/);
  assert.throws(() => mediaId('999999999999999999999999'), /safe integer/);
  const partial = normalizeCreateResult(
    { video_ids: [111, '999999999999999999999999'] },
    'video',
    5,
  );
  assert.equal(partial.results[0].id, '111');
  assert.equal(partial.issues.length, 1);
});
test('known-ID status and download never call create, including download failure', async () => {
  const mocked = mockRun([
    { exit_code: 0, raw: { id: 111, status_code: 1 } },
    { exit_code: 6, raw: { error: 'occupied target' } },
    { exit_code: 0, raw: { file: '/tmp/known.mp4' } },
  ]);
  const adapter = createPixVerseAdapter({ run: mocked.run, capabilities: video });
  assert.equal((await adapter.status(baseIntent(), '111')).results[0].status, 'completed');
  assert.equal((await adapter.download(baseIntent(), '111', '/tmp/dest')).exit_code, 6);
  assert.equal(
    (await adapter.download(baseIntent(), '111', '/tmp/fresh')).results[0].path,
    '/tmp/known.mp4',
  );
  assert(mocked.calls.every((c) => c.args[0] !== 'create'));
});
test('submit preserves partial IDs and executes create once', async () => {
  const mocked = mockRun([
    { exit_code: 5, raw: { status: 'partial', video_ids: [111, 112], failed_ids: [112] } },
  ]);
  const adapter = createPixVerseAdapter({ run: mocked.run, capabilities: video });
  assert.equal(
    adapter.validate({ ...baseIntent(), capability_snapshot: video }).parameters.audio,
    false,
  );
  const result = await adapter.submit(baseIntent());
  assert.equal(result.results.length, 2);
  assert.equal(mocked.calls.length, 1);
});

test('Canvas three-way merge retains human title/layout and imports a selected history', () => {
  const b = agentNode('video_1');
  const base = graph([b, agentNode('compose', { depends_on: ['video_1'] })]);
  const local = structuredClone(base);
  local.nodes[0].payload.prompt = 'Smile';
  const remote = structuredClone(base);
  remote.edit_version = 3;
  remote.nodes[0].title = 'Human choice';
  remote.nodes[0].history_id = '9999999999999999999998';
  remote.nodes[0].position = { x: 33, y: 44 };
  const result = mergeCanvasGraph({ base, local, remote, managedNodeIds: ['video_1'] });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.graph.nodes[0].title, 'Human choice');
  assert.equal(result.graph.nodes[0].payload.prompt, 'Smile');
  assert.equal(result.patch.base_edit_version, 3);
  assert.equal(result.adopted_versions[0].history_id, '9999999999999999999998');
  assert.equal(result.adopted_versions[0].requires_qa, true);
  assert.deepEqual(result.stale_node_ids, ['compose']);
});
test('Canvas same-field conflict preserves human current value and prohibits patch', () => {
  const base = graph([agentNode('v')]);
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.nodes[0].payload.prompt = 'Local';
  remote.nodes[0].payload.prompt = 'Human';
  const result = mergeCanvasGraph({ base, local, remote, managedNodeIds: ['v'] });
  assert(result.requires_resolution);
  assert.equal(result.patch, null);
  assert.equal(result.graph.nodes[0].payload.prompt, 'Human');
});
test('unmanaged nodes and dependency rewrites cannot be silently replaced', () => {
  const base = graph([
    agentNode('v'),
    { node_id: 'human', node_type: 'script', source_type: 'generate', artifact: { text: 'Human' } },
  ]);
  const local = structuredClone(base);
  local.nodes[1].artifact.text = 'Overwrite';
  let result = mergeCanvasGraph({ base, local, remote: base, managedNodeIds: ['v', 'human'] });
  assert(result.conflicts.some((c) => c.reason === 'unmanaged_node'));
  local.nodes[0].depends_on = ['human'];
  result = mergeCanvasGraph({ base, local, remote: base, managedNodeIds: ['v', 'human'] });
  assert(result.conflicts.some((c) => c.reason === 'dependency_recreation_required'));
});
test('deletion concurrent with human edits conflicts; soft-deleted IDs are not recreated', () => {
  const base = graph([agentNode('v')]),
    local = graph([]),
    remote = structuredClone(base);
  remote.nodes[0].title = 'Human';
  const result = mergeCanvasGraph({ base, local, remote, managedNodeIds: ['v'] });
  assert.equal(result.patch, null);
  assert.equal(result.graph.nodes[0].title, 'Human');
});
test('Canvas validates live mappings and rejects invented task_type', () => {
  const intent = canvasIntent();
  assert.equal(
    validateCanvasPatch(intent.canvas.patch, canvasCaps, {
      project_id: intent.canvas.project_id,
      context,
    }).nodes.length,
    1,
  );
  intent.canvas.patch.nodes[0].payload.task_type = 'edit';
  assert.throws(
    () =>
      validateCanvasPatch(intent.canvas.patch, canvasCaps, {
        project_id: intent.canvas.project_id,
        context,
      }),
    /Unmapped.*task_type/,
  );
  assert.throws(
    () =>
      validateCanvasPatch(
        canvasIntent().canvas.patch,
        { compatible: false, nodes: [] },
        { project_id: 'p', context },
      ),
    /Compatible live/,
  );
});
test('Canvas dry-run apply dispatch uses same exact patch and only target executable node', async () => {
  const intent = canvasIntent();
  const mocked = mockRun([
    { exit_code: 0, raw: { ErrCode: 0, Resp: { valid: true } } },
    {
      exit_code: 0,
      raw: {
        ErrCode: 0,
        Resp: {
          valid: true,
          applied: true,
          edit_version: 3,
          diff: { executable_node_ids: ['video_1', 'unrelated'], metadata_node_ids: ['script'] },
        },
      },
    },
    { exit_code: 0, raw: { ErrCode: 0, Resp: { dispatch_status: 'dispatched' } } },
  ]);
  const prepared = await prepareCanvasPatch(intent, { run: mocked.run, snapshot: canvasCaps });
  const applied = await applyCanvasPatch(intent, prepared, { run: mocked.run });
  await dispatchCanvasPatch(intent, applied, { run: mocked.run });
  assert.equal(
    mocked.calls[0].args[mocked.calls[0].args.indexOf('--patch') + 1],
    mocked.calls[1].args[mocked.calls[1].args.indexOf('--patch') + 1],
  );
  assert.equal(
    mocked.calls[0].args[mocked.calls[0].args.indexOf('--idempotency-key') + 1],
    mocked.calls[1].args[mocked.calls[1].args.indexOf('--idempotency-key') + 1],
  );
  const dispatched = mocked.calls[2].args;
  assert.equal(dispatched[dispatched.indexOf('--node-ids') + 1], 'video_1');
  assert.equal(dispatched[dispatched.indexOf('--edit-version') + 1], '3');
});
test('Canvas apply rejects tampering and invalid dry-run never mutates', async () => {
  const intent = canvasIntent();
  const mocked = mockRun([{ exit_code: 0, raw: { ErrCode: 0, Resp: { valid: false } } }]);
  const prepared = await prepareCanvasPatch(intent, { run: mocked.run, snapshot: canvasCaps });
  await assert.rejects(
    () => applyCanvasPatch(intent, prepared, { run: mocked.run }),
    /exact approved patch/,
  );
  assert.equal(mocked.calls.length, 1);
});
test('Canvas adapter never falls back to Create after apply failure', async () => {
  const intent = canvasIntent();
  const mocked = mockRun([
    { exit_code: 0, raw: { ErrCode: 0, Resp: { valid: true } } },
    { exit_code: 2, raw: { error: 'timeout' } },
  ]);
  const result = await createCanvasAdapter({ run: mocked.run, capabilities: canvasCaps }).submit(
    intent,
  );
  assert.equal(result.results[0].id, 'video_1');
  assert.equal(result.results[0].dispatch_unconfirmed, true);
  assert.equal(mocked.calls.length, 2);
  assert(mocked.calls.every((c) => c.args[0] === 'canvas'));
});
test('Canvas READY and old SUCCEEDED histories cannot satisfy a new intent', async () => {
  const intent = canvasIntent();
  const mocked = mockRun([
    {
      exit_code: 0,
      raw: {
        Resp: { nodes: [{ node_id: 'video_1', derived_state: 'READY', history_id: '1000' }] },
      },
    },
    {
      exit_code: 0,
      raw: {
        Resp: { nodes: [{ node_id: 'video_1', derived_state: 'SUCCEEDED', history_id: '1000' }] },
      },
    },
    {
      exit_code: 0,
      raw: {
        Resp: {
          nodes: [
            {
              node_id: 'video_1',
              derived_state: 'SUCCEEDED',
              history_id: '1001',
              file_path: 'https://trusted',
            },
          ],
        },
      },
    },
  ]);
  const adapter = createCanvasAdapter({ run: mocked.run });
  assert.equal((await adapter.status(intent, 'video_1')).results[0].status, 'running');
  assert.equal((await adapter.status(intent, 'video_1')).results[0].status, 'running');
  assert.equal((await adapter.status(intent, 'video_1')).results[0].status, 'completed');
  assert(mocked.calls.every((c) => !c.args.includes('dispatch')));
});
test('Canvas confirmation cannot be bypassed and metadata nodes cannot dispatch', async () => {
  const intent = canvasIntent();
  intent.canvas.patch.nodes[0].semantic = {
    dispatch_state: 'awaiting_confirmation',
    dispatch_plan_id: 'plan-1',
  };
  const applied = {
    applied: true,
    project_id: intent.canvas.project_id,
    node_id: 'video_1',
    patch: intent.canvas.patch,
    edit_version: 3,
    executable_node_ids: ['video_1'],
  };
  await assert.rejects(
    () =>
      dispatchCanvasPatch(intent, applied, { run: async () => assert.fail('Must not dispatch') }),
    /confirmation plan/,
  );
  applied.executable_node_ids = ['metadata'];
  await assert.rejects(() => dispatchCanvasPatch(intent, applied), /not in apply.diff/);
});
test('Canvas downloader explicitly reports unsupported transport and preserves node', async () => {
  const mocked = mockRun([
    {
      exit_code: 0,
      raw: {
        Resp: {
          node: {
            node_id: 'video_1',
            derived_state: 'SUCCEEDED',
            history_id: '1001',
            file_path: 'https://trusted',
          },
        },
      },
    },
  ]);
  const result = await createCanvasAdapter({ run: mocked.run }).download(
    canvasIntent(),
    'video_1',
    '/tmp/out',
  );
  assert.equal(result.exit_code, 6);
  assert.match(result.error, /not configured/);
  assert.equal(mocked.calls.length, 1);
});
test('Canvas dry-run requires explicit successful backend envelope', async () => {
  const mocked = mockRun([{ exit_code: 0, raw: { valid: true } }]);
  const prepared = await prepareCanvasPatch(canvasIntent(), {
    run: mocked.run,
    snapshot: canvasCaps,
  });
  assert.equal(prepared.valid, false);
  assert.equal(mocked.calls.length, 1);
});
test('local history changes use version apply, never Graph patch payload', () => {
  const base = graph([agentNode('v')]),
    local = structuredClone(base);
  local.nodes[0].history_id = '1001';
  const result = mergeCanvasGraph({ base, local, remote: base, managedNodeIds: ['v'] });
  assert.equal(result.patch, null);
  assert(result.conflicts.some((c) => c.reason === 'version_apply_required'));
});
test('Canvas version selection handles already-current no-op then refreshes graph without dispatch', async () => {
  const intent = canvasIntent();
  const mocked = mockRun([
    { exit_code: 0, raw: { Resp: { applied: false } } },
    { exit_code: 0, raw: { Resp: graph([agentNode('video_1')], 4) } },
  ]);
  const result = await createCanvasAdapter({ run: mocked.run }).selectVersion(intent, '1000');
  assert.equal(result.selected, true);
  assert.equal(result.applied, false);
  assert.equal(result.graph.edit_version, 4);
  assert(!mocked.calls[0].args.includes('--edit-version'));
  assert(mocked.calls.every((c) => !c.args.includes('dispatch')));
});
test('Canvas existing complete media downloads only through configured known-node transport', async () => {
  const mocked = mockRun([
    {
      exit_code: 0,
      raw: {
        Resp: {
          node: {
            node_id: 'video_1',
            derived_state: 'SUCCEEDED',
            history_id: '1001',
            file_path: 'https://trusted',
          },
        },
      },
    },
  ]);
  const seen = [];
  const adapter = createCanvasAdapter({
    run: mocked.run,
    downloadMedia: async (request) => {
      seen.push(request);
      return { path: '/tmp/canvas-known.mp4' };
    },
  });
  const result = await adapter.download(canvasIntent(), 'video_1', '/tmp/fresh');
  assert.equal(result.results[0].path, '/tmp/canvas-known.mp4');
  assert.equal(seen[0].file_path, 'https://trusted');
  assert.equal(mocked.calls.length, 1);
});
