import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, Executor } from '../src/store.mjs';
import { planProduction, voiceKey, impactAnalysis } from '../src/planner.mjs';
import { validateProduction } from '../src/contracts.mjs';
import {
  registerEntity,
  resolveEntity,
  characterBundle,
  audioRoute,
  performanceReview,
} from '../src/character.mjs';
import {
  reviewTake,
  registerLocalTake,
  reviewDelivery,
  markStale,
  downloadSelectedTake,
} from '../src/review.mjs';
import { syncCanvas } from '../src/sync.mjs';
import { fileHash } from '../src/contracts.mjs';
export function project() {
  return {
    schema_version: 'production.v1',
    project_id: 'station',
    revision: 1,
    context: { region: 'global', workspace_id: '0' },
    brief: {
      original: 'Cat finds friend at station',
      intent: 'Relief',
      assumptions: [],
      deliveries: [{ id: 'ja-wide', locale: 'ja', aspect: '16:9', duration_ms: 6000 }],
    },
    entities: [],
    assets: [],
    shots: [
      {
        shot_id: 'wait',
        purpose: 'Anticipation',
        prompt: 'Cat waits',
        edit_duration_ms: 2000,
        entry_state: { gaze: 'platform' },
        exit_state: { gaze: 'left' },
        camera: 'wide',
        audio: { intent: 'silent' },
        references: [],
        generation_strategy: 'editable_shot',
        generation: {
          backend: 'create',
          mode: 'video',
          model: 'v6',
          parameters: { duration: 2, audio: false },
          upper_credits: 10,
          price_evidence: { surface: 'cli', source: 'test fixture' },
          capability_snapshot: { fixture: true },
        },
      },
      {
        shot_id: 'smile',
        purpose: 'Relief',
        prompt: 'Cat smiles',
        edit_duration_ms: 4000,
        entry_state: { gaze: 'left' },
        exit_state: { emotion: 'relieved' },
        camera: 'close',
        audio: { intent: 'silent' },
        references: [],
        generation_strategy: 'single_take',
        generation: {
          backend: 'create',
          mode: 'video',
          model: 'v6',
          parameters: { duration: 4, audio: false },
          upper_credits: 10,
          price_evidence: { surface: 'cli', source: 'test fixture' },
          capability_snapshot: { fixture: true },
        },
      },
    ],
    execution_policy: { allowed_scope: 'generation', max_credits: 20, max_attempts: 2 },
    timeline: { fps: 30, clips: [], audio: [], captions: [] },
  };
}
function session(p = project()) {
  const store = new Store(':memory:'),
    plan = planProduction(p),
    approval = store.approve(plan, 'fixture-human');
  return { store, plan, approval };
}
test('natural brief plan preserves explicit OFF and totals; dry run makes zero calls', async () => {
  const { store, plan } = session();
  assert.equal(plan.intents[0].parameters.multi_shot, false);
  assert.equal(plan.intents[0].parameters.audio, false);
  let calls = 0;
  const e = new Executor(store, {
    create: {
      submit() {
        calls++;
      },
    },
  });
  assert.equal((await e.run(plan, { dryRun: true })).provider_calls, 0);
  assert.equal(calls, 0);
  store.close();
});
test('known IDs persist before status; repeated run/resume never resubmit', async () => {
  const { store, plan, approval } = session();
  let calls = 0;
  const adapter = {
    async submit() {
      calls++;
      return { results: [{ id: String(calls), kind: 'video', status: 'submitted' }] };
    },
    async status(i, id) {
      return { results: [{ id, kind: 'video', status: 'completed', cost_credits: 4 }] };
    },
  };
  const e = new Executor(store, { create: adapter });
  await e.run(plan, { approval: approval.id });
  await e.run(plan, { approval: approval.id });
  assert.equal(calls, 2);
  for (const i of plan.intents) await e.resume(i.id);
  assert.equal(calls, 2);
  assert.equal(store.exposure('station'), 8);
  assert.equal(store.takes('station').length, 2);
  store.close();
});
test('crash after durable submitting is blocked after reopening DB', async () => {
  const root = mkdtempSync(join(tmpdir(), 'production-crash-')),
    path = join(root, 'db.sqlite');
  let s = new Store(path);
  const plan = planProduction(project()),
    a = s.approve(plan, 'human');
  s.claim(plan.intents[0], plan, a.id);
  s.close();
  s = new Store(path);
  let calls = 0;
  const e = new Executor(s, {
    create: {
      submit() {
        calls++;
        return { results: [] };
      },
    },
  });
  await assert.rejects(e.resume(plan.intents[0].id), /unknown_submission/);
  await e.run({ ...plan, intents: [plan.intents[0]] }, { approval: a.id });
  assert.equal(calls, 0);
  s.close();
});
test('ambiguous voice response blocks automatic retry; trace ID never treated as idempotency', async () => {
  const p = project();
  p.shots[0].generation.mode = 'voice';
  const { store, plan, approval } = session(p);
  let calls = 0;
  const e = new Executor(store, {
    create: {
      async submit() {
        calls++;
        throw new Error('connection lost after submission');
      },
    },
  });
  await e.run(plan, { approval: approval.id });
  await e.run(plan, { approval: approval.id });
  assert.equal(calls, 2);
  assert.equal(store.job(plan.intents[0].id).state, 'unknown_submission');
  await assert.rejects(e.resume(plan.intents[0].id), /reconcile/);
  store.close();
});
test('nonzero partial results preserve every ID and hold unknown spend', async () => {
  const { store, plan, approval } = session();
  store.claim(plan.intents[0], plan, approval.id);
  store.record(plan.intents[0], {
    exit_code: 5,
    raw: { fail_count: 1 },
    results: [
      { id: '11', kind: 'video', status: 'completed', cost_credits: 3 },
      { id: '12', kind: 'video', status: 'submitted' },
    ],
  });
  store.record(plan.intents[0], {
    results: [{ id: '12', kind: 'video', status: 'completed', cost_credits: 3 }],
  });
  assert.equal(store.results(plan.intents[0].id).length, 2);
  assert.equal(store.takes('station').length, 2);
  assert.equal(store.job(plan.intents[0].id).reserved, 10);
  store.close();
});
test('download ENOSPC preserves provider completion and does not generate', async () => {
  const { store, plan, approval } = session();
  let calls = 0,
    downloads = 0;
  const e = new Executor(store, {
    create: {
      async submit(i) {
        calls++;
        return { results: [{ id: i.shot_id, kind: 'video', status: 'completed' }] };
      },
      async download() {
        downloads++;
        throw new Error('ENOSPC');
      },
    },
  });
  await e.run(plan, { approval: approval.id });
  await assert.rejects(e.download(plan.intents[0].id, 'wait', '/fixture'), /ENOSPC/);
  await e.run(plan, { approval: approval.id });
  assert.equal(calls, 2);
  assert.equal(downloads, 1);
  assert.equal(store.results(plan.intents[0].id)[0].status, 'completed');
  store.close();
});
test('competing SQLite connections cannot double reserve one approval budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'production-budget-')),
    path = join(root, 'db');
  const a = new Store(path),
    b = new Store(path),
    p = project();
  p.execution_policy.max_credits = 10;
  const plan = planProduction(p),
    single = { ...plan, total_upper_credits: 10 };
  const approval = a.approve(single, 'human');
  a.claim(plan.intents[0], plan, approval.id);
  assert.throws(() => b.claim(plan.intents[1], plan, approval.id), /budget/);
  assert.equal(b.exposure('station'), 10);
  a.close();
  b.close();
});
test('unknown price and planning_only are never approved', () => {
  const p = project();
  p.shots[0].generation.upper_credits = null;
  let plan = planProduction(p);
  const s = new Store(':memory:');
  assert.throws(() => s.approve(plan, 'human'), /unresolved/);
  p.shots[0].generation.upper_credits = 10;
  p.execution_policy.allowed_scope = 'planning_only';
  plan = planProduction(p);
  assert.throws(() => s.approve(plan, 'human'), /unresolved/);
  s.close();
});
test('changed prompt model aspect reference content and intentional attempt create new identity', () => {
  const p = project(),
    original = planProduction(p);
  for (const field of ['prompt', 'model', 'attempt']) {
    const q = structuredClone(p);
    if (field === 'prompt') q.shots[0].prompt += '!';
    else q.shots[0].generation[field] = field === 'attempt' ? 2 : 'other';
    assert.notEqual(planProduction(q).intents[0].id, original.intents[0].id);
  }
  const q = structuredClone(p);
  q.shots[0].generation.parameters.aspect_ratio = '9:16';
  assert.notEqual(planProduction(q).intents[0].id, original.intents[0].id);
  assert.equal(planProduction(q).intents[1].id, original.intents[1].id);
});
test('reference hashes are checked and region/workspace mismatch fails closed', () => {
  const p = project(),
    root = mkdtempSync(join(tmpdir(), 'production-ref-')),
    path = join(root, 'ref');
  writeFileSync(path, 'one');
  p.assets = [
    { id: 'cat', kind: 'image', path, region: 'global', workspace_id: '0', provenance: 'fixture' },
  ];
  p.shots[0].references = [{ asset: 'cat', role: 'identity', order: 0 }];
  const a = planProduction(p).intents[0].id;
  writeFileSync(path, 'two');
  assert.notEqual(planProduction(p).intents[0].id, a);
  p.assets[0].workspace_id = 'other';
  assert.throws(() => planProduction(p), /context mismatch/);
});
test('approval is exact-plan bound and fails after content edit', () => {
  const { store, plan, approval } = session();
  const p = project();
  p.shots[0].prompt = 'Changed';
  const next = planProduction(p);
  assert.throws(() => store.claim(next.intents[0], next, approval.id), /exact plan/);
  store.close();
});
test('missing file/completed/unreviewed or failed QA cannot be accepted', () => {
  const s = new Store(':memory:');
  s.putTake({ id: 'a', status: 'completed' });
  assert.throws(() => reviewTake(s, 'a', {}, { accept: true }), /download/);
  const root = mkdtempSync(join(tmpdir(), 'production-review-')),
    path = join(root, 'clip');
  writeFileSync(path, 'fixture');
  s.putTake({ id: 'a', status: 'downloaded', path, stale: false });
  const qa = {
    technical: 'pass',
    creative: 'fail',
    continuity: 'pass',
    audio: 'not_applicable',
    reviewer: 'human',
    notes: 'wrong face',
  };
  assert.throws(() => reviewTake(s, 'a', qa, { accept: true }), /quality gate/);
  qa.creative = 'pass';
  assert.equal(reviewTake(s, 'a', qa, { accept: true }).status, 'accepted');
  assert.equal(s.history('a')[0].kind, 'accepted');
  s.close();
});
test('entity/voice/wardrobe revisions frozen across works and ambiguous names fail', () => {
  const s = new Store(':memory:'),
    context = { region: 'global', workspace_id: '0' },
    base = { revision: 1, status: 'accepted', reviewer: 'human', context, references: [] };
  registerEntity(s, {
    ...base,
    id: 'voice',
    kind: 'voice',
    name: 'Gentle',
    settings: { preset: 'fixture' },
  });
  registerEntity(s, {
    ...base,
    id: 'coat',
    kind: 'wardrobe',
    name: 'Coat',
    fields: { season: 'summer' },
  });
  registerEntity(s, {
    ...base,
    id: 'cat',
    kind: 'character',
    name: 'Cat',
    links: [
      { id: 'voice', revision: 1 },
      { id: 'coat', revision: 1 },
    ],
  });
  const old = characterBundle(s, [{ id: 'cat', revision: 1 }]);
  registerEntity(s, {
    ...base,
    revision: 2,
    id: 'coat',
    kind: 'wardrobe',
    name: 'Coat',
    fields: { season: 'winter' },
  });
  assert.equal(characterBundle(s, [{ id: 'cat', revision: 1 }]).id, old.id);
  assert.equal(resolveEntity(s, 'coat', 1).fields.season, 'summer');
  assert.throws(
    () => registerEntity(s, { ...base, id: 'cat', kind: 'character', name: 'Changed' }),
    /immutable/,
  );
  registerEntity(s, { ...base, id: 'second-cat', kind: 'character', name: 'Cat' });
  assert.throws(() => resolveEntity(s, 'CAT'), /ambiguous/);
  s.close();
});
test('same voice shares across aspects but new reading/performance has new key', () => {
  const base = {
    text: 'Hello',
    locale: 'en',
    voice_revision: 2,
    performance: 'calm',
    context: { region: 'global', workspace_id: '0' },
    model: 'voice',
  };
  assert.equal(voiceKey({ ...base, aspect: '16:9' }), voiceKey({ ...base, aspect: '9:16' }));
  assert.notEqual(voiceKey(base), voiceKey({ ...base, text: 'Hello there' }));
});
test('planner deduplicates identical voice jobs across aspect owners and separates corrected readings', () => {
  const p = project();
  for (const s of p.shots) {
    s.generation.mode = 'voice';
    s.generation.parameters = { text: 'Same narration', voice_id: 'fixture' };
    s.locale = 'en';
    s.voice_revision = 2;
  }
  let plan = planProduction(p);
  assert.equal(plan.intents.length, 1);
  assert.equal(plan.total_upper_credits, 10);
  assert.deepEqual(plan.intents[0].owners, ['wait', 'smile']);
  p.shots[1].generation.parameters.text = 'Corrected pronunciation';
  plan = planProduction(p);
  assert.equal(plan.intents.length, 2);
});
test('exact visible dialogue with TTS alone stays unsupported; two people each reviewed', () => {
  assert.equal(
    audioRoute(
      { intent: 'dialogue', same_voice: true, strict_dialogue: true, visible_mouth: true },
      { tts: true },
    ).supported,
    false,
  );
  const bundle = {
    entities: [
      { id: 'a', kind: 'character' },
      { id: 'b', kind: 'character' },
    ],
  };
  assert.equal(
    performanceReview(bundle, [
      { entity_id: 'a', face: 'pass', wardrobe: 'pass', voice: 'pass', position: 'pass' },
    ]).accepted,
    false,
  );
});
test('impact graph marks affected derivatives without authorizing regeneration', () => {
  const p = project();
  p.dependencies = [
    { id: 'edit-ja', depends_on: ['smile'] },
    { id: 'delivery', depends_on: ['edit-ja'] },
  ];
  const impact = impactAnalysis(p, ['smile']);
  assert.deepEqual(impact.shots, ['smile']);
  assert(impact.stale.includes('delivery'));
  assert.equal(impact.regeneration_authorized, false);
});
test('malformed units duplicated IDs and total mismatch are rejected', () => {
  const p = project();
  p.shots[0].edit_duration_ms = 2.5;
  p.shots[1].shot_id = 'wait';
  assert.equal(validateProduction(p).valid, false);
});
test('bounded identical-request retry inherits authorization only after a confirmed failure', () => {
  const p = project();
  p.shots = p.shots.slice(0, 1);
  p.brief.deliveries[0].duration_ms = 2000;
  const { store, plan, approval } = session(p);
  store.claim(plan.intents[0], plan, approval.id);
  store.record(plan.intents[0], {
    results: [{ id: '123', kind: 'video', status: 'provider_failed', cost_credits: 0 }],
  });
  p.revision++;
  p.shots[0].generation.attempt = 2;
  const next = planProduction(p),
    continued = store.approveRetry(next, approval.id);
  assert.equal(continued.parent_approval_id, approval.id);
  assert.equal(store.claim(next.intents[0], next, continued.id).claimed, true);
  p.shots[0].generation.parameters.duration = 3;
  assert.throws(() => store.approveRetry(planProduction(p), approval.id), /changes/);
  store.close();
});
test('explicit API-only pricing cannot authorize CLI spending', () => {
  const p = project();
  p.shots[0].generation.price_evidence = { surface: 'api', source: 'API price' };
  assert.equal(planProduction(p).generation_permitted, false);
});
test('unaccepted reference and contradictory target controls block paid generation', () => {
  const p = project();
  p.assets = [
    {
      id: 'one',
      kind: 'image',
      provider_id: '10',
      region: 'global',
      workspace_id: '0',
      provenance: 'fixture',
    },
    {
      id: 'two',
      kind: 'image',
      provider_id: '11',
      region: 'global',
      workspace_id: '0',
      provenance: 'fixture',
      status: 'accepted',
    },
  ];
  p.shots[0].references = [
    { asset: 'one', role: 'appearance', order: 0, target: 'cat', controls: { coat: 'red' } },
    { asset: 'two', role: 'appearance', order: 1, target: 'cat', controls: { coat: 'blue' } },
  ];
  const plan = planProduction(p);
  assert(plan.blocked.some((b) => /acceptance/.test(b.reason)));
  assert(plan.blocked.some((b) => /conflicting/.test(b.reason)));
});
test('local media enters the same ledger without invented QA; final review rejects changed output bytes', () => {
  const s = new Store(':memory:'),
    root = mkdtempSync(join(tmpdir(), 'production-local-')),
    path = join(root, 'source');
  writeFileSync(path, 'local bytes');
  const take = registerLocalTake(s, {
    project_id: 'local',
    shot_id: 'intro',
    kind: 'video',
    path,
    context: { region: 'global', workspace_id: '0' },
    provenance: 'provided local fixture',
  });
  assert.equal(take.status, 'downloaded');
  assert.equal(take.qa, null);
  assert.equal(s.jobs('local').length, 0);
  const bundle = {
      deliveries: [
        {
          path,
          sha256: fileHash(path),
          technical_qc: { probe: 'pass', decode: 'pass' },
          creative_delivery_review: 'pending',
        },
      ],
    },
    qa = {
      reviewer: 'human',
      notes: 'viewed fixture',
      creative: 'pass',
      specification: 'pass',
      continuity: 'pass',
      audio: 'not_applicable',
      captions: 'not_applicable',
    };
  assert.equal(reviewDelivery(bundle, qa).deliveries[0].creative_delivery_review, 'accepted');
  assert.equal(bundle.deliveries[0].creative_delivery_review, 'pending');
  writeFileSync(path, 'changed bytes');
  assert.throws(() => reviewDelivery(bundle, qa), /changed/);
  s.close();
});

