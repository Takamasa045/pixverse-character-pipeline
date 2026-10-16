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
export function validateProduction(p) {
  const errors = [];
  const check = (ok, msg) => {
    if (!ok) errors.push(msg);
  };
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
  const total = (p?.shots ?? []).reduce((n, s) => n + s.edit_duration_ms, 0);
  const variants = new Set();
  for (const d of p?.brief?.deliveries ?? []) {
    check(typeof d.id === 'string' && !variants.has(d.id), 'unique delivery id required');
    variants.add(d.id);
    check(
      typeof d.locale === 'string' && /^\d+:\d+$/.test(d.aspect ?? ''),
      'delivery locale/aspect required',
    );
    // Locale-specific edit durations may be declared explicitly.
    const selectedClips =
      d.timeline?.clips ??
      p.timeline?.clips?.filter(
        (c) =>
          (!c.locale || c.locale === d.locale) &&
          (!c.variant_id || c.variant_id === d.id) &&
          (!c.delivery_id || c.delivery_id === d.id),
      );
    const duration = selectedClips?.length
      ? selectedClips.reduce((n, c) => n + c.duration_ms, 0)
      : total;
    check(d.duration_ms === duration, `${d.id}: edit duration does not match requested duration`);
  }
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
  return { valid: errors.length === 0, errors };
}
export function assertProduction(p) {
  const v = validateProduction(p);
  requireValue(v.valid, v.errors.join('; '));
  return p;
}
