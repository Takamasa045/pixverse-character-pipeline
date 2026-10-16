import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Store, Executor } from '../src/store.mjs';
import { planProduction } from '../src/planner.mjs';
import { syncCanvas } from '../src/sync.mjs';
import { buildCreateCommand } from '../src/pixverse.mjs';

// Independent operator-forward exercise. No real provider is invoked. Tiny raw
// local images are the only input media; artifacts remain in a temporary folder.
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const cap = JSON.parse(
  readFileSync(new URL('./fixtures/create-image-nano.json', import.meta.url), 'utf8'),
);
const context = { region: 'global', workspace_id: '0' };
const qa = {
  technical: 'pass',
  creative: 'pass',
  continuity: 'pass',
  audio: 'not_applicable',
  reviewer: 'forward-fixture-human',
  notes: 'Raw local fixture; does not demonstrate generated creative quality.',
};
const raw = (root, name = 'source.ppm') => {
  const p = join(root, name);
  writeFileSync(p, 'P3\n2 2\n255\n255 0 0 0 255 0 0 0 255 255 255 0\n');
  return p;
};
function fixture() {
  return {
    schema_version: 'production.v1',
    project_id: 'forward-station',
    revision: 1,
    context,
    brief: {
      original: '前回と同じキャラで駅の短編。4shot、まず計画、2番目だけ直す。',
      intent: '駅で不安から安心へ',
      assumptions: ['Fixture uses four accepted stills'],
      deliveries: [
        { id: 'ja-wide', locale: 'ja', aspect: '16:9', width: 160, height: 90, duration_ms: 4000 },
      ],
    },
    entities: [{ id: 'returning-cat', revision: 1 }],
    assets: [],
    shots: ['wait', 'search', 'find', 'meet'].map((shot_id, n) => ({
      shot_id,
      purpose: ['待つ', '探す', '発見', '再会'][n],
      prompt: `Station ${shot_id}`,
      edit_duration_ms: 1000,
      entry_state: { gaze: n < 2 ? 'left' : 'friend' },
      exit_state: { emotion: n < 2 ? 'anxious' : 'relieved' },
      camera: n === 3 ? 'two-shot' : 'medium',
      audio: { intent: 'silent' },
      references: [],
      entity_revisions: [{ id: 'returning-cat', revision: 1 }],
      generation_strategy: 'editable_shot',
      generation: {
        backend: 'create',
        mode: 'image',
        model: 'gemini-nano-banana-2.1',
        parameters: {},
        upper_credits: 1,
        price_evidence: { surface: 'cli', source: 'offline fixture' },
        capability_snapshot: cap,
      },
    })),
    execution_policy: { allowed_scope: 'generation', max_credits: 8, max_attempts: 2 },
    timeline: {
      fps: 10,
      clips: [],
      audio: [],
      captions: [{ start_ms: 0, end_ms: 1000, text: '駅で待つ', locale: 'ja' }],
    },
  };
}
function localCli(root) {
  const calls = join(root, 'calls.ndjson'),
    fixturePath = join(root, 'capability.json'),
    source = raw(root);
  writeFileSync(fixturePath, JSON.stringify(cap));
  const shim = join(root, 'pixverse');
  writeFileSync(
    shim,
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.FORWARD_CALLS,JSON.stringify(a)+'\\n');const val=k=>a[a.indexOf(k)+1];let r;if(a[0]==='capabilities')r=JSON.parse(fs.readFileSync(process.env.FORWARD_CAP));else if(a[0]==='create')r={image_id:String(100+fs.readFileSync(process.env.FORWARD_CALLS,'utf8').split('\\n').filter(l=>l.includes('"create","image"')).length),status:'submitted'};else if(a[0]==='task')r={id:a[2],status:'completed',cost_credits:1};else if(a[0]==='asset'){fs.copyFileSync(process.env.FORWARD_SOURCE,val('--dest'));r={id:a[2],status:'completed',file:val('--dest')};}else throw Error('Unexpected offline CLI '+JSON.stringify(a));process.stdout.write(JSON.stringify(r));\n`,
  );
  chmodSync(shim, 0o755);
  const env = {
    ...process.env,
    PATH: root + delimiter + process.env.PATH,
    FORWARD_CALLS: calls,
    FORWARD_CAP: fixturePath,
    FORWARD_SOURCE: source,
  };
  const run = (...args) => {
    const r = spawnSync(process.execPath, [cli, ...args.map(String)], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`);
    return JSON.parse(r.stdout);
  };
  return {
    run,
    calls: () =>
      existsSync(calls)
        ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
        : [],
    source,
  };
}

