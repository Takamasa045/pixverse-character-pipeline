import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  fileHash,
  probeMedia,
  inspectDelivery,
  renderDeliveries,
  editTimeline,
  locateIssue,
  captionsToSrt,
} from '../src/finish.mjs';

let root, video, audio;
const captionFont = [
  process.env.PRODUCTION_TEST_FONT,
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]
  .filter(Boolean)
  .find((file) => existsSync(file));
let pillowAvailable = false;
try {
  execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
  pillowAvailable = true;
} catch {}
const bitmapTest = { skip: !captionFont || !pillowAvailable };
const qa = {
  technical: 'pass',
  creative: 'pass',
  continuity: 'pass',
  audio: 'pass',
  reviewer: 'fixture-reviewer',
  notes: 'Synthetic local test fixture, not generated media.',
};
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'production-finish-test-'));
  video = path.join(root, 'source.mp4');
  audio = path.join(root, 'voice.wav');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=160x90:r=10:d=1.2',
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
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=660:sample_rate=48000:duration=1.2',
    audio,
  ]);
});
after(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const take = {
    id: 'take-1',
    project_id: 'local-film',
    shot_id: 's1',
    kind: 'video',
    path: video,
    sha256: await fileHash(video),
    status: 'accepted',
    provenance: { context: { region: 'global', workspace_id: '0' } },
    qa: structuredClone(qa),
    stale: false,
  };
  const second = { ...structuredClone(take), id: 'take-2', shot_id: 's2' };
  return {
    production: {
      schema_version: 'production.v1',
      project_id: 'local-film',
      revision: 1,
      context: { region: 'global', workspace_id: '0' },
      brief: {
        original: 'Local fixture',
        intent: 'Test finishing',
        assumptions: [],
        deliveries: [
          {
            id: 'ja-wide',
            locale: 'ja',
            aspect: '16:9',
            width: 160,
            height: 90,
            duration_ms: 1000,
          },
        ],
      },
      shots: [
        { shot_id: 's1', take_id: 'take-1' },
        { shot_id: 's2', take_id: 'take-2' },
      ],
      assets: [],
      timeline: {
        fps: 10,
        clips: [
          { shot_id: 's1', take_id: 'take-1', source_in_ms: 100, duration_ms: 400, audio: false },
          { shot_id: 's2', take_id: 'take-2', source_in_ms: 300, duration_ms: 600, audio: false },
        ],
        captions: [{ start_ms: 0, end_ms: 400, text: 'こんにちは', locale: 'ja' }],
        audio: [],
      },
    },
    takes: [take, second],
  };
}

test('accepted source bytes and requested technical specs pass; dry-run writes nothing', async () => {
  const { production, takes } = await fixture();
  const outputDir = path.join(root, 'dry');
  const check = await inspectDelivery(production, takes);
  assert.equal(check.ok, true);
  assert.equal(check.sources.length, 2);
  const result = await renderDeliveries(production, takes, { outputDir, dryRun: true });
  assert.equal(result.status, 'planned');
  assert.equal(result.generation_jobs, 0);
  await assert.rejects(fs.stat(outputDir), { code: 'ENOENT' });
});

test('completion, missing QA, stale adoption, wrong shot and changed bytes cannot pass delivery', async () => {
  for (const [change, code] of [
    [
      (t) => {
        t.status = 'completed';
      },
      'TAKE_NOT_ACCEPTED',
    ],
    [
      (t) => {
        t.qa.creative = null;
      },
      'TAKE_NOT_ACCEPTED',
    ],
    [
      (t) => {
        t.qa.audio = 'fail';
      },
      'TAKE_NOT_ACCEPTED',
    ],
    [
      (t) => {
        t.stale = true;
      },
      'TAKE_NOT_ACCEPTED',
    ],
    [
      (t) => {
        t.shot_id = 'other';
      },
      'TAKE_MISMATCH',
    ],
    [
      (t) => {
        t.sha256 = '0'.repeat(64);
      },
      'SOURCE_HASH_MISMATCH',
    ],
    [
      (t) => {
        delete t.sha256;
      },
      'SOURCE_HASH_MISSING',
    ],
    [
      (t) => {
        t.path = path.join(root, 'absent.mp4');
      },
      'SOURCE_UNREADABLE',
    ],
  ]) {
    const { production, takes } = await fixture();
    change(takes[0]);
    const check = await inspectDelivery(production, takes);
    assert.equal(check.ok, false);
    assert(
      check.issues.some((i) => i.code === code),
      code,
    );
    await assert.rejects(renderDeliveries(production, takes, { dryRun: true }), {
      code: 'DELIVERY_BLOCKED',
    });
  }
});

