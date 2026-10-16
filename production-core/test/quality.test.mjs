import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectMediaQuality, evaluateQuality } from '../src/quality.mjs';
test('real black/silence/loudness observations remain distinct from explicit QC policy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pixverse-qc-')),
    path = join(root, 'black.mp4');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=black:s=160x90:r=10:d=0.4',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    '0.4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    path,
  ]);
  const measurements = await inspectMediaQuality(path);
  assert(measurements.black_intervals_ms.length);
  assert(measurements.silence_intervals_ms.length);
  assert(measurements.mean_volume_db === '-inf' || measurements.mean_volume_db < -80);
  assert.deepEqual(evaluateQuality(measurements), []);
  assert(
    evaluateQuality(measurements, { max_black_interval_ms: 50 }).some((i) =>
      i.code.startsWith('BLACK'),
    ),
  );
  assert(
    evaluateQuality(measurements, { max_silence_interval_ms: 50, expected_audio: true }).some((i) =>
      i.code.startsWith('SILENCE'),
    ),
  );
  assert.deepEqual(
    evaluateQuality(measurements, { max_silence_interval_ms: 0, expected_audio: false }),
    [],
  );
});
test('colour and audible tone measure without invented loudness or black failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pixverse-qc-')),
    path = join(root, 'tone.mp4');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=red:s=160x90:r=10:d=0.4',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=0.4',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    path,
  ]);
  const measurements = await inspectMediaQuality(path);
  assert.deepEqual(measurements.black_intervals_ms, []);
  assert.equal(typeof measurements.mean_volume_db, 'number');
  assert.equal(typeof measurements.peak_volume_db, 'number');
  assert.deepEqual(
    evaluateQuality(measurements, {
      max_black_interval_ms: 0,
      min_mean_volume_db: -60,
      max_peak_volume_db: 0,
    }),
    [],
  );
});
