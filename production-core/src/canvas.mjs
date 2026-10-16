import { createHash } from 'node:crypto';
import { cliRunner, withContext, validateCreateIntent } from './pixverse.mjs';

const fail = (message) => {
  throw new Error(message);
};
const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const id = (value, name = 'Canvas ID') =>
  typeof value === 'string' && value.trim() ? value : fail(`${name} must be a nonempty string`);
const envelope = (raw) => raw?.Resp ?? raw;

export function canvasNodeId(node) {
  return id(node.node_id ?? node.id, 'node_id');
}
export function canvasNodeType(node) {
  return node.data?.extra?.node_type ?? node.info?.node_type ?? node.node_type;
}
export function isAgentNode(node) {
  return (
    node.source === 'agent' ||
    node.data?.extra?.source === 'agent' ||
    node.info?.source === 'agent' ||
    Boolean(node.data?.extra?.agent_patch_id || node.info?.agent_patch_id || node.agent_patch_id)
  );
}
function selectedVersion(node) {
  return node?.history_id ?? node?.info?.history_id ?? node?.data?.history_id;
}
function graphValue(raw) {
  const graph = envelope(raw);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    fail('Full Canvas graph snapshot required');
  id(graph.project_id, 'project_id');
  if (!Number.isSafeInteger(graph.edit_version) || graph.edit_version < 0)
    fail('Canvas edit_version must be a nonnegative safe integer');
  for (const node of graph.nodes) {
    canvasNodeId(node);
    const history = selectedVersion(node);
    if (history !== undefined && history !== null && history !== '') id(history, 'history_id');
  }
  if (new Set(graph.nodes.map(canvasNodeId)).size !== graph.nodes.length)
    fail('Duplicate Canvas node ID');
  return graph;
}

function mergeValue(base, local, remote, path, conflicts) {
  if (equal(local, base)) return clone(remote);
  if (equal(remote, base) || equal(local, remote)) return clone(local);
  if (object(base) && object(local) && object(remote)) {
    const output = {};
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      const value = mergeValue(base[key], local[key], remote[key], `${path}.${key}`, conflicts);
      if (value !== undefined) output[key] = value;
    }
    return output;
  }
  conflicts.push({
    path,
    base: clone(base),
    local: clone(local),
    remote: clone(remote),
    reason: 'both_changed',
  });
  return clone(remote); // Preserve the human's current value until explicitly resolved.
}
function dependencies(node, edges = []) {
  const nodeId = canvasNodeId(node);
  return [
    ...new Set([
      ...(node.depends_on ?? []),
      ...edges
        .filter((e) => (e.target ?? e.target_node_id) === nodeId)
        .map((e) => e.source ?? e.source_node_id),
    ]),
  ].sort();
}
function authorNode(node) {
  const result = { node_id: canvasNodeId(node), node_type: canvasNodeType(node) };
  if (!result.node_type) fail(`Exact node type metadata missing for ${result.node_id}`);
  // Graph snapshots contain server-owned fields; never send those as a patch.
  for (const key of [
    'model',
    'title',
    'position',
    'style',
    'payload',
    'artifact',
    'depends_on',
    'semantic',
  ])
    if (node[key] !== undefined) result[key] = clone(node[key]);
  return result;
}
const authorFields = new Set([
  'node_id',
  'id',
  'node_type',
  'model',
  'title',
  'position',
  'style',
  'payload',
  'artifact',
  'depends_on',
  'semantic',
  'source',
]);

