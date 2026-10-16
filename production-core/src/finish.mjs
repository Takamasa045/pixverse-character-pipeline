import { requireMatchingContext } from './review.mjs';
// Local-only finishing. This module never submits jobs or changes adopted takes.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { inspectMediaQuality, evaluateQuality } from './quality.mjs';

const clone = (value) => structuredClone(value);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe = (value) =>
  String(value)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 100) || 'delivery';
const positive = (value) => Number.isFinite(value) && value > 0;
const integer = (value) => Number.isInteger(value) && value >= 0;
const secs = (ms) => String(ms / 1000);
const status = (value) => (typeof value === 'object' && value ? value.status : value);
const qaPass = (qa) =>
  qa &&
  ['technical', 'creative', 'continuity'].every((k) => status(qa[k]) === 'pass') &&
  ['pass', 'not_applicable'].includes(status(qa.audio)) &&
  typeof qa.reviewer === 'string' &&
  qa.reviewer.trim() &&
  typeof qa.notes === 'string';
const relevant = (item, delivery) =>
  (!item.delivery_id || item.delivery_id === delivery.id) &&
  (!item.variant_id || item.variant_id === delivery.id) &&
  (!item.locale || item.locale === delivery.locale);
const selectedTimeline = (production, delivery) =>
  Object.fromEntries(
    ['clips', 'audio', 'captions'].map((key) => [
      key,
      (key === 'captions' && delivery.caption_mode === 'off'
        ? []
        : (delivery.timeline?.[key] ?? production.timeline?.[key] ?? [])
      ).filter((item) => relevant(item, delivery)),
    ]),
  );

export class DeliveryGateError extends Error {
  constructor(issues) {
    super(`Delivery blocked: ${issues.map((x) => x.code).join(', ')}`);
    this.name = 'DeliveryGateError';
    this.code = 'DELIVERY_BLOCKED';
    this.issues = issues;
  }
}

export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function command(binary, args, { maxBytes = 2_000_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (input !== undefined) {
      child.stdin.on('error', reject);
      child.stdin.end(input);
    }
    let stdout = '',
      stderr = '',
      bytes = 0,
      overflow = false;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        overflow = true;
        child.kill();
        return;
      }
      if (target === 'out') stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 && !overflow
        ? resolve({ stdout, stderr })
        : reject(
            Object.assign(
              new Error(
                `${binary} failed (${overflow ? 'output limit' : code}): ${stderr.slice(-6000)}`,
              ),
              { code: 'LOCAL_TOOL_FAILED', exit_code: code },
            ),
          ),
    );
  });
}