test('asset and entity edits propagate through shot to downstream dependency nodes', () => {
  const p = project();
  p.shots[0].references = [{ asset: 'face', role: 'identity', order: 0 }];
  p.dependencies = [
    { id: 'edit', depends_on: ['wait'] },
    { id: 'export', depends_on: ['edit'] },
  ];
  const impact = impactAnalysis(p, ['face']);
  assert(impact.stale.includes('wait'));
  assert(impact.stale.includes('export'));
  assert.equal(impact.regeneration_authorized, false);
  const store = new Store(':memory:');
  store.putTake({
    id: 'old',
    project_id: p.project_id,
    shot_id: 'wait',
    status: 'accepted',
    stale: false,
    provenance: { entity_revisions: [{ id: 'cat', revision: 1 }] },
  });
  assert.deepEqual(
    markStale(store, p.project_id, { entityIds: ['cat'] }, 'requested contract update').takes,
    ['old'],
  );
  assert.equal(store.take('old').stale, true);
  store.close();
});

test('Canvas human upstream selection invalidates mapped downstream takes without generation', () => {
  const p = project(),
    store = new Store(':memory:');
  store.saveDocument('production', p);
  store.putTake({
    id: 'downstream',
    project_id: p.project_id,
    shot_id: 'smile',
    status: 'accepted',
    stale: false,
  });
  const base = {
    project_id: '99',
    edit_version: 1,
    nodes: [
      { node_id: 'ref', node_type: 'image_generate', source: 'agent', history_id: '100' },
      {
        node_id: 'clip',
        node_type: 'video_generate',
        source: 'agent',
        history_id: '200',
        depends_on: ['ref'],
      },
    ],
    edges: [{ source: 'ref', target: 'clip' }],
  };
  const remote = structuredClone(base);
  remote.edit_version = 2;
  remote.nodes[0].history_id = '101';
  const result = syncCanvas(store, p, {
    base,
    local: base,
    remote,
    context: p.context,
    mappings: [
      { node_id: 'ref', shot_id: 'wait', kind: 'image' },
      { node_id: 'clip', shot_id: 'smile', kind: 'video' },
    ],
  });
  assert.equal(result.applied, true);
  assert.equal(store.take('downstream').stale, true);
  assert.equal(result.production.review_requirements[0].shot_id, 'smile');
  assert.equal(store.jobs(p.project_id).length, 0);
  store.close();
});