/** Three-way field merge. Local deletion/edge rewrites cannot bypass ownership or Graph semantics. */
export function mergeCanvasGraph({ base, local, remote, managedNodeIds = [] }) {
  base = graphValue(base);
  local = graphValue(local);
  remote = graphValue(remote);
  if (base.project_id !== local.project_id || base.project_id !== remote.project_id)
    fail('Canvas project mismatch');
  const managed = new Set(managedNodeIds.map((value) => id(value, 'managed node ID')));
  const maps = [base, local, remote].map((g) => new Map(g.nodes.map((n) => [canvasNodeId(n), n])));
  const conflicts = [],
    nodes = [],
    changed = [],
    deleted = [],
    adopted_versions = [];
  for (const nodeId of new Set(maps.flatMap((m) => [...m.keys()]))) {
    const [b, l, r] = maps.map((m) => m.get(nodeId));
    const localChanged = !equal(l, b);
    let merged;
    if (localChanged && (!managed.has(nodeId) || (r && !isAgentNode(r)))) {
      conflicts.push({
        node_id: nodeId,
        path: `nodes.${nodeId}`,
        reason: 'unmanaged_node',
        base: clone(b),
        local: clone(l),
        remote: clone(r),
      });
      merged = clone(r);
    } else {
      merged = mergeValue(b, l, r, `nodes.${nodeId}`, conflicts);
      if (l && b)
        for (const key of new Set([...Object.keys(l), ...Object.keys(b)])) {
          if (!authorFields.has(key) && !equal(l[key], b[key])) {
            conflicts.push({
              node_id: nodeId,
              path: `nodes.${nodeId}.${key}`,
              reason: key === 'history_id' ? 'version_apply_required' : 'unmapped_graph_field',
              base: clone(b[key]),
              local: clone(l[key]),
              remote: clone(r?.[key]),
            });
            merged = clone(r);
          }
        }
      if (b && l && r && !equal(dependencies(l, local.edges), dependencies(b, base.edges))) {
        conflicts.push({
          node_id: nodeId,
          path: `nodes.${nodeId}.depends_on`,
          reason: 'dependency_recreation_required',
          base: dependencies(b, base.edges),
          local: dependencies(l, local.edges),
          remote: dependencies(r, remote.edges),
        });
        merged = clone(r);
      }
    }
    if (merged) nodes.push(merged);
    if (!equal(merged, r)) merged ? changed.push(merged) : deleted.push(nodeId);
    const oldHistory = selectedVersion(b),
      history = selectedVersion(r);
    if (history && history !== oldHistory && selectedVersion(merged) === history) {
      adopted_versions.push({
        node_id: nodeId,
        history_id: id(history, 'history_id'),
        previous_history_id: oldHistory ?? null,
        file_path: r.file_path ?? r.info?.file_path ?? r.data?.file_path ?? null,
        source: 'canvas_human_selection',
        requires_qa: true,
      });
    }
  }
  if (!equal(local.edges, base.edges))
    conflicts.push({
      path: 'edges',
      reason: 'dependency_recreation_required',
      base: clone(base.edges),
      local: clone(local.edges),
      remote: clone(remote.edges),
    });
  const stale = new Set();
  let frontier = adopted_versions.map((v) => v.node_id);
  while (frontier.length) {
    const next = [];
    for (const node of remote.nodes)
      if (
        dependencies(node, remote.edges).some((dep) => frontier.includes(dep)) &&
        !stale.has(canvasNodeId(node))
      ) {
        stale.add(canvasNodeId(node));
        next.push(canvasNodeId(node));
      }
    frontier = next;
  }
  const graph = { ...clone(remote), nodes }; // remote layout, edges and unowned metadata survive.
  const patch =
    conflicts.length || (!changed.length && !deleted.length)
      ? null
      : {
          schema_version: 'canvas_agent_graph.v1',
          base_edit_version: remote.edit_version,
          nodes: changed.map(authorNode),
          ...(deleted.length ? { deleted_node_ids: deleted } : {}),
        };
  return {
    graph,
    conflicts,
    adopted_versions,
    stale_node_ids: [...stale],
    patch,
    requires_resolution: conflicts.length > 0,
  };
}

function valueAt(value, path) {
  return path.split('.').reduce((v, k) => v?.[k], value);
}
const present = (value) =>
  value !== undefined &&
  value !== null &&
  value !== '' &&
  (!Array.isArray(value) || value.length > 0);

