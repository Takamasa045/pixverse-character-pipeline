import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  importLegacy,
  exportLegacy,
  importRegistry,
  exportRegistry,
  readLegacyFile,
} from '../src/compat.mjs';
import { fileHash, inspectDelivery } from '../src/finish.mjs';

let root;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'production-compat-test-'));
  await fs.writeFile(path.join(root, 'existing.mp4'), 'fixture-existing-bytes-not-a-real-video');
});
after(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});
const context = { region: 'global', workspace_id: '0' };
const codes = (result) => result.report.issues.map((i) => i.code);

test('Character project imports local takes and locale edits without inventing adoption, voice or context', async () => {
  const input = {
    project: { slug: 'guide', title: 'Weekly guide' },
    speaker: { name: 'Guide', images: ['face.png'], mode: 'single' },
    locales: {
      ja: {
        clips: [
          {
            id: 'intro',
            source: 'video',
            asset: 'existing.mp4',
            durationSeconds: 2,
            hasAudio: false,
            overlayText: '案内',
            overlayStyle: 'title',
          },
          { id: 'talk', source: 'generated', text: 'こんにちは', durationSeconds: 3 },
        ],
      },
      en: {
        clips: [
          {
            id: 'intro',
            source: 'video',
            asset: 'existing.mp4',
            durationSeconds: 4,
            hasAudio: false,
          },
        ],
      },
    },
    render: { aspectRatios: ['16:9', '9:16'], fps: 30 },
    generation: { model: 'v6', generateAudio: false },
  };
  const original = structuredClone(input);
  const result = await importLegacy(input, { format: 'character', baseDir: root });
  assert.deepEqual(input, original);
  assert.equal(result.report.generated_jobs, 0);
  assert.equal(result.report.source_modified, false);
  assert.equal(result.production.context.region, null);
  assert.equal(result.production.context.workspace_id, null);
  assert.equal(result.production.brief.deliveries.length, 4);
  assert.equal(result.takes.length, 2);
  assert.deepEqual(
    result.production.brief.deliveries.map((d) => d.duration_ms),
    [5000, 5000, 4000, 4000],
  );
  assert.equal(result.production.timeline.clips[0].audio, false);
  assert.equal(result.production.shots[0].audio.intent, 'silent');
  assert.equal(result.takes[0].status, 'downloaded');
  assert.equal(result.takes[0].qa.creative, null);
  assert.equal(result.production.shots[0].take_id, undefined);
  for (const code of [
    'CONTEXT_UNKNOWN',
    'FILE_MISSING',
    'QA_UNKNOWN',
    'GENERATED_ASSET_UNRESOLVED',
    'VOICE_ASSET_UNRESOLVED',
    'CHARACTER_FACETS_UNKNOWN',
  ])
    assert(codes(result).includes(code), code);
  const check = await inspectDelivery(result.production, result.takes, {
    baseDir: root,
    probe: async () => ({ video: true, duration_ms: 5000, audio_streams: 0 }),
  });
  assert.equal(check.ok, false, 'imported assets cannot bypass adoption gate');
  assert.equal(JSON.stringify(result).includes('undefined'), false);
});

