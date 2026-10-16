// A text-only timing preview. No provider, registry, take or acceptance mutation.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertProduction, canonical, hash } from './contracts.mjs';
import { fileHash, probeMedia } from './finish.mjs';

export class PlanPreviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PlanPreviewError';
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new PlanPreviewError(code, message);
};
const safe = (s) =>
  String(s)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 64) || 'preview';
async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}
async function run(binary, args, input) {
  return new Promise((resolve, reject) => {
    const c = spawn(binary, args, {
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      bytes = 0,
      overflow = false;
    const collect = (name) => (chunk) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) {
        overflow = true;
        c.kill();
        return;
      }
      if (name === 'out') stdout += chunk;
      else stderr += chunk;
    };
    c.stdout.on('data', collect('out'));
    c.stderr.on('data', collect('err'));
    c.once('error', reject);
    if (input !== undefined) {
      c.stdin.on('error', reject);
      c.stdin.end(input);
    }
    c.once('close', (code) =>
      code === 0 && !overflow
        ? resolve({ stdout, stderr })
        : reject(
            new PlanPreviewError(
              'PREVIEW_TOOL_FAILED',
              `${binary}: ${overflow ? 'output limit' : code}: ${stderr.slice(-3000)}`,
            ),
          ),
    );
  });
}
const BITMAP_SCRIPT = String.raw`
import json,sys
try:
 import PIL
 from PIL import Image,ImageDraw,ImageFont
except ImportError:
 print(json.dumps({"error":"PREVIEW_RENDERER_UNAVAILABLE","message":"An existing Python 3 + Pillow runtime is required"}));sys.exit(0)
r=json.load(sys.stdin)
try:
 layouts=[]
 for card in r["cards"]:
  image=Image.new("RGB",(r["width"],r["height"]),(18,24,36));draw=ImageDraw.Draw(image)
  margin=max(6,r["width"]//40)
  chosen=None
  for size in range(max(9,min(22,r["height"]//20)),7,-1):
   font=ImageFont.truetype(r["font_path"],size,index=0)
   lines=[]
   for paragraph in card["text"]:
    for rawline in paragraph.replace("\r\n","\n").replace("\r","\n").split("\n"):
     line=""
     for ch in rawline:
      if ch=="\t": ch=" "
      trial=line+ch
      box=draw.textbbox((0,0),trial,font=font)
      if box[2]-box[0]>r["width"]-2*margin:
       if not line: raise ValueError("A glyph exceeds the preview width")
       lines.append(line);line=ch
      else: line=trial
     lines.append(line)
   boxes=[draw.textbbox((0,0),line or " ",font=font) for line in lines]
   heights=[max(size,b[3]-b[1])+2 for b in boxes]
   if sum(heights)<=r["height"]-2*margin:
    chosen=(font,lines,boxes,heights,size);break
  if chosen is None:
   print(json.dumps({"error":"PREVIEW_TEXT_OVERFLOW","message":"Text does not fit the preview card; shorten shot notes or use a larger delivery size","shot_id":card["shot_id"]}));sys.exit(0)
  font,lines,boxes,heights,size=chosen;y=margin;rects=[]
  for n,(line,box,height) in enumerate(zip(lines,boxes,heights)):
   color=(255,200,87) if n==0 else (238,242,249)
   draw.text((margin-box[0],y-box[1]),line,font=font,fill=color)
   rects.append({"x":margin,"y":y,"width":box[2]-box[0],"height":box[3]-box[1]});y+=height
  image.save(card["path"],"PNG")
  layouts.append({"shot_id":card["shot_id"],"font_size":size,"lines":lines,"glyph_boxes":rects})
 print(json.dumps({"pillow_version":PIL.__version__,"layouts":layouts}))
except Exception as e:
 print(json.dumps({"error":"PREVIEW_FONT_OR_LAYOUT_INVALID","message":str(e)}))
`;

