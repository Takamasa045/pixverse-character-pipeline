import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { renderPlanPreview } from '../src/preview.mjs';
import { fileHash } from '../src/finish.mjs';

const roots = [];
async function root() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-preview-test-'));
  roots.push(d);
  return d;
}
after(async () => {
  for (const d of roots) await fs.rm(d, { recursive: true, force: true });
});
const font = [
  process.env.PRODUCTION_TEST_FONT,
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]
  .filter(Boolean)
  .find(existsSync);
let tools = false;
try {
  execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
  tools = true;
} catch {}
const real = { skip: !font || !tools };
function production() {
  return {
    schema_version: 'production.v1',
    project_id: 'text-preview',
    revision: 1,
    context: { region: 'global', workspace_id: '0' },
    brief: {
      original: 'Two shots',
      intent: 'Wait then greet',
      assumptions: [],
      deliveries: [
        { id: 'wide', locale: 'en', aspect: '16:9', width: 320, height: 180, duration_ms: 1200 },
      ],
    },
    entities: [],
    assets: [],
    shots: [
      {
        shot_id: 'wait',
        purpose: 'Wait at station',
        edit_duration_ms: 600,
        entry_state: { pose: 'wait' },
        exit_state: { gaze: 'left' },
        camera: 'wide',
        audio: { intent: 'silence' },
        references: [],
        generation_strategy: 'editable_shot',
      },
      {
        shot_id: 'greet',
        purpose: 'Greet a friend',
        edit_duration_ms: 600,
        entry_state: { gaze: 'left' },
        exit_state: { pose: 'wave' },
        camera: 'close',
        audio: { intent: 'ambience' },
        references: [],
        generation_strategy: 'editable_shot',
      },
    ],
    execution_policy: { allowed_scope: 'planning_only', max_credits: null, max_attempts: 1 },
    timeline: { fps: 10, clips: [], audio: [], captions: [] },
  };
}
async function dryFont(dir) {
  const f = font ?? path.join(dir, 'unprobed-font.ttf');
  if (!font) await fs.writeFile(f, 'dry-run only; font decoder must not run');
  return f;
}

test('planning preview dry-run performs zero processes and zero writes, requires no accepted material', async () => {
  const d = await root(),
    p = production(),
    copy = structuredClone(p),
    f = await dryFont(d),
    out = path.join(d, 'never-created');
  const old = process.env.PATH;
  process.env.PATH = '';
  let r;
  try {
    r = await renderPlanPreview(p, {
      outputDir: out,
      fontPath: f,
      dryRun: true,
      python: '/missing/python',
      ffmpeg: '/missing/ffmpeg',
      ffprobe: '/missing/ffprobe',
    });
  } finally {
    process.env.PATH = old;
  }
  assert.equal(existsSync(out), false);
  assert.deepEqual(p, copy);
  assert.equal(r.preview_rendered, false);
  assert.equal(r.font_layout_verified, false);
  assert.equal(r.status, 'planning_preview');
  assert.equal(r.adoption, 'not_reviewed');
  assert.equal(r.generation_jobs, 0);
  assert.equal(r.provider_calls, 0);
  assert.equal(r.source_media_used, false);
  assert.equal(r.specification.cards.length, 2);
  assert(!JSON.stringify(r).includes('"accepted"'));
  assert(!JSON.stringify(r).includes('"qa"'));
  assert(r.specification.cards.every((c) => c.text.some((t) => t.includes('SILENT PLACEHOLDERS'))));
});

