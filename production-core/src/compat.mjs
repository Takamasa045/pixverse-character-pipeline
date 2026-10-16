// Read-only boundary adapters. Imported completion is evidence, never QA approval.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileHash, inspectDelivery } from './finish.mjs';
import { validateProduction } from './contracts.mjs';

const copy = (value) => structuredClone(value);
const json = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const millis = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 1000) : 0);
const dimension = (aspect) =>
  ({
    '16:9': [1920, 1080],
    '9:16': [1080, 1920],
    '1:1': [1080, 1080],
    '4:3': [1440, 1080],
    '3:4': [1080, 1440],
    '3:2': [1620, 1080],
    '2:3': [1080, 1620],
    '21:9': [2520, 1080],
  })[aspect] || [null, null];
const unknownQa = () => ({
  technical: null,
  creative: null,
  continuity: null,
  audio: null,
  reviewer: null,
  notes: 'Imported source requires explicit review before adoption.',
});
const issue = (report, code, fields = {}) => report.issues.push({ code, ...fields });

function identifier(value, report, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    issue(report, 'UNSAFE_PROVIDER_ID', { field });
    return null;
  }
  if (
    !['number', 'string'].includes(typeof value) ||
    !/^\d+$/.test(String(value)) ||
    BigInt(value) <= 0n
  ) {
    issue(report, 'PROVIDER_ID_INVALID', { field });
    return null;
  }
  return String(value);
}

/** JSON needs no dependencies. YAML is supported only with an explicitly supplied parser. */
export async function readLegacyFile(file, { yamlParser } = {}) {
  const text = await fs.readFile(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!yamlParser)
      throw Object.assign(
        new Error(
          'Non-JSON legacy input requires an injected yamlParser; the original file has not been modified.',
        ),
        { code: 'YAML_PARSER_REQUIRED' },
      );
    const result = yamlParser(text);
    if (!result || typeof result !== 'object')
      throw Object.assign(new Error('Legacy parser did not return an object'), {
        code: 'LEGACY_INVALID',
      });
    return result;
  }
}

function contextFor(value, report, field = 'context') {
  const unsafe =
    typeof value?.workspace_id === 'number' && !Number.isSafeInteger(value.workspace_id);
  if (unsafe) issue(report, 'UNSAFE_WORKSPACE_ID', { field });
  const context = {
    region: value?.region ?? null,
    workspace_id:
      unsafe || value?.workspace_id === undefined || value.workspace_id === null
        ? null
        : String(value.workspace_id),
  };
  if (!context.region || context.workspace_id === null)
    issue(report, 'CONTEXT_UNKNOWN', {
      field,
      action: 'Verify the intended account, region and workspace before reusing provider assets.',
    });
  return context;
}

function createProduction(input, options, report) {
  const project = input.project || {};
  const sourceId = String(project.slug || project.id || 'project')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 64);
  return {
    schema_version: 'production.v1',
    project_id: options.projectId || `legacy-${sourceId}-${hash(input).slice(0, 12)}`,
    revision: 1,
    context: contextFor(options.context, report),
    brief: {
      original: project.title || project.name || input.meta?.title || 'Imported legacy project',
      intent: 'Review imported material and missing production requirements.',
      deliveries: [],
      assumptions: [],
    },
    entities: [],
    assets: [],
    shots: [],
    execution_policy: { allowed_scope: 'planning_only', max_credits: 0, max_attempts: 1 },
    timeline: {
      fps: input.render?.fps || input.meta?.fps || input.fps || 30,
      clips: [],
      audio: [],
      captions: [],
    },
    migration: {
      source_format: report.source_format,
      source_sha256: hash(input),
      original: copy(input),
    },
  };
}

async function addAsset(production, report, fields, options) {
  const asset = {
    id: `legacy-asset-${production.assets.length + 1}`,
    kind: fields.kind || 'image',
    path: fields.path || undefined,
    provider_id: fields.provider_id || undefined,
    region: production.context.region,
    workspace_id: production.context.workspace_id,
    provenance: {
      source: 'legacy_import',
      source_format: report.source_format,
      original: fields.original || null,
    },
    qa: unknownQa(),
  };
  production.assets.push(asset);
  if (asset.path) {
    const absolute = path.resolve(options.baseDir || '.', asset.path);
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile() || !stat.size) throw new Error('empty or not a regular file');
      asset.sha256 = await fileHash(absolute);
      report.files.push({
        asset_id: asset.id,
        path: asset.path,
        exists: true,
        sha256: asset.sha256,
      });
    } catch (error) {
      issue(report, 'FILE_MISSING', {
        asset_id: asset.id,
        path: asset.path,
        message: error.message,
      });
      report.files.push({ asset_id: asset.id, path: asset.path, exists: false });
    }
  } else issue(report, 'LOCAL_FILE_UNKNOWN', { asset_id: asset.id });
  if (!asset.provider_id) issue(report, 'PROVIDER_ID_UNKNOWN', { asset_id: asset.id });
  issue(report, 'QA_UNKNOWN', { asset_id: asset.id });
  return asset;
}

function addShot(production, fields) {
  const shot = {
    shot_id: fields.id,
    purpose: fields.purpose || '',
    prompt: fields.prompt || '',
    edit_duration_ms: fields.duration,
    entry_state: fields.entry_state || '',
    exit_state: fields.exit_state || '',
    camera: fields.camera || '',
    audio: {
      intent:
        fields.audio === false
          ? 'silent'
          : fields.audio === true
            ? 'native_audio_requested'
            : 'unspecified',
    },
    references: [],
    generation_strategy: fields.multi_shot === true ? 'native_sequence' : 'editable_shot',
  };
  if (fields.model)
    shot.generation = {
      backend: 'create',
      mode: fields.mode || 'video',
      model: fields.model,
      parameters: Object.fromEntries(
        Object.entries({
          duration: fields.duration / 1000,
          quality: fields.quality,
          aspect_ratio: fields.aspect,
          audio: fields.generation_audio ?? fields.audio,
          multi_shot: fields.multi_shot,
        }).filter(([, v]) => v !== undefined),
      ),
      upper_credits: null,
      price_evidence: null,
    };
  production.shots.push(shot);
  return shot;
}

