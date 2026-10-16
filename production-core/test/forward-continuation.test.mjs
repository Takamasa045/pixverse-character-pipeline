import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, Executor } from '../src/store.mjs';
import { fileHash } from '../src/contracts.mjs';
import { downloadSelectedTake, reviewTake, markStale } from '../src/review.mjs';
import { adoptTake, syncCanvas } from '../src/sync.mjs';
import { renderDeliveries, inspectDelivery, probeMedia } from '../src/finish.mjs';
import { planProduction, impactAnalysis } from '../src/planner.mjs';
import {
  createPresetAdapter,
  resolvePresetIntent,
  planPresetCandidates,
  presetSnapshotHash,
} from '../src/presets.mjs';

// All transport responses are local bytes. FFmpeg/Pillow are existing runtimes;
// no provider process, network, authentication, installation or paid job is used.
let root, video;
const context = { region: 'global', workspace_id: '0' };
const qa = {
  technical: 'pass',
  creative: 'pass',
  continuity: 'pass',
  audio: 'pass',
  reviewer: 'independent-forward-fixture',
  notes: 'Local fixture contract evidence; no generated creative quality claim.',
};
const font = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
function production() {
  return {
    schema_version: 'production.v1',
    project_id: 'forward-continuation',
    revision: 1,
    context,
    brief: {
      original: '既存素材で字幕と縦横のクロップを納品',
      intent: 'Test exact selected take finishing',
      assumptions: [],
      deliveries: [
        {
          id: 'wide',
          locale: 'ja',
          aspect: '16:9',
          width: 160,
          height: 90,
          duration_ms: 1000,
          caption_mode: 'sidecar',
          qc: { expected_audio: false },
        },
      ],
    },
    entities: [],
    assets: [],
    shots: [
      {
        shot_id: 'station',
        purpose: 'Station recognition',
        edit_duration_ms: 1000,
        entry_state: { gaze: 'left' },
        exit_state: { emotion: 'relieved' },
        camera: 'medium',
        audio: { intent: 'silent' },
        references: [],
        entity_revisions: [],
        generation_strategy: 'editable_shot',
      },
    ],
    execution_policy: { allowed_scope: 'planning_only', max_credits: 0, max_attempts: 1 },
    timeline: {
      fps: 10,
      clips: [],
      audio: [],
      captions: [{ start_ms: 200, end_ms: 800, text: '駅\nHi', locale: 'ja' }],
    },
  };
}
before(() => {
  root = mkdtempSync(join(tmpdir(), 'forward-continuation-'));
  video = join(root, 'existing.mp4');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=red:s=160x90:r=10:d=1.2,drawbox=x=80:y=0:w=80:h=90:color=blue:t=fill',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=1.2',
    '-shortest',
    '-c:v',
    'libx264',
    '-threads',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    video,
  ]);
});
const frame = (file, second) =>
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-ss',
    String(second),
    '-i',
    file,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ]);