const rectValid = (rect, width, height) =>
  rect &&
  ['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(rect[key])) &&
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.width > 0 &&
  rect.height > 0 &&
  rect.x + rect.width <= width &&
  rect.y + rect.height <= height;
const containsRect = (outer, inner) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
const burnsCaptions = (delivery) => ['burn_in', 'both'].includes(delivery.caption_mode);

// Optional installed Pillow supplies font measurement and bitmap text on FFmpeg builds
// without drawtext/libfreetype. JSON goes through stdin, never shell/filter text.
const CAPTION_BITMAP_SCRIPT = String.raw`
import json, sys, math
request = json.load(sys.stdin)
try:
    import PIL
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print(json.dumps({"ok": False, "code": "CAPTION_RENDERER_UNAVAILABLE"})); sys.exit(0)
style = request["style"]
try:
    font = ImageFont.truetype(style["font_path"], style["font_size"], index=style["font_index"])
except Exception as error:
    print(json.dumps({"ok": False, "code": "CAPTION_FONT_INVALID", "message": str(error)})); sys.exit(0)
measure = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
area = style["safe_area"]
layouts = []
for index, caption in enumerate(request["captions"]):
    text = caption["text"].replace("\r\n", "\n").replace("\r", "\n")
    box = measure.multiline_textbbox((0, 0), text, font=font, spacing=style["line_spacing"], align=style["align"])
    box = tuple(int(math.floor(value) if index < 2 else math.ceil(value)) for index, value in enumerate(box))
    padding = style["padding"]
    width, height = box[2]-box[0]+2*padding, box[3]-box[1]+2*padding
    if width <= 0 or height <= 0 or width > area["width"] or height > area["height"]:
        print(json.dumps({"ok": False, "code": "CAPTION_OVERFLOW", "caption_index": index, "measured_width": width, "measured_height": height})); sys.exit(0)
    x = area["x"] + (0 if style["align"] == "left" else area["width"]-width if style["align"] == "right" else (area["width"]-width)//2)
    y = area["y"] + (0 if style["vertical_align"] == "top" else area["height"]-height if style["vertical_align"] == "bottom" else (area["height"]-height)//2)
    result = {"caption_index": index, "box": {"x": x, "y": y, "width": width, "height": height}, "glyph_box": {"x": x+padding, "y": y+padding, "width": box[2]-box[0], "height": box[3]-box[1]}}
    if request.get("output_paths"):
        image = Image.new("RGBA", (width, height), style["background_color"])
        ImageDraw.Draw(image).multiline_text((padding-box[0], padding-box[1]), text, font=font, fill=style["color"], spacing=style["line_spacing"], align=style["align"])
        image.save(request["output_paths"][index], format="PNG")
    layouts.append(result)
print(json.dumps({"ok": True, "layouts": layouts, "pillow_version": PIL.__version__}))
`;

async function captionBitmapRequest(style, captions, options, outputPaths) {
  const { stdout } = await command(options.python || 'python3', ['-c', CAPTION_BITMAP_SCRIPT], {
    input: JSON.stringify({ style, captions, output_paths: outputPaths }),
  });
  return JSON.parse(stdout);
}

async function inspectCaptionLayout(delivery, captions, options) {
  const issues = [],
    raw = delivery.caption_style;
  const add = (code, detail = {}) => issues.push({ code, delivery_id: delivery.id, ...detail });
  if (!raw || typeof raw !== 'object')
    return { issues: [{ code: 'CAPTION_STYLE_REQUIRED', delivery_id: delivery.id }] };
  const allowed = [
    'font_path',
    'font_size',
    'font_index',
    'line_spacing',
    'padding',
    'align',
    'vertical_align',
    'color',
    'background_color',
    'safe_area',
  ];
  if (Object.keys(raw).some((key) => !allowed.includes(key))) add('CAPTION_STYLING_UNSUPPORTED');
  const style = {
    ...raw,
    font_index: raw.font_index ?? 0,
    line_spacing: raw.line_spacing ?? 4,
    padding: raw.padding ?? 0,
    align: raw.align ?? 'center',
    vertical_align: raw.vertical_align ?? 'bottom',
    color: raw.color ?? '#ffffffff',
    background_color: raw.background_color ?? '#00000000',
  };
  if (
    !rectValid(style.safe_area, delivery.width, delivery.height) ||
    Object.keys(style.safe_area || {}).some((key) => !['x', 'y', 'width', 'height'].includes(key))
  )
    add('CAPTION_SAFE_AREA_INVALID');
  if (
    !Number.isSafeInteger(style.font_size) ||
    style.font_size < 1 ||
    style.font_size > 512 ||
    !integer(style.font_index) ||
    !integer(style.line_spacing) ||
    !integer(style.padding) ||
    !['left', 'center', 'right'].includes(style.align) ||
    !['top', 'center', 'bottom'].includes(style.vertical_align) ||
    !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(style.color) ||
    !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(style.background_color)
  )
    add('CAPTION_STYLE_INVALID');
  if (captions.length > 64) add('CAPTION_COUNT_UNSUPPORTED', { limit: 64 });
  if (captions.some((c) => typeof c.text !== 'string' || c.text.length > 10000))
    add('CAPTION_TEXT_INVALID');
  const ordered = [...captions].sort((a, b) => a.start_ms - b.start_ms);
  if (
    burnsCaptions(delivery) &&
    ordered.some((c, i) => i > 0 && c.start_ms < ordered[i - 1].end_ms)
  )
    add('CAPTION_OVERLAP_UNSUPPORTED');
  let font;
  try {
    if (typeof style.font_path !== 'string') throw new Error('An existing font_path is required');
    style.font_path = path.resolve(options.baseDir || '.', style.font_path);
    const stat = await fs.stat(style.font_path);
    if (!stat.isFile() || !stat.size) throw new Error('Font is not a nonempty file');
    font = { path: style.font_path, sha256: await fileHash(style.font_path) };
  } catch (error) {
    add('CAPTION_FONT_UNAVAILABLE', { message: error.message });
  }
  if (issues.length) return { issues };
  try {
    const measured = await captionBitmapRequest(style, captions, options);
    if (!measured.ok) {
      add(measured.code, measured);
      return { issues };
    }
    return {
      issues,
      layout: {
        delivery_id: delivery.id,
        applied: burnsCaptions(delivery),
        style,
        font,
        pillow_version: measured.pillow_version,
        safe_area: style.safe_area,
        captions: measured.layouts,
      },
    };
  } catch (error) {
    add('CAPTION_RENDERER_UNAVAILABLE', { message: error.message });
    return { issues };
  }
}

export async function probeMedia(file, { ffprobe = 'ffprobe' } = {}) {
  const { stdout } = await command(ffprobe, [
    '-v',
    'error',
    '-show_format',
    '-show_streams',
    '-of',
    'json',
    file,
  ]);
  const raw = JSON.parse(stdout);
  const video = raw.streams?.find((s) => s.codec_type === 'video');
  const audio = raw.streams?.filter((s) => s.codec_type === 'audio') || [];
  const rate = video?.avg_frame_rate || video?.r_frame_rate;
  const [a, b] = String(rate || '0/1')
    .split('/')
    .map(Number);
  const duration = Number(raw.format?.duration ?? video?.duration ?? audio[0]?.duration);
  const rotation = Number(
    video?.side_data_list?.find((side) => side.rotation !== undefined)?.rotation ??
      video?.tags?.rotate ??
      0,
  );
  return {
    duration_ms: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: b ? a / b : null,
    rotation: Number.isFinite(rotation) ? rotation : null,
    video: Boolean(video),
    audio_streams: audio.length,
    codecs: (raw.streams || []).map((s) => ({ type: s.codec_type, codec: s.codec_name })),
    size: Number(raw.format?.size) || null,
  };
}

/** Check persisted adoption, source bytes, edit capabilities and requested delivery specs. */
export async function inspectDelivery(production, takes, options = {}) {
  const issues = [],
    sources = [],
    caption_layouts = [],
    deliveries = production.brief?.deliveries || [];
  const add = (code, detail = {}) => issues.push({ code, ...detail });
  try {
    requireMatchingContext(production.context);
  } catch (error) {
    add('PRODUCTION_CONTEXT_INVALID', { message: error.message });
  }
  if (production.schema_version !== 'production.v1') add('SCHEMA_UNSUPPORTED');
  if (
    typeof production.project_id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(production.project_id) ||
    !Number.isSafeInteger(production.revision) ||
    production.revision <= 0
  )
    add('PRODUCTION_IDENTITY_INVALID');
  if (!positive(production.timeline?.fps) || production.timeline.fps > 120) add('FPS_INVALID');
  if (!deliveries.length) add('DELIVERIES_MISSING');
  if (!deliveries.some((d) => !options.variantIds || options.variantIds.includes(d.id)))
    add('DELIVERY_SELECTION_EMPTY');
  if (new Set(deliveries.map((d) => d.id)).size !== deliveries.length) add('DELIVERY_ID_DUPLICATE');
  const byTake = new Map((takes || []).map((t) => [t.id, t]));
  if (byTake.size !== (takes || []).length) add('TAKE_ID_DUPLICATE');
  const byShot = new Map((production.shots || []).map((s) => [s.shot_id, s]));
  const byAsset = new Map((production.assets || []).map((a) => [a.id, a]));
  if (byShot.size !== (production.shots || []).length) add('SHOT_ID_DUPLICATE');
  if (byAsset.size !== (production.assets || []).length) add('ASSET_ID_DUPLICATE');
  if ([...byTake.keys()].some((id) => byAsset.has(id))) add('SOURCE_ID_COLLISION');
  const probe = options.probe || ((file) => probeMedia(file, options));
  const seenSources = new Map();
  async function inspectSource(source, kind, identity) {
    try {
      const context =
        source?.provenance?.context ??
        (source?.region !== undefined || source?.workspace_id !== undefined
          ? { region: source.region, workspace_id: source.workspace_id }
          : undefined);
      requireMatchingContext(context, production.context);
    } catch (error) {
      add('SOURCE_CONTEXT_INVALID', { source_id: identity, message: error.message });
    }
    const key = `${identity}:${source?.path}`;
    if (seenSources.has(key)) return seenSources.get(key);
    if (!source?.path) {
      add('SOURCE_FILE_MISSING', { source_id: identity });
      return null;
    }
    const absolute = path.resolve(options.baseDir || '.', source.path);
    const record = { source_id: identity, path: absolute, kind };
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile() || !stat.size) throw new Error('not a nonempty regular file');
      record.sha256 = await fileHash(absolute);
      record.size = stat.size;
      if (!source.sha256) add('SOURCE_HASH_MISSING', { source_id: identity });
      else if (source.sha256 !== record.sha256)
        add('SOURCE_HASH_MISMATCH', { source_id: identity });
      record.probe = await probe(absolute);
      if (kind === 'video' && (!record.probe.video || !positive(record.probe.duration_ms)))
        add('VIDEO_INVALID', { source_id: identity });
      if (kind === 'image' && !record.probe.video) add('IMAGE_INVALID', { source_id: identity });
      if (kind === 'audio' && !record.probe.audio_streams)
        add('AUDIO_INVALID', { source_id: identity });
    } catch (error) {
      add('SOURCE_UNREADABLE', { source_id: identity, message: error.message });
    }
    seenSources.set(key, record);
    sources.push(record);
    return record;
  }
  for (const delivery of deliveries.filter(
    (d) => !options.variantIds || options.variantIds.includes(d.id),
  )) {
    const timeline = selectedTimeline(production, delivery);
    const duration = timeline.clips.reduce((n, c) => n + (Number(c.duration_ms) || 0), 0);
    for (const requirement of production.review_requirements ?? [])
      if (timeline.clips.some((clip) => clip.shot_id === requirement.shot_id))
        add('DEPENDENCY_REVIEW_REQUIRED', {
          delivery_id: delivery.id,
          shot_id: requirement.shot_id,
        });
    if (
      !delivery.id ||
      !Number.isInteger(delivery.width) ||
      !Number.isInteger(delivery.height) ||
      delivery.width < 2 ||
      delivery.height < 2 ||
      delivery.width % 2 ||
      delivery.height % 2
    )
      add('DIMENSIONS_INVALID', { delivery_id: delivery.id });
    const aspect = String(delivery.aspect || '')
      .split(':')
      .map(Number);
    if (
      aspect.length !== 2 ||
      !aspect.every(positive) ||
      Math.abs(delivery.width / delivery.height - aspect[0] / aspect[1]) > 0.01
    )
      add('ASPECT_MISMATCH', { delivery_id: delivery.id });
    if (!timeline.clips.length) add('TIMELINE_EMPTY', { delivery_id: delivery.id });
    if (!integer(delivery.duration_ms) || delivery.duration_ms !== duration)
      add('DELIVERY_DURATION_MISMATCH', {
        delivery_id: delivery.id,
        expected: delivery.duration_ms,
        actual: duration,
      });
    if (
      delivery.caption_mode &&
      !['off', 'sidecar', 'burn_in', 'both'].includes(delivery.caption_mode)
    )
      add('CAPTION_MODE_UNSUPPORTED', { delivery_id: delivery.id, value: delivery.caption_mode });
    if (delivery.effects?.length || (delivery.transition && delivery.transition !== 'cut'))
      add('EDIT_UNSUPPORTED', { delivery_id: delivery.id });
    try {
      evaluateQuality(
        {
          black_intervals_ms: [],
          silence_intervals_ms: [],
          has_audio: true,
          mean_volume_db: 0,
          peak_volume_db: 0,
        },
        delivery.qc || {},
      );
    } catch (error) {
      add('QC_POLICY_INVALID', { delivery_id: delivery.id, message: error.message });
    }
    for (const clip of timeline.clips) {
      const shot = byShot.get(clip.shot_id),
        take = byTake.get(clip.take_id);
      if (!shot) add('SHOT_MISSING', { shot_id: clip.shot_id });
      if (!take || take.shot_id !== clip.shot_id || take.project_id !== production.project_id) {
        add('TAKE_MISMATCH', { shot_id: clip.shot_id, take_id: clip.take_id });
        continue;
      }
      if (shot?.take_id && shot.take_id !== take.id)
        add('ADOPTED_TAKE_MISMATCH', { shot_id: clip.shot_id, take_id: clip.take_id });
      const pinned = shot?.entity_revisions ?? [];
      const recorded = take.provenance?.entity_revisions ?? [];
      const entityIdentity = (refs) => refs.map((ref) => `${ref.id}:${ref.revision}`).sort();
      if (pinned.length && digest(entityIdentity(pinned)) !== digest(entityIdentity(recorded)))
        add('TAKE_ENTITY_REVISIONS_MISMATCH', { take_id: take.id, shot_id: clip.shot_id });
      if (take.status !== 'accepted' || take.stale !== false || !qaPass(take.qa))
        add('TAKE_NOT_ACCEPTED', { take_id: take.id });
      if (!['image', 'video'].includes(take.kind))
        add('VISUAL_KIND_UNSUPPORTED', { take_id: take.id });
      if (
        !integer(clip.source_in_ms) ||
        !Number.isInteger(clip.duration_ms) ||
        clip.duration_ms <= 0
      )
        add('CLIP_RANGE_INVALID', { take_id: take.id });
      if (take.kind === 'image' && clip.source_in_ms !== 0)
        add('IMAGE_TRIM_UNSUPPORTED', { take_id: take.id });
      if (
        (clip.transition && clip.transition !== 'cut') ||
        clip.effects?.length ||
        (clip.speed !== undefined && clip.speed !== 1)
      )
        add('EDIT_UNSUPPORTED', { take_id: take.id });
      if (clip.audio !== undefined && typeof clip.audio !== 'boolean')
        add('CLIP_AUDIO_INVALID', { take_id: take.id });
      if (
        clip.volume !== undefined &&
        (!Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 4)
      )
        add('VOLUME_INVALID', { take_id: take.id });
      const source = await inspectSource(take, take.kind, take.id);
      if (clip.crop && source?.probe?.rotation !== undefined && source.probe.rotation % 360 !== 0)
        add('CROP_ORIENTATION_UNSUPPORTED', {
          take_id: take.id,
          action:
            'Normalize or explicitly review source orientation before defining pixel-coordinate crop rectangles.',
        });
      if (
        clip.crop &&
        (!rectValid(clip.crop, source?.probe?.width, source?.probe?.height) ||
          Object.keys(clip.crop).some((key) => !['x', 'y', 'width', 'height'].includes(key)))
      )
        add('CROP_RECT_INVALID', { take_id: take.id });
      if (clip.protected_regions !== undefined && !Array.isArray(clip.protected_regions))
        add('PROTECTED_REGIONS_INVALID', { take_id: take.id });
      for (const region of Array.isArray(clip.protected_regions) ? clip.protected_regions : []) {
        if (!rectValid(region, source?.probe?.width, source?.probe?.height))
          add('PROTECTED_REGION_INVALID', { take_id: take.id, region });
        else if (
          clip.crop &&
          rectValid(clip.crop, source?.probe?.width, source?.probe?.height) &&
          !containsRect(clip.crop, region)
        )
          add('CROP_PROTECTED_REGION_CLIPPED', { take_id: take.id, region });
      }
      if (
        source?.probe &&
        take.kind === 'video' &&
        clip.source_in_ms + clip.duration_ms >
          source.probe.duration_ms + 1000 / production.timeline.fps
      )
        add('CLIP_OUT_OF_RANGE', { take_id: take.id });
      if (source?.probe && clip.audio === true && !source.probe.audio_streams)
        add('NATIVE_AUDIO_MISSING', { take_id: take.id });
    }
    for (const track of timeline.audio) {
      const asset = byAsset.get(track.asset_id);
      if (!asset || asset.kind !== 'audio') {
        add('AUDIO_ASSET_MISSING', { asset_id: track.asset_id });
        continue;
      }
      if (asset.stale === true || !qaPass(asset.qa))
        add('AUDIO_NOT_ACCEPTED', { asset_id: asset.id });
      if (
        !integer(track.start_ms) ||
        !integer(track.source_in_ms) ||
        !Number.isInteger(track.duration_ms) ||
        track.duration_ms <= 0 ||
        track.start_ms + track.duration_ms > duration
      )
        add('AUDIO_RANGE_INVALID', { asset_id: asset.id });
      if (
        track.volume !== undefined &&
        (!Number.isFinite(track.volume) || track.volume < 0 || track.volume > 4)
      )
        add('VOLUME_INVALID', { asset_id: asset.id });
      if (track.effects?.length || track.fade_in_ms || track.fade_out_ms || track.loop)
        add('AUDIO_EDIT_UNSUPPORTED', { asset_id: asset.id });
      const source = await inspectSource(asset, 'audio', asset.id);
      if (source?.probe && track.source_in_ms + track.duration_ms > source.probe.duration_ms + 30)
        add('AUDIO_OUT_OF_RANGE', { asset_id: asset.id });
    }
    for (const caption of timeline.captions) {
      if (
        !integer(caption.start_ms) ||
        !integer(caption.end_ms) ||
        caption.end_ms <= caption.start_ms ||
        caption.end_ms > duration ||
        typeof caption.text !== 'string' ||
        !caption.text.trim()
      )
        add('CAPTION_RANGE_INVALID', { delivery_id: delivery.id });
      if (caption.style || caption.position || caption.effect)
        add('CAPTION_STYLING_UNSUPPORTED', { delivery_id: delivery.id });
    }
    if (
      delivery.caption_mode !== 'off' &&
      timeline.captions.length &&
      (burnsCaptions(delivery) || delivery.caption_style)
    ) {
      const checked = await inspectCaptionLayout(delivery, timeline.captions, options);
      issues.push(...checked.issues);
      if (checked.layout) caption_layouts.push(checked.layout);
    }
  }
  if (options.variantIds?.some((id) => !deliveries.some((d) => d.id === id)))
    add('DELIVERY_UNKNOWN');
  return { ok: !issues.length, issues, sources, caption_layouts };
}