function addTake(production, takes, asset, shot, fields = {}) {
  const take = {
    id: `legacy-take-${takes.length + 1}`,
    project_id: production.project_id,
    shot_id: shot.shot_id,
    intent_id: null,
    provider_id: asset.provider_id || null,
    kind: asset.kind,
    path: asset.path,
    sha256: asset.sha256,
    status: asset.sha256 ? 'downloaded' : 'completed',
    qa: unknownQa(),
    stale: false,
    provenance: {
      source: 'legacy_import',
      legacy_status: fields.status || null,
      asset_id: asset.id,
    },
  };
  takes.push(take);
  // A candidate placement is deliberately not shot.take_id adoption.
  return take;
}

function addDelivery(production, { id, aspect, locale = 'und', duration, width, height }) {
  const [w, h] = dimension(aspect);
  production.brief.deliveries.push({
    id,
    locale,
    aspect,
    duration_ms: duration,
    width: width ?? w,
    height: height ?? h,
  });
}

// The retired spokesperson entry normalizes scripts into generated clip requirements.
// Defaults below mirror its local reader and are explicitly recorded, never generated.
function normalizeSpokesperson(input, report) {
  if (!input.scripts || typeof input.scripts !== 'object' || Array.isArray(input.scripts))
    throw Object.assign(new Error('Legacy spokesperson scripts must be a locale map'), {
      code: 'LEGACY_SCRIPTS_INVALID',
    });
  const output = input.output || {},
    announcement = input.announcement || {},
    locales = {};
  const defaults = (field, value) => {
    issue(report, 'LEGACY_DEFAULT_APPLIED', {
      field,
      value,
      source: 'retired Character config reader',
    });
    return value;
  };
  const duration =
    typeof output.duration === 'number' && Number.isFinite(output.duration)
      ? output.duration
      : defaults('output.duration', 5);
  const aspects =
    Array.isArray(output.aspect_ratios) && output.aspect_ratios.length
      ? output.aspect_ratios
      : defaults('output.aspect_ratios', ['16:9', '9:16']);
  for (const [locale, script] of Object.entries(input.scripts)) {
    if (!script || typeof script !== 'object' || Array.isArray(script)) {
      issue(report, 'LEGACY_SCRIPT_INVALID', { locale });
      continue;
    }
    const mode =
      typeof script.audio_mode === 'string'
        ? script.audio_mode
        : defaults(`scripts.${locale}.audio_mode`, 'tts');
    if (!['tts', 'file'].includes(mode))
      issue(report, 'LEGACY_AUDIO_MODE_REVIEW_REQUIRED', { locale, value: mode });
    const text = typeof script.text === 'string' ? script.text : undefined;
    const voiceId =
      mode === 'tts' && typeof script.voice_id === 'string' && script.voice_id.trim()
        ? script.voice_id
        : null;
    const audioFile =
      mode === 'file' && typeof script.audio_file === 'string' && script.audio_file.trim()
        ? script.audio_file
        : null;
    if (script.tts_speaker !== undefined)
      issue(report, 'LEGACY_NUMERIC_TTS_SPEAKER_UNMAPPED', {
        locale,
        original: copy(script.tts_speaker),
        voice_id: voiceId,
        action:
          'Select or verify an actual voice_id; a legacy numeric speaker index is not a current voice identifier.',
      });
    if (mode === 'file' && !audioFile) issue(report, 'LEGACY_AUDIO_FILE_MISSING', { locale });
    if (mode === 'tts' && !text) issue(report, 'LEGACY_SCRIPT_TEXT_MISSING', { locale });
    locales[locale] = {
      clips: [
        {
          id: 'primary',
          source: 'generated',
          durationSeconds: duration,
          text,
          audioFile,
          voiceId,
          hasAudio: true,
          overlayStyle: 'none',
          overlayText: '',
        },
      ],
    };
  }
  const ambient =
    typeof output.ambient_sound === 'string' ? output.ambient_sound.trim().toLowerCase() : '';
  const generateAudio =
    typeof output.generate_audio === 'boolean'
      ? output.generate_audio
      : Boolean(ambient && !['none', 'null', 'false'].includes(ambient));
  if (ambient && !['none', 'null', 'false'].includes(ambient))
    issue(report, 'LEGACY_AMBIENT_HINT_REVIEW_REQUIRED', {
      original: output.ambient_sound,
      generate_audio: generateAudio,
    });
  if (input.prompt?.per_ratio)
    issue(report, 'LEGACY_RATIO_PROMPTS_REQUIRE_PER_DELIVERY_PLAN', {
      original: copy(input.prompt.per_ratio),
    });
  report.source_variant = 'spokesperson';
  return {
    project: { title: announcement.topic || 'Untitled Project', date: announcement.date ?? null },
    speaker: copy(input.speaker || {}),
    locales,
    render: { aspectRatios: aspects, fps: defaults('render.fps', 30), outputDir: output.dest },
    generation: {
      model: output.model,
      referenceModel: output.reference_model,
      quality: output.quality,
      upscale: output.upscale,
      generateAudio,
      prompt: { base: input.prompt?.base, perRatio: input.prompt?.per_ratio },
    },
  };
}