test('forward CLI: plan approval run resume download review adopt repair Canvas selection and local MP4/SRT', () => {
  const root = mkdtempSync(join(tmpdir(), 'forward-station-')),
    db = join(root, 'production.sqlite'),
    file = join(root, 'production.json');
  const { run, calls, source } = localCli(root),
    save = (p) => writeFileSync(file, JSON.stringify(p));
  let p = fixture();
  save(p);
  const entity = join(root, 'character.json');
  writeFileSync(
    entity,
    JSON.stringify({
      id: 'returning-cat',
      revision: 1,
      kind: 'character',
      status: 'accepted',
      name: 'Returning cat',
      context,
      reviewer: qa.reviewer,
      references: [
        {
          kind: 'image',
          path: source,
          status: 'accepted',
          provenance: 'previous local fixture',
          ...context,
        },
      ],
    }),
  );
  run('character', 'register', entity, '--db', db);
  assert.equal(run('character', 'get', 'returning-cat', '--revision', '1', '--db', db).revision, 1);
  assert.equal(run('validate', file).valid, true);
  const before = run('plan', file);
  assert.equal(before.sequence.length, 4);
  assert.equal(run('run', file, '--dry-run').provider_calls, 0);
  assert.equal(calls().length, 0);
  const approval = run('approve', file, '--db', db, '--actor', qa.reviewer);
  run('run', file, '--db', db, '--approval', approval.id);
  run('run', file, '--db', db, '--approval', approval.id);
  for (const job of run('status', p.project_id, '--db', db).jobs) {
    run('resume', job.id, '--db', db);
    run(
      'download',
      job.id,
      '--provider',
      run('status', p.project_id, '--db', db).takes.find((t) => t.intent_id === job.id).provider_id,
      '--out',
      join(root, `${job.shot_id}.ppm`),
      '--db',
      db,
    );
  }
  const qafile = join(root, 'qa.json');
  writeFileSync(qafile, JSON.stringify(qa));
  for (const take of run('status', p.project_id, '--db', db).takes) {
    run('review', take.id, '--qa', qafile, '--accept', '--db', db);
    p = run('adopt', file, '--shot', take.shot_id, '--take', take.id, '--db', db);
    save(p);
  }
  assert.equal(calls().filter((a) => a[0] === 'create').length, 4);
  const initialTakes = p.shots.map((s) => s.take_id);
  p.revision++;
  delete p.shots[1].take_id;
  p.shots[1].prompt += '; gaze to left';
  p.shots[1].generation.attempt = 2;
  save(p);
  const repairPlan = run('plan', file);
  assert.deepEqual(
    repairPlan.intents.map((i) => i.shot_id),
    ['search'],
  );
  assert.equal(repairPlan.reuse.length, 3);
  const repairApproval = run('approve', file, '--actor', qa.reviewer, '--db', db);
  run('run', file, '--approval', repairApproval.id, '--db', db);
  run('resume', repairPlan.intents[0].id, '--db', db);
  let take = run('status', p.project_id, '--db', db).takes.find(
    (t) => t.intent_id === repairPlan.intents[0].id,
  );
  run(
    'download',
    repairPlan.intents[0].id,
    '--provider',
    take.provider_id,
    '--out',
    join(root, 'search-fixed.ppm'),
    '--db',
    db,
  );
  run('review', take.id, '--qa', qafile, '--accept', '--db', db);
  p = run('adopt', file, '--shot', 'search', '--take', take.id, '--db', db);
  save(p);
  assert.deepEqual(
    p.shots.filter((s) => s.shot_id !== 'search').map((s) => s.take_id),
    initialTakes.filter((_, i) => i !== 1),
  );
  const graph = {
    project_id: '9999999999999999999999',
    edit_version: 1,
    nodes: [
      {
        node_id: 'search-node',
        node_type: 'image_generate',
        source: 'agent',
        history_id: '100',
        position: { x: 1, y: 2 },
      },
    ],
    edges: [],
  };
  const remote = structuredClone(graph);
  remote.edit_version = 2;
  remote.nodes[0].history_id = '9999999999999999999998';
  remote.nodes[0].position = { x: 123, y: 456 };
  remote.nodes.push({
    node_id: 'human-note',
    node_type: 'script',
    source: 'human',
    artifact: { text: 'Keep' },
  });
  const syncFile = join(root, 'sync.json');
  writeFileSync(
    syncFile,
    JSON.stringify({
      context,
      base: graph,
      local: graph,
      remote,
      mappings: [{ node_id: 'search-node', shot_id: 'search', kind: 'image' }],
    }),
  );
  const synced = run('canvas-sync', file, '--sync', syncFile, '--db', db);
  assert.equal(synced.applied, true);
  p = synced.production;
  save(p);
  assert.equal(p.canvas.graph.nodes.length, 2);
  assert.deepEqual(p.canvas.graph.nodes[0].position, { x: 123, y: 456 });
  take = synced.imported_takes[0];
  assert.equal(take.provider_id, '9999999999999999999998');
  assert.equal(take.status, 'completed');
  run(
    'attach',
    take.id,
    '--file',
    source,
    '--evidence',
    'existing fixture selected in Canvas',
    '--db',
    db,
  );
  run('review', take.id, '--qa', qafile, '--accept', '--db', db);
  p = run('adopt', file, '--shot', 'search', '--take', take.id, '--db', db);
  p.revision++;
  p.timeline.clips = p.shots.map((s) => ({
    shot_id: s.shot_id,
    take_id: s.take_id,
    source_in_ms: 0,
    duration_ms: 1000,
    audio: false,
  }));
  save(p);
  const takesFile = join(root, 'takes.json');
  writeFileSync(takesFile, JSON.stringify(run('status', p.project_id, '--db', db).takes));
  const deliver = run('finish', file, '--takes', takesFile, '--out', join(root, 'delivery'));
  assert.equal(deliver.generation_jobs, 0);
  assert(existsSync(deliver.deliveries[0].path));
  assert.match(readFileSync(deliver.deliveries[0].captions.path, 'utf8'), /駅で待つ/);
  assert.deepEqual(deliver.deliveries[0].technical_qc, { probe: 'pass', decode: 'pass' });
  assert.equal(calls().filter((a) => a[0] === 'create').length, 5);
});