const stamp = (ms) => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
export function captionsToSrt(captions) {
  return [...captions]
    .sort((a, b) => a.start_ms - b.start_ms)
    .map(
      (c, i) =>
        `${i + 1}\n${stamp(c.start_ms)} --> ${stamp(c.end_ms)}\n${c.text.replace(/\r\n?/g, '\n')}\n`,
    )
    .join('\n');
}

/** Replacement edits preserve the input and report delivery invalidation without generation. */
export function editTimeline(production, patch) {
  if (!patch || Object.keys(patch).some((k) => !['clips', 'audio', 'captions'].includes(k)))
    throw new DeliveryGateError([{ code: 'TIMELINE_PATCH_UNSUPPORTED' }]);
  for (const value of Object.values(patch))
    if (!Array.isArray(value)) throw new DeliveryGateError([{ code: 'TIMELINE_PATCH_INVALID' }]);
  const updated = clone(production);
  updated.timeline = { ...updated.timeline, ...clone(patch) };
  updated.revision = (updated.revision || 0) + 1;
  const deliveries = production.brief?.deliveries || [];
  const affected = deliveries
    .filter((d) => digest(selectedTimeline(production, d)) !== digest(selectedTimeline(updated, d)))
    .map((d) => d.id);
  const oldClips = JSON.stringify(production.timeline?.clips),
    newClips = JSON.stringify(updated.timeline.clips);
  return {
    production: updated,
    impact: {
      delivery_ids: affected,
      shot_ids:
        oldClips === newClips
          ? []
          : [
              ...new Set(
                [...(production.timeline?.clips || []), ...updated.timeline.clips].map(
                  (c) => c.shot_id,
                ),
              ),
            ],
      generate: [],
      action: 'rerender_affected_deliveries',
    },
  };
}