async function characterImport(input, production, takes, report, options) {
  if (!input.locales)
    throw Object.assign(
      new Error('Character import requires project.locales or legacy spokesperson scripts.'),
      { code: 'LEGACY_CHARACTER_UNSUPPORTED' },
    );
  const images = input.speaker?.images || [];
  if (input.speaker) {
    const refs = [];
    for (const image of images)
      refs.push((await addAsset(production, report, { kind: 'image', path: image }, options)).id);
    production.entities.push({
      id: 'legacy-speaker',
      revision: 1,
      kind: 'character',
      name: input.speaker.name || '',
      reference_asset_ids: refs,
      provenance: { source: 'legacy_speaker', original: copy(input.speaker) },
    });
    issue(report, 'CHARACTER_FACETS_UNKNOWN', {
      entity_id: 'legacy-speaker',
      missing: ['voice', 'wardrobe', 'world', 'performance', 'accepted_revision'],
    });
  }
  for (const [locale, config] of Object.entries(input.locales)) {
    let cursor = 0;
    for (const clip of config.clips || []) {
      const id = `${locale}:${clip.id}`,
        duration = millis(clip.durationSeconds);
      const shot = addShot(production, {
        id,
        duration,
        prompt: clip.prompt || input.generation?.prompt?.base,
        purpose: clip.overlayText,
        audio: clip.hasAudio,
        generation_audio: input.generation?.generateAudio,
        mode: clip.source === 'reference' ? 'reference' : 'video',
        model: ['generated', 'reference'].includes(clip.source)
          ? clip.source === 'reference'
            ? input.generation?.referenceModel || input.generation?.model
            : input.generation?.model
          : undefined,
        quality: input.generation?.quality,
      });
      shot.references = production.entities.flatMap((e) =>
        e.reference_asset_ids.map((asset, order) => ({ asset, role: 'identity', order })),
      );
      let take;
      if (['video', 'image'].includes(clip.source) && clip.asset)
        take = addTake(
          production,
          takes,
          await addAsset(
            production,
            report,
            { kind: clip.source, path: clip.asset, original: copy(clip) },
            options,
          ),
          shot,
        );
      else
        issue(report, 'GENERATED_ASSET_UNRESOLVED', {
          shot_id: id,
          action:
            'Supply an existing run/render manifest; migration does not generate replacement media.',
        });
      production.timeline.clips.push({
        shot_id: id,
        take_id: take?.id || null,
        source_in_ms: 0,
        duration_ms: duration,
        locale,
        audio: clip.hasAudio === true,
        ...(clip.audioVolume === undefined ? {} : { volume: clip.audioVolume }),
      });
      if (clip.overlayText && clip.overlayStyle !== 'none') {
        production.timeline.captions.push({
          start_ms: cursor,
          end_ms: cursor + duration,
          text: clip.overlayText,
          locale,
        });
        issue(report, 'OVERLAY_CONVERTED_TO_SIDECAR', {
          shot_id: id,
          original_style: clip.overlayStyle,
        });
      }
      if (clip.audioFile) {
        const a = await addAsset(
          production,
          report,
          { kind: 'audio', path: clip.audioFile },
          options,
        );
        production.timeline.audio.push({
          asset_id: a.id,
          start_ms: cursor,
          source_in_ms: 0,
          duration_ms: duration,
          volume: clip.audioVolume ?? 1,
          locale,
        });
      }
      if (clip.text && !clip.audioFile)
        issue(report, 'VOICE_ASSET_UNRESOLVED', {
          shot_id: id,
          text: clip.text,
          voice_id: clip.voiceId ?? null,
        });
      cursor += duration;
    }
    for (const aspect of input.render?.aspectRatios || ['16:9'])
      addDelivery(production, {
        id: `${locale}-${aspect.replace(':', 'x')}`,
        aspect,
        locale,
        duration: cursor,
      });
    if (config.bgm) {
      const a = await addAsset(production, report, { kind: 'audio', path: config.bgm }, options);
      production.timeline.audio.push({
        asset_id: a.id,
        start_ms: 0,
        source_in_ms: 0,
        duration_ms: cursor,
        volume: config.bgmVolume ?? 1,
        locale,
      });
    }
  }
  if (input.generation?.upscale || input.generation?.image?.enabled)
    issue(report, 'LEGACY_GENERATION_OPTIONS_RETAINED_ONLY', {
      action: 'Review source metadata when planning future jobs.',
    });
}