/** Validate exact caller-authored nodes against a fresh Canvas query. The CLI does final Graph/DAG checks. */
export function validateCanvasPatch(patch, snapshot, { project_id, context } = {}) {
  id(project_id, 'project_id');
  if (
    patch?.schema_version !== 'canvas_agent_graph.v1' ||
    !Number.isSafeInteger(patch.base_edit_version) ||
    patch.base_edit_version < 0
  )
    fail('Invalid Canvas patch schema/version');
  if (patch.project_id !== undefined && patch.project_id !== project_id)
    fail('Patch project mismatch');
  const nodes = patch.nodes ?? [],
    deleted = patch.deleted_node_ids ?? [];
  if (!nodes.length && !deleted.length) fail('Empty Canvas patch');
  const ids = [...nodes.map(canvasNodeId), ...deleted.map((value) => id(value, 'deleted node ID'))];
  if (new Set(ids).size !== ids.length) fail('Duplicate/reused Canvas node ID');
  if (snapshot?.compatible !== true || !Array.isArray(snapshot.nodes))
    fail('Compatible live Canvas capability snapshot required');
  for (const node of nodes) {
    const live = snapshot.nodes.find((item) => item.node_type === node.node_type);
    if (
      !live ||
      live.compatible !== true ||
      live.canvas?.graph_patch_authoring_status !== 'supported'
    )
      fail(`Unsupported Canvas node type: ${node.node_type}`);
    for (const name of live.canvas.required_fields ?? [])
      if (!present(node[name])) fail(`Canvas ${node.node_id} missing ${name}`);
    if (node.payload?.model !== undefined) fail('Canvas model belongs on node.model');
    const adapter = live.canvas.capability_adapter;
    if (adapter?.kind === 'cli') {
      if (adapter.contract_revision !== 'canvas_cli_capability_adapter.v2')
        fail('Unsupported Canvas adapter revision');
      const selector = valueAt(node, adapter.selector_field);
      const route = live.routes?.find((item) => item.selector === selector);
      if (!route || route.compatible !== true || !route.cli)
        fail(`Unsupported Canvas selector: ${selector}`);
      const mapping = route.field_mapping ?? adapter.routes?.[selector]?.field_mapping ?? [];
      const allowedPayload = new Set(
        mapping.filter((m) => m.from.startsWith('payload.')).map((m) => m.from.split('.')[1]),
      );
      if (adapter.selector_field.startsWith('payload.'))
        allowedPayload.add(adapter.selector_field.split('.')[1]);
      for (const key of Object.keys(node.payload ?? {}))
        if (!allowedPayload.has(key)) fail(`Unmapped Canvas payload field: ${key}`);
      const parameters = {};
      for (const m of mapping) {
        const value = valueAt(node, m.from);
        if (!present(value)) continue;
        if (m.transform && m.transform !== 'resolve_node_reference')
          fail(`Unknown Canvas field transform: ${m.transform}`);
        // Graph reference objects stay untouched. Use opaque placeholders only for
        // registry shape validation; the CLI resolves their node IDs and media.
        parameters[m.to] = m.transform
          ? Array.isArray(value)
            ? value.map(() => 'canvas-reference')
            : 'canvas-reference'
          : clone(value);
      }
      for (const condition of route.conditions ?? adapter.routes?.[selector]?.conditions ?? []) {
        for (const field of condition.required ?? [])
          if (!present(valueAt(node, field))) fail(`Canvas route missing ${field}`);
      }
      delete parameters.model;
      validateCreateIntent(
        {
          id: 'canvas-precheck',
          backend: 'create',
          mode: route.capability_ref.replace(/^create\./, ''),
          model: node.model,
          parameters,
          inputs: [],
          context,
        },
        route.cli,
      );
    }
    if (['script', 'shot_plan'].includes(node.node_type) && !present(node.artifact?.text))
      fail('Canvas text belongs in artifact.text');
    if (node.node_type === 'video_compose' && 'depends_on' in node)
      fail('Canvas video_compose must stay edge-free; use payload.tracks');
    if (node.depends_on?.some((dep) => typeof dep !== 'string'))
      fail('Canvas dependency IDs must be strings');
  }
  return clone(patch);
}