test('continuation: selected Canvas video downloads once, then actual crop + Japanese burn-in + SRT + QC finish and reuse', async () => {
  const s = new Store(':memory:'),
    p = production();
  s.saveDocument('production', p);
  const base = {
    project_id: '999999999999999999999',
    edit_version: 1,
    nodes: [
      {
        node_id: 'station-video',
        node_type: 'video_generate',
        source: 'agent',
        history_id: '100',
        position: { x: 1, y: 1 },
      },
    ],
    edges: [],
  };
  const remote = structuredClone(base);
  remote.edit_version = 2;
  remote.nodes[0].history_id = '999999999999999999998';
  remote.nodes[0].position = { x: 40, y: 50 };
  const synced = syncCanvas(s, p, {
    context,
    base,
    local: base,
    remote,
    mappings: [{ node_id: 'station-video', shot_id: 'station', kind: 'video' }],
  });
  const selected = synced.imported_takes[0];
  let transfers = 0;
  const calls = [],
    bytes = readFileSync(video),
    run = async (args) => {
      calls.push(args);
      return {
        exit_code: 0,
        raw: {
          Resp: {
            node: {
              node_id: 'station-video',
              history_id: selected.provider_id,
              derived_state: 'SUCCEEDED',
              file_path: 'https://fixture.invalid/existing.mp4',
            },
          },
        },
      };
    };
  const out = await downloadSelectedTake(s, selected.id, join(root, 'selected'), {
    run,
    downloadOptions: {
      reserveBytes: 0,
      fetchImpl: async () => {
        transfers++;
        return new Response(bytes, {
          headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) },
        });
      },
    },
  });
  assert.equal(out.sha256, fileHash(video));
  assert.equal((await probeMedia(out.path)).duration_ms, 1200);
  assert.equal(out.status, 'downloaded');
  await downloadSelectedTake(s, selected.id, join(root, 'selected'), {
    run: () => assert.fail('cached media must not query or generate'),
  });
  assert.equal(transfers, 1);
  assert.equal(calls.length, 2);
  assert(
    calls.every(
      (a) =>
        a[0] === 'canvas' && a.includes('get') && !a.includes('dispatch') && !a.includes('create'),
    ),
  );
  reviewTake(s, selected.id, qa, { accept: true });
  const adopted = adoptTake(s, synced.production, 'station', selected.id);
  adopted.timeline.clips = [
    {
      shot_id: 'station',
      take_id: selected.id,
      source_in_ms: 100,
      duration_ms: 1000,
      audio: false,
    },
  ];
  const clip = {
    ...adopted.timeline.clips[0],
    crop: { x: 110, y: 0, width: 50, height: 90 },
    protected_regions: [{ x: 115, y: 10, width: 35, height: 65, label: 'Required subject' }],
  };
  adopted.brief.deliveries.push({
    id: 'portrait',
    locale: 'ja',
    aspect: '9:16',
    width: 90,
    height: 160,
    duration_ms: 1000,
    caption_mode: 'both',
    caption_style: {
      font_path: font,
      font_size: 12,
      safe_area: { x: 8, y: 110, width: 74, height: 42 },
      padding: 2,
      line_spacing: 2,
      color: '#ffffffff',
      background_color: '#000000dd',
    },
    timeline: { clips: [clip] },
    qc: { expected_audio: false, max_black_interval_ms: 0 },
  });
  const sourceHash = fileHash(video),
    manifest = await renderDeliveries(adopted, s.takes(p.project_id), {
      outputDir: join(root, 'deliveries'),
    });
  assert.equal(manifest.generation_jobs, 0);
  assert.equal(s.jobs(p.project_id).length, 0);
  assert.equal(fileHash(video), sourceHash);
  const [wide, portrait] = manifest.deliveries;
  assert.equal(portrait.technical_qc.caption_safe_area, 'geometry_pass_applied');
  assert.equal(portrait.technical_qc.crop_bounds, 'pass');
  assert.equal(portrait.quality_review, 'explicit_policy_pass_pending_creative_review');
  assert.match(readFileSync(portrait.captions.path, 'utf8'), /駅\nHi/);
  assert.equal(portrait.measurements.has_audio, true);
  assert(portrait.measurements.silence_intervals_ms.length);
  const baseline = frame(portrait.path, 0.1),
    during = frame(portrait.path, 0.5);
  let blue = 0,
    white = 0,
    outsideWhite = 0;
  for (let y = 0; y < 160; y++)
    for (let x = 0; x < 90; x++) {
      const i = (y * 90 + x) * 3;
      if (baseline[i + 2] > baseline[i] + 80) blue++;
      if (during[i] > 180 && during[i + 1] > 180 && during[i + 2] > 180) {
        white++;
        if (x < 8 || x >= 82 || y < 110 || y >= 152) outsideWhite++;
      }
    }
  assert(blue > 90 * 160 * 0.85, 'portrait must retain supplied blue subject');
  assert(white > 5, 'decoded caption glyphs must actually appear');
  assert.equal(outsideWhite, 0, 'burned glyph pixels must remain within requested safe area');
  assert.equal((await probeMedia(wide.path)).width, 160);
  const again = await renderDeliveries(adopted, s.takes(p.project_id), {
    outputDir: join(root, 'deliveries'),
    ffmpeg: '/must-not-encode',
  });
  assert(again.deliveries.every((d) => d.reused));
  assert.equal(transfers, 1);
  s.close();
});