async function shotpackImport(input, production, takes, report, options) {
  const project = input.project?.slug ? input : options.project || {};
  const storyboard = input.shots ? input : input.storyboard || options.storyboard;
  if (!storyboard?.shots)
    throw Object.assign(
      new Error(
        'Shotpack project references a separate storyboard; supply it explicitly with options.storyboard.',
      ),
      { code: 'STORYBOARD_REQUIRED' },
    );
  const scenes = (options.manifest || input.manifest)?.scenes || [];
  let duration = 0;
  for (let index = 0; index < storyboard.shots.length; index++) {
    const legacy = storyboard.shots[index],
      id = legacy.id || `shot-${index + 1}`;
    const shot = addShot(production, {
      id,
      duration: millis(legacy.duration),
      prompt: legacy.prompt,
      purpose: legacy.objective || legacy.notes,
      entry_state: legacy.entry_state,
      exit_state: legacy.exit_state,
      camera: legacy.camera,
      audio: legacy.audio,
      multi_shot: legacy.multi_shot,
      model: legacy.model || project.generation?.model,
      quality: legacy.quality,
      aspect: legacy.aspect_ratio,
      mode: 'video',
    });
    if (legacy.image_ref && legacy.image_ref !== 'generate') {
      const ref = String(legacy.image_ref);
      const asset = await addAsset(
        production,
        report,
        {
          kind: 'image',
          path: /^https?:/.test(ref) || /^\d+$/.test(ref) ? undefined : ref,
          provider_id: /^\d+$/.test(ref)
            ? identifier(legacy.image_ref, report, `${id}.image_ref`)
            : undefined,
          original: { image_ref: legacy.image_ref },
        },
        options,
      );
      shot.references.push({ asset: asset.id, role: 'appearance', order: 0 });
    } else if (legacy.image_ref === 'generate')
      issue(report, 'REFERENCE_UNRESOLVED', { shot_id: id });
    const scene = scenes.find((s) => s.shot_id === id) || scenes[index];
    let take;
    if (scene?.assets?.videoSrc)
      take = addTake(
        production,
        takes,
        await addAsset(
          production,
          report,
          {
            kind: 'video',
            path: scene.assets.videoSrc,
            provider_id: identifier(
              scene.provider_id ?? scene.video_id,
              report,
              `${id}.provider_id`,
            ),
            original: copy(scene),
          },
          options,
        ),
        shot,
      );
    else if (project.assets?.mode === 'local' && project.assets?.videoPattern) {
      const filename = project.assets.videoPattern.replace(/%0?(\d*)d/, (_, n) =>
        String(index + 1).padStart(Number(n) || 1, '0'),
      );
      take = addTake(
        production,
        takes,
        await addAsset(
          production,
          report,
          { kind: 'video', path: path.join(project.assets.sourceDir || '.', filename) },
          options,
        ),
        shot,
      );
    } else issue(report, 'GENERATED_ASSET_UNRESOLVED', { shot_id: id });
    production.timeline.clips.push({
      shot_id: id,
      take_id: take?.id || null,
      source_in_ms: 0,
      duration_ms: shot.edit_duration_ms,
      audio: legacy.audio === true,
    });
    duration += shot.edit_duration_ms;
    if (Object.values(legacy.post_process || {}).some(Boolean))
      issue(report, 'POST_PROCESS_NOT_REPLAYED', {
        shot_id: id,
        original: copy(legacy.post_process),
      });
    if (!shot.purpose || !shot.entry_state || !shot.exit_state || !shot.camera)
      issue(report, 'SHOT_DESIGN_INCOMPLETE', { shot_id: id });
  }
  const aspects = storyboard.meta?.aspects || [project.generation?.aspectRatio || '16:9'];
  for (const aspect of aspects)
    addDelivery(production, { id: `und-${aspect.replace(':', 'x')}`, aspect, duration });
  if (project.assets?.audio) {
    const a = await addAsset(
      production,
      report,
      { kind: 'audio', path: path.join(project.assets.sourceDir || '.', project.assets.audio) },
      options,
    );
    production.timeline.audio.push({
      asset_id: a.id,
      start_ms: 0,
      source_in_ms: 0,
      duration_ms: duration,
      volume: 1,
    });
  }
  production.timeline.fps = storyboard.meta?.fps || project.render?.fps || production.timeline.fps;
}

async function manifestImport(input, production, takes, report, options) {
  if (input.variants && !input.scenes && !input.cuts) {
    issue(report, 'RUN_MANIFEST_REQUIRES_RENDER_MANIFEST', {
      variants: copy(input.variants),
      action:
        'Import each existing manifest.render.json explicitly. Completed is not proof that its files exist.',
    });
    for (const variant of input.variants)
      if (variant.file)
        await addAsset(
          production,
          report,
          {
            kind: 'video',
            path: variant.file,
            original: {
              status: variant.status,
              language: variant.language,
              aspectRatio: variant.aspectRatio,
            },
          },
          options,
        );
    return;
  }
  const scenes = input.scenes || input.cuts;
  if (!Array.isArray(scenes))
    throw Object.assign(new Error('Manifest must contain scenes, cuts or variants'), {
      code: 'MANIFEST_INVALID',
    });
  let duration = 0;
  const fps = input.fps || input.deliverables?.[0]?.fps || production.timeline.fps;
  production.timeline.fps = fps;
  for (const [index, scene] of scenes.entries()) {
    const id = scene.shot_id || scene.id || `shot-${index + 1}`;
    const length =
      scene.durationSec === undefined
        ? Math.round(((scene.durationInFrames || 0) / fps) * 1000)
        : millis(scene.durationSec);
    const shot = addShot(production, {
      id,
      duration: length,
      prompt: scene.prompt,
      purpose: scene.objective,
      model: scene.model,
      audio: scene.hasAudio,
      multi_shot: scene.multi_shot,
    });
    const video = scene.assets?.videoSrc || scene.videoSrc,
      image = scene.imageSrc || scene.assets?.stills?.[0];
    let take;
    if (video || image)
      take = addTake(
        production,
        takes,
        await addAsset(
          production,
          report,
          {
            kind: video ? 'video' : 'image',
            path: video || image,
            provider_id: identifier(
              scene.provider_id ?? scene.video_id ?? scene.image_id,
              report,
              `${id}.provider_id`,
            ),
            original: copy(scene),
          },
          options,
        ),
        shot,
        { status: 'legacy_manifest' },
      );
    else issue(report, 'LOCAL_FILE_UNKNOWN', { shot_id: id });
    production.timeline.clips.push({
      shot_id: id,
      take_id: take?.id || null,
      source_in_ms: 0,
      duration_ms: length,
      audio: scene.hasAudio === true,
      ...(scene.audioVolume === undefined ? {} : { volume: scene.audioVolume }),
    });
    if (scene.transition && scene.transition !== 'cut')
      issue(report, 'TRANSITION_UNREPRESENTED', { shot_id: id, value: scene.transition });
    const text = scene.overlayText || scene.hookText;
    if (text && scene.overlayStyle !== 'none')
      production.timeline.captions.push({ start_ms: duration, end_ms: duration + length, text });
    if (scene.narrationSrc) {
      const asset = await addAsset(
        production,
        report,
        { kind: 'audio', path: scene.narrationSrc },
        options,
      );
      production.timeline.audio.push({
        asset_id: asset.id,
        start_ms: duration,
        source_in_ms: 0,
        duration_ms: length,
        volume: 1,
      });
    }
    duration += length;
  }
  const deliveries = input.deliverables || [
    {
      id: input.language || 'legacy',
      width: input.width,
      height: input.height,
      aspectRatio: input.aspectRatio,
      locale: input.language,
    },
  ];
  for (const delivery of deliveries) {
    const aspect =
      delivery.aspectRatio ||
      (delivery.width && delivery.height
        ? (() => {
            const gcd = (a, b) => (b ? gcd(b, a % b) : a);
            const g = gcd(delivery.width, delivery.height);
            return `${delivery.width / g}:${delivery.height / g}`;
          })()
        : '16:9');
    addDelivery(production, {
      id: delivery.id,
      aspect,
      locale: delivery.locale || input.language || 'und',
      duration,
      width: delivery.width,
      height: delivery.height,
    });
  }
  const audioPath = input.audio?.src || input.bgm;
  if (audioPath) {
    const a = await addAsset(production, report, { kind: 'audio', path: audioPath }, options);
    production.timeline.audio.push({
      asset_id: a.id,
      start_ms: 0,
      source_in_ms: 0,
      duration_ms: duration,
      volume: input.bgmVolume ?? 1,
    });
  }
  issue(report, 'DELIVERY_REVIEW_REQUIRED', {
    action:
      'Review imported timing, audio duration, overlay conversion and each source before adoption.',
  });
}