test('legacy spokesperson scripts normalize without generation or inferring a modern voice from numeric tts_speaker', async () => {
  const input = {
    speaker: { name: 'Neutral Guide', images: ['face.png'], mode: 'single' },
    announcement: { date: '2026-03-21', topic: 'Legacy Compat Check' },
    scripts: {
      ja: { text: 'これは互換性テスト用の原稿です。', audio_mode: 'tts', tts_speaker: 1 },
      en: { text: 'An existing reading.', audio_mode: 'file', audio_file: 'voice.wav' },
    },
    output: {
      aspect_ratios: ['16:9', '9:16'],
      model: 'v6',
      quality: '720p',
      duration: 5,
      upscale: true,
      generate_audio: false,
      ambient_sound: 'forest',
      dest: './old-output',
    },
    prompt: { base: 'Provided character speaking', per_ratio: { '9:16': 'Portrait framing' } },
  };
  await fs.writeFile(path.join(root, 'voice.wav'), 'existing-audio-bytes');
  const original = structuredClone(input);
  const migrated = await importLegacy(input, { format: 'character', context, baseDir: root });
  assert.deepEqual(input, original);
  assert.deepEqual(migrated.production.migration.original, original);
  assert.equal(migrated.report.source_variant, 'spokesperson');
  assert.equal(migrated.production.brief.original, 'Legacy Compat Check');
  assert.equal(migrated.production.migration.normalization.project_date, '2026-03-21');
  assert.equal(migrated.production.brief.deliveries.length, 4);
  assert(migrated.production.brief.deliveries.every((d) => d.duration_ms === 5000));
  assert.equal(migrated.production.shots[0].generation.parameters.audio, false);
  assert.equal(migrated.production.shots[0].generation.model, 'v6');
  const numeric = migrated.report.issues.find(
    (i) => i.code === 'LEGACY_NUMERIC_TTS_SPEAKER_UNMAPPED',
  );
  assert.equal(numeric.original, 1);
  assert.equal(numeric.voice_id, null);
  const voice = migrated.report.issues.find((i) => i.code === 'VOICE_ASSET_UNRESOLVED');
  assert.equal(voice.voice_id, null);
  assert.equal(voice.text, input.scripts.ja.text);
  assert.equal(migrated.production.timeline.audio.length, 1);
  assert.equal(
    migrated.production.assets.find((a) => a.kind === 'audio').sha256,
    await fileHash(path.join(root, 'voice.wav')),
  );
  assert.equal(migrated.takes.length, 0);
  assert.equal(migrated.report.generated_jobs, 0);
  assert(codes(migrated).includes('LEGACY_RATIO_PROMPTS_REQUIRE_PER_DELIVERY_PLAN'));
  assert(codes(migrated).includes('GENERATED_ASSET_UNRESOLVED'));
  assert.equal(migrated.production.execution_policy.allowed_scope, 'planning_only');
  const inferredFormat = await importLegacy(input, { context, baseDir: root });
  assert.equal(inferredFormat.report.source_format, 'character');
});

test('spokesperson legacy defaults are explicit provenance and existing string voice IDs remain exact', async () => {
  const input = {
    speaker: { images: [] },
    scripts: {
      en: { text: 'Hello', voice_id: 'actual-existing-voice' },
      invalid: 'not a script object',
    },
    output: {},
    prompt: {},
  };
  const migrated = await importLegacy(input, { context, baseDir: root });
  assert.equal(migrated.production.shots[0].edit_duration_ms, 5000);
  assert.equal(
    migrated.production.shots[0].generation,
    undefined,
    'an absent legacy model is not invented as a current generation route',
  );
  assert.equal(
    migrated.report.issues.find((i) => i.code === 'VOICE_ASSET_UNRESOLVED').voice_id,
    'actual-existing-voice',
  );
  assert(codes(migrated).includes('LEGACY_DEFAULT_APPLIED'));
  assert(codes(migrated).includes('LEGACY_SCRIPT_INVALID'));
  assert.equal(
    migrated.production.migration.normalization.project_date,
    null,
    'migration does not invent today as the source date',
  );
  assert.deepEqual(migrated.production.migration.original, input);
});

test('Shotpack storyboard and project import preserve explicit OFF and do not replay paid postprocessing', async () => {
  const input = {
    project: { slug: 'launch' },
    assets: { mode: 'local', sourceDir: '.', videoPattern: 'existing.mp4' },
    generation: { model: 'v6', aspectRatio: '16:9' },
    render: { fps: 24 },
  };
  const storyboard = {
    meta: { fps: 24, aspects: ['16:9'] },
    shots: [
      {
        id: 's1',
        duration: 2,
        prompt: 'Show product',
        notes: 'Opening',
        audio: false,
        multi_shot: false,
        image_ref: '398830212288488',
        post_process: { upscale: '4k' },
      },
      {
        id: 's2',
        duration: 3,
        prompt: 'Close product',
        audio: true,
        multi_shot: true,
        image_ref: 'generate',
      },
    ],
  };
  const original = structuredClone({ input, storyboard });
  const result = await importLegacy(input, {
    format: 'shotpack',
    storyboard,
    context,
    baseDir: root,
  });
  assert.equal(result.production.timeline.fps, 24);
  assert.equal(result.takes.length, 2);
  assert.equal(result.production.shots[0].generation.parameters.audio, false);
  assert.equal(result.production.shots[0].generation.parameters.multi_shot, false);
  assert.equal(result.production.shots[1].generation_strategy, 'native_sequence');
  assert.equal(result.production.assets[0].provider_id, '398830212288488');
  assert.equal(result.production.shots[0].references[0].role, 'appearance');
  assert(codes(result).includes('POST_PROCESS_NOT_REPLAYED'));
  assert(codes(result).includes('REFERENCE_UNRESOLVED'));
  assert(codes(result).includes('SHOT_DESIGN_INCOMPLETE'));
  assert.deepEqual({ input, storyboard }, original);
  await assert.rejects(importLegacy(input, { format: 'shotpack' }), {
    code: 'STORYBOARD_REQUIRED',
  });
});