/** Map an issue in edit time back to source shot/take ranges. No mutation or submission. */
export function locateIssue(production, issue) {
  if (!integer(issue.start_ms) || !integer(issue.end_ms) || issue.end_ms <= issue.start_ms)
    throw new DeliveryGateError([{ code: 'ISSUE_RANGE_INVALID' }]);
  const delivery =
    production.brief?.deliveries?.find((d) => d.id === issue.delivery_id) ||
    production.brief?.deliveries?.[0];
  if (!delivery || (issue.delivery_id && issue.delivery_id !== delivery.id))
    throw new DeliveryGateError([{ code: 'DELIVERY_UNKNOWN' }]);
  let cursor = 0;
  const affected = [];
  for (const clip of selectedTimeline(production, delivery).clips) {
    const start = cursor;
    cursor += clip.duration_ms;
    if (issue.start_ms < cursor && issue.end_ms > start)
      affected.push({
        shot_id: clip.shot_id,
        take_id: clip.take_id,
        time_range: {
          start_ms: clip.source_in_ms + Math.max(0, issue.start_ms - start),
          end_ms: clip.source_in_ms + Math.min(clip.duration_ms, issue.end_ms - start),
        },
      });
  }
  if (issue.end_ms > cursor) throw new DeliveryGateError([{ code: 'ISSUE_OUT_OF_RANGE' }]);
  const category = issue.category || issue.kind || 'creative';
  const editOnly = [
    'caption',
    'captions',
    'subtitle',
    'timing',
    'edit',
    'volume',
    'crop',
    'technical',
  ].includes(category);
  return {
    ...clone(issue),
    category,
    delivery_id: delivery.id,
    affected,
    proposed_fix: editOnly
      ? 'review_local_edit'
      : category === 'audio'
        ? 'review_audio_source_and_edit'
        : 'review_reference_performance_and_affected_takes',
    generation_required: false,
    generation_candidate_shot_ids: editOnly ? [] : affected.map((a) => a.shot_id),
    approval_required_for_new_generation: !editOnly,
  };
}