test('forward safety: partial unknown submission blocks a new attempt for the same shot', async () => {
  const s = new Store(':memory:'),
    p = fixture();
  p.entities = [];
  p.shots = p.shots.slice(0, 1);
  p.shots[0].entity_revisions = [];
  p.brief.deliveries[0].duration_ms = 1000;
  const first = planProduction(p),
    a = s.approve(first, 'fixture-human');
  s.claim(first.intents[0], first, a.id);
  s.record(first.intents[0], {
    exit_code: 5,
    error: 'partial response; one result unknown',
    results: [{ id: '101', kind: 'image', status: 'completed' }],
  });
  p.revision++;
  p.shots[0].generation.attempt = 2;
  const next = planProduction(p),
    b = s.approve(next, 'fixture-human');
  let sends = 0;
  const e = new Executor(s, {
    create: {
      submit() {
        sends++;
        return { results: [{ id: '102', kind: 'image', status: 'submitted' }] };
      },
    },
  });
  await assert.rejects(e.run(next, { approval: b.id }), /unresolved|reconcile/);
  assert.equal(sends, 0);
  s.close();
});

test('forward safety: Canvas sync rejects another workspace instead of relabeling provenance', () => {
  const s = new Store(':memory:'),
    p = fixture();
  s.saveDocument('production', p);
  const base = {
    project_id: 'canvas-other-workspace',
    context: { region: 'cn', workspace_id: '88' },
    edit_version: 1,
    nodes: [
      { node_id: 'search-node', node_type: 'image_generate', source: 'agent', history_id: '100' },
    ],
    edges: [],
  };
  const remote = structuredClone(base);
  remote.edit_version = 2;
  remote.nodes[0].history_id = '101';
  assert.throws(
    () =>
      syncCanvas(s, p, {
        base,
        local: base,
        remote,
        mappings: [{ node_id: 'search-node', shot_id: 'search', kind: 'image' }],
      }),
    /context|workspace|region/,
  );
  s.close();
});