test('continuation: protected subject loss and explicit silence policy block without generating', async () => {
  const p = production(),
    take = {
      id: 'local',
      project_id: p.project_id,
      shot_id: 'station',
      path: video,
      kind: 'video',
      status: 'accepted',
      stale: false,
      qa,
      sha256: fileHash(video),
    };
  p.shots[0].take_id = take.id;
  p.timeline.clips = [
    {
      shot_id: 'station',
      take_id: take.id,
      source_in_ms: 0,
      duration_ms: 1000,
      audio: false,
      crop: { x: 80, y: 0, width: 80, height: 90 },
      protected_regions: [{ x: 0, y: 0, width: 50, height: 50 }],
    },
  ];
  const inspection = await inspectDelivery(p, [take]);
  assert(inspection.issues.some((i) => i.code === 'CROP_PROTECTED_REGION_CLIPPED'));
  delete p.timeline.clips[0].crop;
  delete p.timeline.clips[0].protected_regions;
  p.brief.deliveries[0].qc = { expected_audio: true, max_silence_interval_ms: 100 };
  await assert.rejects(
    renderDeliveries(p, [take], { outputDir: join(root, 'silence-blocked') }),
    (e) => e.issues?.some((i) => i.code === 'SILENCE_INTERVAL_EXCEEDS_LIMIT'),
  );
  assert(
    !existsSync(join(root, 'silence-blocked')) ||
      !readdirSync(join(root, 'silence-blocked')).some((n) => n.endsWith('.mp4')),
  );
});

test('continuation: explicit entity change stales dependent accepted takes as well as the direct shot', () => {
  const p = production(),
    s = new Store(':memory:');
  p.shots[0].entity_revisions = [{ id: 'cat', revision: 1 }];
  p.shots.push({ ...p.shots[0], shot_id: 'dependent', entity_revisions: [] });
  p.brief.deliveries[0].duration_ms = 2000;
  p.dependencies = [
    { id: 'dependent', depends_on: ['station'] },
    { id: 'wide', depends_on: ['dependent'] },
  ];
  s.saveDocument('production', p);
  s.putTake({
    id: 'direct',
    project_id: p.project_id,
    shot_id: 'station',
    status: 'accepted',
    stale: false,
    provenance: { entity_revisions: [{ id: 'cat', revision: 1 }] },
  });
  s.putTake({
    id: 'derived',
    project_id: p.project_id,
    shot_id: 'dependent',
    status: 'accepted',
    stale: false,
    provenance: { entity_revisions: [] },
  });
  assert(impactAnalysis(p, ['cat']).stale.includes('dependent'));
  markStale(s, p.project_id, { entityIds: ['cat'] }, 'Changed accepted identity');
  assert.equal(s.take('direct').stale, true);
  assert.equal(s.take('derived').stale, true);
  assert.equal(s.jobs(p.project_id).length, 0);
  s.close();
});

test('continuation: explicit reference asset change stales directly bound and dependent takes', () => {
  const p = production(),
    s = new Store(':memory:');
  p.assets = [
    {
      id: 'product-ref',
      kind: 'image',
      provider_id: '100',
      ...context,
      status: 'accepted',
      provenance: 'local fixture',
    },
  ];
  p.shots[0].references = [{ asset: 'product-ref', role: 'appearance', order: 0 }];
  p.shots.push({ ...p.shots[0], shot_id: 'dependent', references: [] });
  p.brief.deliveries[0].duration_ms = 2000;
  p.dependencies = [{ id: 'dependent', depends_on: ['station'] }];
  s.saveDocument('production', p);
  s.putTake({
    id: 'direct-asset',
    project_id: p.project_id,
    shot_id: 'station',
    status: 'accepted',
    stale: false,
    provenance: { inputs: [{ id: 'product-ref' }] },
  });
  s.putTake({
    id: 'derived-asset',
    project_id: p.project_id,
    shot_id: 'dependent',
    status: 'accepted',
    stale: false,
    provenance: { inputs: [] },
  });
  assert(impactAnalysis(p, ['product-ref']).stale.includes('dependent'));
  markStale(s, p.project_id, { assetIds: ['product-ref'] }, 'Changed accepted product appearance');
  assert.equal(s.take('direct-asset').stale, true);
  assert.equal(s.take('derived-asset').stale, true);
  assert.equal(s.jobs(p.project_id).length, 0);
  s.close();
});