test('recorded Canvas selection downloads via default transport with injected bytes, not Create', async () => {
  const store = new Store(':memory:'),
    directory = mkdtempSync(join(tmpdir(), 'canvas-take-'));
  const calls = [];
  store.putTake({
    id: 'selected',
    project_id: 'station',
    shot_id: 'wait',
    kind: 'image',
    status: 'completed',
    stale: false,
    qa: null,
    provenance: {
      backend: 'canvas',
      project_id: '999999999999999999999',
      node_id: 'reference',
      history_id: '888888888888888888888',
      context: { region: 'global', workspace_id: '0' },
    },
  });
  const run = async (args) => {
    calls.push(args);
    return {
      exit_code: 0,
      raw: {
        node: {
          node_id: 'reference',
          derived_state: 'SUCCEEDED',
          history_id: '888888888888888888888',
          file_path: 'https://example.test/reference.ppm',
        },
      },
    };
  };
  const bytes = 'P3\n2 2\n255\n255 0 0 0 255 0 0 0 255 255 255 0\n';
  let transfers = 0;
  const result = await downloadSelectedTake(store, 'selected', directory, {
    run,
    downloadOptions: {
      reserveBytes: 0,
      fetchImpl: async () => {
        transfers++;
        return new Response(bytes, {
          status: 200,
          headers: {
            'content-type': 'image/x-portable-pixmap',
            'content-length': String(Buffer.byteLength(bytes)),
          },
        });
      },
    },
  });
  assert.equal(result.status, 'downloaded');
  assert.equal(result.sha256, fileHash(result.path));
  assert.equal(result.qa, null);
  assert.equal(calls.length, 2);
  assert(calls.every((args) => args[0] === 'canvas' && args.includes('get')));
  await downloadSelectedTake(store, 'selected', directory, { run });
  assert.equal(transfers, 1);
  assert.equal(store.jobs('station').length, 0);
  store.close();
});
