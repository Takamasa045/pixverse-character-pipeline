import { requireValue, hash, fileHash } from './contracts.mjs';
export function registerEntity(store, entity) {
  entity = structuredClone(entity);
  requireValue(
    typeof entity.id === 'string' && entity.id && Number.isSafeInteger(entity.revision),
    'entity ID/revision required',
  );
  requireValue(
    ['character', 'wardrobe', 'voice', 'location', 'prop'].includes(entity.kind),
    'entity kind required',
  );
  requireValue(
    entity.status === 'accepted',
    'only an explicitly accepted entity revision may be registered',
  );
  requireValue(typeof entity.reviewer === 'string' && entity.reviewer, 'entity reviewer required');
  requireValue(
    typeof entity.context?.region === 'string' && typeof entity.context?.workspace_id === 'string',
    'entity context required',
  );
  for (const ref of entity.references ?? []) {
    requireValue(
      ref.status === 'accepted' && ref.provenance,
      'reference acceptance/provenance required',
    );
    requireValue(
      ref.region === entity.context.region && ref.workspace_id === entity.context.workspace_id,
      'reference context mismatch',
    );
    requireValue(
      ref.path || typeof ref.provider_id === 'string',
      'reference path or provider ID required',
    );
    if (ref.path) {
      const actual = fileHash(ref.path);
      requireValue(!ref.sha256 || ref.sha256 === actual, 'entity reference hash mismatch');
      ref.sha256 = actual;
    }
  }
  for (const link of entity.links ?? []) {
    requireValue(
      store.document('entity', link.id, link.revision),
      'linked entity revision missing',
    );
  }
  return store.saveDocument('entity', structuredClone(entity));
}
export function resolveEntity(store, name, revision) {
  const exact = store.document('entity', name, revision);
  if (exact) return exact;
  const matches = store
    .documents('entity')
    .filter((e) => e.name?.toLocaleLowerCase() === name.toLocaleLowerCase());
  const ids = [...new Set(matches.map((e) => e.id))];
  requireValue(ids.length <= 1, 'ambiguous entity name; choose an exact ID');
  requireValue(ids.length === 1, 'entity not found');
  return store.document('entity', ids[0], revision);
}
export function characterBundle(store, selection, { context, performance = [] } = {}) {
  const entities = selection.map((e) => resolveEntity(store, e.id, e.revision));
  const visit = [...entities],
    seen = new Set(entities.map((e) => `${e.id}:${e.revision}`));
  for (const e of visit)
    for (const link of e.links ?? []) {
      const key = `${link.id}:${link.revision}`;
      if (!seen.has(key)) {
        const item = resolveEntity(store, link.id, link.revision);
        visit.push(item);
        seen.add(key);
      }
    }
  if (context)
    for (const e of visit)
      requireValue(
        e.context.region === context.region && e.context.workspace_id === context.workspace_id,
        'character bundle context mismatch',
      );
  const references = visit.flatMap((e) =>
    (e.references ?? []).map((r) => ({ ...r, entity_id: e.id, entity_revision: e.revision })),
  );
  return {
    schema_version: 'character-bundle.v1',
    id: hash(visit),
    entities: visit,
    references,
    performance,
    unresolved: visit.flatMap((e) => e.unresolved ?? []),
  };
}
export function audioRoute(requirement, capabilities = {}) {
  if (requirement.intent === 'silent')
    return { route: 'silent', supported: true, synchronized: false };
  if (requirement.strict_dialogue && requirement.visible_mouth && requirement.same_voice) {
    if (capabilities.verified_sync?.evidence)
      return {
        route: 'verified_sync',
        supported: true,
        synchronized: false,
        evidence: capabilities.verified_sync.evidence,
        review_required: true,
      };
    return {
      route: null,
      supported: false,
      synchronized: false,
      reason: 'Independent TTS and audio references do not establish exact lip sync',
      alternatives: ['off-screen narration', 'provided verified synchronized clip'],
    };
  }
  if (requirement.intent === 'narration')
    return {
      route: requirement.provided_audio ? 'provided_audio' : 'independent_voice',
      supported: true,
      synchronized: false,
    };
  return {
    route: 'native_audio',
    supported: Boolean(capabilities.native_audio),
    synchronized: false,
    review_required: true,
  };
}
export function performanceReview(bundle, observations) {
  const required = bundle.entities.filter((e) => e.kind === 'character').map((e) => e.id),
    issues = [];
  for (const id of required) {
    const o = observations.find((o) => o.entity_id === id);
    if (!o) issues.push({ entity_id: id, reason: 'missing individual review' });
    else
      for (const key of ['face', 'wardrobe', 'voice', 'position'])
        if (!['pass', 'not_applicable'].includes(o[key]))
          issues.push({ entity_id: id, category: key, reason: o[key] ?? 'not reviewed' });
  }
  return { accepted: issues.length === 0, issues };
}