test('unsupported edits and out-of-range sources block instead of silently flattening', async () => {
  const { production, takes } = await fixture();
  production.timeline.clips[0].transition = 'dissolve';
  production.timeline.clips[1].source_in_ms = 1100;
  production.brief.deliveries[0].caption_mode = 'animated';
  production.timeline.captions[0].end_ms = 1500;
  const check = await inspectDelivery(production, takes);
  for (const code of [
    'EDIT_UNSUPPORTED',
    'CLIP_OUT_OF_RANGE',
    'CAPTION_MODE_UNSUPPORTED',
    'CAPTION_RANGE_INVALID',
  ])
    assert(
      check.issues.some((i) => i.code === code),
      code,
    );
});

test('real local FFmpeg produces MP4, SRT, hashes, probe and manifest; repeat reuses exact output', async () => {
  const { production, takes } = await fixture();
  production.assets.push({
    id: 'voice',
    kind: 'audio',
    region: 'global',
    workspace_id: '0',
    path: audio,
    sha256: await fileHash(audio),
    qa,
  });
  production.timeline.audio.push({
    asset_id: 'voice',
    start_ms: 100,
    source_in_ms: 100,
    duration_ms: 800,
    volume: 0.5,
  });
  const outputDir = path.join(root, 'rendered');
  const manifest = await renderDeliveries(production, takes, { outputDir });
  const delivery = manifest.deliveries[0];
  assert.equal(manifest.generation_jobs, 0);
  assert.equal(delivery.creative_delivery_review, 'pending');
  assert.equal(delivery.sha256, await fileHash(delivery.path));
  assert.deepEqual(delivery.technical_qc, { probe: 'pass', decode: 'pass' });
  const probed = await probeMedia(delivery.path);
  assert.equal(probed.width, 160);
  assert.equal(probed.height, 90);
  assert.equal(probed.fps, 10);
  assert(probed.audio_streams > 0);
  assert(Math.abs(probed.duration_ms - 1000) < 100);
  assert.match(
    await fs.readFile(delivery.captions.path, 'utf8'),
    /00:00:00,000 --> 00:00:00,400\nこんにちは/,
  );
  assert.equal(JSON.parse(await fs.readFile(manifest.path, 'utf8')).schema_version, 'delivery.v1');
  const again = await renderDeliveries(production, takes, {
    outputDir,
    ffmpeg: '/no-render-command-may-run',
  });
  assert.equal(again.deliveries[0].reused, true);
  assert.equal(again.deliveries[0].path, delivery.path);
  await fs.appendFile(delivery.captions.path, '\nmodified');
  await assert.rejects(renderDeliveries(production, takes, { outputDir }), (error) =>
    error.issues.some((i) => i.code === 'CAPTION_CACHE_MISMATCH'),
  );
});

test('explicit audio=false mutes an input with native audio', async () => {
  const { production, takes } = await fixture();
  production.timeline.captions = [];
  const result = await renderDeliveries(production, takes, { outputDir: path.join(root, 'muted') });
  const pcm = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    result.deliveries[0].path,
    '-vn',
    '-f',
    's16le',
    '-acodec',
    'pcm_s16le',
    '-',
  ]);
  let max = 0;
  for (let i = 0; i < pcm.length; i += 2) max = Math.max(max, Math.abs(pcm.readInt16LE(i)));
  assert.equal(max, 0, 'native source tone must stay muted');
  assert(
    result.deliveries[0].measurements.peak_volume_db === '-inf' ||
      result.deliveries[0].measurements.peak_volume_db <= -90,
  );
  assert(result.deliveries[0].measurements.silence_intervals_ms.some((i) => i.duration_ms >= 900));
  assert.equal(result.deliveries[0].quality_review, 'measurements_pending_review');
});

