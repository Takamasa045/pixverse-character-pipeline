import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateProduction } from '../src/contracts.mjs';
const file = new URL('../fixtures/station-story.json', import.meta.url);
const fixture = () => JSON.parse(readFileSync(file, 'utf8'));
const clip = (p, extra = {}) => ({
  shot_id: p.shots[0].shot_id,
  take_id: 'take-1',
  source_in_ms: 0,
  duration_ms: 20000,
  ...extra,
});
test('planning validity reports a missing edit separately from delivery readiness', () => {
  const p = fixture();
  const result = validateProduction(p);
  assert.equal(result.valid, true);
  assert.equal(result.phase, 'planning');
  assert.equal(result.ready_for_delivery, false);
  assert.ok(result.delivery_errors.length);
  assert.equal(validateProduction(p, { phase: 'delivery' }).valid, false);
});
test('missing timeline and explicit empty delivery override cannot pass by shot-duration fallback', () => {
  const p = fixture();
  delete p.timeline;
  assert.equal(validateProduction(p).valid, false);
  const q = fixture();
  q.brief.deliveries[0].timeline = { clips: [] };
  assert.equal(validateProduction(q).valid, false);
});
test('validation uses scoped selected clips and rejects malformed edit values', () => {
  const p = fixture();
  p.timeline.clips = [clip(p)];
  p.shots[0].take_id = 'take-1';
  assert.equal(validateProduction(p, { phase: 'delivery' }).valid, true);
  for (const change of [
    { shot_id: 'missing' },
    { duration_ms: -1 },
    { source_in_ms: -1 },
    { take_id: '' },
  ]) {
    const q = structuredClone(p);
    Object.assign(q.timeline.clips[0], change);
    assert.equal(validateProduction(q).valid, false);
  }
  for (const field of ['take_id', 'source_in_ms']) {
    const q = structuredClone(p);
    delete q.timeline.clips[0][field];
    assert.equal(validateProduction(q).valid, true);
    assert.equal(validateProduction(q, { phase: 'delivery' }).valid, false);
  }
  const q = structuredClone(p);
  q.brief.deliveries[0].timeline = { clips: [clip(q, { locale: 'en' })] };
  assert.equal(validateProduction(q).valid, false);
  const r = structuredClone(p);
  delete r.shots[0].take_id;
  assert.equal(validateProduction(r, { phase: 'delivery' }).valid, false);
});
test('CLI exposes planning readiness and rejects delivery validation before media work', () => {
  const cli = new URL('../src/cli.mjs', import.meta.url);
  const result = JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(cli), 'validate', fileURLToPath(file)], {
      encoding: 'utf8',
    }),
  );
  assert.equal(result.ready_for_delivery, false);
  const delivery = spawnSync(
    process.execPath,
    [fileURLToPath(cli), 'validate', fileURLToPath(file), '--phase', 'delivery'],
    { encoding: 'utf8' },
  );
  assert.equal(delivery.status, 1);
  assert.equal(JSON.parse(delivery.stdout).phase, 'delivery');
});

test('delivery selection isolates unfinished variants while preserving shared shape validation', () => {
  const p = fixture();
  p.shots[0].take_id = 'take-1';
  p.timeline.clips = [clip(p, { delivery_id: 'ja-wide' })];
  p.brief.deliveries.push({ ...p.brief.deliveries[0], id: 'en-wide', locale: 'en' });
  assert.equal(validateProduction(p, { phase: 'delivery' }).valid, false);
  assert.equal(validateProduction(p, { phase: 'delivery', variantIds: ['ja-wide'] }).valid, true);
  assert.equal(validateProduction(p, { phase: 'delivery', variantIds: ['missing'] }).valid, false);
  p.brief.deliveries[1].timeline = { clips: null };
  assert.equal(validateProduction(p, { phase: 'delivery', variantIds: ['ja-wide'] }).valid, false);
  for (const timeline of [
    null,
    { fps: 0, clips: [], audio: [], captions: [] },
    { fps: 30, clips: [null], audio: [], captions: [] },
  ]) {
    const q = fixture();
    q.timeline = timeline;
    assert.equal(validateProduction(q).valid, false);
  }
});