export async function importLegacy(input, options = {}) {
  if (typeof input === 'string') {
    options = { baseDir: path.dirname(path.resolve(input)), ...options };
    input = await readLegacyFile(input, options);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Object.assign(new Error('Expected a legacy input object'), { code: 'LEGACY_INVALID' });
  const format =
    options.format ||
    (input.locales || input.scripts
      ? 'character'
      : input.scenes || input.cuts || input.variants
        ? 'manifest'
        : 'shotpack');
  const report = {
    schema_version: 'migration-report.v1',
    source_format: format,
    generated_jobs: 0,
    source_modified: false,
    costs: { actual_credits: null, source: 'legacy_not_verified' },
    issues: [],
    files: [],
  };
  const production = createProduction(input, options, report),
    takes = [];
  if (format === 'character' || format === 'character-project') {
    const characterInput =
      !input.locales && input.scripts ? normalizeSpokesperson(input, report) : input;
    if (report.source_variant === 'spokesperson') {
      production.brief.original = characterInput.project.title;
      production.timeline.fps = characterInput.render.fps;
      production.migration.normalization = {
        kind: 'legacy-spokesperson',
        project_date: characterInput.project.date,
      };
    }
    await characterImport(characterInput, production, takes, report, options);
  } else if (
    format === 'shotpack' ||
    format === 'shotpack-project' ||
    format === 'shotpack-storyboard'
  )
    await shotpackImport(input, production, takes, report, options);
  else if (
    format === 'manifest' ||
    format === 'shotpack-manifest' ||
    format === 'character-render' ||
    format === 'character-run'
  )
    await manifestImport(input, production, takes, report, options);
  else
    throw Object.assign(new Error(`Unsupported legacy format: ${format}`), {
      code: 'LEGACY_FORMAT_UNSUPPORTED',
    });
  production.brief.assumptions = [...new Set(report.issues.map((i) => i.code))];
  report.validation = validateProduction(json(production));
  report.ready_for_delivery = false;
  report.imported = {
    shots: production.shots.length,
    assets: production.assets.length,
    takes: takes.length,
    entities: production.entities.length,
  };
  return json({ production, takes, report });
}

/** Official v2 registry import keeps every unknown field for a lossless boundary export. */
export async function importRegistry(registry, options = {}) {
  if (typeof registry === 'string') {
    options = { baseDir: path.dirname(path.resolve(registry)), ...options };
    registry = await readLegacyFile(registry, options);
  }
  if (registry?.version !== 2)
    throw Object.assign(new Error('Only official registry version 2 is supported'), {
      code: 'REGISTRY_VERSION_UNSUPPORTED',
    });
  const kind =
    options.kind || (registry.characters ? 'characters' : registry.items ? 'items' : null);
  if (
    !['characters', 'items'].includes(kind) ||
    !registry[kind] ||
    typeof registry[kind] !== 'object' ||
    Array.isArray(registry[kind])
  )
    throw Object.assign(new Error('Expected characters or items map'), {
      code: 'REGISTRY_INVALID',
    });
  const report = {
    schema_version: 'migration-report.v1',
    source_format: `registry-${kind}-v2`,
    generated_jobs: 0,
    source_modified: false,
    issues: [],
    files: [],
  };
  const entities = [],
    assets = [];
  for (const [slug, entry] of Object.entries(registry[kind])) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw Object.assign(new Error(`Invalid registry entry ${slug}`), {
        code: 'REGISTRY_INVALID',
      });
    const provider_id = identifier(entry.image_id, report, `${kind}.${slug}.image_id`);
    if (!provider_id) issue(report, 'PROVIDER_ID_UNKNOWN', { slug });
    if (!entry.name) issue(report, 'ENTITY_NAME_UNKNOWN', { slug });
    const context = contextFor(entry, report, `${kind}.${slug}`);
    const asset = {
      id: `registry:${kind}:${slug}:reference`,
      kind: 'image',
      provider_id,
      path: entry.cache?.local_path || undefined,
      region: context.region,
      workspace_id: context.workspace_id,
      provenance: {
        source: 'official_registry_v2',
        slug,
        source_prompt: entry.source_prompt ?? null,
        generation: entry.generation ?? null,
        origin: entry.origin ?? null,
      },
      qa: unknownQa(),
    };
    if (asset.path) {
      try {
        asset.sha256 = await fileHash(path.resolve(options.baseDir || '.', asset.path));
        report.files.push({ path: asset.path, exists: true, asset_id: asset.id });
      } catch {
        report.files.push({ path: asset.path, exists: false, asset_id: asset.id });
        issue(report, 'OPTIONAL_PREVIEW_MISSING', { slug, path: asset.path });
      }
    }
    assets.push(asset);
    entities.push({
      id: `registry:${kind}:${slug}`,
      revision: 1,
      kind: kind === 'characters' ? 'character' : 'prop',
      name: entry.name || slug,
      reference_asset_ids: [asset.id],
      provenance: { source: 'official_registry_v2', slug },
      registry: { kind, slug, original: copy(entry) },
    });
    issue(report, 'QA_UNKNOWN', { entity_id: entities.at(-1).id });
    issue(report, 'ENTITY_FACETS_UNKNOWN', {
      entity_id: entities.at(-1).id,
      missing: ['voice', 'wardrobe', 'world', 'accepted_revision'],
    });
  }
  return json({
    entities,
    assets,
    report,
    registry_metadata: Object.fromEntries(
      Object.entries(copy(registry)).filter(([key]) => key !== kind),
    ),
    kind,
  });
}

