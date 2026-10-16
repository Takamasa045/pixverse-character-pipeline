import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, Executor } from '../src/store.mjs';
import { createPixVerseAdapter } from '../src/pixverse.mjs';
import { createCanvasAdapter } from '../src/canvas.mjs';
import { createPresetAdapter } from '../src/presets.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const video = fixture('create-video-v6');
const canvasCaps = fixture('canvas-seedance25');
const context = { region: 'global', workspace_id: '0' };
const createIntent = () => ({
  id: 'create-intent',
  project_id: 'boundary',
  shot_id: 'shot',
  attempt: 1,
  backend: 'create',
  mode: 'video',
  model: 'v6',
  parameters: { prompt: 'Cat waits', duration: 5 },
  inputs: [],
  context,
  upper_credits: 10,
  capability_snapshot: video,
});
const canvasIntent = () => ({
  ...createIntent(),
  id: 'canvas-intent',
  backend: 'canvas',
  model: 'seedance-2.5',
  parameters: {},
  canvas: {
    project_id: '12345',
    node_id: 'video_1',
    baseline_history_id: null,
    capability_snapshot: canvasCaps,
    patch: {
      schema_version: 'canvas_agent_graph.v1',
      base_edit_version: 2,
      nodes: [
        {
          node_id: 'video_1',
          node_type: 'video_generate',
          model: 'seedance-2.5',
          payload: { gen_type: 'text_to_video', prompt: 'Cat waits', duration: 4 },
        },
      ],
    },
  },
});
const presetIntent = () => ({
  ...createIntent(),
  id: 'preset-intent',
  backend: 'preset',
  mode: 'template',
  model: null,
  preset_id: '12345',
  output_kind: 'image',
  parameters: {},
  inputs: [{ kind: 'image', path: '/fixture/image.png', ...context }],
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
});
function session(intent, path = ':memory:') {
  const store = new Store(path);
  const plan = {
    id: 'approved-plan',
    project_id: intent.project_id,
    generation_permitted: true,
    blocked: [],
    total_upper_credits: 10,
    policy: { max_credits: 10, max_attempts: 1 },
    intents: [intent],
  };
  return { store, plan, approval: store.approve(plan, 'fixture-human').id };
}
function unclaimed(s, intent) {
  assert.equal(s.store.job(intent.id), null);
  assert.equal(s.store.exposure(intent.project_id), 0);
  assert.equal(s.store.history(intent.id).at(-1).kind, 'preflight_failed');
}

test('Create live drift fails before claim; same approved attempt can recover and submits once', async () => {
  const intent = createIntent(),
    s = session(intent);
  let changed = true,
    creates = 0;
  const adapter = createPixVerseAdapter({
    capabilities: async () => {
      const current = structuredClone(video);
      if (changed) current.capability.models.v6.parameters.audio.default = false;
      return current;
    },
    run: async () => {
      creates++;
      return { exit_code: 0, raw: { video_id: 111 } };
    },
  });
  const executor = new Executor(s.store, { create: adapter });
  await assert.rejects(executor.run(s.plan, { approval: s.approval }), /changed after approval/);
  unclaimed(s, intent);
  assert.equal(creates, 0);
  changed = false;
  await executor.run(s.plan, { approval: s.approval });
  assert.equal(creates, 1);
  assert.equal(s.store.job(intent.id).state, 'submitted');
  await executor.run(s.plan, { approval: s.approval });
  assert.equal(creates, 1);
  s.store.close();
});

test('Preset CLI version and schema reads fail before claim and never consume paid attempts', async () => {
  const intent = presetIntent(),
    s = session(intent);
  let version = '1.4.9',
    drift = false,
    creates = 0;
  const adapter = createPresetAdapter({
    infoProvider: async () => ({
      ...intent.preset_snapshot.info,
      ...(drift ? { duration: 9 } : {}),
    }),
    run: async (args) =>
      args[0] === '--version'
        ? { exit_code: 0, stdout: version }
        : (creates++, { exit_code: 0, raw: { image_id: 112 } }),
  });
  const executor = new Executor(s.store, { preset: adapter });
  await assert.rejects(executor.run(s.plan, { approval: s.approval }), /CLI differs/);
  unclaimed(s, intent);
  assert.equal(creates, 0);
  version = '1.4.8';
  drift = true;
  await assert.rejects(executor.run(s.plan, { approval: s.approval }), /info changed/);
  unclaimed(s, intent);
  drift = false;
  await executor.run(s.plan, { approval: s.approval });
  assert.equal(creates, 1);
  s.store.close();
});

test('Canvas rejected read-only dry-run reserves nothing; recovery only applies once', async () => {
  const intent = canvasIntent(),
    s = session(intent);
  let valid = false,
    applies = 0,
    dispatches = 0;
  const adapter = createCanvasAdapter({
    capabilities: canvasCaps,
    run: async (args) => {
      if (args.includes('dry-run')) return { exit_code: 0, raw: { ErrCode: 0, Resp: { valid } } };
      if (args.includes('apply')) {
        applies++;
        return {
          exit_code: 0,
          raw: {
            ErrCode: 0,
            Resp: {
              valid: true,
              applied: true,
              edit_version: 3,
              diff: { executable_node_ids: ['video_1'] },
            },
          },
        };
      }
      dispatches++;
      return { exit_code: 0, raw: { ErrCode: 0, Resp: { dispatch_status: 'dispatched' } } };
    },
  });
  const executor = new Executor(s.store, { canvas: adapter });
  await assert.rejects(executor.run(s.plan, { approval: s.approval }), /dry-run rejected/);
  unclaimed(s, intent);
  assert.equal(applies, 0);
  assert.equal(dispatches, 0);
  valid = true;
  await executor.run(s.plan, { approval: s.approval });
  await executor.run(s.plan, { approval: s.approval });
  assert.equal(applies, 1);
  assert.equal(dispatches, 1);
  s.store.close();
});