test('planning preview selects only declared variants and checks selected shot duration before writing', async () => {
  const d = await root(),
    f = await dryFont(d),
    out = path.join(d, 'output'),
    p = production();
  await assert.rejects(
    () => renderPlanPreview(p, { outputDir: out, fontPath: f, variantId: 'missing', dryRun: true }),
    (e) => e.code === 'PREVIEW_VARIANT_UNKNOWN',
  );
  p.brief.deliveries.push({
    ...p.brief.deliveries[0],
    id: 'portrait',
    aspect: '9:16',
    width: 180,
    height: 320,
  });
  await assert.rejects(
    () => renderPlanPreview(p, { outputDir: out, fontPath: f, dryRun: true }),
    (e) => e.code === 'PREVIEW_VARIANT_REQUIRED',
  );
  const selected = await renderPlanPreview(p, {
    outputDir: out,
    fontPath: f,
    variantId: 'portrait',
    dryRun: true,
  });
  assert.equal(selected.specification.width, 180);
  assert.equal(selected.specification.height, 320);
  p.brief.deliveries[1].timeline = {
    clips: [
      { shot_id: 'greet', duration_ms: 600 },
      { shot_id: 'wait', duration_ms: 600 },
    ],
  };
  const reordered = await renderPlanPreview(p, {
    outputDir: out,
    fontPath: f,
    variantId: 'portrait',
    dryRun: true,
  });
  assert.deepEqual(
    reordered.specification.cards.map((c) => c.shot_id),
    ['greet', 'wait'],
  );
  p.brief.deliveries[1].duration_ms = 1199;
  await assert.rejects(
    () =>
      renderPlanPreview(p, { outputDir: out, fontPath: f, variantId: 'portrait', dryRun: true }),
    /duration/,
  );
  assert.equal(existsSync(out), false);
});

test(
  'real text cards produce a silent timed MP4; glyph pixels, metadata, reuse and source immutability are verified',
  real,
  async () => {
    const d = await root(),
      p = production(),
      source = path.join(d, 'user-source.bin');
    await fs.writeFile(source, 'user material must remain unchanged');
    const sourceHash = await fileHash(source),
      sourceStat = await fs.stat(source);
    p.assets = [{ id: 'unused-source', kind: 'image', path: source, ...p.context }];
    const original = structuredClone(p);
    const out = path.join(d, 'preview');
    const r = await renderPlanPreview(p, { outputDir: out, fontPath: font });
    assert.equal(r.preview_rendered, true);
    assert.equal(r.status, 'planning_preview');
    assert.equal(r.adoption, 'not_reviewed');
    assert.equal(r.final_delivery, false);
    assert.equal(r.generation_jobs, 0);
    assert.equal(r.source_media_used, false);
    assert.equal(r.probe.audio_streams, 0);
    assert.equal(r.probe.width, 320);
    assert.equal(r.probe.height, 180);
    assert(Math.abs(r.probe.duration_ms - 1200) <= 100);
    assert.equal(r.specification.total_frames, 12);
    assert.equal(r.layouts.length, 2);
    assert(r.layouts[0].lines.some((l) => l.includes('Purpose:')));
    assert(r.layouts[1].lines.some((l) => l.includes('Greet')));
    const pixels = (sec) =>
      execFileSync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-ss',
          sec,
          '-i',
          r.output.path,
          '-frames:v',
          '1',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          '-',
        ],
        { maxBuffer: 500000 },
      );
    const first = pixels('0.2'),
      second = pixels('0.8');
    assert.notDeepEqual(first, second);
    const line = r.layouts[0].lines.findIndex((l) => l.includes('Purpose:')),
      box = r.layouts[0].glyph_boxes[line];
    let bright = 0;
    for (let y = box.y; y < box.y + box.height; y++)
      for (let x = box.x; x < box.x + box.width; x++) {
        const at = (y * 320 + x) * 3;
        if (first[at] > 170 && first[at + 1] > 170 && first[at + 2] > 170) bright++;
      }
    assert(bright > 10, 'visible purpose text pixels');
    assert.equal(await fileHash(r.output.path), r.output.sha256);
    const before = await fs.stat(r.output.path),
      manifestBefore = await fs.readFile(r.manifest_path);
    const old = process.env.PATH;
    process.env.PATH = '';
    let reused;
    try {
      reused = await renderPlanPreview(p, {
        outputDir: out,
        fontPath: font,
        python: '/missing',
        ffmpeg: '/missing',
        ffprobe: '/missing',
      });
    } finally {
      process.env.PATH = old;
    }
    assert.equal(reused.reused, true);
    assert.equal(reused.output.path, r.output.path);
    assert.equal((await fs.stat(r.output.path)).mtimeMs, before.mtimeMs);
    assert.deepEqual(await fs.readFile(r.manifest_path), manifestBefore);
    assert.deepEqual(p, original);
    assert.equal(await fileHash(source), sourceHash);
    assert.equal((await fs.stat(source)).mtimeMs, sourceStat.mtimeMs);
    assert.equal((await fs.readdir(out)).length, 2);
    assert(!Object.keys(r).includes('takes'));
    assert(!Object.keys(r).includes('qa'));
  },
);