test('legacy completed run is inventoried and a missing MP4 never becomes a completed delivery', async () => {
  const input = {
    project: { slug: 'old' },
    variants: [
      {
        status: 'completed',
        file: 'missing.mp4',
        renderManifest: 'missing-manifest.json',
        language: 'ja',
        aspectRatio: '16:9',
        clipVideoIds: { intro: { final: '900719925474099312345' } },
      },
    ],
  };
  const result = await importLegacy(input, { format: 'manifest', baseDir: root, context });
  assert(codes(result).includes('RUN_MANIFEST_REQUIRES_RENDER_MANIFEST'));
  assert(codes(result).includes('FILE_MISSING'));
  assert.equal(result.report.ready_for_delivery, false);
  assert.equal(result.takes.length, 0);
  assert.equal(result.production.assets[0].provenance.original.status, 'completed');
  assert.equal(
    result.production.migration.original.variants[0].clipVideoIds.intro.final,
    '900719925474099312345',
  );
  assert.equal((await inspectDelivery(result.production, result.takes)).ok, false);
});

test('old Shotpack and Character render manifests preserve timing, file snapshots and provider IDs', async () => {
  const shotpack = {
    project: { id: 'legacy-cut' },
    deliverables: [{ id: 'wide', width: 160, height: 90, fps: 10, durationInFrames: 10 }],
    scenes: [
      {
        id: 'scene-1',
        shot_id: 's1',
        durationSec: 1,
        objective: 'Open',
        assets: { videoSrc: 'existing.mp4' },
        video_id: '900719925474099312345',
        transition: 'dissolve',
        multi_shot: false,
      },
    ],
  };
  const result = await importLegacy(shotpack, { format: 'manifest', context, baseDir: root });
  assert.equal(result.production.brief.deliveries[0].aspect, '16:9');
  assert.equal(result.takes[0].provider_id, '900719925474099312345');
  assert.equal(result.takes[0].sha256, await fileHash(path.join(root, 'existing.mp4')));
  assert(codes(result).includes('TRANSITION_UNREPRESENTED'));
  const character = {
    fps: 30,
    width: 1080,
    height: 1920,
    language: 'en',
    aspectRatio: '9:16',
    cuts: [{ id: 'end', durationInFrames: 45, imageSrc: 'end.png', overlayStyle: 'none' }],
  };
  const imported = await importLegacy(character, { context, baseDir: root });
  assert.equal(imported.production.timeline.clips[0].duration_ms, 1500);
  assert.equal(imported.production.brief.deliveries[0].locale, 'en');
  assert.equal(imported.takes[0].kind, 'image');
});

test('JSON import reads source-relative paths; YAML is explicit injected parsing; source bytes stay intact', async () => {
  const input = {
    fps: 10,
    language: 'en',
    width: 160,
    height: 90,
    aspectRatio: '16:9',
    cuts: [{ id: 's1', videoSrc: 'existing.mp4', durationInFrames: 10 }],
  };
  const file = path.join(root, 'legacy.json');
  await fs.writeFile(file, JSON.stringify(input));
  const before = await fileHash(file);
  const imported = await importLegacy(file, { context });
  assert.equal(imported.report.files[0].exists, true);
  assert.equal(await fileHash(file), before);
  const yamlFile = path.join(root, 'legacy.yaml');
  await fs.writeFile(yamlFile, 'legacy: fixture\n');
  await assert.rejects(readLegacyFile(yamlFile), { code: 'YAML_PARSER_REQUIRED' });
  assert.deepEqual(
    await readLegacyFile(yamlFile, {
      yamlParser: (text) => {
        assert.equal(text, 'legacy: fixture\n');
        return input;
      },
    }),
    input,
  );
  assert.equal(await fs.readFile(yamlFile, 'utf8'), 'legacy: fixture\n');
});

