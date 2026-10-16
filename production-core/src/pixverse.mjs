import { execFile } from 'node:child_process';
import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

const clone = (value) => structuredClone(value);
const provided = (v) =>
  v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length > 0);
const fail = (message) => {
  throw new Error(message);
};

/** Installed CLI registry only. No model names or paid service routes are inferred. */
export function normalizeCreateCapability(snapshot, { mode, model } = {}) {
  const registry = snapshot?.capability ?? snapshot;
  const capability = registry?.capabilities?.[mode] ?? registry?.modes?.[mode] ?? registry;
  if (!capability?.parameters || !capability.capability_id?.startsWith('create.'))
    fail('A Create capability query is required');
  const actualMode = capability.capability_id.slice(7);
  if (mode && mode !== actualMode) fail(`Capability mode mismatch: ${actualMode} / ${mode}`);
  const selected =
    model ?? capability.selected_model ?? snapshot?.query?.model ?? capability.default_model;
  if (!selected || !capability.models?.[selected])
    fail(`Model is absent from installed capabilities: ${selected}`);
  const parameters = clone(capability.parameters);
  for (const [name, override] of Object.entries(capability.models[selected].parameters ?? {})) {
    parameters[name] = { ...parameters[name], ...clone(override) };
  }
  return { ...clone(capability), mode: actualMode, selected_model: selected, parameters };
}

function conditionMatches(when, values, capability) {
  return Object.entries(when ?? {}).every(([name, test]) => {
    if (name === 'always') return test === true;
    const value = values[name];
    if (typeof test !== 'object' || test === null) return value === test;
    return Object.entries(test).every(([op, expected]) => {
      if (op === 'present') return provided(value) === expected;
      if (op === 'not_in') return !expected.includes(value);
      if (op === 'in') return expected.includes(value);
      if (op === 'min_count') return (value?.length ?? 0) >= expected;
      if (op === 'max_count') return (value?.length ?? 0) <= expected;
      if (op === 'supports' && name === 'model')
        return capability?.parameters?.[expected]?.supported === true;
      fail(`Unsupported capability condition ${op}; refresh adapter before executing`);
    });
  });
}

function mediaValue(input, context) {
  if (input.provider_id && (input.region === undefined || input.workspace_id === undefined))
    fail('Provider reference context is unknown; confirm region and workspace before execution');
  if (input.region !== undefined && input.region !== context.region)
    fail('Reference region differs from execution context');
  if (
    input.workspace_id !== undefined &&
    String(input.workspace_id) !== String(context.workspace_id)
  )
    fail('Reference workspace differs from execution context');
  const value = input.provider_id ?? input.path ?? input.value;
  if (!provided(value)) fail('Reference has no provider_id, path, or value');
  if (typeof value !== 'string') fail('Reference identifiers and paths must be strings');
  if (value.startsWith('http:')) fail('HTTP media inputs are not supported');
  return value;
}

export function resolveCreateInputs(intent) {
  const values = clone(intent.parameters ?? {});
  const bindings = {};
  const context = intent.context ?? {};
  const defaultField = (kind, mode) => {
    if (mode === 'reference') return { image: 'images', video: 'videos', audio: 'audios' }[kind];
    if (mode === 'image' || mode === 'transition') return kind === 'image' ? 'images' : undefined;
    if (mode === 'modify')
      return kind === 'image' ? 'images' : kind === 'video' ? 'video' : undefined;
    if (mode === 'motion-control')
      return kind === 'image' ? 'image' : kind === 'video' ? 'video' : undefined;
    if (mode === 'video') return kind === 'image' ? 'image' : undefined;
    if (mode === 'extend' || mode === 'upscale') return kind === 'video' ? 'video' : undefined;
    return undefined;
  };
  for (const input of [...(intent.inputs ?? [])].sort(
    (a, b) => (a.binding?.order ?? a.order ?? 0) - (b.binding?.order ?? b.order ?? 0),
  )) {
    const field = input.parameter ?? defaultField(input.kind, intent.mode);
    if (!field)
      fail(`No documented ${intent.mode} input binding for ${input.kind}; specify parameter`);
    const value = mediaValue(input, context);
    if (['images', 'videos', 'audios'].includes(field)) {
      (bindings[field] ??= []).push(value);
    } else {
      if (provided(bindings[field])) fail(`Multiple values for single input ${field}`);
      bindings[field] = value;
    }
  }
  for (const [field, value] of Object.entries(bindings)) {
    if (provided(values[field]) && JSON.stringify(values[field]) !== JSON.stringify(value))
      fail(`Conflicting resolved media binding ${field}`);
    values[field] = value;
  }
  return values;
}