test(
  'changed preview bytes and incomplete outputs are preserved and never overwritten',
  real,
  async () => {
    const d = await root(),
      p = production(),
      out = path.join(d, 'preview'),
      r = await renderPlanPreview(p, { outputDir: out, fontPath: font });
    await fs.appendFile(r.output.path, 'tampered');
    const changed = await fs.readFile(r.output.path);
    await assert.rejects(
      () => renderPlanPreview(p, { outputDir: out, fontPath: font }),
      (e) => e.code === 'PREVIEW_CACHE_MISMATCH',
    );
    assert.deepEqual(await fs.readFile(r.output.path), changed);
    const missing = path.join(d, 'incomplete'),
      dry = await renderPlanPreview(p, { outputDir: missing, fontPath: font, dryRun: true });
    await fs.mkdir(missing);
    await fs.writeFile(dry.output.path, 'existing incomplete file');
    await assert.rejects(
      () => renderPlanPreview(p, { outputDir: missing, fontPath: font }),
      (e) => e.code === 'PREVIEW_OUTPUT_EXISTS',
    );
    assert.equal(await fs.readFile(dry.output.path, 'utf8'), 'existing incomplete file');
  },
);

test(
  'preview renderer errors clean only their own work; existing locks and user files remain',
  real,
  async () => {
    const d = await root(),
      p = production(),
      out = path.join(d, 'failed');
    await assert.rejects(
      () => renderPlanPreview(p, { outputDir: out, fontPath: font, ffmpeg: '/missing/tool' }),
      /ENOENT/,
    );
    assert.deepEqual(await fs.readdir(out), []);
    const dry = await renderPlanPreview(p, { outputDir: out, fontPath: font, dryRun: true }),
      lock = dry.output.path.replace(/\.mp4$/, '.lock');
    await fs.writeFile(lock, 'someone else owns this lock');
    await assert.rejects(
      () => renderPlanPreview(p, { outputDir: out, fontPath: font }),
      (e) => e.code === 'PREVIEW_IN_PROGRESS',
    );
    assert.equal(await fs.readFile(lock, 'utf8'), 'someone else owns this lock');
    const invalid = path.join(d, 'not-a-font');
    await fs.writeFile(invalid, 'user file');
    await assert.rejects(
      () => renderPlanPreview(p, { outputDir: path.join(d, 'bad-font'), fontPath: invalid }),
      (e) => e.code === 'PREVIEW_FONT_OR_LAYOUT_INVALID',
    );
    assert.equal(await fs.readFile(invalid, 'utf8'), 'user file');
  },
);

test(
  'text overflow rejects rather than truncating planned notes or publishing a misleading card',
  real,
  async () => {
    const d = await root(),
      p = production();
    p.shots[0].purpose = 'Long planning note '.repeat(1000);
    const out = path.join(d, 'overflow');
    await assert.rejects(
      () => renderPlanPreview(p, { outputDir: out, fontPath: font }),
      (e) => e.code === 'PREVIEW_TEXT_OVERFLOW',
    );
    assert.deepEqual(await fs.readdir(out), []);
  },
);