function requestCanvas(intent) {
  if (intent.backend !== 'canvas') fail('Canvas adapter cannot execute Create');
  const canvas = intent.canvas;
  if (!canvas) fail('Canvas intent metadata required');
  id(canvas.project_id, 'project_id');
  id(canvas.node_id, 'node_id');
  if (
    !('baseline_history_id' in canvas) ||
    (canvas.baseline_history_id !== null &&
      (typeof canvas.baseline_history_id !== 'string' || !canvas.baseline_history_id))
  )
    fail('Canvas baseline_history_id is required (null only for a new node)');
  return canvas;
}
function patchKey(project_id, patch) {
  return `production-${digest({ project_id, patch })}`;
}
function common(intent, args) {
  return withContext(['canvas', ...args, '--json'], intent.context);
}
function successful(response) {
  return (
    response.exit_code === 0 &&
    response.raw &&
    (response.raw.ErrCode === undefined || response.raw.ErrCode === 0)
  );
}

export async function prepareCanvasPatch(intent, { run = cliRunner(), snapshot } = {}) {
  const canvas = requestCanvas(intent);
  const patch = validateCanvasPatch(
    canvas.patch,
    snapshot ?? canvas.capability_snapshot ?? intent.capability_snapshot,
    { project_id: canvas.project_id, context: intent.context },
  );
  if (!(patch.nodes ?? []).some((n) => n.node_id === canvas.node_id))
    fail('Target node must be in the approved patch');
  const key = patchKey(canvas.project_id, patch);
  const response = await run(
    common(intent, [
      'patch',
      'dry-run',
      canvas.project_id,
      '--patch',
      JSON.stringify(patch),
      '--idempotency-key',
      key,
    ]),
    { context: intent.context },
  );
  if (!successful(response) || response.raw.ErrCode !== 0 || envelope(response.raw)?.valid !== true)
    return { valid: false, patch, key, response };
  return {
    valid: true,
    project_id: canvas.project_id,
    node_id: canvas.node_id,
    patch,
    key,
    patch_hash: digest(patch),
    response,
  };
}

export async function applyCanvasPatch(intent, prepared, { run = cliRunner() } = {}) {
  const canvas = requestCanvas(intent);
  if (
    !prepared?.valid ||
    prepared.project_id !== canvas.project_id ||
    prepared.node_id !== canvas.node_id ||
    prepared.patch_hash !== digest(prepared.patch) ||
    !equal(prepared.patch, canvas.patch)
  )
    fail('Successful dry-run of the exact approved patch required');
  const response = await run(
    common(intent, [
      'patch',
      'apply',
      canvas.project_id,
      '--patch',
      JSON.stringify(prepared.patch),
      '--idempotency-key',
      prepared.key,
    ]),
    { context: intent.context },
  );
  const data = envelope(response.raw);
  const applied = successful(response) && data?.valid === true && data?.applied === true;
  return {
    ...prepared,
    applied,
    edit_version: data?.edit_version ?? data?.diff?.edit_version,
    executable_node_ids: data?.diff?.executable_node_ids ?? [],
    response,
  };
}

export async function dispatchCanvasPatch(intent, applied, { run = cliRunner() } = {}) {
  const canvas = requestCanvas(intent);
  if (
    !applied?.applied ||
    applied.project_id !== canvas.project_id ||
    applied.node_id !== canvas.node_id ||
    !equal(applied.patch, canvas.patch)
  )
    fail('Successful apply of the exact approved patch required');
  if (!applied.executable_node_ids.includes(canvas.node_id))
    fail('Target is not in apply.diff.executable_node_ids');
  if (!Number.isSafeInteger(applied.edit_version) || applied.edit_version < 0)
    fail('Current apply edit_version required');
  const node = applied.patch.nodes.find((n) => n.node_id === canvas.node_id);
  const expectedPlan =
    node?.semantic?.dispatch_state === 'awaiting_confirmation'
      ? node.semantic.dispatch_plan_id
      : undefined;
  if (expectedPlan && canvas.dispatch_plan_id !== expectedPlan)
    fail('Matching Canvas confirmation plan required');
  const args = [
    'dispatch',
    canvas.project_id,
    '--node-ids',
    canvas.node_id,
    '--edit-version',
    String(applied.edit_version),
  ];
  if (canvas.dispatch_plan_id)
    args.push('--dispatch-plan-id', id(canvas.dispatch_plan_id, 'dispatch_plan_id'));
  const response = await run(common(intent, args), { context: intent.context });
  return {
    ...response,
    project_id: canvas.project_id,
    node_id: canvas.node_id,
    edit_version: applied.edit_version,
  };
}