/** Fail on an illegal value even when CLI would silently adjust it. Approval covers exact values. */
export function validateCreateIntent(intent, snapshot) {
  if (intent.backend !== 'create') fail('Create adapter cannot execute another backend');
  if (!intent.id || !intent.context?.region || intent.context.workspace_id === undefined)
    fail('Intent ID, region and workspace are required');
  const capability = normalizeCreateCapability(snapshot, intent);
  const parameters = { ...resolveCreateInputs(intent), model: capability.selected_model };
  const reserved = ['idempotency_key', 'client_request_id', 'wait', 'json', 'output'];
  for (const key of reserved)
    if (key in (intent.parameters ?? {})) fail(`${key} is executor-owned`);
  for (const [name, descriptor] of Object.entries(capability.parameters)) {
    if (
      !(name in parameters) &&
      descriptor.supported !== false &&
      descriptor.default !== undefined &&
      descriptor.default !== null &&
      !reserved.includes(name)
    ) {
      parameters[name] = clone(descriptor.default);
    }
  }
  const rules = [...(capability.rules ?? [])];
  for (const variant of Object.values(capability.variants ?? {})) {
    if (conditionMatches(variant.when, parameters, capability))
      rules.push(...(variant.rules ?? []));
  }
  const descriptors = clone(capability.parameters);
  for (const rule of rules)
    if (conditionMatches(rule.when, parameters, capability)) {
      for (const [name, override] of Object.entries(rule.parameters ?? {}))
        descriptors[name] = { ...descriptors[name], ...override };
      if (
        rule.id === 'reference-media-required' &&
        !['images', 'videos', 'audios'].some((k) => provided(parameters[k]))
      )
        fail(rule.description);
      if (
        rule.id === 'audio-requires-visual-reference' &&
        !provided(parameters.images) &&
        !provided(parameters.videos)
      )
        fail(rule.description);
      if (
        rule.id === 'voice-required' &&
        !provided(parameters.voice_id) &&
        !provided(parameters.provider_voice_id)
      )
        fail(rule.description);
      if (
        rule.id === 'music-lyrics-choice' &&
        !provided(parameters.lyrics) &&
        parameters.instrumental !== true &&
        parameters.auto_lyrics !== true
      )
        fail(rule.description);
      if (
        !rule.parameters &&
        ![
          'reference-media-required',
          'audio-requires-visual-reference',
          'voice-required',
          'music-lyrics-choice',
        ].includes(rule.id)
      )
        fail(`Unsupported capability rule ${rule.id}; inspect current CLI contract`);
    }
  for (const [name, desc] of Object.entries(descriptors)) {
    if (desc.required && !provided(parameters[name])) fail(`Required parameter: ${name}`);
  }
  for (const [name, value] of Object.entries(parameters)) {
    const desc = descriptors[name];
    if (!desc?.flag) fail(`Unknown CLI parameter: ${name}`);
    // Explicit false can request disabling a default-on feature, but the registry
    // must actually expose that feature for this model; never silently omit it.
    if (desc.supported === false && provided(value)) fail(`Unsupported model parameter: ${name}`);
    if (!provided(value)) continue;
    if (desc.type === 'boolean' && typeof value !== 'boolean') fail(`${name} must be boolean`);
    if (
      desc.type === 'integer' &&
      !Number.isSafeInteger(value) &&
      !(name === 'duration' && value === 'auto' && desc.enum?.includes(0))
    )
      fail(`${name} must be an integer`);
    if (desc.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
      fail(`${name} must be a finite number`);
    if (['string', 'text', 'media'].includes(desc.type) && typeof value !== 'string')
      fail(`${name} must be a string`);
    if (
      desc.type === 'media_list' &&
      (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v))
    )
      fail(`${name} must be a nonempty media list`);
    const enumValue = name === 'duration' && value === 'auto' ? 0 : value;
    if (desc.enum && !desc.enum.includes(enumValue)) fail(`Illegal ${name}: ${value}`);
    if (
      typeof value === 'number' &&
      ((desc.min !== undefined && value < desc.min) || (desc.max !== undefined && value > desc.max))
    )
      fail(`${name} out of range`);
    if (desc.max_count !== undefined && value.length > desc.max_count) fail(`Too many ${name}`);
    if (desc.min_count !== undefined && value.length < desc.min_count) fail(`Too few ${name}`);
    if (desc.min_length !== undefined && value.length < desc.min_length) fail(`Too short ${name}`);
    if (
      (desc.type === 'media' ? [value] : desc.type === 'media_list' ? value : []).some((v) =>
        v.startsWith('http:'),
      )
    )
      fail('HTTP media inputs are not supported');
  }
  if (provided(parameters.image) && provided(parameters.images))
    fail('image and images are mutually exclusive');
  return { capability, parameters };
}