async function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

/** Render existing accepted material only; all local tools use argv, never a shell. */
export async function renderDeliveries(production, takes, options = {}) {
  const inspection = await inspectDelivery(production, takes, options);
  if (!inspection.ok) throw new DeliveryGateError(inspection.issues);
  const byTake = new Map(takes.map((t) => [t.id, t]));
  const bySource = new Map(inspection.sources.map((s) => [s.source_id, s]));
  const outputDir = path.resolve(options.outputDir || 'deliveries');
  const ffmpeg = options.ffmpeg || 'ffmpeg',
    phase = options.phase || 'final';
  if (!['rough', 'final'].includes(phase))
    throw new DeliveryGateError([{ code: 'PHASE_UNSUPPORTED' }]);
  const manifest = {
    schema_version: 'delivery.v1',
    project_id: production.project_id,
    production_revision: production.revision,
    phase,
    status: options.dryRun ? 'planned' : 'completed',
    acceptance: 'pending_creative_delivery_review',
    local_only: true,
    generation_jobs: 0,
    costs: clone(
      options.cost_report ??
        production.cost_report ?? {
          actual_credits: null,
          source: 'not_provided',
          note: 'Local finishing submits zero generation jobs; the cost of adopted assets remains unknown unless supplied by the production ledger.',
        },
    ),
    deliveries: [],
  };
  for (const delivery of production.brief.deliveries.filter(
    (d) => !options.variantIds || options.variantIds.includes(d.id),
  )) {
    const timeline = selectedTimeline(production, delivery);
    const captionLayout = inspection.caption_layouts.find(
      (layout) => layout.delivery_id === delivery.id,
    );
    const sourceIds = [
      ...new Set([
        ...timeline.clips.map((c) => c.take_id),
        ...timeline.audio.map((a) => a.asset_id),
      ]),
    ];
    const inputs = sourceIds.map((id) => ({
      id,
      sha256: bySource.get(id).sha256,
      qa: byTake.get(id)?.qa || production.assets.find((a) => a.id === id)?.qa,
    }));
    const fingerprint = digest({
      delivery,
      timeline,
      inputs,
      caption_layout: captionLayout || null,
      fps: production.timeline.fps,
      phase,
      renderer: 'ffmpeg-cut.v3',
    });
    const stem = `${safe(production.project_id)}-${safe(delivery.id)}-${fingerprint.slice(0, 20)}`;
    const output = path.join(outputDir, `${stem}.mp4`),
      metadata = path.join(outputDir, `${stem}.json`);
    const record = {
      id: delivery.id,
      locale: delivery.locale,
      aspect: delivery.aspect,
      width: delivery.width,
      height: delivery.height,
      fps: production.timeline.fps,
      duration_ms: delivery.duration_ms,
      fingerprint,
      path: output,
      source_snapshots: inputs,
      timeline: clone(timeline),
      adopted_qa: true,
      stale: false,
      creative_delivery_review: 'pending',
      ...(captionLayout ? { caption_layout: clone(captionLayout) } : {}),
      framing_review: timeline.clips.some((c) => c.crop)
        ? 'pending_visual_review'
        : 'source_fit_with_padding',
    };
    async function verifySourcesUnchanged() {
      for (const id of sourceIds) {
        const source = bySource.get(id);
        if ((await fileHash(source.path)) !== source.sha256)
          throw new DeliveryGateError([{ code: 'SOURCE_CHANGED_DURING_RENDER', source_id: id }]);
      }
      if (captionLayout && (await fileHash(captionLayout.font.path)) !== captionLayout.font.sha256)
        throw new DeliveryGateError([
          { code: 'CAPTION_FONT_CHANGED_DURING_RENDER', delivery_id: delivery.id },
        ]);
    }
    if (options.dryRun) {
      manifest.deliveries.push(record);
      continue;
    }
    await fs.mkdir(outputDir, { recursive: true });
    // Only reuse a proven local output; damaged or untracked files are never overwritten.
    let existing;
    try {
      existing = JSON.parse(await fs.readFile(metadata, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing) {
      await verifySourcesUnchanged();
      if (existing.fingerprint !== fingerprint || (await fileHash(output)) !== existing.sha256)
        throw new DeliveryGateError([
          { code: 'DELIVERY_CACHE_MISMATCH', delivery_id: delivery.id },
        ]);
      if (
        existing.captions &&
        (await fileHash(existing.captions.path)) !== existing.captions.sha256
      )
        throw new DeliveryGateError([{ code: 'CAPTION_CACHE_MISMATCH', delivery_id: delivery.id }]);
      manifest.deliveries.push({ ...existing, reused: true });
      continue;
    }
    try {
      await fs.access(output);
      throw new DeliveryGateError([{ code: 'OUTPUT_EXISTS_UNTRACKED', delivery_id: delivery.id }]);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const lockPath = path.join(outputDir, `${stem}.lock`);
    let lock;
    try {
      lock = await fs.open(lockPath, 'wx');
    } catch (error) {
      if (error.code === 'EEXIST')
        throw new DeliveryGateError([
          {
            code: 'DELIVERY_RENDER_IN_PROGRESS',
            delivery_id: delivery.id,
            action:
              'Check the existing local render before retrying; no stale lock is removed automatically.',
          },
        ]);
      throw error;
    }
    let work;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, fingerprint }));
      work = await fs.mkdtemp(path.join(outputDir, '.finish-'));
      const segments = [];
      for (let index = 0; index < timeline.clips.length; index++) {
        const clip = timeline.clips[index],
          take = byTake.get(clip.take_id),
          source = bySource.get(take.id);
        const segment = path.join(work, `${index}.mp4`),
          args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
        if (take.kind === 'image') args.push('-loop', '1', '-i', source.path);
        else args.push('-ss', secs(clip.source_in_ms), '-i', source.path);
        const nativeAudio = clip.audio === true;
        if (!nativeAudio)
          args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
        args.push(
          '-t',
          secs(clip.duration_ms),
          '-map',
          '0:v:0',
          '-map',
          nativeAudio ? '0:a:0' : '1:a:0',
          '-vf',
          `${clip.crop ? `crop=${clip.crop.width}:${clip.crop.height}:${clip.crop.x}:${clip.crop.y}:exact=1,` : ''}scale=${delivery.width}:${delivery.height}:force_original_aspect_ratio=decrease,pad=${delivery.width}:${delivery.height}:(ow-iw)/2:(oh-ih)/2,fps=${production.timeline.fps},setsar=1`,
          '-af',
          `apad,volume=${nativeAudio ? (clip.volume ?? 1) : 0}`,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          phase === 'rough' ? '28' : '20',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          segment,
        );
        await command(ffmpeg, args);
        segments.push(segment);
      }
      // Generated paths are controlled, but ffconcat still requires apostrophe escaping.
      const list = path.join(work, 'concat.txt');
      await fs.writeFile(
        list,
        segments.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'),
      );
      const tempOutput = path.join(work, 'delivery.mp4'),
        args = [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          list,
        ];
      for (const track of timeline.audio)
        args.push('-ss', secs(track.source_in_ms), '-i', bySource.get(track.asset_id).path);
      const filters = [];
      if (timeline.audio.length) {
        filters.push(
          ...timeline.audio.map(
            (track, i) =>
              `[${i + 1}:a]atrim=duration=${secs(track.duration_ms)},asetpts=PTS-STARTPTS,volume=${track.volume ?? 1},adelay=${track.start_ms}:all=1[a${i}]`,
          ),
        );
        filters.push(
          `[0:a]${timeline.audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${timeline.audio.length + 1}:normalize=0:duration=first[mix]`,
        );
      }
      if (burnsCaptions(delivery) && captionLayout) {
        const bitmapPaths = timeline.captions.map((_, i) => path.join(work, `caption-${i}.png`));
        const drawn = await captionBitmapRequest(
          captionLayout.style,
          timeline.captions,
          options,
          bitmapPaths,
        );
        if (
          !drawn.ok ||
          digest(drawn.layouts) !== digest(captionLayout.captions) ||
          drawn.pillow_version !== captionLayout.pillow_version
        )
          throw new DeliveryGateError([
            { code: 'CAPTION_LAYOUT_CHANGED_DURING_RENDER', delivery_id: delivery.id },
          ]);
        for (let i = 0; i < bitmapPaths.length; i++) {
          args.push('-i', bitmapPaths[i]);
          const caption = timeline.captions[i],
            box = captionLayout.captions[i].box;
          filters.push(
            `[${i ? `cv${i - 1}` : '0:v'}][${timeline.audio.length + i + 1}:v]overlay=x=${box.x}:y=${box.y}:enable='gte(t,${secs(caption.start_ms)})*lt(t,${secs(caption.end_ms)})':eof_action=repeat[cv${i}]`,
          );
        }
      }
      if (filters.length) args.push('-filter_complex', filters.join(';'));
      args.push(
        '-map',
        burnsCaptions(delivery) && captionLayout ? `[cv${timeline.captions.length - 1}]` : '0:v:0',
        '-map',
        timeline.audio.length ? '[mix]' : '0:a:0',
      );
      args.push(
        '-t',
        secs(delivery.duration_ms),
        '-c:v',
        burnsCaptions(delivery) && captionLayout ? 'libx264' : 'copy',
        ...(burnsCaptions(delivery) && captionLayout
          ? ['-preset', 'veryfast', '-crf', phase === 'rough' ? '28' : '20', '-pix_fmt', 'yuv420p']
          : []),
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-movflags',
        '+faststart',
        tempOutput,
      );
      await command(ffmpeg, args);
      const media = await probeMedia(tempOutput, options);
      if (
        !media.video ||
        media.width !== delivery.width ||
        media.height !== delivery.height ||
        Math.abs(media.duration_ms - delivery.duration_ms) >
          Math.max(100, 2000 / production.timeline.fps) ||
        Math.abs(media.fps - production.timeline.fps) > 0.01 ||
        !media.audio_streams
      )
        throw new DeliveryGateError([
          { code: 'OUTPUT_TECHNICAL_QC_FAILED', delivery_id: delivery.id, probe: media },
        ]);
      await command(ffmpeg, ['-v', 'error', '-nostdin', '-i', tempOutput, '-f', 'null', '-']);
      const measurements = await inspectMediaQuality(tempOutput, {
        ffmpeg,
        hasAudio: media.audio_streams > 0,
      });
      const qualityIssues = evaluateQuality(measurements, delivery.qc || {});
      if (qualityIssues.length)
        throw new DeliveryGateError(
          qualityIssues.map((issue) => ({ ...issue, delivery_id: delivery.id, measurements })),
        );
      await verifySourcesUnchanged();
      record.sha256 = await fileHash(tempOutput);
      record.probe = media;
      record.technical_qc = { probe: 'pass', decode: 'pass' };
      record.measurements = measurements;
      record.quality_review = Object.keys(delivery.qc || {}).length
        ? 'explicit_policy_pass_pending_creative_review'
        : 'measurements_pending_review';
      if (captionLayout)
        record.technical_qc.caption_safe_area = captionLayout.applied
          ? 'geometry_pass_applied'
          : 'geometry_pass_not_applied';
      if (timeline.clips.some((c) => c.crop)) record.technical_qc.crop_bounds = 'pass';
      if (!['off', 'burn_in'].includes(delivery.caption_mode) && timeline.captions.length) {
        const captionPath = path.join(outputDir, `${stem}.srt`);
        await fs.writeFile(captionPath, captionsToSrt(timeline.captions), { flag: 'wx' });
        record.captions = { path: captionPath, sha256: await fileHash(captionPath), format: 'srt' };
      }
      // link is exclusive: a concurrent or external output is never replaced.
      await fs.link(tempOutput, output);
      await atomicJson(metadata, record);
      manifest.deliveries.push(record);
    } finally {
      if (work) await fs.rm(work, { recursive: true, force: true });
      await lock.close();
      await fs.rm(lockPath, { force: true });
    }
  }
  if (!options.dryRun) {
    manifest.path = path.join(
      outputDir,
      `manifest-${digest(manifest.deliveries.map((d) => d.fingerprint)).slice(0, 20)}.json`,
    );
    await atomicJson(manifest.path, manifest);
  }
  return manifest;
}