test('official character v2 registry roundtrip is lossless for unknown fields, IDs, numeric zero workspace and metadata', async () => {
  const registry = {
    version: 2,
    future_metadata: { keep: true },
    characters: {
      aria: {
        name: 'Aria',
        image_id: 398830212288488,
        image_url: 'https://example.com/aria.png',
        origin: 'generated',
        region: 'global',
        workspace_id: 0,
        fields: { short_description: 'Apprentice', custom: 'preserve' },
        source_prompt: 'Original prompt',
        generation: { model: 'gpt-image-2.5-flare', quality: '1440p', aspect_ratio: '16:9' },
        cache: { local_path: './missing-preview.png' },
        custom_future: { untouched: true },
      },
      old: {
        name: 'Old',
        image_id: '900719925474099312345',
        origin: 'imported',
        source_prompt: null,
        generation: null,
      },
    },
  };
  const original = structuredClone(registry);
  const imported = await importRegistry(registry, { baseDir: root });
  assert.equal(imported.assets[0].workspace_id, '0');
  assert.equal(imported.assets[1].provider_id, '900719925474099312345');
  assert(codes(imported).includes('OPTIONAL_PREVIEW_MISSING'));
  assert(codes(imported).includes('CONTEXT_UNKNOWN'));
  assert.deepEqual(exportRegistry(imported).registry, registry);
  assert.deepEqual(registry, original);
  assert.equal(imported.report.generated_jobs, 0);
});

test('official items registry rejects unsafe numeric IDs and unsupported versions; imported IDs never acquire invented generation', async () => {
  await assert.rejects(importRegistry({ version: 1, characters: {} }), {
    code: 'REGISTRY_VERSION_UNSUPPORTED',
  });
  const registry = {
    version: 2,
    items: {
      mug: {
        name: 'Mug',
        image_id: '123',
        origin: 'imported',
        source_prompt: null,
        generation: null,
        region: 'cn',
        workspace_id: 'workspace',
      },
      unsafe: { name: 'Unsafe', image_id: Number.MAX_SAFE_INTEGER + 1 },
    },
  };
  const imported = await importRegistry(registry);
  assert.equal(imported.entities[0].kind, 'prop');
  assert.equal(imported.assets[0].provenance.generation, null);
  assert(codes(imported).includes('UNSAFE_PROVIDER_ID'));
  assert.equal(imported.assets[1].provider_id, null);
  const exported = exportRegistry(imported);
  assert.equal(exported.registry.items.unsafe, undefined);
  assert(exported.report.issues.some((i) => i.code === 'REGISTRY_PROVIDER_ID_REQUIRED'));
});

test('legacy export verifies adopted source bytes and reports edits the old consumer cannot represent', async () => {
  const production = {
    schema_version: 'production.v1',
    project_id: 'film',
    revision: 2,
    context,
    brief: {
      original: 'Film',
      deliveries: [
        { id: 'ja-wide', locale: 'ja', aspect: '16:9', width: 160, height: 90, duration_ms: 1000 },
      ],
    },
    shots: [{ shot_id: 's1', take_id: 't1', prompt: 'Open', purpose: 'Intro' }],
    timeline: {
      fps: 10,
      clips: [{ shot_id: 's1', take_id: 't1', source_in_ms: 0, duration_ms: 1000, audio: false }],
      audio: [],
      captions: [],
    },
  };
  const takes = [
    {
      id: 't1',
      project_id: 'film',
      shot_id: 's1',
      kind: 'video',
      provenance: { context },
      path: 'existing.mp4',
      sha256: await fileHash(path.join(root, 'existing.mp4')),
      status: 'accepted',
      stale: false,
      qa: {
        technical: 'pass',
        creative: 'pass',
        continuity: 'pass',
        audio: 'not_applicable',
        reviewer: 'fixture',
        notes: 'Reviewed',
      },
    },
  ];
  const options = {
    baseDir: root,
    probe: async () => ({ video: true, duration_ms: 1200, audio_streams: 0 }),
  };
  const shotpack = await exportLegacy(production, takes, options);
  assert.equal(shotpack.report.complete, false);
  assert.equal(shotpack.manifest.scenes[0].durationInFrames, 10);
  assert.equal(shotpack.manifest.scenes[0].hasAudio, false);
  assert.equal(shotpack.manifest.project.textPolicy, '');
  assert.equal(shotpack.manifest.deliverables[0].compositionId, 'Shotpack');
  assert.equal(shotpack.report.asset_staging[0].source, path.join(root, 'existing.mp4'));
  assert.equal(shotpack.report.asset_staging[0].destination, 'public/shotpack-sample/scene-1.mp4');
  const character = await exportLegacy(production, takes, {
    ...options,
    format: 'character-render',
  });
  assert.equal(character.manifest.cuts[0].videoSrc, 'legacy/video-1.mp4');
  production.timeline.clips[0].audio = true;
  const nativeAudio = await exportLegacy(production, takes, {
    ...options,
    probe: async () => ({ video: true, duration_ms: 1200, audio_streams: 1 }),
  });
  assert(nativeAudio.report.issues.some((i) => i.code === 'EXPORT_NATIVE_AUDIO_UNREPRESENTABLE'));
  production.timeline.clips[0].audio = false;
  production.timeline.captions.push({ start_ms: 0, end_ms: 1000, text: 'Test' });
  production.timeline.clips[0].source_in_ms = 100;
  const unsupported = await exportLegacy(production, takes, options);
  assert.equal(unsupported.report.complete, false);
  assert(unsupported.report.issues.some((i) => i.code === 'EXPORT_TRIM_UNREPRESENTABLE'));
  assert(unsupported.report.issues.some((i) => i.code === 'EXPORT_FINISHING_REQUIRES_SIDECARS'));
  takes[0].status = 'completed';
  const unadopted = await exportLegacy(production, takes, options);
  assert.equal(unadopted.manifest, null);
  assert(unadopted.report.issues.some((i) => i.code === 'EXPORT_SOURCE_GATE_FAILED'));
});