test('forward safety: resolving an unknown submission releases verified actual-cost exposure', async () => {
  const s = new Store(':memory:'),
    p = fixture();
  p.shots = p.shots.slice(0, 1);
  p.brief.deliveries[0].duration_ms = 1000;
  const plan = planProduction(p),
    a = s.approve(plan, 'fixture-human'),
    i = plan.intents[0];
  s.claim(i, plan, a.id);
  s.record(i, { exit_code: 5, error: 'lost output', results: [] });
  const e = new Executor(s, {});
  await e.reconcile(
    i.id,
    [{ id: '101', kind: 'image', status: 'completed', cost_credits: 0.25 }],
    'Explicit lookup confirms the sole submitted job and final billed amount',
  );
  assert.equal(s.job(i.id).state, 'completed');
  assert.equal(s.exposure(p.project_id), 0.25);
  s.close();
});

test('forward CLI: live capability queries use the approved region and workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'forward-context-')),
    db = join(root, 'db.sqlite'),
    file = join(root, 'production.json');
  const { run, calls } = localCli(root),
    p = fixture();
  p.context = { region: 'cn', workspace_id: '88' };
  p.entities = [];
  p.shots = p.shots.slice(0, 1);
  p.shots[0].entity_revisions = [];
  p.brief.deliveries[0].duration_ms = 1000;
  writeFileSync(file, JSON.stringify(p));
  const a = run('approve', file, '--db', db, '--actor', 'fixture-human');
  run('run', file, '--db', db, '--approval', a.id);
  for (const args of calls().filter((a) => a[0] === 'capabilities')) {
    assert.equal(
      args[args.indexOf('--region') + 1],
      'cn',
      'capability lookup must not use the account default context',
    );
    assert.equal(args[args.indexOf('--workspace-id') + 1], '88');
  }
});

test('forward retrieval: a lost local download can be downloaded again without generation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forward-download-')),
    s = new Store(':memory:'),
    p = fixture();
  p.shots = p.shots.slice(0, 1);
  p.brief.deliveries[0].duration_ms = 1000;
  const plan = planProduction(p),
    a = s.approve(plan, 'fixture-human'),
    i = plan.intents[0];
  s.claim(i, plan, a.id);
  s.record(i, {
    results: [{ id: '101', kind: 'image', status: 'completed', path: join(root, 'missing.ppm') }],
  });
  let downloads = 0;
  const dest = join(root, 'retrieved.ppm'),
    e = new Executor(s, {
      create: {
        download() {
          downloads++;
          raw(root, 'retrieved.ppm');
          return { results: [{ id: '101', kind: 'image', status: 'completed', path: dest }] };
        },
        submit() {
          assert.fail('retrieval cannot generate');
        },
      },
    });
  await e.download(i.id, '101', dest);
  assert.equal(downloads, 1);
  assert(existsSync(dest));
  s.close();
});

test('forward explicit OFF: a default-on positive-only capability must not silently drop false', () => {
  const snapshot = structuredClone(cap);
  snapshot.capability.parameters.feature = {
    flag: '--feature',
    type: 'boolean',
    default: true,
    supported: true,
  };
  const i = {
    id: 'off-intent',
    backend: 'create',
    mode: 'image',
    model: 'gemini-nano-banana-2.1',
    context,
    inputs: [],
    parameters: { prompt: 'fixture', feature: false },
  };
  assert.throws(() => buildCreateCommand(i, snapshot), /disable|negative|OFF|false|flag/);
});
