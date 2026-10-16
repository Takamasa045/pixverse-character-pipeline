import { execFile } from 'node:child_process';

function execute(binary, args) {
  return new Promise((resolve, reject) =>
    execFile(
      binary,
      args,
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(`Media QC failed: ${stderr.slice(-3000)}`))
          : resolve({ stdout, stderr }),
    ),
  );
}
function intervals(log, startPattern, endPattern) {
  const output = [];
  let start = null;
  for (const line of log.split('\n')) {
    const begins = line.match(startPattern);
    if (begins) start = Math.max(0, Math.round(Number(begins[1]) * 1000));
    const ends = line.match(endPattern);
    if (ends && start !== null) {
      const end = Math.max(start, Math.round(Number(ends[1]) * 1000));
      output.push({ start_ms: start, end_ms: end, duration_ms: end - start });
      start = null;
    }
  }
  return output;
}
const level = (value) => (value === undefined ? null : value === '-inf' ? '-inf' : Number(value));

/** Measurements are observations, not an automatic artistic judgement. */
export async function inspectMediaQuality(
  file,
  { ffmpeg = 'ffmpeg', hasAudio = true, run = execute } = {},
) {
  const args = ['-hide_banner', '-nostdin', '-i', file, '-vf', 'blackdetect=d=0.04:pix_th=0.10'];
  if (hasAudio) args.push('-af', 'silencedetect=noise=-50dB:d=0.04,volumedetect');
  args.push('-f', 'null', '-');
  const { stderr } = await run(ffmpeg, args),
    black = [];
  for (const match of stderr.matchAll(
    /black_start:([\d.+-]+)\s+black_end:([\d.+-]+)\s+black_duration:([\d.+-]+)/g,
  )) {
    black.push({
      start_ms: Math.max(0, Math.round(Number(match[1]) * 1000)),
      end_ms: Math.round(Number(match[2]) * 1000),
      duration_ms: Math.round(Number(match[3]) * 1000),
    });
  }
  return {
    schema_version: 'media-qc.v1',
    black_intervals_ms: black,
    silence_intervals_ms: hasAudio
      ? intervals(stderr, /silence_start:\s*([\d.+-]+)/, /silence_end:\s*([\d.+-]+)/)
      : [],
    mean_volume_db: hasAudio
      ? level(stderr.match(/mean_volume:\s*(-?inf|[-\d.]+)\s*dB/)?.[1])
      : null,
    peak_volume_db: hasAudio
      ? level(stderr.match(/max_volume:\s*(-?inf|[-\d.]+)\s*dB/)?.[1])
      : null,
    has_audio: hasAudio,
    detector_settings: { black_pixel_threshold: 0.1, silence_noise_db: -50, min_interval_ms: 40 },
    interpretation:
      'Review these observations against the creative intent; only explicit policy limits block delivery.',
  };
}
export function evaluateQuality(measurements, policy = {}) {
  const allowed = [
    'max_black_interval_ms',
    'max_silence_interval_ms',
    'min_mean_volume_db',
    'max_peak_volume_db',
    'expected_audio',
  ];
  for (const key of Object.keys(policy))
    if (!allowed.includes(key)) throw new Error(`Unsupported media QC policy ${key}`);
  for (const [key, value] of Object.entries(policy))
    if (
      key === 'expected_audio'
        ? typeof value !== 'boolean'
        : !Number.isFinite(value) || (key.endsWith('_interval_ms') && value < 0)
    )
      throw new Error(`Invalid media QC policy ${key}`);
  const issues = [];
  if (
    policy.max_black_interval_ms !== undefined &&
    measurements.black_intervals_ms.some((i) => i.duration_ms > policy.max_black_interval_ms)
  )
    issues.push({ code: 'BLACK_INTERVAL_EXCEEDS_LIMIT' });
  if (policy.expected_audio === true && !measurements.has_audio)
    issues.push({ code: 'EXPECTED_AUDIO_MISSING' });
  if (policy.expected_audio !== false) {
    if (
      policy.max_silence_interval_ms !== undefined &&
      measurements.silence_intervals_ms.some((i) => i.duration_ms > policy.max_silence_interval_ms)
    )
      issues.push({ code: 'SILENCE_INTERVAL_EXCEEDS_LIMIT' });
    const number = (value) => (value === '-inf' ? -Infinity : value);
    if (
      policy.min_mean_volume_db !== undefined &&
      (measurements.mean_volume_db === null ||
        number(measurements.mean_volume_db) < policy.min_mean_volume_db)
    )
      issues.push({ code: 'MEAN_VOLUME_BELOW_LIMIT' });
    if (
      policy.max_peak_volume_db !== undefined &&
      (measurements.peak_volume_db === null ||
        number(measurements.peak_volume_db) > policy.max_peak_volume_db)
    )
      issues.push({ code: 'PEAK_VOLUME_EXCEEDS_LIMIT' });
  }
  return issues;
}
