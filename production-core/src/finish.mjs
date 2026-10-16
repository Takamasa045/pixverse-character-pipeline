// Local-only finishing. This module never submits jobs or changes adopted takes.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

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
      (delivery.timeline?.[key] ?? production.timeline?.[key] ?? []).filter((item) =>
        relevant(item, delivery),
      ),
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

async function command(binary, args, { maxBytes = 2_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  return {
    duration_ms: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: b ? a / b : null,
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
    deliveries = production.brief?.deliveries || [];
  const add = (code, detail = {}) => issues.push({ code, ...detail });
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
    if (delivery.caption_mode && !['off', 'sidecar'].includes(delivery.caption_mode))
      add('CAPTION_MODE_UNSUPPORTED', { delivery_id: delivery.id, value: delivery.caption_mode });
    if (delivery.effects?.length || (delivery.transition && delivery.transition !== 'cut'))
      add('EDIT_UNSUPPORTED', { delivery_id: delivery.id });
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
        (clip.speed !== undefined && clip.speed !== 1) ||
        clip.crop
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
  }
  if (options.variantIds?.some((id) => !deliveries.some((d) => d.id === id)))
    add('DELIVERY_UNKNOWN');
  return { ok: !issues.length, issues, sources };
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
      fps: production.timeline.fps,
      phase,
      renderer: 'ffmpeg-cut.v1',
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
    };
    async function verifySourcesUnchanged() {
      for (const id of sourceIds) {
        const source = bySource.get(id);
        if ((await fileHash(source.path)) !== source.sha256)
          throw new DeliveryGateError([{ code: 'SOURCE_CHANGED_DURING_RENDER', source_id: id }]);
      }
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
          `scale=${delivery.width}:${delivery.height}:force_original_aspect_ratio=decrease,pad=${delivery.width}:${delivery.height}:(ow-iw)/2:(oh-ih)/2,fps=${production.timeline.fps},setsar=1`,
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
      if (timeline.audio.length) {
        const filters = timeline.audio.map(
          (track, i) =>
            `[${i + 1}:a]atrim=duration=${secs(track.duration_ms)},asetpts=PTS-STARTPTS,volume=${track.volume ?? 1},adelay=${track.start_ms}:all=1[a${i}]`,
        );
        filters.push(
          `[0:a]${timeline.audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${timeline.audio.length + 1}:normalize=0:duration=first[mix]`,
        );
        args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[mix]');
      } else args.push('-map', '0:v:0', '-map', '0:a:0');
      args.push(
        '-t',
        secs(delivery.duration_ms),
        '-c:v',
        'copy',
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
      await verifySourcesUnchanged();
      record.sha256 = await fileHash(tempOutput);
      record.probe = media;
      record.technical_qc = { probe: 'pass', decode: 'pass' };
      if (delivery.caption_mode !== 'off' && timeline.captions.length) {
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