test('image holds and source native audio opt-in render without generation', async () => {
  const { production, takes } = await fixture();
  const image = path.join(root, 'still.ppm');
  await fs.writeFile(image, 'P3\n2 2\n255\n0 0 255 0 0 255 0 0 255 0 0 255\n');
  takes[0] = {
    ...takes[0],
    kind: 'image',
    path: image,
    sha256: await fileHash(image),
    qa: { ...qa, audio: 'not_applicable' },
  };
  production.timeline.clips[0].source_in_ms = 0;
  production.timeline.clips[1].audio = true;
  const result = await renderDeliveries(production, takes, {
    outputDir: path.join(root, 'image-hold'),
    phase: 'rough',
  });
  assert.equal(result.phase, 'rough');
  assert.equal(result.deliveries.length, 1);
  const pcm = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    result.deliveries[0].path,
    '-vn',
    '-f',
    's16le',
    '-acodec',
    'pcm_s16le',
    '-',
  ]);
  assert(
    pcm.some((byte) => byte !== 0),
    'explicitly opted-in native source tone should be present',
  );
});

test('editing only Japanese captions invalidates only Japanese deliveries, keeps takes and generation empty', async () => {
  const { production } = await fixture();
  production.brief.deliveries.push({
    ...production.brief.deliveries[0],
    id: 'en-wide',
    locale: 'en',
  });
  production.timeline.captions.push({ start_ms: 0, end_ms: 500, text: 'Hello', locale: 'en' });
  const original = structuredClone(production);
  const result = editTimeline(production, {
    captions: production.timeline.captions.map((c) =>
      c.locale === 'ja' ? { ...c, text: '修正' } : c,
    ),
  });
  assert.deepEqual(result.impact.delivery_ids, ['ja-wide']);
  assert.deepEqual(result.impact.generate, []);
  assert.deepEqual(result.impact.shot_ids, []);
  assert.deepEqual(production, original);
  assert.equal(result.production.revision, 2);
});

test('subtitle-only revision reuses the unaffected language output and passes ledger costs through separately', async () => {
  const { production, takes } = await fixture();
  production.brief.deliveries.push({
    ...production.brief.deliveries[0],
    id: 'en-wide',
    locale: 'en',
  });
  production.timeline.captions.push({ start_ms: 0, end_ms: 500, text: 'Hello', locale: 'en' });
  const outputDir = path.join(root, 'languages');
  const initial = await renderDeliveries(production, takes, {
    outputDir,
    cost_report: { actual_credits: null, unknown_results: 1 },
  });
  const revised = editTimeline(production, {
    captions: production.timeline.captions.map((c) =>
      c.locale === 'ja' ? { ...c, text: '修正' } : c,
    ),
  });
  const second = await renderDeliveries(revised.production, takes, { outputDir });
  assert.notEqual(initial.deliveries[0].path, second.deliveries[0].path);
  assert.equal(initial.deliveries[1].path, second.deliveries[1].path);
  assert.equal(second.deliveries[1].reused, true);
  assert.equal(second.generation_jobs, 0);
  assert.deepEqual(initial.costs, { actual_credits: null, unknown_results: 1 });
  assert.equal(second.costs.actual_credits, null);
});

test('local tool or output-path failure preserves sources and clears only owned temporary render files', async () => {
  const { production, takes } = await fixture();
  const original = await fileHash(video);
  const outputDir = path.join(root, 'tool-failure');
  await assert.rejects(
    renderDeliveries(production, takes, { outputDir, ffmpeg: '/usr/bin/false' }),
    { code: 'LOCAL_TOOL_FAILED' },
  );
  assert.deepEqual(await fs.readdir(outputDir), []);
  assert.equal(await fileHash(video), original);
  const notDirectory = path.join(root, 'not-directory');
  await fs.writeFile(notDirectory, 'preserve');
  await assert.rejects(renderDeliveries(production, takes, { outputDir: notDirectory }));
  assert.equal(await fs.readFile(notDirectory, 'utf8'), 'preserve');
  assert.equal(await fileHash(video), original);
});