/** Pass the import bundle, or {entities,assets,kind,registry_metadata}. No filesystem writes. */
export function exportRegistry(bundle, options = {}) {
  const kind = options.kind || bundle.kind || bundle.entities?.[0]?.registry?.kind;
  if (!['characters', 'items'].includes(kind))
    throw Object.assign(new Error('Registry kind is required'), { code: 'REGISTRY_KIND_REQUIRED' });
  const entries = {},
    issues = [];
  for (const entity of bundle.entities || []) {
    if (entity.registry?.kind !== kind) {
      issues.push({ code: 'REGISTRY_ENTITY_UNREPRESENTABLE', entity_id: entity.id });
      continue;
    }
    const asset = (bundle.assets || []).find((a) => entity.reference_asset_ids?.includes(a.id));
    if (
      !asset?.provider_id ||
      !/^\d+$/.test(asset.provider_id) ||
      BigInt(asset.provider_id) <= 0n
    ) {
      issues.push({ code: 'REGISTRY_PROVIDER_ID_REQUIRED', entity_id: entity.id });
      continue;
    }
    if (Object.hasOwn(entries, entity.registry.slug)) {
      issues.push({
        code: 'REGISTRY_SLUG_COLLISION',
        entity_id: entity.id,
        slug: entity.registry.slug,
      });
      continue;
    }
    const entry = copy(entity.registry.original),
      originalId = entry.image_id;
    if (entry.name !== undefined || entity.name !== entity.registry.slug) entry.name = entity.name;
    entry.image_id = String(originalId) === asset.provider_id ? originalId : asset.provider_id;
    if (asset.region !== null && asset.region !== undefined) entry.region = asset.region;
    if (asset.workspace_id !== null && asset.workspace_id !== undefined)
      entry.workspace_id =
        String(entry.workspace_id) === String(asset.workspace_id)
          ? entry.workspace_id
          : asset.workspace_id;
    if (asset.path) entry.cache = { ...entry.cache, local_path: asset.path };
    entries[entity.registry.slug] = entry;
  }
  return {
    registry: { ...copy(bundle.registry_metadata || {}), version: 2, [kind]: entries },
    report: { issues, generated_jobs: 0, source_modified: false },
  };
}