test('continuation: MiniApp raw schema plans and executes with mock project resume without duplicate submission', async () => {
  const p = production(),
    s = new Store(':memory:'),
    info = {
      app_id: 'fixture_reframe',
      can_create: true,
      params_schema: [
        { name: 'image', type: 'upload', required: true, max_count: 1 },
        { name: 'ratio', type: 'enum', required: true, options: ['16:9', '9:16'] },
      ],
    };
  const snapshot = {
    info,
    context,
    cli_version: '1.4.8',
    analysis: {
      evidence: {
        source: 'Independent fixture operator schema/output attestation',
        info_sha256: presetSnapshotHash(info),
      },
      output: {
        kind: 'image',
        aspects: ['16:9', '9:16'],
        editable_shots: false,
        intermediate_assets: [],
      },
    },
  };
  const candidates = planPresetCandidates({
    requirements: { requires_editable_shots: true },
    miniapps: [snapshot],
  });
  assert(candidates.candidates[0].mismatches.includes('editable_shots'));
  assert.equal(candidates.provider_calls, 0);
  p.execution_policy = { allowed_scope: 'generation', max_credits: 2, max_attempts: 1 };
  p.assets = [
    {
      id: 'appearance',
      kind: 'image',
      provider_id: '101',
      media_path: 'upload/existing.png',
      region: context.region,
      workspace_id: context.workspace_id,
      status: 'accepted',
      provenance: 'already uploaded local fixture',
    },
  ];
  p.shots[0].references = [{ asset: 'appearance', role: 'appearance', order: 0 }];
  p.shots[0].generation = {
    backend: 'preset',
    mode: 'miniapps',
    model: null,
    preset_id: 'fixture_reframe',
    output_kind: 'image',
    parameters: { ratio: '9:16' },
    preset_snapshot: snapshot,
    upper_credits: 1,
    price_evidence: { surface: 'cli', source: 'offline contract fixture' },
  };
  const plan = planProduction(p, { resolveIntent: resolvePresetIntent });
  assert.equal(plan.blocked.length, 0);
  const a = s.approve(plan, 'fixture-human'),
    calls = [],
    run = async (args) => {
      calls.push(args);
      if (args[0] === '--version') return { exit_code: 0, stdout: '1.4.8' };
      if (args[0] === 'miniapps' && args[1] === 'create')
        return { exit_code: 0, raw: { project_id: 900, status: 'submitted' } };
      if (args[0] === 'task')
        return {
          exit_code: 0,
          raw: {
            project_id: 900,
            status: 'completed',
            assets: [{ id: 901, type: 'image', url: 'https://fixture.invalid/image.png' }],
            cost_credits: 1,
          },
        };
      throw Error('Unexpected mock command');
    };
  const e = new Executor(s, {
    preset: createPresetAdapter({ run, infoProvider: async () => info }),
  });
  await e.run(plan, { approval: a.id });
  await e.run(plan, { approval: a.id });
  await e.resume(plan.intents[0].id);
  await e.resume(plan.intents[0].id);
  assert.equal(calls.filter((c) => c[0] === 'miniapps' && c[1] === 'create').length, 1);
  assert.equal(s.job(plan.intents[0].id).state, 'completed');
  assert.equal(s.takes(p.project_id)[0].kind, 'image');
  s.close();
});