test('source changes after initial inspection cannot be certified by a delivery snapshot', async () => {
  const { production, takes } = await fixture();
  const mutable = path.join(root, 'changing.mp4');
  await fs.copyFile(video, mutable);
  takes.splice(1);
  takes[0].path = mutable;
  production.shots.splice(1);
  production.timeline.clips = [
    { ...production.timeline.clips[0], source_in_ms: 0, duration_ms: 1000 },
  ];
  let changed = false;
  await assert.rejects(
    renderDeliveries(production, takes, {
      outputDir: path.join(root, 'source-changed'),
      probe: async (file) => {
        if (!changed) {
          await fs.appendFile(file, '\ntrailing data');
          changed = true;
        }
        return probeMedia(file);
      },
    }),
    (error) => error.issues?.some((i) => i.code === 'SOURCE_CHANGED_DURING_RENDER'),
  );
});

test('half-open edit time ranges map to exact source shot boundaries and never authorize generation', async () => {
  const { production } = await fixture();
  const first = locateIssue(production, { start_ms: 0, end_ms: 400, category: 'caption' });
  assert.deepEqual(first.affected, [
    { shot_id: 's1', take_id: 'take-1', time_range: { start_ms: 100, end_ms: 500 } },
  ]);
  assert.equal(first.generation_required, false);
  assert.deepEqual(first.generation_candidate_shot_ids, []);
  const crossing = locateIssue(production, { start_ms: 350, end_ms: 500, category: 'continuity' });
  assert.deepEqual(
    crossing.affected.map((s) => s.shot_id),
    ['s1', 's2'],
  );
  assert.equal(crossing.approval_required_for_new_generation, true);
  assert.throws(() => locateIssue(production, { start_ms: 900, end_ms: 1001 }), {
    code: 'DELIVERY_BLOCKED',
  });
});

test('delivery-specific timeline and selection isolate all other missing sources', async () => {
  const { production, takes } = await fixture();
  production.brief.deliveries[0].timeline = {
    clips: production.timeline.clips,
    audio: [],
    captions: [],
  };
  production.brief.deliveries.push({
    ...production.brief.deliveries[0],
    id: 'unready',
    timeline: {
      clips: [{ shot_id: 'missing', take_id: 'missing', source_in_ms: 0, duration_ms: 1000 }],
    },
  });
  assert.equal((await inspectDelivery(production, takes, { variantIds: ['ja-wide'] })).ok, true);
  assert.equal((await inspectDelivery(production, takes)).ok, false);
});

test('untracked output and pending lock are preserved instead of overwritten', async () => {
  const { production, takes } = await fixture();
  const outputDir = path.join(root, 'locked');
  const plan = await renderDeliveries(production, takes, { outputDir, dryRun: true });
  await fs.mkdir(outputDir);
  const output = plan.deliveries[0].path;
  await fs.writeFile(output.replace(/\.mp4$/, '.lock'), 'external pending render');
  await assert.rejects(renderDeliveries(production, takes, { outputDir }), (error) =>
    error.issues.some((i) => i.code === 'DELIVERY_RENDER_IN_PROGRESS'),
  );
  assert.equal(
    await fs.readFile(output.replace(/\.mp4$/, '.lock'), 'utf8'),
    'external pending render',
  );
  await fs.writeFile(output, 'untracked output');
  await assert.rejects(renderDeliveries(production, takes, { outputDir }), (error) =>
    error.issues.some((i) => i.code === 'OUTPUT_EXISTS_UNTRACKED'),
  );
  assert.equal(await fs.readFile(output, 'utf8'), 'untracked output');
});

test('SRT timestamps cross minute/hour boundaries and preserve multilingual text', () => {
  assert.match(
    captionsToSrt([{ start_ms: 3_661_002, end_ms: 3_662_000, text: 'Hello\r\nこんにちは' }]),
    /01:01:01,002 --> 01:01:02,000\nHello\nこんにちは/,
  );
});

