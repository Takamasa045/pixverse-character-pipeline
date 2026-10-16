import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync } from 'node:fs';
export function canonical(value) {
  if (value === undefined) throw new Error('undefined is not production data');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(',')}}`;
}
export const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
export function fileHash(path) {
  const digest = createHash('sha256'),
    fd = openSync(path, 'r'),
    buffer = Buffer.alloc(1024 * 1024);
  try {
    let n;
    while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0)
      digest.update(buffer.subarray(0, n));
    return digest.digest('hex');
  } finally {
    closeSync(fd);
  }
}
export function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}
export const timelineItemMatches = (item, delivery) =>
  (!item.delivery_id || item.delivery_id === delivery.id) &&
  (!item.variant_id || item.variant_id === delivery.id) &&
  (!item.locale || item.locale === delivery.locale);
export const selectedTimeline = (production, delivery) =>
  Object.fromEntries(
    ['clips', 'audio', 'captions'].map((key) => [
      key,
      (key === 'captions' && delivery.caption_mode === 'off'
        ? []
        : (delivery.timeline?.[key] ?? production.timeline?.[key] ?? [])
      ).filter((item) => timelineItemMatches(item, delivery)),
    ]),
  );
export function validateProduction(p, { phase = 'planning', variantIds } = {}) {
  const errors = [];
  const check = (ok, msg) => {
    if (!ok) errors.push(msg);
  };
  check(['planning', 'delivery'].includes(phase), 'phase must be planning or delivery');
  check(p?.schema_version === 'production.v1', 'schema_version must be production.v1');
  check(
    typeof p?.project_id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(p.project_id),
    'safe project_id required',
  );
  check(Number.isSafeInteger(p?.revision) && p.revision > 0, 'positive revision required');
  check(
    typeof p?.context?.region === 'string' && typeof p?.context?.workspace_id === 'string',
    'region/workspace_id strings required',
  );
  check(
    typeof p?.brief?.original === 'string' && typeof p?.brief?.intent === 'string',
    'brief original and intent required',
  );
  check(
    Array.isArray(p?.brief?.deliveries) && p.brief.deliveries.length > 0,
    'explicit deliveries required',
  );
  check(Array.isArray(p?.shots) && p.shots.length > 0, 'shots required');
  check(Array.isArray(p?.assets), 'assets required');
  const ids = new Set();
  const generation = (g, id) => {
    check(['create', 'canvas', 'preset'].includes(g.backend), `${id}: backend required`);
    check(typeof g.mode === 'string', `${id}: mode required`);
    if (g.backend === 'preset') {
      check(
        g.model === null && ['template', 'miniapps'].includes(g.mode),
        `${id}: preset model must be null and mode explicit`,
      );
      check(typeof g.preset_id === 'string' && g.preset_id.length > 0, `${id}: preset_id required`);
      check(['image', 'video'].includes(g.output_kind), `${id}: preset output_kind required`);
    } else check(typeof g.model === 'string', `${id}: model required`);
    check(Number.isSafeInteger(g.attempt ?? 1) && (g.attempt ?? 1) > 0, `${id}: invalid attempt`);
  };
  const assetIds = new Set((p?.assets ?? []).map((a) => a.id));
  check(assetIds.size === (p?.assets ?? []).length, 'duplicate asset id');
  for (const a of p?.assets ?? []) {
    check(
      typeof a.id === 'string' && ['image', 'video', 'audio'].includes(a.kind),
      'asset id/kind required',
    );
    check(
      typeof a.region === 'string' && typeof a.workspace_id === 'string',
      `asset ${a.id}: context unknown`,
    );
    check(Boolean(a.path || a.provider_id), `asset ${a.id}: path or provider_id required`);
    if (a.provider_id !== undefined)
      check(typeof a.provider_id === 'string', `asset ${a.id}: provider_id must be string`);
  }
  for (const s of p?.shots ?? []) {
    check(typeof s.shot_id === 'string' && !ids.has(s.shot_id), 'unique stable shot_id required');
    ids.add(s.shot_id);
    check(typeof s.purpose === 'string' && s.purpose.length > 0, `${s.shot_id}: purpose required`);
    check(
      Number.isSafeInteger(s.edit_duration_ms) && s.edit_duration_ms > 0,
      `${s.shot_id}: integer edit_duration_ms required`,
    );
    check(
      s.entry_state && s.exit_state && s.audio && typeof s.camera === 'string',
      `${s.shot_id}: entry/exit/audio/camera required`,
    );
    check(
      ['editable_shot', 'single_take', 'native_sequence'].includes(s.generation_strategy),
      `${s.shot_id}: strategy required`,
    );
    const orders = new Set();
    for (const r of s.references ?? []) {
      check(assetIds.has(r.asset), `${s.shot_id}: missing reference ${r.asset}`);
      check(
        ['identity', 'appearance', 'motion', 'layout', 'audio', 'timing'].includes(r.role),
        `${s.shot_id}: invalid reference role`,
      );
      check(
        Number.isSafeInteger(r.order) && !orders.has(r.order),
        `${s.shot_id}: unique reference order required`,
      );
      orders.add(r.order);
    }
    if (s.generation) {
      generation(s.generation, s.shot_id);
    }
  }
  for (const job of p?.jobs ?? []) {
    check(typeof job.shot_id === 'string' && !ids.has(job.shot_id), 'unique job/shot ID required');
    ids.add(job.shot_id);
    if (job.generation) generation(job.generation, job.shot_id);
  }
  const deliveryErrors = [];
  const ready = (ok, message) => {
    if (!ok) deliveryErrors.push(message);
  };
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const positiveMs = (v) => Number.isSafeInteger(v) && v > 0;
  const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;
  const timelineShape = (timeline, label, override = false) => {
    check(object(timeline), `${label}: timeline object required`);
    if (!object(timeline)) return;
    if (!override || Object.hasOwn(timeline, 'fps'))
      check(Number.isFinite(timeline.fps) && timeline.fps > 0, `${label}: positive fps required`);
    for (const key of ['clips', 'audio', 'captions']) {
      if (override && !Object.hasOwn(timeline, key)) continue;
      check(Array.isArray(timeline[key]), `${label}: ${key} array required`);
      if (Array.isArray(timeline[key]))
        check(timeline[key].every(object), `${label}: ${key} entries must be objects`);
    }
    for (const c of Array.isArray(timeline.clips) ? timeline.clips : []) {
      if (!object(c)) continue;
      check(
        (p?.shots ?? []).some((shot) => shot.shot_id === c.shot_id),
        `${label}: unknown clip shot`,
      );
      check(positiveMs(c.duration_ms), `${label}: positive integer clip duration_ms required`);
      if (Object.hasOwn(c, 'take_id')) check(nonempty(c.take_id), `${label}: invalid clip take_id`);
      if (Object.hasOwn(c, 'source_in_ms'))
        check(
          Number.isSafeInteger(c.source_in_ms) && c.source_in_ms >= 0,
          `${label}: invalid source_in_ms`,
        );
    }
  };
  timelineShape(p?.timeline, 'production');
  const total = (p?.shots ?? []).reduce((n, s) => n + s.edit_duration_ms, 0);
  const variants = new Set();
  for (const d of p?.brief?.deliveries ?? []) {
    check(typeof d.id === 'string' && !variants.has(d.id), 'unique delivery id required');
    variants.add(d.id);
    check(
      typeof d.locale === 'string' && /^\d+:\d+$/.test(d.aspect ?? ''),
      'delivery locale/aspect required',
    );
    check(positiveMs(d.duration_ms), `${d.id}: positive integer delivery duration_ms required`);
    if (Object.hasOwn(d, 'timeline')) timelineShape(d.timeline, d.id, true);
    if (variantIds && !variantIds.includes(d.id)) continue;
    const source = d.timeline?.clips ?? p?.timeline?.clips;
    const clips = Array.isArray(source)
      ? source.filter((c) => object(c) && timelineItemMatches(c, d))
      : [];
    const unassembledPlan =
      Array.isArray(p?.timeline?.clips) &&
      p.timeline.clips.length === 0 &&
      !Object.hasOwn(d.timeline ?? {}, 'clips');
    if (unassembledPlan) {
      // A planning estimate is not an assembled edit and cannot pass delivery validation.
      check(
        d.duration_ms === total,
        `${d.id}: planned shot duration does not match requested duration`,
      );
    } else {
      check(clips.length > 0, `${d.id}: selected timeline must contain clips`);
      const duration = clips.reduce((n, c) => n + c.duration_ms, 0);
      check(d.duration_ms === duration, `${d.id}: edit duration does not match requested duration`);
    }
    ready(clips.length > 0, `${d.id}: selected timeline must contain clips for delivery`);
    for (const c of clips) {
      ready(nonempty(c.take_id), `${d.id}: clip take_id required for delivery`);
      ready(
        Number.isSafeInteger(c.source_in_ms) && c.source_in_ms >= 0,
        `${d.id}: clip source_in_ms required for delivery`,
      );
      const shot = (p?.shots ?? []).find((s) => s.shot_id === c.shot_id);
      ready(
        nonempty(c.take_id) && shot?.take_id === c.take_id,
        `${d.id}: clip must match explicit shot adoption`,
      );
    }
  }
  if (variantIds)
    check(
      variantIds.length > 0 && variantIds.every((id) => variants.has(id)),
      'unknown or empty delivery selection',
    );
  check(
    ['planning_only', 'generation'].includes(p?.execution_policy?.allowed_scope),
    'execution allowed_scope required',
  );
  check(
    Number.isSafeInteger(p?.execution_policy?.max_attempts) && p.execution_policy.max_attempts > 0,
    'max_attempts required',
  );
  if (p?.execution_policy?.max_credits !== null)
    check(
      Number.isFinite(p?.execution_policy?.max_credits) && p.execution_policy.max_credits >= 0,
      'invalid max_credits',
    );
  const delivery_errors = [...errors, ...deliveryErrors];
  if (phase === 'delivery') errors.push(...deliveryErrors);
  return {
    valid: errors.length === 0,
    phase,
    errors,
    ready_for_delivery: delivery_errors.length === 0,
    delivery_errors,
  };
}
export function assertProduction(p, options) {
  const v = validateProduction(p, options);
  requireValue(v.valid, v.errors.join('; '));
  return p;
}