function flags(parameters, descriptors) {
  const args = [];
  for (const [name, value] of Object.entries(parameters)) {
    if (!provided(value)) continue;
    const desc = descriptors[name];
    const options = desc.flag.match(/--[a-z][a-z-]*/g) ?? [];
    if (typeof value === 'boolean') {
      const flag = options.find((f) => (value ? !f.startsWith('--no-') : f.startsWith('--no-')));
      if (flag) args.push(flag);
      else if (value) fail(`No positive boolean flag for ${name}`);
      else if (desc.default === true)
        fail(`Cannot represent explicit false for default-on ${name}: no negative flag`);
      // false for positive-only flags is their documented disabled state.
    } else
      args.push(
        options[0] ?? fail(`Invalid capability flag ${name}`),
        ...(Array.isArray(value)
          ? value.map(String)
          : [name === 'duration' && value === 0 ? 'auto' : String(value)]),
      );
  }
  return args;
}

export function buildCreateCommand(intent, snapshot) {
  const { capability, parameters } = validateCreateIntent(intent, snapshot);
  const args = ['create', capability.mode, ...flags(parameters, capability.parameters)];
  if (capability.parameters.idempotency_key) args.push('--idempotency-key', intent.id);
  else if (capability.parameters.client_request_id) args.push('--client-request-id', intent.id);
  if (!capability.parameters.wait || !capability.parameters.json)
    fail('Create adapter requires no-wait and JSON support');
  args.push('--no-wait', '--json');
  return withContext(args, intent.context);
}

export function withContext(args, context) {
  if (
    !['global', 'cn'].includes(context?.region) ||
    context.workspace_id === undefined ||
    context.workspace_id === null ||
    String(context.workspace_id).trim() === ''
  )
    fail('Explicit region/workspace context required');
  return [...args, '--region', context.region, '--workspace-id', String(context.workspace_id)];
}

export function cliBinary(binary = process.env.PIXVERSE_BIN || 'pixverse') {
  const candidates = binary.includes('/')
    ? [resolve(binary)]
    : (process.env.PATH ?? '').split(delimiter).map((dir) => resolve(dir, binary));
  for (const path of candidates)
    try {
      accessSync(path, constants.X_OK);
      return realpathSync(path);
    } catch {}
  return binary;
}
export function cliRunner(binary = cliBinary()) {
  return (args, { context } = {}) =>
    new Promise((resolve) => {
      execFile(
        binary,
        args,
        {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, ...(context?.region ? { PIXVERSE_REGION: context.region } : {}) },
        },
        (error, stdout, stderr) => {
          let raw;
          try {
            raw = stdout.trim() ? JSON.parse(stdout) : undefined;
          } catch {
            /* Preserve diagnostics without turning an unknown submission into retry. */
          }
          resolve({
            raw,
            stdout,
            stderr,
            exit_code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          });
        },
      );
    });
}

export function mediaId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) fail('Unsafe media ID from provider');
    return String(value);
  }
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$/.test(value) ||
    BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    fail('CLI media ID must be a positive safe integer string');
  return value;
}

const statusValue = (item) => {
  if (
    item.error ||
    ['failed', 'error', 'provider_failed'].includes(item.status) ||
    [7, 8].includes(item.status_code)
  )
    return 'provider_failed';
  if (
    ['completed', 'succeeded', 'success', 'downloaded'].includes(item.status) ||
    item.status_code === 1
  )
    return 'completed';
  if (item.status === 'submitted') return 'submitted';
  return 'running';
};

