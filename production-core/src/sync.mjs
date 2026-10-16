import { mergeCanvasGraph } from './canvas.mjs';
import { hash, requireValue } from './contracts.mjs';
import { impactAnalysis } from './planner.mjs';
import { validateTakeEvidence } from './review.mjs';
import { performanceReview } from './character.mjs';
/** Save a three-way sync as a new local revision. Conflicts never mutate the project. */
export function syncCanvas(store, production, { base, local, remote, mappings, context }) {
  requireValue(Array.isArray(mappings), 'Canvas node to shot mapping required');
  const same = (c) =>
    c?.region === production.context.region && c?.workspace_id === production.context.workspace_id;
  requireValue(
    same(context ?? remote?.context),
    'Canvas sync context is unknown or differs from production region/workspace',
  );
  for (const graph of [base, local, remote])
    if (graph?.context) requireValue(same(graph.context), 'Canvas graph region/workspace mismatch');
  const merged = mergeCanvasGraph({
    base,
    local,
    remote,
    managedNodeIds: mappings.map((m) => m.node_id),
  });
  if (merged.requires_resolution) return { applied: false, ...merged };
  const next = structuredClone(production);
  next.revision++;
  const imports = [];
  for (const adoption of merged.adopted_versions) {
    const mapping = mappings.find((m) => m.node_id === adoption.node_id);
    if (!mapping) continue;
    const shot = next.shots.find((s) => s.shot_id === mapping.shot_id);
    requireValue(shot, 'Canvas mapping references unknown shot');
    const id = hash({
      project: production.project_id,
      node: adoption.node_id,
      history: adoption.history_id,
    });
    const take = {
      id,
      project_id: production.project_id,
      shot_id: shot.shot_id,
      intent_id: null,
      provider_id: adoption.history_id,
      kind: mapping.kind ?? 'video',
      status: 'completed',
      stale: false,
      qa: null,
      provenance: {
        backend: 'canvas',
        project_id: remote.project_id,
        node_id: adoption.node_id,
        history_id: adoption.history_id,
        file_path: adoption.file_path,
        context: production.context,
        entity_revisions: shot.entity_revisions ?? [],
        source: adoption.source,
      },
    };
    imports.push(take);
    shot.take_id = id;
    for (const clip of next.timeline.clips) if (clip.shot_id === shot.shot_id) clip.take_id = id;
    for (const d of next.brief.deliveries ?? [])
      for (const clip of d.timeline?.clips ?? [])
        if (clip.shot_id === shot.shot_id) clip.take_id = id;
  }
  next.canvas = {
    project_id: remote.project_id,
    edit_version: remote.edit_version,
    graph: merged.graph,
    mappings,
    stale_node_ids: merged.stale_node_ids,
  };
  // Human selection is recorded immediately, but remains unreviewed until files and QA are available.
  const result = store.transaction(() => {
    const latest = store.document('production', production.project_id);
    requireValue(
      !latest || production.revision >= latest.revision,
      'Canvas sync source is older than the saved production',
    );
    const importedShots = new Set(imports.map((take) => take.shot_id));
    const staleShots = [
      ...new Set([
        ...mappings.filter((m) => merged.stale_node_ids.includes(m.node_id)).map((m) => m.shot_id),
        ...impactAnalysis(production, [...importedShots]).shots.filter(
          (id) => !importedShots.has(id),
        ),
      ]),
    ];
    for (const take of store.takes(production.project_id))
      if (staleShots.includes(take.shot_id)) {
        store.putTake({
          ...take,
          stale: true,
          stale_reason: 'Canvas upstream selected history changed',
        });
        store.event('stale', take.id, { reason: 'Canvas upstream selected history changed' });
      }
    next.review_requirements = [
      ...(next.review_requirements ?? []),
      ...staleShots.map((shot_id) => ({
        shot_id,
        reason: 'Canvas upstream selected history changed',
        regeneration_authorized: false,
      })),
    ];
    for (const take of imports) {
      if (!store.take(take.id)) store.putTake(take);
      store.event('canvas_selection', take.id, take.provenance);
    }
    const previous = store.document('production', next.project_id, next.revision);
    requireValue(!previous, 'production revision already exists');
    store.db
      .prepare('INSERT INTO documents VALUES(?,?,?,?)')
      .run('production', next.project_id, next.revision, JSON.stringify(next));
    store.event('canvas_sync', next.project_id, {
      edit_version: remote.edit_version,
      imported: imports.map((t) => t.id),
      stale_node_ids: merged.stale_node_ids,
    });
    return { applied: true, production: next, imported_takes: imports, ...merged };
  });
  return result;
}
/** Adopting a reviewed take changes only the selected shot and its edit references. */
export function adoptTake(store, production, shotId, takeId) {
  const take = store.take(takeId),
    next = structuredClone(production);
  requireValue(
    take && take.project_id === production.project_id && take.shot_id === shotId,
    'take does not belong to this project/shot',
  );
  requireValue(
    take.status === 'accepted' && !take.stale,
    'only an accepted current take may be adopted',
  );
  const shot = next.shots.find((s) => s.shot_id === shotId);
  requireValue(shot, 'shot not found');
  requireValue(
    typeof take.sha256 === 'string' && take.sha256.length > 0,
    'accepted take content hash required',
  );
  const { entities } = validateTakeEvidence(store, take, production);
  requireValue(
    ['technical', 'creative', 'continuity'].every((key) => take.qa?.[key] === 'pass') &&
      ['pass', 'not_applicable'].includes(take.qa?.audio),
    'accepted take quality gates are incomplete',
  );
  const characters = entities.filter((entity) => entity.kind === 'character');
  if (characters.length > 1)
    requireValue(
      performanceReview({ entities: characters }, take.qa?.entities ?? []).accepted,
      'each visible character requires separate face/wardrobe/voice/position review',
    );
  const changed = shot.take_id !== take.id;
  const downstream = new Set(
    changed ? impactAnalysis(production, [shotId]).shots.filter((id) => id !== shotId) : [],
  );
  shot.take_id = take.id;
  next.review_requirements = (next.review_requirements ?? []).filter((r) => r.shot_id !== shotId);
  next.revision++;
  for (const clip of next.timeline.clips) if (clip.shot_id === shotId) clip.take_id = take.id;
  for (const d of next.brief.deliveries ?? [])
    for (const clip of d.timeline?.clips ?? []) if (clip.shot_id === shotId) clip.take_id = take.id;
  next.review_requirements = [
    ...next.review_requirements.filter((r) => !downstream.has(r.shot_id)),
    ...[...downstream].map((shot_id) => ({
      shot_id,
      reason: 'Upstream adopted take changed',
      regeneration_authorized: false,
    })),
  ];
  return store.transaction(() => {
    const latest = store.document('production', production.project_id);
    requireValue(
      !latest || next.revision === latest.revision + 1,
      'adoption source is older than the saved production',
    );
    for (const affected of store.takes(production.project_id))
      if (downstream.has(affected.shot_id)) {
        store.putTake({ ...affected, stale: true, stale_reason: 'Upstream adopted take changed' });
        store.event('stale', affected.id, { reason: 'Upstream adopted take changed' });
      }
    store.db
      .prepare('INSERT INTO documents VALUES(?,?,?,?)')
      .run('production', next.project_id, next.revision, JSON.stringify(next));
    store.event('revision', next.project_id, { kind: 'production', revision: next.revision });
    store.event('adopted', take.id, { shot_id: shotId, downstream: [...downstream] });
    return next;
  });
}
