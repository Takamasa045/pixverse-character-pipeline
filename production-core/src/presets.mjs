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
function templateParameters(intent, snapshot) {
  const info = snapshot.info,
    parameters = copy(intent.parameters ?? {});
  // 1.4.9 adds ordered slots and fixed settings with a different backend contract.
  // No raw slot field names are published in the current skill: do not guess them.
  if (snapshot.cli_version !== '1.4.8')
    fail(
      'Ordered/fixed-output template execution needs an exact versioned input/output schema fixture; only verified legacy CLI 1.4.8 template execution is supported',
    );
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
    kind = outputKind(snapshot.info);
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
  return {
    validate: resolvePresetIntent,
    async submit(intent) {
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
        args.push('--idempotency-key', intent.id, '--no-wait', '--json');
      }
      const r = await run(withContext(args, intent.context), { context: intent.context });
      return {
        ...(intent.mode === 'miniapps'
          ? resultMiniApp(r.raw, intent.output_kind, undefined, r.exit_code)
          : normalizeCreateResult(r.raw, intent.output_kind, r.exit_code)),
        stderr: r.stderr,
      };
    },
    async status(intent, provider_id) {
      resolvePresetIntent(intent);
      const id = mediaId(provider_id),
        type = intent.mode === 'miniapps' ? 'miniapps' : intent.output_kind;
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
      const result = normalizeCreateResult(r.raw, intent.output_kind, r.exit_code);
      if (!result.results.length && r.exit_code === 0 && r.raw?.status)
        result.results.push({
          id,
          kind: intent.output_kind,
          status:
            r.raw.status === 'completed'
              ? 'completed'
              : ['failed', 'error'].includes(r.raw.status)
                ? 'provider_failed'
                : 'running',
        });
      return { ...result, stderr: r.stderr };
    },
    async download(intent, provider_id, destination) {
      resolvePresetIntent(intent);
      const id = mediaId(provider_id),
        type = intent.mode === 'miniapps' ? 'miniapps' : intent.output_kind;
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
      const result = normalizeCreateResult(r.raw, intent.output_kind, r.exit_code);
      if (!result.results.length && r.exit_code === 0 && r.raw?.file)
        result.results.push({
          id,
          kind: intent.output_kind,
          status: 'completed',
          path: r.raw.file,
        });
      return result;
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
        execution_supported: mode === 'miniapps' || snapshot.cli_version === '1.4.8',
        live_recheck_required: true,
      };
      const output = {
        ...(mode === 'template'
          ? {
              kind: outputKind(info),
              default_duration_ms: typeof info.duration === 'number' ? info.duration * 1000 : null,
            }
          : {}),
        ...(analysis?.output ?? {}),
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
      compare('output_kind', requirements.output_kind, output.kind);
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
        if (!Number.isSafeInteger(info.effect_type)) candidate.unknown.push('ordered_input_schema');
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
        if ((cli_version ?? snapshot.cli_version) !== '1.4.8')
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
      'Modern ordered templates require captured field/result schemas; the generic model Create adapter is never used as a fallback.',
    ],
  };
}