function captionStyle() {
  return {
    font_path: captionFont,
    font_size: 14,
    safe_area: { x: 8, y: 42, width: 144, height: 40 },
    padding: 4,
    line_spacing: 2,
    color: '#ffffffff',
    background_color: '#000000dd',
  };
}

function rgbFrame(file, second) {
  return execFileSync('ffmpeg', [
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
}

test(
  'explicit font burn-in renders multilingual captions only during their range and entirely inside safe area',
  bitmapTest,
  async () => {
    const { production, takes } = await fixture();
    const delivery = production.brief.deliveries[0];
    delivery.caption_mode = 'both';
    delivery.caption_style = captionStyle();
    production.timeline.captions = [
      { start_ms: 200, end_ms: 800, text: '字幕\nHello', locale: 'ja' },
    ];
    production.assets.push({
      id: 'burn-voice',
      kind: 'audio',
      region: 'global',
      workspace_id: '0',
      path: audio,
      sha256: await fileHash(audio),
      qa,
    });
    production.timeline.audio.push({
      asset_id: 'burn-voice',
      start_ms: 0,
      source_in_ms: 0,
      duration_ms: 1000,
      volume: 0.5,
    });
    const outputDir = path.join(root, 'safe-subtitles');
    const check = await inspectDelivery(production, takes);
    assert.equal(check.ok, true, JSON.stringify(check.issues));
    assert.equal(check.caption_layouts[0].font.sha256, await fileHash(captionFont));
    const rendered = (await renderDeliveries(production, takes, { outputDir })).deliveries[0];
    assert.equal(rendered.technical_qc.caption_safe_area, 'geometry_pass_applied');
    assert.equal(rendered.caption_layout.applied, true);
    assert(rendered.captions.path.endsWith('.srt'));
    assert.equal(
      typeof rendered.measurements.mean_volume_db,
      'number',
      'narration mix remains audible with subtitle burn-in',
    );
    const area = delivery.caption_style.safe_area;
    for (const [second, expectedText] of [
      [0.1, false],
      [0.5, true],
      [0.9, false],
    ]) {
      const rgb = rgbFrame(rendered.path, second);
      let white = 0;
      for (let pixel = 0; pixel < rgb.length / 3; pixel++) {
        if (rgb[pixel * 3 + 1] < 150 || rgb[pixel * 3 + 2] < 150) continue;
        white++;
        const x = pixel % delivery.width,
          y = Math.floor(pixel / delivery.width);
        assert(
          x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height,
          `text outside safe area at ${x},${y}`,
        );
      }
      assert.equal(white > 0, expectedText, `caption timing at ${second}s`);
    }
    const again = await renderDeliveries(production, takes, {
      outputDir,
      ffmpeg: '/no-encode-on-reuse',
    });
    assert.equal(again.deliveries[0].reused, true);
    delivery.caption_mode = 'burn_in';
    const burnOnly = (await renderDeliveries(production, takes, { outputDir })).deliveries[0];
    assert.equal(
      burnOnly.captions,
      undefined,
      'burn-in alone does not silently add a requested sidecar',
    );
    assert.notEqual(burnOnly.path, rendered.path);
  },
);

test(
  'caption safe area, overflow, missing font and renderer limits block before writing output',
  bitmapTest,
  async () => {
    for (const [change, code] of [
      [
        (d) => {
          delete d.caption_style;
        },
        'CAPTION_STYLE_REQUIRED',
      ],
      [
        (d) => {
          d.caption_style.safe_area.x = 155;
        },
        'CAPTION_SAFE_AREA_INVALID',
      ],
      [
        (d) => {
          d.caption_style.safe_area.width = 8;
        },
        'CAPTION_OVERFLOW',
      ],
      [
        (d) => {
          d.caption_style.font_path = path.join(root, 'missing.ttf');
        },
        'CAPTION_FONT_UNAVAILABLE',
      ],
      [
        (d) => {
          d.caption_style.rotate = 45;
        },
        'CAPTION_STYLING_UNSUPPORTED',
      ],
    ]) {
      const { production, takes } = await fixture();
      const d = production.brief.deliveries[0];
      d.caption_mode = 'burn_in';
      d.caption_style = captionStyle();
      change(d);
      const checked = await inspectDelivery(production, takes);
      assert.equal(checked.ok, false);
      assert(
        checked.issues.some((i) => i.code === code),
        JSON.stringify(checked.issues),
      );
    }
    const { production, takes } = await fixture();
    const d = production.brief.deliveries[0];
    d.caption_mode = 'burn_in';
    d.caption_style = captionStyle();
    const unavailable = await inspectDelivery(production, takes, {
      python: '/no-python-installed',
    });
    assert(unavailable.issues.some((i) => i.code === 'CAPTION_RENDERER_UNAVAILABLE'));
    production.timeline.captions.push({
      start_ms: 200,
      end_ms: 500,
      text: 'Overlap',
      locale: 'ja',
    });
    const overlap = await inspectDelivery(production, takes);
    assert(overlap.issues.some((i) => i.code === 'CAPTION_OVERLAP_UNSUPPORTED'));
  },
);

test(
  'sidecar layout metadata measures safe area without claiming those pixels were burned into video',
  bitmapTest,
  async () => {
    const { production, takes } = await fixture();
    production.brief.deliveries[0].caption_mode = 'sidecar';
    production.brief.deliveries[0].caption_style = captionStyle();
    const planned = await renderDeliveries(production, takes, { dryRun: true });
    assert.equal(planned.deliveries[0].caption_layout.applied, false);
    production.brief.deliveries[0].caption_mode = 'off';
    const off = await renderDeliveries(production, takes, {
      dryRun: true,
      python: '/never-called',
    });
    assert.equal(off.deliveries[0].caption_layout, undefined);
  },
);

test('an unavailable optional bitmap runtime reports a blocker without installing or writing output', async () => {
  const { production, takes } = await fixture();
  production.brief.deliveries[0].caption_mode = 'burn_in';
  production.brief.deliveries[0].caption_style = { ...captionStyle(), font_path: video };
  const outputDir = path.join(root, 'no-bitmap-runtime');
  await assert.rejects(
    renderDeliveries(production, takes, { outputDir, python: '/no-optional-bitmap-runtime' }),
    (error) => error.issues?.some((i) => i.code === 'CAPTION_RENDERER_UNAVAILABLE'),
  );
  await assert.rejects(fs.stat(outputDir), { code: 'ENOENT' });
});

test('variant-specific explicit crop reframes a supplied image without touching the horizontal edit or protected subject', async () => {
  const { production, takes } = await fixture();
  const image = path.join(root, 'reframe-source.ppm');
  const pixels = Buffer.alloc(160 * 90 * 3);
  for (let y = 0; y < 90; y++)
    for (let x = 0; x < 160; x++) pixels[(y * 160 + x) * 3 + (x < 80 ? 0 : 2)] = 255;
  await fs.writeFile(image, Buffer.concat([Buffer.from('P6\n160 90\n255\n'), pixels]));
  takes.splice(1);
  takes[0] = { ...takes[0], kind: 'image', path: image, sha256: await fileHash(image) };
  production.shots.splice(1);
  production.timeline.captions = [];
  production.timeline.clips = [
    { shot_id: 's1', take_id: 'take-1', source_in_ms: 0, duration_ms: 1000, audio: false },
  ];
  production.brief.deliveries.push({
    id: 'ja-portrait',
    locale: 'ja',
    aspect: '9:16',
    width: 90,
    height: 160,
    duration_ms: 1000,
    timeline: {
      clips: [
        {
          ...production.timeline.clips[0],
          crop: { x: 100, y: 0, width: 50, height: 90 },
          protected_regions: [
            { x: 105, y: 10, width: 35, height: 60, label: 'Required blue subject' },
          ],
        },
      ],
    },
  });
  const before = structuredClone(production);
  const sourceHash = await fileHash(image);
  const result = await renderDeliveries(production, takes, {
    outputDir: path.join(root, 'reframed'),
  });
  const wide = rgbFrame(result.deliveries[0].path, 0.5),
    portrait = rgbFrame(result.deliveries[1].path, 0.5);
  assert(wide[(45 * 160 + 20) * 3] > 180 && wide[(45 * 160 + 140) * 3 + 2] > 180);
  assert(portrait[(80 * 90 + 45) * 3 + 2] > 180 && portrait[(80 * 90 + 45) * 3] < 40);
  assert.equal(result.deliveries[1].technical_qc.crop_bounds, 'pass');
  assert.equal(result.deliveries[1].framing_review, 'pending_visual_review');
  assert.deepEqual(production, before);
  assert.equal(await fileHash(image), sourceHash);
  const crop = production.brief.deliveries[1].timeline.clips[0];
  crop.protected_regions.push({ x: 0, y: 0, width: 50, height: 90, label: 'Required red subject' });
  const clipped = await inspectDelivery(production, takes);
  assert(clipped.issues.some((i) => i.code === 'CROP_PROTECTED_REGION_CLIPPED'));
  crop.crop.width = 100;
  const outOfBounds = await inspectDelivery(production, takes);
  assert(outOfBounds.issues.some((i) => i.code === 'CROP_RECT_INVALID'));
  crop.crop.width = 50;
  crop.protected_regions.splice(1);
  const orientation = await inspectDelivery(production, takes, {
    probe: async (file) => ({ ...(await probeMedia(file)), rotation: 90 }),
  });
  assert(orientation.issues.some((i) => i.code === 'CROP_ORIENTATION_UNSUPPORTED'));
});

test('only explicit media QC thresholds block export; intended silence remains valid', async () => {
  const { production, takes } = await fixture();
  production.timeline.captions = [];
  const d = production.brief.deliveries[0];
  d.qc = { expected_audio: false, max_silence_interval_ms: 100, min_mean_volume_db: -10 };
  const intendedSilent = await renderDeliveries(production, takes, {
    outputDir: path.join(root, 'intentional-silence'),
  });
  assert(
    intendedSilent.deliveries[0].measurements.mean_volume_db === '-inf' ||
      intendedSilent.deliveries[0].measurements.mean_volume_db <= -90,
  );
  assert.equal(
    intendedSilent.deliveries[0].quality_review,
    'explicit_policy_pass_pending_creative_review',
  );
  d.qc.expected_audio = true;
  await assert.rejects(
    renderDeliveries(production, takes, { outputDir: path.join(root, 'unexpected-silence') }),
    (error) =>
      error.issues?.some((i) => i.code === 'SILENCE_INTERVAL_EXCEEDS_LIMIT') &&
      error.issues.some((i) => i.code === 'MEAN_VOLUME_BELOW_LIMIT'),
  );
  d.qc = { invented_measurement: 4 };
  assert(
    (await inspectDelivery(production, takes)).issues.some((i) => i.code === 'QC_POLICY_INVALID'),
  );
});

test('an explicitly disallowed black interval blocks before publishing a completed output', async () => {
  const { production, takes } = await fixture();
  const image = path.join(root, 'black.ppm');
  await fs.writeFile(image, 'P3\n2 2\n255\n0 0 0 0 0 0 0 0 0 0 0 0\n');
  takes.splice(1);
  takes[0] = { ...takes[0], kind: 'image', path: image, sha256: await fileHash(image) };
  production.shots.splice(1);
  production.timeline.captions = [];
  production.timeline.clips = [
    { shot_id: 's1', take_id: 'take-1', source_in_ms: 0, duration_ms: 1000, audio: false },
  ];
  production.brief.deliveries[0].qc = { max_black_interval_ms: 100, expected_audio: false };
  const outputDir = path.join(root, 'black-disallowed');
  await assert.rejects(renderDeliveries(production, takes, { outputDir }), (error) =>
    error.issues?.some(
      (i) =>
        i.code === 'BLACK_INTERVAL_EXCEEDS_LIMIT' && i.measurements.black_intervals_ms.length > 0,
    ),
  );
  assert.deepEqual(await fs.readdir(outputDir), []);
  assert.equal(await fileHash(image), takes[0].sha256);
});