export function normalizeCanvasResult(raw, node_id, kind = 'video', exit_code = 0) {
  id(node_id, 'node_id');
  const data = envelope(raw) ?? {};
  const nodes = data.nodes ?? [];
  const node = Array.isArray(nodes)
    ? nodes.find((n) => (n.node_id ?? n.id) === node_id)
    : nodes[node_id];
  const state = node?.derived_state;
  const status =
    ['FAILED', 'INVALID'].includes(state) || (!node && data.dispatch_status === 'failed')
      ? 'provider_failed'
      : state === 'SUCCEEDED'
        ? 'completed'
        : 'running';
  const result = { id: node_id, status, kind };
  const filePath = node?.file_path ?? node?.info?.file_path ?? node?.data?.file_path;
  if (filePath) result.url = filePath;
  if (['READY', 'METADATA', 'BLOCKED'].includes(state)) result.dispatch_unconfirmed = true;
  if (selectedVersion(node)) result.history_id = id(selectedVersion(node), 'history_id');
  if (typeof node?.cost_credits === 'number') result.cost_credits = node.cost_credits;
  const error =
    data.error ??
    node?.error_message ??
    (['partial', 'failed'].includes(data.dispatch_status)
      ? `Canvas dispatch ${data.dispatch_status}`
      : undefined);
  return {
    results: node || data.dispatch_status ? [result] : [],
    exit_code,
    ...(error ? { error } : {}),
    raw,
  };
}