/** Export selected adopted material to the two old Remotion consumer contracts. */
export async function exportLegacy(production, takes, options = {}) {
  const format = options.format || 'shotpack-manifest';
  const delivery =
    production.brief?.deliveries?.find((d) => d.id === options.variantId) ||
    production.brief?.deliveries?.[0];
  if (!delivery || (options.variantId && delivery.id !== options.variantId))
    throw Object.assign(new Error('Requested delivery is missing'), { code: 'DELIVERY_UNKNOWN' });
  const verification = await inspectDelivery(production, takes, {
    ...options,
    variantIds: [delivery.id],
  });
  if (!verification.ok)
    return {
      manifest: null,
      report: {
        issues: [{ code: 'EXPORT_SOURCE_GATE_FAILED', issues: verification.issues }],
        complete: false,
        ready_for_delivery: false,
        generated_jobs: 0,
        source_modified: false,
      },
    };
  const clips = (delivery.timeline?.clips ?? production.timeline?.clips ?? []).filter(
    (c) =>
      (!c.locale || c.locale === delivery.locale) &&
      (!c.delivery_id || c.delivery_id === delivery.id) &&
      (!c.variant_id || c.variant_id === delivery.id),
  );
  const fps = production.timeline.fps,
    issues = [],
    cuts = [],
    scenes = [];
  const verifiedSources = new Map(verification.sources.map((s) => [s.source_id, s]));
  let frame = 0;
  for (const clip of clips) {
    const take = (takes || []).find((t) => t.id === clip.take_id),
      shot = production.shots.find((s) => s.shot_id === clip.shot_id);
    if (!take?.path || take.status !== 'accepted' || take.stale !== false) {
      issues.push({ code: 'EXPORT_TAKE_UNACCEPTED', shot_id: clip.shot_id });
      continue;
    }
    if (clip.source_in_ms !== 0) {
      issues.push({ code: 'EXPORT_TRIM_UNREPRESENTABLE', shot_id: clip.shot_id });
      continue;
    }
    if (
      take.kind === 'image' &&
      !['character', 'character-render', 'character-project'].includes(format)
    ) {
      issues.push({ code: 'EXPORT_IMAGE_UNREPRESENTABLE', shot_id: clip.shot_id });
      continue;
    }
    if (
      clip.audio === true &&
      ['shotpack', 'manifest', 'shotpack-manifest', 'shotpack-project'].includes(format)
    )
      issues.push({
        code: 'EXPORT_NATIVE_AUDIO_UNREPRESENTABLE',
        shot_id: clip.shot_id,
        action:
          'The old Shotpack consumer mutes scene videos. Flatten or use the new local finishing adapter.',
      });
    if (format === 'character-project' && (clip.volume ?? 1) > 1)
      issues.push({ code: 'EXPORT_GAIN_UNREPRESENTABLE', shot_id: clip.shot_id });
    const duration = Math.round((clip.duration_ms / 1000) * fps);
    const sourcePath = verifiedSources.get(take.id).path;
    cuts.push({
      id: clip.shot_id,
      startFrame: frame,
      durationInFrames: duration,
      videoSrc: take.kind === 'video' ? sourcePath : null,
      imageSrc: take.kind === 'image' ? sourcePath : null,
      overlayText: '',
      overlayStyle: 'none',
      hasAudio: clip.audio === true,
      audioVolume: clip.volume ?? 1,
    });
    scenes.push({
      id: clip.shot_id,
      shot_id: clip.shot_id,
      startSec: frame / fps,
      endSec: (frame + duration) / fps,
      durationSec: duration / fps,
      startFrame: frame,
      durationInFrames: duration,
      assets: {
        videoSrc: take.kind === 'video' ? sourcePath : null,
        stills: take.kind === 'image' ? [sourcePath] : [],
      },
      prompt: shot?.prompt || '',
      objective: shot?.purpose || '',
      music_section: '',
      emotion: '',
      motif: '',
      hookText: null,
      model: shot?.generation?.model || '',
      multi_shot: shot?.generation_strategy === 'native_sequence',
      transition: 'cut',
      hasAudio: clip.audio === true,
    });
    frame += duration;
  }
  const audio = (delivery.timeline?.audio ?? production.timeline.audio ?? []).filter(
    (a) =>
      (!a.locale || a.locale === delivery.locale) &&
      (!a.delivery_id || a.delivery_id === delivery.id) &&
      (!a.variant_id || a.variant_id === delivery.id),
  );
  const captions = (delivery.timeline?.captions ?? production.timeline.captions ?? []).filter(
    (a) =>
      (!a.locale || a.locale === delivery.locale) &&
      (!a.delivery_id || a.delivery_id === delivery.id) &&
      (!a.variant_id || a.variant_id === delivery.id),
  );
  const simpleAudio =
    audio.length === 1 &&
    audio[0].start_ms === 0 &&
    audio[0].source_in_ms === 0 &&
    audio[0].duration_ms === delivery.duration_ms &&
    (['character', 'character-render', 'character-project'].includes(format) ||
      (audio[0].volume ?? 1) === 1)
      ? production.assets.find((a) => a.id === audio[0].asset_id)
      : null;
  const simpleAudioPath = simpleAudio ? verifiedSources.get(simpleAudio.id).path : null;
  if ((audio.length && !simpleAudio) || captions.length)
    issues.push({
      code: 'EXPORT_FINISHING_REQUIRES_SIDECARS',
      audio_tracks: audio.length,
      captions: captions.length,
      action:
        'Use delivery.v1 or flatten through local finishing; legacy manifest cannot preserve arbitrary tracks and timed captions.',
    });
  const theme = copy(
    production.theme ||
      production.migration?.original?.theme || {
        background: '#000000',
        accent: '#FFFFFF',
        text: '#FFFFFF',
      },
  );
  let manifest;
  if (format === 'character' || format === 'character-render')
    manifest = {
      aspectRatio: delivery.aspect,
      language: delivery.locale,
      projectSlug: production.project_id,
      fps,
      width: delivery.width,
      height: delivery.height,
      durationInFrames: frame,
      cuts,
      bgm: simpleAudioPath,
      bgmVolume: simpleAudio ? (audio[0].volume ?? 1) : 1,
      speakerImage: '',
      theme,
    };
  else if (
    [
      'shotpack',
      'manifest',
      'shotpack-manifest',
      'shotpack-project',
      'shotpack-storyboard',
    ].includes(format)
  )
    manifest = {
      project: {
        id: production.project_id,
        name: production.brief.original,
        version: String(production.revision),
        primaryDeliverable: delivery.id,
        textPolicy: '',
        editPolicy: '',
        protagonistPolicy: '',
        motifs: [],
        body: '',
        artistNotes: null,
        referenceNotes: null,
      },
      deliverables: [
        {
          id: delivery.id,
          width: delivery.width,
          height: delivery.height,
          fps,
          compositionId: 'Shotpack',
          durationInFrames: frame,
          sceneCount: scenes.length,
        },
      ],
      scenes,
      audio: { src: simpleAudioPath, durationInSeconds: frame / fps },
      theme,
      visualPeakSection: '',
      quietSection: '',
      thumbnail: { sceneId: scenes[0]?.id || '', frame: 0 },
    };
  else if (format === 'character-project') manifest = null;
  else
    throw Object.assign(new Error(`Unsupported export format: ${format}`), {
      code: 'LEGACY_EXPORT_UNSUPPORTED',
    });
  const date =
    options.date ||
    production.migration?.original?.project?.date ||
    production.migration?.normalization?.project_date;
  if (['character-project', 'shotpack-project'].includes(format) && !date)
    issues.push({
      code: 'EXPORT_PROJECT_DATE_REQUIRED',
      action: 'Supply the actual original or intended project date explicitly.',
    });
  if (format === 'character-project') {
    const identityIds = new Set(
      production.shots.flatMap((s) =>
        (s.references || []).filter((r) => r.role === 'identity').map((r) => r.asset),
      ),
    );
    const images = production.assets.filter(
      (a) => a.kind === 'image' && identityIds.has(a.id) && a.path,
    );
    const speakerImages = [];
    for (const asset of images) {
      try {
        if ((await fileHash(path.resolve(options.baseDir || '.', asset.path))) === asset.sha256)
          speakerImages.push(path.resolve(options.baseDir || '.', asset.path));
        else issues.push({ code: 'EXPORT_CHARACTER_REFERENCE_UNVERIFIED', asset_id: asset.id });
      } catch {
        issues.push({ code: 'EXPORT_CHARACTER_REFERENCE_UNVERIFIED', asset_id: asset.id });
      }
    }
    if (!speakerImages.length || speakerImages.length > 7)
      issues.push({
        code: 'EXPORT_CHARACTER_REFERENCE_REQUIRED',
        action:
          'The old Character runtime requires 1–7 existing speaker images; no placeholder or new reference is generated.',
      });
    manifest = {
      project: {
        slug: production.project_id,
        title: production.brief.original,
        date: date || null,
      },
      speaker: {
        name: production.entities?.find((e) => e.kind === 'character')?.name || '',
        images: speakerImages,
        mode: 'single',
      },
      locales: {
        [delivery.locale]: {
          theme,
          bgm: simpleAudioPath,
          bgmVolume: simpleAudio ? (audio[0].volume ?? 1) : 1,
          clips: cuts.map((c) => ({
            id: c.id,
            source: c.videoSrc ? 'video' : 'image',
            asset: c.videoSrc || c.imageSrc,
            durationSeconds: c.durationInFrames / fps,
            hasAudio: c.hasAudio,
            audioVolume: c.audioVolume,
            overlayStyle: 'none',
            overlayText: '',
          })),
        },
      },
      render: {
        fps,
        aspectRatios: [delivery.aspect],
        outputDir: options.legacyOutputDir || './output',
      },
      generation: { generateAudio: false, upscale: false, image: { enabled: false } },
    };
  }
  if (format === 'shotpack-storyboard' || format === 'shotpack-project') {
    const storyboard = {
      meta: {
        title: production.brief.original,
        fps,
        aspects: [delivery.aspect],
        target_duration_seconds: delivery.duration_ms / 1000,
      },
      shots: clips.map((c) => {
        const shot = production.shots.find((s) => s.shot_id === c.shot_id);
        if (!shot?.prompt && !shot?.purpose)
          issues.push({ code: 'EXPORT_SHOT_PROMPT_MISSING', shot_id: c.shot_id });
        return json({
          id: c.shot_id,
          prompt: shot?.prompt || shot?.purpose || '',
          objective: shot?.purpose || '',
          duration: c.duration_ms / 1000,
          aspect_ratio: delivery.aspect,
          audio: c.audio === true,
          multi_shot: shot?.generation_strategy === 'native_sequence',
          model: shot?.generation?.model,
          quality: shot?.generation?.parameters?.quality,
          notes: shot?.camera || '',
          entry_state: shot?.entry_state,
          exit_state: shot?.exit_state,
        });
      }),
    };
    if (format === 'shotpack-storyboard') manifest = storyboard;
    else {
      const staging = scenes.map((scene, i) => ({
        source: scene.assets.videoSrc,
        destination: `scene-${String(i + 1).padStart(2, '0')}.mp4`,
      }));
      issues.push({
        code: 'EXPORT_STAGING_REQUIRED',
        files: staging,
        action:
          'Copy reviewed sources into a separate export directory before using the old local runtime; this adapter performs no filesystem mutation.',
      });
      if (!simpleAudio)
        issues.push({
          code: 'EXPORT_LEGACY_AUDIO_REQUIRED',
          action:
            'The old Shotpack project requires an existing full-length audio file; no silent placeholder is invented.',
        });
      manifest = {
        project: {
          project: {
            slug: production.project_id,
            title: production.brief.original,
            date: date || null,
            version: String(production.revision),
          },
          inputs: { storyboard: './storyboard.json' },
          assets: {
            mode: 'local',
            sourceDir: options.assetDir || './adopted-assets',
            videoPattern: 'scene-%02d.mp4',
            stillPattern: 'ref-shot-%02d.webp',
            copyStills: false,
            audio: simpleAudioPath,
          },
          generation: { image: { enabled: false }, aspectRatio: delivery.aspect },
          render: {
            compositionId: 'Shotpack',
            fps,
            width: delivery.width,
            height: delivery.height,
            output: options.legacyOutput || './dist/render.mp4',
          },
          theme,
        },
        storyboard,
        render_manifest: manifest,
      };
    }
  }
  const staging = [];
  if (
    ['character', 'character-render', 'shotpack', 'manifest', 'shotpack-manifest'].includes(format)
  ) {
    const isCharacter = ['character', 'character-render'].includes(format),
      mapping = new Map();
    function stage(source, prefix) {
      if (!source) return source;
      if (mapping.has(source)) return mapping.get(source);
      const name = `${prefix}-${mapping.size + 1}${path.extname(source) || '.bin'}`;
      const reference = isCharacter ? `legacy/${name}` : name;
      staging.push({
        source,
        destination: isCharacter ? `public/${reference}` : `public/shotpack-sample/${name}`,
      });
      mapping.set(source, reference);
      return reference;
    }
    if (isCharacter) {
      for (const cut of manifest.cuts) {
        cut.videoSrc = stage(cut.videoSrc, 'video');
        cut.imageSrc = stage(cut.imageSrc, 'image');
      }
      manifest.bgm = stage(manifest.bgm, 'audio');
    } else {
      for (const scene of manifest.scenes) {
        scene.assets.videoSrc = stage(scene.assets.videoSrc, 'scene');
        scene.assets.stills = scene.assets.stills.map((s) => stage(s, 'still'));
      }
      manifest.audio.src = stage(manifest.audio.src, 'audio');
    }
    if (staging.length)
      issues.push({
        code: 'EXPORT_PUBLIC_STAGING_REQUIRED',
        action:
          'Copy the verified sources to the reported public paths in an isolated export directory before using the legacy composition. No files have been copied.',
      });
  }
  return {
    manifest,
    report: {
      issues,
      complete: !issues.length,
      ready_for_delivery: false,
      file_verification: 'pass',
      asset_staging: staging,
      legacy_renderer_presentation: 'requires_review',
      source_snapshots: verification.sources.map((s) => ({ id: s.source_id, sha256: s.sha256 })),
      generated_jobs: 0,
      source_modified: false,
    },
  };
}