test('legacy project and storyboard exports expose required staging and references rather than inventing missing material', async () => {
  const production = {
    schema_version: 'production.v1',
    project_id: 'film',
    revision: 2,
    context,
    entities: [],
    assets: [],
    brief: {
      original: 'Film',
      deliveries: [
        { id: 'ja-wide', locale: 'ja', aspect: '16:9', width: 160, height: 90, duration_ms: 1000 },
      ],
    },
    shots: [
      {
        shot_id: 's1',
        take_id: 't1',
        prompt: 'Open',
        purpose: 'Intro',
        camera: 'wide',
        references: [],
        generation_strategy: 'editable_shot',
      },
    ],
    timeline: {
      fps: 10,
      clips: [{ shot_id: 's1', take_id: 't1', source_in_ms: 0, duration_ms: 1000, audio: false }],
      audio: [],
      captions: [],
    },
  };
  const takes = [
    {
      id: 't1',
      project_id: 'film',
      shot_id: 's1',
      kind: 'video',
      provenance: { context },
      path: 'existing.mp4',
      sha256: await fileHash(path.join(root, 'existing.mp4')),
      status: 'accepted',
      stale: false,
      qa: {
        technical: 'pass',
        creative: 'pass',
        continuity: 'pass',
        audio: 'not_applicable',
        reviewer: 'fixture',
        notes: 'Reviewed',
      },
    },
  ];
  const options = {
    baseDir: root,
    probe: async () => ({ video: true, duration_ms: 1200, audio_streams: 0 }),
  };
  const storyboard = await exportLegacy(production, takes, {
    ...options,
    format: 'shotpack-storyboard',
  });
  assert.equal(storyboard.report.complete, true);
  assert.equal(storyboard.manifest.shots[0].audio, false);
  assert.equal(storyboard.manifest.shots[0].multi_shot, false);
  const shotpack = await exportLegacy(production, takes, {
    ...options,
    format: 'shotpack-project',
  });
  for (const code of [
    'EXPORT_STAGING_REQUIRED',
    'EXPORT_LEGACY_AUDIO_REQUIRED',
    'EXPORT_PROJECT_DATE_REQUIRED',
  ])
    assert(
      shotpack.report.issues.some((i) => i.code === code),
      code,
    );
  assert.equal(shotpack.manifest.project.assets.mode, 'local');
  assert.equal(shotpack.manifest.project.generation.image.enabled, false);
  const character = await exportLegacy(production, takes, {
    ...options,
    format: 'character-project',
    date: '2026-10-16',
  });
  assert(character.report.issues.some((i) => i.code === 'EXPORT_CHARACTER_REFERENCE_REQUIRED'));
  assert.equal(character.manifest.locales.ja.clips[0].source, 'video');
  assert.equal(character.manifest.generation.generateAudio, false);
});
