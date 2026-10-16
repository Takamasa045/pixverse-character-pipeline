import { submissionBoundary } from './submission.mjs';
import { createHash } from 'node:crypto';
import { cliRunner, withContext, mediaId, normalizeCreateResult } from './pixverse.mjs';

const copy = (value) => structuredClone(value);
const fail = (message) => {
  throw new Error(message);
};
const present = (value) =>
  value !== undefined &&
  value !== null &&
  value !== '' &&
  (!Array.isArray(value) || value.length > 0);
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => k !== 'trace_id')
        .sort()
        .map((k) => [k, sorted(value[k])]),
    );
  return value;
}
export const presetSnapshotHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(sorted(value)))
    .digest('hex');
function stringId(value) {
  if (typeof value === 'number') return mediaId(value);
  if (typeof value !== 'string' || !value.trim()) fail('Preset ID must be a nonempty string');
  return value;
}
const outputKind = (info) =>
  info.template_type === 1 ? 'video' : info.template_type === 2 ? 'image' : null;
function attested(snapshot) {
  return Boolean(
    snapshot?.analysis?.evidence?.source &&
    snapshot.analysis.evidence.info_sha256 === presetSnapshotHash(snapshot.info),
  );
}
function contextMatches(a, b) {
  return (
    a?.region === b?.region &&
    String(a?.workspace_id) === String(b?.workspace_id) &&
    a?.workspace_id !== undefined &&
    b?.workspace_id !== undefined
  );
}

function snapshotFor(intent) {
  if (
    intent.backend !== 'preset' ||
    !['template', 'miniapps'].includes(intent.mode) ||
    intent.model !== null
  )
    fail('Preset execution requires backend preset, template/miniapps mode, and model:null');
  stringId(intent.preset_id);
  if (!intent.id) fail('Immutable preset intent ID required');
  const snapshot = intent.preset_snapshot ?? intent.capability_snapshot;
  if (!snapshot?.info || !snapshot.cli_version || !contextMatches(snapshot.context, intent.context))
    fail('Preset info, installed CLI version and matching context snapshot required');
  return snapshot;
}
function bindUploads(parameters, inputs, schema, context) {
  const output = copy(parameters),
    groups = {};
  const uploads = schema.filter((s) => s.type === 'upload');
  for (const input of [...inputs].sort(
    (a, b) => (a.binding?.order ?? 0) - (b.binding?.order ?? 0),
  )) {
    const name = input.parameter ?? (uploads.length === 1 ? uploads[0].name : undefined);
    if (!name || !uploads.some((s) => s.name === name))
      fail('MiniApp reference requires an exact upload parameter binding');
    if (!contextMatches(input, context)) fail('MiniApp upload context unknown or mismatched');
    if (typeof input.media_path !== 'string' || !input.media_path.trim())
      fail('MiniApp inputs require an existing uploaded media_path; plan upload separately');
    (groups[name] ??= []).push(input.media_path);
  }
  for (const [name, paths] of Object.entries(groups)) {
    const desc = uploads.find((s) => s.name === name),
      value = desc.max_count === 1 ? paths[0] : paths.length === 1 ? paths[0] : paths;
    if (present(output[name]) && JSON.stringify(output[name]) !== JSON.stringify(value))
      fail('Conflicting MiniApp upload binding');
    output[name] = value;
  }
  return output;
}
export function validateMiniAppParameters(info, parameters, { inputs = [], context } = {}) {
  if (!Array.isArray(info.params_schema) || !info.params_schema.length)
    fail('MiniApp live params_schema required');
  if (info.can_create === false) fail('MiniApp is unavailable');
  const result = bindUploads(parameters, inputs, info.params_schema, context);
  for (const name of Object.keys(result))
    if (!info.params_schema.some((s) => s.name === name)) fail(`Unknown MiniApp parameter ${name}`);
  for (const desc of info.params_schema) {
    const value = result[desc.name];
    if (desc.required && !present(value)) fail(`Missing MiniApp parameter ${desc.name}`);
    if (!present(value)) continue;
    if (desc.type === 'unknown' || !['enum', 'text', 'upload'].includes(desc.type))
      fail(`Unknown MiniApp schema type ${desc.name}; inspect backend schema`);
    if (desc.type === 'enum' && (!Array.isArray(desc.options) || !desc.options.includes(value)))
      fail(`Illegal MiniApp enum ${desc.name}`);
    if (
      desc.type === 'text' &&
      (typeof value !== 'string' ||
        (desc.max_length !== undefined && value.length > desc.max_length))
    )
      fail(`Illegal MiniApp text ${desc.name}`);
    if (desc.type === 'upload') {
      const values = Array.isArray(value) ? value : [value];
      if (desc.max_count !== undefined && values.length > desc.max_count)
        fail(`Too many MiniApp uploads ${desc.name}`);
      for (const path of values) {
        if (typeof path !== 'string' || !path || /^(?:https?:|\/|\.\.?\/)/.test(path))
          fail('MiniApp upload requires a provider media path, not a local path or URL');
        const input = inputs.find((i) => i.media_path === path);
        if (!input || !contextMatches(input, context))
          fail('MiniApp upload lacks a matching context-bound input snapshot');
        if (input.kind === 'video' && desc.max_video_size_mb !== undefined) {
          if (
            !Number.isSafeInteger(input.size_bytes) ||
            input.size_bytes > desc.max_video_size_mb * 1024 * 1024
          )
            fail('MiniApp video size unknown or exceeds schema limit');
        }
      }
    }
  }
  return result;
}
// PixVerse CLI 1.4.9, source pinned in docs/ADAPTERS.md. Sources 21/22
// dispatch to template/generate; the legacy model Create route cannot replace it.
const orderedTemplate = (info) => [21, 22].includes(info.template_source);
const templateVersionSupported = (info, version) =>
  orderedTemplate(info) ? version === '1.4.9' : ['1.4.8', '1.4.9'].includes(version);