test('Create mutation throw remains unknown across reopen and skips all later preflight', async () => {
  const intent = createIntent(),
    path = join(mkdtempSync(join(tmpdir(), 'submission-boundary-')), 'state.sqlite');
  const s = session(intent, path);
  let creates = 0,
    reads = 0;
  const adapter = createPixVerseAdapter({
    capabilities: async () => {
      reads++;
      return video;
    },
    run: async () => {
      creates++;
      throw new Error('timeout after send');
    },
  });
  await new Executor(s.store, { create: adapter }).run(s.plan, { approval: s.approval });
  assert.equal(s.store.job(intent.id).state, 'unknown_submission');
  assert.equal(s.store.exposure(intent.project_id), 10);
  s.store.close();
  const store = new Store(path);
  const rerun = new Executor(store, {
    create: {
      validate() {
        throw new Error('must not preflight');
      },
      prepare() {
        throw new Error('must not query');
      },
      submit() {
        throw new Error('must not resend');
      },
    },
  });
  const report = await rerun.run(s.plan, { approval: s.approval });
  assert.equal(report.jobs[0].reused, true);
  assert.equal(creates, 1);
  assert.equal(reads, 1);
  store.close();
});

test('Canvas apply throw or unconfirmed response retains reservation and never reapplies', async () => {
  for (const throws of [true, false]) {
    const intent = canvasIntent(),
      s = session(intent);
    let applies = 0;
    const adapter = createCanvasAdapter({
      capabilities: canvasCaps,
      run: async (args) => {
        if (args.includes('dry-run'))
          return { exit_code: 0, raw: { ErrCode: 0, Resp: { valid: true } } };
        applies++;
        if (throws) throw new Error('apply timeout');
        return { exit_code: 2, raw: { error: 'apply result lost' } };
      },
    });
    const executor = new Executor(s.store, { canvas: adapter });
    await executor.run(s.plan, { approval: s.approval });
    assert.equal(s.store.exposure(intent.project_id), 10);
    assert(
      throws
        ? s.store.job(intent.id).state === 'unknown_submission'
        : s.store.job(intent.id).unresolved_submission,
    );
    await executor.run(s.plan, { approval: s.approval });
    assert.equal(applies, 1);
    s.store.close();
  }
});

test('partial IDs survive the submission boundary and remain blocked for auto retry', async () => {
  const intent = createIntent(),
    s = session(intent);
  let creates = 0;
  const adapter = createPixVerseAdapter({
    capabilities: video,
    run: async () => (
      creates++,
      { exit_code: 5, raw: { video_ids: [111, 112], failed_ids: [112], fail_count: 1 } }
    ),
  });
  const executor = new Executor(s.store, { create: adapter });
  await executor.run(s.plan, { approval: s.approval });
  await executor.run(s.plan, { approval: s.approval });
  assert.deepEqual(
    s.store
      .results(intent.id)
      .map((r) => r.id)
      .sort(),
    ['111', '112'],
  );
  assert.equal(s.store.job(intent.id).unresolved_submission, true);
  assert.equal(s.store.exposure(intent.project_id), 10);
  assert.equal(creates, 1);
  s.store.close();
});

test('concurrent read-only preparations still have one transactional paid claim', async () => {
  const intent = createIntent(),
    s = session(intent);
  let reads = 0,
    creates = 0,
    release;
  const bothReady = new Promise((resolve) => {
    release = resolve;
  });
  const adapter = createPixVerseAdapter({
    capabilities: async () => {
      if (++reads === 2) release();
      await bothReady;
      return video;
    },
    run: async () => (creates++, { exit_code: 0, raw: { video_id: 111 } }),
  });
  const executor = new Executor(s.store, { create: adapter });
  await Promise.all([
    executor.run(s.plan, { approval: s.approval }),
    executor.run(s.plan, { approval: s.approval }),
  ]);
  assert.equal(reads, 2);
  assert.equal(creates, 1);
  assert.equal(s.store.jobs(intent.project_id).length, 1);
  s.store.close();
});

test('untyped adapter errors after claim remain unknown rather than falsely safe', async () => {
  const intent = createIntent(),
    s = session(intent);
  await new Executor(s.store, {
    create: {
      submit() {
        throw new Error('generic error');
      },
    },
  }).run(s.plan, { approval: s.approval });
  assert.equal(s.store.job(intent.id).state, 'unknown_submission');
  assert.equal(s.store.exposure(intent.project_id), 10);
  s.store.close();
});

test('prepared command tokens bind the exact intent and are consumed once', async () => {
  const intent = createIntent();
  let creates = 0;
  const adapter = createPixVerseAdapter({
    capabilities: video,
    run: async () => (creates++, { exit_code: 0, raw: { video_id: 111 } }),
  });
  const token = await adapter.prepare(intent);
  intent.parameters.prompt += '!';
  await assert.rejects(adapter.submit(intent, token), /Exact prepared submission/);
  assert.equal(creates, 0);
  intent.parameters.prompt = 'Cat waits';
  await adapter.submit(intent, token);
  await assert.rejects(adapter.submit(intent, token), /Exact prepared submission/);
  assert.equal(creates, 1);
});