/** Keep all accepted IDs even on nonzero exit; an empty result is an unknown submission. */
export function normalizeCreateResult(raw, kind = 'video', exit_code = 0) {
  const data = raw?.Resp ?? raw ?? {};
  const results = new Map();
  const issues = [];
  const add = (value, item = {}) => {
    if (value === undefined || value === null) return;
    let id;
    try {
      id = mediaId(value);
    } catch (error) {
      issues.push({ value, error: error.message });
      return;
    }
    const result = { id, kind, status: statusValue(item) };
    const url = item[`${kind}_url`] ?? item.url;
    const path = item.file ?? item.local_path ?? item.path;
    if (url) result.url = url;
    if (path) result.path = path;
    if (typeof item.cost_credits === 'number') result.cost_credits = item.cost_credits;
    if (item.error) result.error = item.error;
    results.set(id, { ...results.get(id), ...result });
  };
  for (const id of data[`${kind}_ids`] ?? []) add(id, { status: 'submitted' });
  add(data[`${kind}_id`] ?? data.id, data);
  for (const item of data.items ?? []) add(item[`${kind}_id`] ?? item.id, item);
  for (const id of data.failed_ids ?? []) add(id, { status: 'failed' });
  // task status batch uses an ID-keyed map, including per-task errors.
  if (!results.size && typeof data === 'object' && !Array.isArray(data)) {
    for (const [id, item] of Object.entries(data))
      if (/^[1-9][0-9]*$/.test(id) && item && typeof item === 'object') add(item.id ?? id, item);
  }
  return {
    results: [...results.values()],
    exit_code,
    ...(data.error || issues.length
      ? { error: data.error ?? 'Some provider IDs violate the CLI media-ID contract' }
      : {}),
    ...(issues.length ? { issues } : {}),
    raw,
  };
}

const kindFor = (mode) =>
  ['voice', 'music'].includes(mode) ? 'audio' : mode === 'image' ? 'image' : 'video';

export function createPixVerseAdapter({ run = cliRunner(), capabilities } = {}) {
  const query = async (intent) => {
    if (typeof capabilities === 'function') return capabilities(intent);
    if (capabilities)
      return capabilities[intent.mode]?.[intent.model] ?? capabilities[intent.mode] ?? capabilities;
    const result = await run(
      withContext(
        ['capabilities', 'create', intent.mode, '--model', intent.model, '--json'],
        intent.context,
      ),
      { context: intent.context },
    );
    if (result.exit_code !== 0 || !result.raw)
      fail('Unable to query installed Create capabilities');
    return result.raw;
  };
  return {
    validate(intent) {
      const snapshot =
        intent.capability_snapshot ??
        (typeof capabilities !== 'function' &&
          (capabilities?.[intent.mode]?.[intent.model] ??
            capabilities?.[intent.mode] ??
            capabilities));
      if (!snapshot) fail('Captured capability snapshot required for offline preflight');
      return validateCreateIntent(intent, snapshot);
    },
    async capabilities(intent) {
      return query(intent);
    },
    async submit(intent) {
      const snapshot = await query(intent);
      if (intent.capability_snapshot) {
        const approved = validateCreateIntent(intent, intent.capability_snapshot).parameters;
        const current = validateCreateIntent(intent, snapshot).parameters;
        if (JSON.stringify(approved) !== JSON.stringify(current))
          fail('Create capability resolution changed after approval; rebuild intent');
      }
      const response = await run(buildCreateCommand(intent, snapshot), { context: intent.context });
      return {
        ...normalizeCreateResult(response.raw, kindFor(intent.mode), response.exit_code),
        stderr: response.stderr,
      };
    },
    async status(intent, provider_id) {
      if (intent.backend !== 'create') fail('Create status cannot query Canvas');
      const id = mediaId(provider_id);
      const response = await run(
        withContext(
          ['task', 'status', id, '--type', kindFor(intent.mode), '--json'],
          intent.context,
        ),
        { context: intent.context },
      );
      const result = normalizeCreateResult(response.raw, kindFor(intent.mode), response.exit_code);
      // Some CLI status replies omit id; retain the already-known identity.
      if (!result.results.length && response.raw && !response.raw.error && response.exit_code === 0)
        result.results.push({
          id,
          kind: kindFor(intent.mode),
          status: statusValue(response.raw),
          raw: response.raw,
        });
      return { ...result, stderr: response.stderr };
    },
    async download(intent, provider_id, destination) {
      if (intent.backend !== 'create') fail('Create download cannot query Canvas');
      if (!destination || typeof destination !== 'string') fail('Download destination required');
      const id = mediaId(provider_id);
      const response = await run(
        withContext(
          [
            'asset',
            'download',
            id,
            '--type',
            kindFor(intent.mode),
            '--dest',
            destination,
            '--json',
          ],
          intent.context,
        ),
        { context: intent.context },
      );
      const result = normalizeCreateResult(response.raw, kindFor(intent.mode), response.exit_code);
      if (!result.results.length && response.exit_code === 0 && response.raw?.file)
        result.results.push({
          id,
          kind: kindFor(intent.mode),
          status: 'completed',
          path: response.raw.file,
        });
      return { ...result, stderr: response.stderr };
    },
  };
}