export function createCanvasAdapter({ run = cliRunner(), capabilities, downloadMedia } = {}) {
  return {
    validate(intent) {
      const canvas = requestCanvas(intent);
      return validateCanvasPatch(
        canvas.patch,
        canvas.capability_snapshot ??
          intent.capability_snapshot ??
          (typeof capabilities !== 'function' ? capabilities : undefined),
        { project_id: canvas.project_id, context: intent.context },
      );
    },
    async graph(intent) {
      const canvas = requestCanvas(intent);
      const response = await run(common(intent, ['graph', 'get', canvas.project_id]), {
        context: intent.context,
      });
      if (!successful(response)) fail('Canvas graph read failed');
      return clone(graphValue(response.raw));
    },
    async submit(intent) {
      const canvas = requestCanvas(intent);
      // Query Canvas itself; a Create registry reference never selects another backend.
      let snapshot = typeof capabilities === 'function' ? await capabilities(intent) : capabilities;
      if (!snapshot) {
        const response = await run(
          withContext(['capabilities', 'canvas', '--json'], intent.context),
          { context: intent.context },
        );
        if (!successful(response)) fail('Live Canvas capabilities unavailable');
        snapshot = response.raw;
      }
      const prepared = await prepareCanvasPatch(intent, { run, snapshot });
      if (!prepared.valid)
        return {
          results: [],
          exit_code: prepared.response.exit_code || 6,
          error: 'Canvas dry-run rejected',
          raw: prepared.response.raw,
        };
      const applied = await applyCanvasPatch(intent, prepared, { run });
      if (!applied.applied)
        return {
          results: [
            {
              id: canvas.node_id,
              kind: intent.kind ?? 'video',
              status: 'running',
              dispatch_unconfirmed: true,
            },
          ],
          exit_code: applied.response.exit_code || 1,
          error: 'Canvas patch not confirmed applied; inspect graph before recovery',
          raw: applied.response.raw,
        };
      const response = await dispatchCanvasPatch(intent, applied, { run });
      const result = normalizeCanvasResult(
        response.raw,
        canvas.node_id,
        intent.kind ?? 'video',
        response.exit_code,
      );
      if (!result.results.length)
        result.results.push({
          id: canvas.node_id,
          kind: intent.kind ?? 'video',
          status: 'running',
          dispatch_unconfirmed: true,
        });
      return result;
    },
    async status(intent, provider_id) {
      const canvas = requestCanvas(intent);
      if (id(provider_id, 'node_id') !== canvas.node_id)
        fail('Canvas status ID differs from intent target');
      const response = await run(
        common(intent, ['graph', 'status', canvas.project_id, '--node-ids', provider_id]),
        { context: intent.context },
      );
      const result = normalizeCanvasResult(
        response.raw,
        provider_id,
        intent.kind ?? 'video',
        response.exit_code,
      );
      for (const item of result.results)
        if (
          item.status === 'completed' &&
          (!item.history_id || item.history_id === canvas.baseline_history_id)
        ) {
          item.status = 'running';
          item.dispatch_unconfirmed = true;
          result.error =
            'Canvas has no newly completed history for this intent; inspect dispatch before recovery';
        }
      return result;
    },
    async versions(intent, { page = 1, page_size = 20 } = {}) {
      const canvas = requestCanvas(intent);
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(page_size) ||
        page_size < 1 ||
        page_size > 100
      )
        fail('Invalid Canvas version pagination');
      const response = await run(
        common(intent, [
          'node',
          'versions',
          canvas.project_id,
          '--node-id',
          canvas.node_id,
          '--page',
          String(page),
          '--page-size',
          String(page_size),
        ]),
        { context: intent.context },
      );
      if (!successful(response)) fail('Canvas version read failed');
      return clone(response.raw);
    },
    async selectVersion(intent, history_id) {
      const canvas = requestCanvas(intent);
      id(history_id, 'history_id');
      const response = await run(
        common(intent, [
          'node',
          'version',
          'apply',
          canvas.project_id,
          '--node-id',
          canvas.node_id,
          '--history-id',
          history_id,
        ]),
        { context: intent.context },
      );
      const data = envelope(response.raw);
      if (!successful(response) || typeof data?.applied !== 'boolean')
        return { selected: false, response };
      // applied=false is the official already-current successful no-op. Always
      // refresh the graph; version apply does not return the next edit_version.
      const graphResponse = await run(common(intent, ['graph', 'get', canvas.project_id]), {
        context: intent.context,
      });
      if (!successful(graphResponse)) return { selected: true, refresh_required: true, response };
      return {
        selected: true,
        applied: data.applied,
        graph: clone(graphValue(graphResponse.raw)),
        response,
      };
    },
    async download(intent, provider_id, destination) {
      const canvas = requestCanvas(intent);
      if (provider_id !== canvas.node_id) fail('Canvas download ID differs from intent target');
      const response = await run(
        common(intent, ['node', 'get', canvas.project_id, '--node-id', provider_id]),
        { context: intent.context },
      );
      const data = envelope(response.raw),
        node = data?.node ?? data;
      const history = selectedVersion(node);
      if (
        !successful(response) ||
        node?.derived_state !== 'SUCCEEDED' ||
        !history ||
        history === canvas.baseline_history_id
      )
        return {
          results: [],
          exit_code: response.exit_code || 1,
          error: 'Canvas result is not confirmed newly complete',
          raw: response.raw,
        };
      const filePath = node?.file_path ?? node?.info?.file_path ?? node?.data?.file_path;
      if (!downloadMedia)
        return {
          results: [],
          exit_code: 6,
          error: 'Canvas media downloader is not configured; existing node retained',
          raw: response.raw,
        };
      if (!filePath)
        return {
          results: [],
          exit_code: 6,
          error: 'Canvas current node has no trusted file_path',
          raw: response.raw,
        };
      // Injected finishing transport downloads this known media only. It must use
      // no-overwrite publication and must never create a replacement generation.
      const local = await downloadMedia({
        file_path: filePath,
        destination,
        context: intent.context,
        node: clone(node),
      });
      if (!local?.path) fail('Canvas downloader returned no saved path');
      return {
        results: [
          { id: provider_id, kind: intent.kind ?? 'video', status: 'completed', path: local.path },
        ],
        exit_code: 0,
        raw: response.raw,
      };
    },
  };
}