function orderedSlots(info) {
  const fields = info.input_fields;
  if (
    !Array.isArray(fields) ||
    !fields.length ||
    fields.some((f) => !f || !['image', 'video', 'text'].includes(f.content_type))
  )
    fail('Template detail has no supported input_fields schema');
  for (const f of fields) {
    for (const name of ['max_size', 'min_duration', 'max_duration'])
      if (f[name] !== undefined && (!Number.isFinite(f[name]) || f[name] <= 0))
        fail(`Invalid template ${name} constraint`);
    if (
      f.min_duration !== undefined &&
      f.max_duration !== undefined &&
      f.min_duration > f.max_duration
    )
      fail('Template duration constraints have no intersection');
  }
  if (
    fields.filter((f) => f.content_type === 'video').length > 1 ||
    fields.filter((f) => f.content_type === 'text').length > 1
  )
    fail('Template has more video/text slots than the CLI supports');
  return fields;
}
// Exact CLI mapping: reserve the remaining inputs for required slots; fill optional
// slots from left to right. Empty placeholders must describe that same mapping.
function mapOrderedImages(slots, values) {
  let at = 0,
    remainingRequired = slots.filter((f) => f.required !== false).length;
  return slots.map((f) => {
    const value =
      f.required === false && values.length - at <= remainingRequired ? '' : (values[at++] ?? '');
    if (f.required !== false) remainingRequired--;
    return value;
  });
}
function modernTemplateParameters(intent, snapshot) {
  const info = snapshot.info,
    fields = orderedSlots(info),
    p = copy(intent.parameters ?? {});
  if (!templateVersionSupported(info, snapshot.cli_version))
    fail(
      'Ordered templates require the verified CLI 1.4.9 execution contract; installed 1.4.8 cannot submit this schema',
    );
  if (mediaId(intent.preset_id) !== mediaId(info.template_id))
    fail('Template ID differs from snapshot');
  for (const name of Object.keys(p))
    if (!['image', 'video', 'prompt'].includes(name))
      fail(`Fixed template output/control override is not accepted: ${name}`);
  if (!Number.isFinite(info.fixed_cost) || info.fixed_cost < 0)
    fail('Live fixed template credit cost required before approval');
  if (!Number.isFinite(intent.upper_credits) || intent.upper_credits < info.fixed_cost)
    fail('Approved upper_credits is below the fixed template cost or missing');
  const images = fields.filter((f) => f.content_type === 'image');
  const videos = fields.filter((f) => f.content_type === 'video');
  const text = fields.filter((f) => f.content_type === 'text');
  const inputs = [...(intent.inputs ?? [])].sort(
    (a, b) => (a.binding?.order ?? 0) - (b.binding?.order ?? 0),
  );
  const values = new Map(),
    imageInputs = [],
    videoInputs = [];
  for (const input of inputs) {
    if (!['image', 'video'].includes(input.kind) || !contextMatches(input, intent.context))
      fail('Template input kind or context is unsupported');
    const value = input.provider_id ?? input.path ?? input.media_path;
    if (typeof value !== 'string' || !value || value.startsWith('http:'))
      fail('Invalid template media input');
    values.set(value, input);
    (input.kind === 'image' ? imageInputs : videoInputs).push(input);
  }
  const valueFor = (i) => i.provider_id ?? i.path ?? i.media_path;
  if (imageInputs.length && !present(p.image)) {
    if (imageInputs.some((i) => i.parameter !== undefined)) {
      p.image = images.map(() => '');
      for (const i of imageInputs) {
        const matches = images
          .map((f, n) => (i.parameter === f.node_id || i.parameter === f.name ? n : -1))
          .filter((n) => n >= 0);
        if (matches.length !== 1 || p.image[matches[0]])
          fail('Template image slot binding must identify one unoccupied field');
        p.image[matches[0]] = valueFor(i);
      }
    } else p.image = imageInputs.map(valueFor);
  }
  if (videoInputs.length > 1) fail('Template takes at most one video');
  if (videoInputs.length) {
    if (present(p.video) && p.video !== valueFor(videoInputs[0]))
      fail('Conflicting template video binding');
    p.video = valueFor(videoInputs[0]);
  }
  const supplied = p.image ?? [];
  if (
    !Array.isArray(supplied) ||
    supplied.some((v) => typeof v !== 'string') ||
    supplied.length > images.length
  )
    fail('Image inputs exceed or do not match the ordered template slots');
  const mapped = supplied.includes('')
    ? images.map((f, n) => supplied[n] ?? '')
    : mapOrderedImages(images, supplied);
  if (images.some((f, n) => f.required !== false && !mapped[n]))
    fail('Missing required ordered image slot');
  const canonical = mapOrderedImages(images, mapped.filter(Boolean));
  if (mapped.some((v, n) => v !== canonical[n]))
    fail('Optional image selection cannot be represented; fill optional slots from left to right');
  if ((p.video && !videos.length) || (videos.length && videos[0].required !== false && !p.video))
    fail('Video input does not match the template slots');
  if (p.prompt !== undefined && (!text.length || typeof p.prompt !== 'string'))
    fail('Template has no matching editable text input slot');
  if (p.prompt !== undefined && Array.from(p.prompt).length > 5000)
    fail('Template text exceeds the CLI 5000 character limit; refusing silent truncation');
  const bound = [
    ...mapped.map((v, n) => [v, images[n]]),
    ...(p.video ? [[p.video, videos[0]]] : []),
  ];
  for (const [value, field] of bound) {
    if (!value) continue;
    const input = inputs.find(
      (i) =>
        valueFor(i) === value &&
        i.kind === field.content_type &&
        (i.parameter === undefined || i.parameter === field.node_id || i.parameter === field.name),
    );
    if (!input || input.kind !== field.content_type)
      fail('Template media input lacks a matching context-bound snapshot');
    if (
      input.parameter !== undefined &&
      input.parameter !== field.node_id &&
      input.parameter !== field.name
    )
      fail('Template media snapshot does not match the selected ordered slot');
    if (
      field.max_size !== undefined &&
      (!Number.isSafeInteger(input.size_bytes) ||
        input.size_bytes < 0 ||
        input.size_bytes > field.max_size)
    )
      fail('Template input size is unknown or exceeds the field limit');
    if (
      field.content_type === 'video' &&
      (field.min_duration !== undefined || field.max_duration !== undefined)
    ) {
      const seconds = input.duration_ms / 1000;
      if (
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        (field.min_duration !== undefined && seconds < field.min_duration) ||
        (field.max_duration !== undefined && seconds > field.max_duration)
      )
        fail('Template video duration is unknown or outside field limits');
    }
  }
  if (inputs.some((i) => !bound.some(([v]) => v === valueFor(i))))
    fail('Unbound template reference snapshot');
  if (mapped.length) p.image = mapped;
  return p;
}
function modernOutput(info) {
  const items = info.output;
  if (
    !Array.isArray(items) ||
    !items.length ||
    items.some((o) => !['image', 'video'].includes(o.type))
  )
    fail('Template declared output metadata is unavailable');
  const kinds = [...new Set(items.map((o) => o.type))];
  const durations = items.map((o) => o.duration);
  const ratio = (a, b) => {
    while (b) [a, b] = [b, a % b];
    return a;
  };
  const aspects = items
    .filter(
      (o) =>
        Number.isSafeInteger(o.width) &&
        o.width > 0 &&
        Number.isSafeInteger(o.height) &&
        o.height > 0,
    )
    .map((o) => {
      const d = ratio(o.width, o.height);
      return `${o.width / d}:${o.height / d}`;
    });
  return {
    kind: kinds.length === 1 ? kinds[0] : null,
    kinds,
    declared_outputs: copy(items),
    fixed_duration_ms: null,
    aspects: null,
    ...(durations.every((d) => Number.isFinite(d) && d > 0) && new Set(durations).size === 1
      ? { fixed_duration_ms: durations[0] * 1000 }
      : {}),
    ...(aspects.length === items.length ? { aspects: [...new Set(aspects)] } : {}),
  };
}
function normalizeOrderedResult(raw, exit_code = 0) {
  const data = raw?.Resp ?? raw ?? {},
    results = new Map(),
    issues = [];
  // Error responses deliberately retain valid_outputs and response.outputs. Do
  // not lose accepted IDs merely because another output is malformed.
  for (const item of [
    ...(Array.isArray(data.outputs) ? data.outputs : []),
    ...(Array.isArray(data.valid_outputs) ? data.valid_outputs : []),
    ...(Array.isArray(data.response?.outputs) ? data.response.outputs : []),
  ]) {
    let id;
    try {
      id = mediaId(item?.media_id);
    } catch (e) {
      issues.push(e.message);
      continue;
    }
    if (!['image', 'video'].includes(item.media_type)) {
      issues.push(`Unknown output type for ${id}`);
      if (!results.has(id))
        results.set(id, { id, kind: 'unknown', status: 'running', inspection_unconfirmed: true });
      continue;
    }
    const prior = results.get(id);
    if (prior && prior.kind !== 'unknown' && prior.kind !== item.media_type) {
      issues.push(`Conflicting media types for output ${id}`);
      results.set(id, { id, kind: 'unknown', status: 'running', inspection_unconfirmed: true });
    } else results.set(id, { id, kind: item.media_type, status: 'submitted' });
  }
  if (!results.size)
    issues.push('No verified ordered template output IDs; reconcile provider history before retry');
  return {
    results: [...results.values()],
    exit_code,
    ...(data.error || issues.length ? { error: data.error ?? issues.join('; ') } : {}),
    raw,
  };
}