function sequenceFor(p, variant) {
  const shots = new Map(p.shots.map((s) => [s.shot_id, s]));
  const clips = (variant.timeline?.clips ?? p.timeline?.clips ?? []).filter(
    (c) =>
      (!c.locale || c.locale === variant.locale) &&
      (!c.delivery_id || c.delivery_id === variant.id) &&
      (!c.variant_id || c.variant_id === variant.id),
  );
  const selected = clips.length
    ? clips.map((c) => {
        const shot = shots.get(c.shot_id);
        if (!shot) fail('PREVIEW_SHOT_UNKNOWN', 'Variant timeline references an unknown shot');
        return { ...shot, edit_duration_ms: c.duration_ms };
      })
    : p.shots;
  if (selected.length > 100) fail('PREVIEW_LIMIT', 'Text preview supports at most 100 shot cards');
  if (selected.some((s) => !Number.isSafeInteger(s.edit_duration_ms) || s.edit_duration_ms <= 0))
    fail('PREVIEW_DURATION_INVALID', 'Each shot requires positive integer milliseconds');
  const duration = selected.reduce((n, s) => n + s.edit_duration_ms, 0);
  if (duration !== variant.duration_ms)
    fail(
      'PREVIEW_DURATION_MISMATCH',
      'Selected shot durations must sum to the requested variant duration',
    );
  if (duration > 600000) fail('PREVIEW_LIMIT', 'Text preview supports at most 10 minutes');
  return selected;
}
function previewSize(variant) {
  const [a, b] = variant.aspect.split(':').map(Number);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a <= 0 || b <= 0)
    fail('PREVIEW_ASPECT_INVALID', 'Positive aspect ratio required');
  const gcd = (x, y) => (y ? gcd(y, x % y) : x),
    d = gcd(a, b),
    x = a / d,
    y = b / d;
  let bound = 640;
  if (variant.width !== undefined || variant.height !== undefined) {
    if (
      !Number.isSafeInteger(variant.width) ||
      !Number.isSafeInteger(variant.height) ||
      variant.width <= 0 ||
      variant.height <= 0 ||
      variant.width * b !== variant.height * a
    )
      fail('PREVIEW_SIZE_INVALID', 'Delivery dimensions must match its aspect ratio');
    bound = Math.min(640, Math.max(variant.width, variant.height));
  }
  const unit = Math.floor(bound / Math.max(x, y) / 2) * 2,
    width = x * unit,
    height = y * unit;
  if (width < 160 || height < 90)
    fail('PREVIEW_SIZE_INVALID', 'Preview dimensions are too small for shot text');
  return { width, height };
}

/** Render planned shot text without reading source media or touching a ledger. */
export async function renderPlanPreview(
  production,
  {
    outputDir,
    fontPath,
    dryRun = false,
    variantId,
    python = 'python3',
    ffmpeg = 'ffmpeg',
    ffprobe = 'ffprobe',
  } = {},
) {
  const p = structuredClone(assertProduction(production));
  if (typeof outputDir !== 'string' || !outputDir)
    fail('PREVIEW_OUTPUT_REQUIRED', 'An explicit preview output directory is required');
  if (typeof fontPath !== 'string' || !fontPath)
    fail('PREVIEW_FONT_REQUIRED', 'An explicit existing font is required');
  if (typeof dryRun !== 'boolean') fail('PREVIEW_DRY_RUN_INVALID', 'dryRun must be boolean');
  if (!variantId && p.brief.deliveries.length !== 1)
    fail('PREVIEW_VARIANT_REQUIRED', 'Select one declared delivery variant');
  const variant = p.brief.deliveries.find((d) => d.id === (variantId ?? p.brief.deliveries[0].id));
  if (!variant) fail('PREVIEW_VARIANT_UNKNOWN', 'Selected variant is absent from the brief');
  const sequence = sequenceFor(p, variant),
    { width, height } = previewSize(variant),
    fps = p.timeline?.fps ?? 10;
  if (!Number.isInteger(fps) || fps < 1 || fps > 60)
    fail('PREVIEW_FPS_INVALID', 'Preview fps must be an integer from 1 through 60');
  let elapsed = 0,
    priorFrame = 0;
  const cards = sequence.map((s, index) => {
    const start_ms = elapsed;
    elapsed += s.edit_duration_ms;
    const endFrame = Math.round((elapsed * fps) / 1000),
      frames = endFrame - priorFrame;
    if (frames < 1)
      fail('PREVIEW_SHOT_TOO_SHORT', 'Each card must occupy at least one preview frame');
    const card = {
      shot_id: s.shot_id,
      index,
      duration_ms: s.edit_duration_ms,
      start_ms,
      end_ms: elapsed,
      start_frame: priorFrame,
      frames,
      purpose: s.purpose,
      entry_state: s.entry_state,
      exit_state: s.exit_state,
      camera: s.camera,
      audio: s.audio,
    };
    priorFrame = endFrame;
    card.text = [
      'PLANNING PREVIEW | SILENT PLACEHOLDERS',
      `Shot ${index + 1}/${sequence.length}: ${s.shot_id} | ${start_ms / 1000}-${elapsed / 1000}s`,
      `Brief: ${p.brief.original}`,
      `Intent: ${p.brief.intent}`,
      `Purpose: ${s.purpose}`,
      `Before: ${canonical(s.entry_state)}`,
      `After: ${canonical(s.exit_state)}`,
      `Camera: ${s.camera}`,
      `Sound intent (not played): ${canonical(s.audio)}`,
      'NOT GENERATED | NOT REVIEWED | NOT FINAL',
    ];
    return card;
  });
  const fontFile = path.resolve(fontPath),
    stat = await fs.stat(fontFile).catch(() => null);
  if (!stat?.isFile() || !stat.size)
    fail('PREVIEW_FONT_INVALID', 'Font must be an existing nonempty regular file');
  const font_sha256 = await fileHash(fontFile);
  const specification = {
    project_id: p.project_id,
    variant_id: variant.id,
    locale: variant.locale,
    aspect: variant.aspect,
    width,
    height,
    fps,
    planned_duration_ms: elapsed,
    rendered_duration_ms: (priorFrame / fps) * 1000,
    total_frames: priorFrame,
    frame_rounding: 'cumulative_nearest_frame',
    timing_tolerance_ms: 1000 / fps,
    cards,
    font_sha256,
    renderer: 'text-plan-preview.v1',
    bitmap_script_hash: hash(BITMAP_SCRIPT),
  };
  const fingerprint = hash(specification),
    dir = path.resolve(outputDir),
    stem = `plan-${safe(p.project_id)}-${safe(variant.id)}-${fingerprint}`,
    output = path.join(dir, `${stem}.mp4`),
    manifestPath = path.join(dir, `${stem}.json`),
    lockPath = path.join(dir, `${stem}.lock`);
  const base = {
    schema_version: 'planning-preview.v1',
    status: 'planning_preview',
    adoption: 'not_reviewed',
    final_delivery: false,
    placeholder: true,
    audio: 'silent_no_audio_stream',
    review_required: true,
    generation_jobs: 0,
    provider_calls: 0,
    source_media_used: false,
    font_coverage_verified: false,
    fingerprint,
    specification,
    notice:
      'Text-only silent placeholders for shot order and timing. No generated performance, source footage, spoken audio, accepted take or final QA.',
    output: { path: output },
    manifest_path: manifestPath,
  };
  // This branch precedes all mkdir/write/child-process calls, including capability probes.
  if (dryRun)
    return {
      ...base,
      dry_run: true,
      preview_rendered: false,
      reused: false,
      font_layout_verified: false,
    };
  const oldOutput = await exists(output),
    oldManifest = await exists(manifestPath);
  if (oldOutput || oldManifest) {
    if (!oldOutput || !oldManifest)
      fail(
        'PREVIEW_OUTPUT_EXISTS',
        'Existing output or manifest is incomplete; preserved for inspection',
      );
    try {
      if (!(await fs.lstat(output)).isFile() || !(await fs.lstat(manifestPath)).isFile())
        throw new Error('regular files required');
      const old = JSON.parse(await fs.readFile(manifestPath, 'utf8')),
        { record_hash, ...record } = old;
      if (
        record_hash !== hash(record) ||
        old.fingerprint !== fingerprint ||
        hash(old.specification) !== hash(specification) ||
        old.output.path !== output ||
        old.output.sha256 !== (await fileHash(output))
      )
        throw new Error('hash or specification mismatch');
      const reused = { ...record, reused: true };
      return { ...reused, record_hash: hash(reused) };
    } catch {
      fail(
        'PREVIEW_CACHE_MISMATCH',
        'Existing preview failed hash verification; files were preserved',
      );
    }
  }
  await fs.mkdir(dir, { recursive: true });
  let lock, work;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST')
      fail(
        'PREVIEW_IN_PROGRESS',
        'An existing preview lock requires inspection; it is never removed automatically',
      );
    throw e;
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, fingerprint }));
    work = await fs.mkdtemp(path.join(dir, '.plan-preview-'));
    const paths = cards.map((c, n) => path.join(work, `${String(n).padStart(4, '0')}.png`));
    let drawn;
    try {
      const r = await run(
        python,
        ['-c', BITMAP_SCRIPT],
        JSON.stringify({
          width,
          height,
          font_path: fontFile,
          cards: cards.map((c, n) => ({ ...c, path: paths[n] })),
        }),
      );
      drawn = JSON.parse(r.stdout);
    } catch (e) {
      if (e.code === 'ENOENT')
        fail('PREVIEW_RENDERER_UNAVAILABLE', 'An existing Python 3 + Pillow runtime is required');
      throw e;
    }
    if (drawn.error) fail(drawn.error, drawn.message);
    for (let n = 0; n < cards.length; n++)
      await run(ffmpeg, [
        '-v',
        'error',
        '-n',
        '-loop',
        '1',
        '-framerate',
        String(fps),
        '-i',
        paths[n],
        '-frames:v',
        String(cards[n].frames),
        '-an',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        path.join(work, `${String(n).padStart(4, '0')}.mp4`),
      ]);
    const concat = path.join(work, 'segments.txt');
    await fs.writeFile(
      concat,
      cards.map((_, n) => `file '${String(n).padStart(4, '0')}.mp4'`).join('\n') + '\n',
      { flag: 'wx' },
    );
    const rendered = path.join(work, 'preview.mp4');
    await run(ffmpeg, [
      '-v',
      'error',
      '-n',
      '-f',
      'concat',
      '-safe',
      '1',
      '-i',
      concat,
      '-an',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      rendered,
    ]);
    const probe = await probeMedia(rendered, { ffprobe });
    if (
      !probe.video ||
      probe.audio_streams !== 0 ||
      probe.width !== width ||
      probe.height !== height ||
      Math.abs(probe.fps - fps) > 0.01 ||
      Math.abs(probe.duration_ms - specification.rendered_duration_ms) > 1000 / fps + 2
    )
      fail(
        'PREVIEW_TECHNICAL_MISMATCH',
        'Encoded preview does not match its planned silent timing',
      );
    await run(ffmpeg, ['-v', 'error', '-i', rendered, '-f', 'null', '-']);
    if ((await fileHash(fontFile)) !== font_sha256)
      fail('PREVIEW_FONT_CHANGED', 'Font changed during rendering; no preview was published');
    const record = {
      ...base,
      dry_run: false,
      preview_rendered: true,
      reused: false,
      pillow_version: drawn.pillow_version,
      font_layout_verified: true,
      layouts: drawn.layouts,
      probe,
      technical_check: 'encoded_dimensions_timing_silent_full_decode',
      output: {
        path: output,
        sha256: await fileHash(rendered),
        bytes: (await fs.stat(rendered)).size,
      },
    };
    const manifest = { ...record, record_hash: hash(record) },
      pending = path.join(work, 'manifest.json');
    await fs.writeFile(pending, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await fs.link(rendered, output);
    await fs.link(pending, manifestPath);
    return manifest;
  } finally {
    if (work) await fs.rm(work, { recursive: true, force: true });
    const held = await lock.stat();
    await lock.close();
    const current = await fs.lstat(lockPath).catch(() => null);
    if (current && current.ino === held.ino) await fs.rm(lockPath);
  }
}