function templateParameters(intent, snapshot) {
  const info = snapshot.info,
    parameters = copy(intent.parameters ?? {});
  if (orderedTemplate(info)) return modernTemplateParameters(intent, snapshot);
  if (!templateVersionSupported(info, snapshot.cli_version))
    fail('Unverified template CLI version; verified versions are 1.4.8 and 1.4.9');
  if (!Number.isSafeInteger(info.effect_type) || info.effect_type < 0 || !outputKind(info))
    fail('Unknown template input/output schema');
  if (mediaId(intent.preset_id) !== mediaId(info.template_id))
    fail('Template ID differs from snapshot');
  const bindings = { image: [], video: [] };
  for (const input of [...(intent.inputs ?? [])].sort(
    (a, b) => (a.binding?.order ?? 0) - (b.binding?.order ?? 0),
  )) {
    if (!['image', 'video'].includes(input.kind) || !contextMatches(input, intent.context))
      fail('Template input kind or context is unsupported');
    const value = input.provider_id ?? input.path ?? input.media_path;
    if (typeof value !== 'string' || !value || value.startsWith('http:'))
      fail('Invalid template media input');
    bindings[input.kind].push(value);
  }
  for (const [name, list] of Object.entries(bindings))
    if (list.length) {
      const value = name === 'video' ? list[0] : list;
      if (name === 'video' && list.length > 1) fail('Template takes at most one video');
      if (present(parameters[name]) && JSON.stringify(parameters[name]) !== JSON.stringify(value))
        fail('Conflicting template media bindings');
      parameters[name] = value;
    }
  const images = parameters.image ?? [],
    videos = parameters.video ? [parameters.video] : [];
  if (!Array.isArray(images) || images.some((v) => typeof v !== 'string'))
    fail('Template image inputs must be ordered strings');
  if (images.length && videos.length) fail('Template image/video inputs are mutually exclusive');
  for (const value of [...images, ...videos])
    if (!Object.values(bindings).some((list) => list.includes(value)))
      fail('Template media input lacks a matching context-bound snapshot');
  if (info.effect_type === 0 && (images.length || videos.length))
    fail('Text-only template rejects media inputs');
  if (
    info.effect_type === 1 &&
    !(
      (images.length === 1 && !videos.length) ||
      (videos.length === 1 && !images.length && info.supported_features === 1000)
    )
  )
    fail('Template requires one image or its supported video alternative');
  if (info.effect_type > 1 && (images.length !== info.effect_type || videos.length))
    fail(`Template requires exactly ${info.effect_type} images`);
  // Avoid undocumented output overrides. The fixed preset output is compared in
  // candidate planning; this execution path accepts no arbitrary framing/duration.
  for (const key of Object.keys(parameters))
    if (!['image', 'video', 'prompt', 'seed', 'count'].includes(key))
      fail(`Preset output/control override is not verified: ${key}`);
  if (parameters.prompt !== undefined && typeof parameters.prompt !== 'string')
    fail('Template prompt must be text');
  if (parameters.seed !== undefined && !Number.isSafeInteger(parameters.seed))
    fail('Template seed must be a safe integer');
  parameters.count ??= 1;
  if (!Number.isSafeInteger(parameters.count) || parameters.count < 1 || parameters.count > 4)
    fail('Template count must be 1..4');
  return parameters;
}
export function resolvePresetIntent(intent) {
  const snapshot = snapshotFor(intent);
  let parameters, kind;
  if (intent.mode === 'template') {
    parameters = templateParameters(intent, snapshot);
    kind = orderedTemplate(snapshot.info) ? intent.output_kind : outputKind(snapshot.info);
    if (orderedTemplate(snapshot.info) && !modernOutput(snapshot.info).kinds.includes(kind))
      fail('Approved output kind is absent from template output metadata');
  } else {
    if (stringId(snapshot.info.app_id) !== intent.preset_id)
      fail('MiniApp ID differs from snapshot');
    parameters = validateMiniAppParameters(snapshot.info, intent.parameters ?? {}, {
      inputs: intent.inputs ?? [],
      context: intent.context,
    });
    if (!attested(snapshot) || !['image', 'video'].includes(snapshot.analysis.output?.kind))
      fail('MiniApp primary output kind needs evidence tied to the info snapshot');
    kind = snapshot.analysis.output.kind;
  }
  if (intent.output_kind !== kind) fail('Preset output kind differs from the approved requirement');
  return { parameters, output_kind: kind, snapshot };
}
function resultMiniApp(raw, expected, id, exit_code = 0) {
  const data = raw?.Resp ?? raw ?? {},
    assets = data.assets ?? [];
  const primary = assets.find((a) => a.type === 'video') ?? assets.find((a) => a.type === 'image');
  const project = data.project_id ?? data.id ?? id;
  const results = [];
  let error = data.error;
  if (project !== undefined) {
    const provider = mediaId(project),
      status =
        data.status === 'completed' || data.status_code === 1
          ? 'completed'
          : ['failed', 'error'].includes(data.status) || [7, 8].includes(data.status_code)
            ? 'provider_failed'
            : data.status === 'submitted'
              ? 'submitted'
              : 'running';
    const item = { id: provider, kind: expected, status };
    if (status === 'completed' && !primary) {
      item.status = 'running';
      item.inspection_unconfirmed = true;
      error = 'MiniApp primary output inspection is incomplete; resume the existing project';
    } else if (status === 'completed' && primary.type !== expected) {
      item.status = 'provider_failed';
      error = 'MiniApp primary output type differs from approved requirement';
    }
    if (primary) {
      item.url = primary.url ?? data.url;
      try {
        item.primary_media_id = mediaId(primary.id);
      } catch (e) {
        item.status = 'running';
        item.inspection_unconfirmed = true;
        error = e.message;
      }
    }
    if (typeof data.cost_credits === 'number') item.cost_credits = data.cost_credits;
    if (data.file ?? data.local_path) item.path = data.file ?? data.local_path;
    results.push(item);
  }
  return { results, exit_code, ...(error ? { error } : {}), raw };
}
const success = (r) => r.exit_code === 0 && r.raw && !r.raw.error;
export function createPresetAdapter({ run = cliRunner(), infoProvider } = {}) {
  const readInfo = async (intent) => {
    if (infoProvider) return infoProvider(intent);
    const r = await run(
      withContext(
        [intent.mode === 'template' ? 'template' : 'miniapps', 'info', intent.preset_id, '--json'],
        intent.context,
      ),
      { context: intent.context },
    );
    if (!success(r)) fail('Preset live info unavailable; no submission made');
    return r.raw;
  };
  const checkVersion = async (snapshot) => {
    const r = await run(['--version'], {});
    const version = r.stdout?.trim() ?? r.raw?.version;
    if (r.exit_code !== 0 || version !== snapshot.cli_version)
      fail('Installed CLI differs from approved preset snapshot');
  };
  const boundary = submissionBoundary(
    async (intent) => {
      const resolved = resolvePresetIntent(intent);
      await checkVersion(resolved.snapshot);
      const latest = await readInfo(intent);
      if (presetSnapshotHash(latest) !== presetSnapshotHash(resolved.snapshot.info))
        fail('Preset info changed after approval; rebuild the plan');
      let args;
      if (intent.mode === 'miniapps')
        args = [
          'miniapps',
          'create',
          '--id',
          intent.preset_id,
          '--params',
          JSON.stringify(resolved.parameters),
          '--no-wait',
          '--json',
        ];
      else {
        args = ['create', 'template', '--template-id', intent.preset_id];
        for (const [name, value] of Object.entries(resolved.parameters)) {
          if (!present(value)) continue;
          args.push(
            `--${name.replaceAll('_', '-')}`,
            ...(Array.isArray(value) ? value : [String(value)]),
          );
        }
        if (!orderedTemplate(resolved.snapshot.info)) args.push('--idempotency-key', intent.id);
        args.push('--no-wait', '--json');
      }
      return {
        args: withContext(args, intent.context),
        ordered: orderedTemplate(resolved.snapshot.info),
      };
    },
    async (intent, { args, ordered }) => {
      const r = await run(args, { context: intent.context });
      return {
        ...(intent.mode === 'miniapps'
          ? resultMiniApp(r.raw, intent.output_kind, undefined, r.exit_code)
          : ordered
            ? normalizeOrderedResult(r.raw, r.exit_code)
            : normalizeCreateResult(r.raw, intent.output_kind, r.exit_code)),
        stderr: r.stderr,
      };
    },
  );
  return {
    ...boundary,
    validate: resolvePresetIntent,
    async status(intent, provider_id, result = {}) {
      resolvePresetIntent(intent);
      const id = mediaId(provider_id),
        type = intent.mode === 'miniapps' ? 'miniapps' : (result.kind ?? intent.output_kind);
      if (!['miniapps', 'image', 'video'].includes(type)) fail('Unsupported preset result kind');
      let r = await run(
        withContext(['task', 'status', id, '--type', type, '--json'], intent.context),
        { context: intent.context },
      );
      if (intent.mode === 'miniapps') {
        const data = r.raw?.Resp ?? r.raw;
        if ((data?.status === 'completed' || data?.status_code === 1) && !data.assets) {
          const info = await run(
            withContext(['asset', 'info', id, '--type', 'miniapps', '--json'], intent.context),
            { context: intent.context },
          );
          if (success(info)) r = info;
        }
        return { ...resultMiniApp(r.raw, intent.output_kind, id, r.exit_code), stderr: r.stderr };
      }
      const normalized = normalizeCreateResult(r.raw, type, r.exit_code);
      if (!normalized.results.length && r.exit_code === 0 && r.raw?.status)
        normalized.results.push({
          id,
          kind: type,
          status:
            r.raw.status === 'completed'
              ? 'completed'
              : ['failed', 'error'].includes(r.raw.status)
                ? 'provider_failed'
                : 'running',
        });
      return { ...normalized, stderr: r.stderr };
    },
    async download(intent, provider_id, destination, result = {}) {
      resolvePresetIntent(intent);
      const id = mediaId(provider_id),
        type = intent.mode === 'miniapps' ? 'miniapps' : (result.kind ?? intent.output_kind);
      if (!['miniapps', 'image', 'video'].includes(type)) fail('Unsupported preset result kind');
      if (!destination || typeof destination !== 'string')
        fail('Preset download directory required');
      const r = await run(
        withContext(
          ['asset', 'download', id, '--type', type, '--dest', destination, '--json'],
          intent.context,
        ),
        { context: intent.context },
      );
      if (intent.mode === 'miniapps')
        return r.exit_code === 0 && r.raw?.file
          ? {
              results: [{ id, kind: intent.output_kind, status: 'completed', path: r.raw.file }],
              exit_code: 0,
              raw: r.raw,
            }
          : {
              results: [],
              exit_code: r.exit_code || 1,
              error: r.raw?.error ?? r.stderr,
              raw: r.raw,
            };
      const normalized = normalizeCreateResult(r.raw, type, r.exit_code);
      if (!normalized.results.length && r.exit_code === 0 && r.raw?.file)
        normalized.results.push({
          id,
          kind: type,
          status: 'completed',
          path: r.raw.file,
        });
      return normalized;
    },
  };
}

/** Pure conditional discovery/fit comparison. Descriptions never imply control guarantees. */
export function planPresetCandidates({
  requirements = {},
  templates = [],
  miniapps = [],
  cli_version,
} = {}) {
  const candidates = [];
  for (const [mode, items] of [
    ['template', templates],
    ['miniapps', miniapps],
  ])
    for (const item of items) {
      const snapshot = item.preset_snapshot ?? item,
        info = snapshot.info ?? {},
        analysis = attested(snapshot) ? snapshot.analysis : null;
      const candidate = {
        mode,
        preset_id:
          info.template_id !== undefined ? stringId(info.template_id) : (info.app_id ?? null),
        name: info.display_name ?? info.name ?? null,
        checks: [],
        missing_inputs: [],
        unknown: [],
        mismatches: [],
        execution_supported:
          mode === 'miniapps' ||
          templateVersionSupported(info, cli_version ?? snapshot.cli_version),
        live_recheck_required: true,
      };
      let declaredOutput = {};
      const ordered = mode === 'template' && orderedTemplate(info);
      if (ordered)
        declaredOutput = {
          kind: null,
          kinds: [],
          fixed_duration_ms: null,
          aspects: null,
          declared_outputs: [],
        };
      if (mode === 'template' && orderedTemplate(info)) {
        try {
          declaredOutput = modernOutput(info);
        } catch {
          candidate.unknown.push('fixed_output_schema');
        }
      }
      const output = {
        ...(mode === 'template'
          ? {
              ...(orderedTemplate(info)
                ? {}
                : {
                    kind: outputKind(info),
                    default_duration_ms:
                      typeof info.duration === 'number' ? info.duration * 1000 : null,
                  }),
            }
          : {}),
        ...(analysis?.output ?? {}),
        ...declaredOutput,
      };
      const compare = (requirement, requested, actual) => {
        if (requested === undefined || requested === false) return;
        const state =
          actual === undefined || actual === null
            ? 'unknown'
            : Array.isArray(requested)
              ? requested.every((x) => actual?.includes?.(x))
                ? 'satisfied'
                : 'mismatch'
              : requested === actual
                ? 'satisfied'
                : 'mismatch';
        candidate.checks.push({ requirement, requested, actual: actual ?? null, state });
        if (state === 'unknown') candidate.unknown.push(requirement);
        if (state === 'mismatch') candidate.mismatches.push(requirement);
      };
      compare(
        'output_kind',
        requirements.output_kind,
        output.kinds?.includes(requirements.output_kind) ? requirements.output_kind : output.kind,
      );
      compare('duration_ms', requirements.duration_ms, output.fixed_duration_ms);
      compare('aspects', requirements.aspects, output.aspects);
      compare('editable_shots', requirements.requires_editable_shots, output.editable_shots);
      compare(
        'local_replacement',
        requirements.requires_local_replacement,
        output.local_replacement,
      );
      compare(
        'intermediate_assets',
        requirements.requires_intermediate_assets,
        output.intermediate_assets,
      );
      compare(
        'continuity_controls',
        requirements.continuity_controls,
        analysis?.continuity_controls,
      );
      compare('requirement_ids', requirements.requirement_ids, analysis?.confirmed_requirements);
      if (requirements.intent && !analysis?.semantic_fit_confirmed)
        candidate.unknown.push('semantic_fit');
      if (snapshot.available !== true) candidate.unknown.push('current_account_availability');
      if (requirements.context && !contextMatches(snapshot.context, requirements.context))
        candidate.unknown.push('region_workspace');
      if (mode === 'miniapps') {
        if (!Array.isArray(info.params_schema)) candidate.unknown.push('live_params_schema');
        else
          for (const field of info.params_schema) {
            if (field.type === 'unknown') candidate.unknown.push(`params.${field.name}`);
            if (field.required && !present(item.parameters?.[field.name]))
              candidate.missing_inputs.push(field.name);
          }
      } else {
        if (orderedTemplate(info)) {
          try {
            const fields = orderedSlots(info);
            for (const kind of ['image', 'video']) {
              const required = fields.filter(
                (f) => f.content_type === kind && f.required !== false,
              ).length;
              if ((item.inputs ?? []).filter((i) => i.kind === kind).length < required)
                candidate.missing_inputs.push(`${required} ${kind} input(s)`);
            }
            candidate.fixed_cost_credits = info.fixed_cost ?? null;
            if (!Number.isFinite(info.fixed_cost) || info.fixed_cost < 0)
              candidate.unknown.push('fixed_cost');
          } catch (e) {
            candidate.unknown.push('ordered_input_schema');
          }
        } else if (!Number.isSafeInteger(info.effect_type))
          candidate.unknown.push('ordered_input_schema');
        else {
          const count = (item.inputs ?? []).filter((i) => i.kind === 'image').length;
          if (
            info.effect_type > count &&
            !(
              (item.inputs ?? []).some((i) => i.kind === 'video') &&
              info.effect_type === 1 &&
              info.supported_features === 1000
            )
          )
            candidate.missing_inputs.push(`${info.effect_type} image input(s)`);
        }
        if (!templateVersionSupported(info, cli_version ?? snapshot.cli_version))
          candidate.unknown.push('versioned_ordered_input_output_contract');
      }
      candidate.status = candidate.mismatches.length
        ? 'incompatible'
        : candidate.unknown.length
          ? 'needs_verification'
          : candidate.missing_inputs.length
            ? 'needs_input'
            : 'candidate';
      candidate.execution_permitted = false; // Selection/fit is never a budget approval.
      candidate.output = output;
      candidates.push(candidate);
    }
  const discovery_required = [];
  if (!templates.length)
    discovery_required.push({
      mode: 'template',
      argv: ['template', 'list', '--json'],
      then: ['template', 'info', '<selected-id>', '--json'],
    });
  if (!miniapps.length)
    discovery_required.push({
      mode: 'miniapps',
      argv: ['miniapps', 'list', '--json'],
      then: ['miniapps', 'info', '<selected-id>', '--json'],
    });
  return {
    schema_version: 'preset-candidates.v1',
    provider_calls: 0,
    candidates,
    discovery_required,
    selection_required: candidates.some((c) => c.status === 'candidate'),
    notes: [
      'Output constraints are compared, never overridden. Missing intermediate assets or identity/voice controls cannot be inferred from a preset name.',
      'Ordered templates use the verified CLI 1.4.9 field/result contract; the generic model Create adapter is never used as a fallback.',
    ],
  };
}
