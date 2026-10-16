import { requireValue, fileHash, hash } from './contracts.mjs';
import { performanceReview } from './character.mjs';
export function reviewTake(store, id, qa, { accept = false, reevaluate = false } = {}) {
  const take = store.take(id);
  requireValue(take, 'take not found');
  requireValue(
    ['downloaded', 'reviewed', 'accepted'].includes(take.status),
    'download and inspect the take before review',
  );
  requireValue(take.path && fileHash(take.path), 'take file missing');
  requireValue(
    typeof qa.reviewer === 'string' && qa.reviewer && typeof qa.notes === 'string',
    'reviewer and notes required',
  );
  for (const key of ['technical', 'creative', 'continuity', 'audio'])
    requireValue(['pass', 'fail', 'not_applicable'].includes(qa[key]), `review ${key} required`);
  if (accept) {
    requireValue(!take.stale || reevaluate, 'stale take must be reevaluated before adoption');
    requireValue(
      ['technical', 'creative', 'continuity'].every((k) => qa[k] === 'pass') &&
        ['pass', 'not_applicable'].includes(qa.audio),
      'quality gate failed',
    );
    const entities = (take.provenance?.entity_revisions ?? [])
      .map((e) => store.document('entity', e.id, e.revision))
      .filter((e) => e?.kind === 'character');
    if (entities.length > 1)
      requireValue(
        performanceReview({ entities }, qa.entities ?? []).accepted,
        'each visible character requires separate face/wardrobe/voice/position review',
      );
  }
  return store.transaction(() => {
    const next = {
      ...take,
      sha256: fileHash(take.path),
      qa,
      stale: reevaluate ? false : take.stale,
      status: accept ? 'accepted' : 'reviewed',
    };
    store.putTake(next);
    store.event(accept ? 'accepted' : 'reviewed', id, { qa, reevaluate });
    return next;
  });
}
export function attachTakeFile(store, id, path, evidence) {
  const take = store.take(id);
  requireValue(take, 'take not found');
  requireValue(
    typeof evidence === 'string' && evidence.trim(),
    'file provenance evidence required',
  );
  requireValue(
    !take.path,
    'take already has a local file; create a new take instead of replacing bytes',
  );
  return store.transaction(() => {
    const next = { ...take, path, sha256: fileHash(path), status: 'downloaded', qa: null };
    store.putTake(next);
    store.event('file_attached', id, { path, evidence });
    return next;
  });
}
export function registerLocalTake(store, input) {
  requireValue(
    typeof input.project_id === 'string' && typeof input.shot_id === 'string',
    'local take project/shot required',
  );
  requireValue(
    ['image', 'video', 'audio'].includes(input.kind) && input.path,
    'local media kind/path required',
  );
  requireValue(
    input.context?.region && typeof input.context.workspace_id === 'string' && input.provenance,
    'local media context/provenance required',
  );
  const sha256 = fileHash(input.path),
    id = hash({
      project: input.project_id,
      shot: input.shot_id,
      sha256,
      context: input.context,
      provenance: input.provenance,
    });
  const old = store.take(id);
  if (old) return old;
  return store.transaction(() => {
    const take = {
      id,
      project_id: input.project_id,
      shot_id: input.shot_id,
      intent_id: null,
      provider_id: `local-${sha256}`,
      kind: input.kind,
      path: input.path,
      sha256,
      status: 'downloaded',
      stale: false,
      qa: null,
      provenance: {
        backend: 'local',
        context: input.context,
        source: input.provenance,
        entity_revisions: input.entity_revisions ?? [],
      },
    };
    store.putTake(take);
    store.event('local_take', id, take.provenance);
    return take;
  });
}
export function reviewDelivery(bundle, qa) {
  requireValue(
    qa?.reviewer && typeof qa.notes === 'string',
    'delivery reviewer and notes required',
  );
  requireValue(
    qa.creative === 'pass' && qa.specification === 'pass',
    'creative and specification review must pass',
  );
  requireValue(
    ['creative', 'continuity', 'audio', 'captions', 'specification'].every((k) =>
      ['pass', 'not_applicable'].includes(qa[k]),
    ),
    'final creative/audio/captions/specification review required',
  );
  requireValue(bundle.deliveries?.length > 0, 'delivery bundle has no outputs');
  for (const d of bundle.deliveries) {
    requireValue(
      d.technical_qc?.probe === 'pass' && d.technical_qc?.decode === 'pass',
      'output technical checks required',
    );
    requireValue(fileHash(d.path) === d.sha256, 'output changed since technical inspection');
    if (d.captions)
      requireValue(
        fileHash(d.captions.path) === d.captions.sha256,
        'captions changed since inspection',
      );
  }
  return {
    ...structuredClone(bundle),
    review_id: hash({ bundle, qa }),
    final_review: qa,
    deliveries: bundle.deliveries.map((d) => ({ ...d, creative_delivery_review: 'accepted' })),
  };
}
export function markStale(store, project, { shotIds = [], entityIds = [] }, reason) {
  return store.transaction(() => {
    const changed = [];
    for (const take of store.takes(project))
      if (
        shotIds.includes(take.shot_id) ||
        (take.provenance?.inputs ?? []).some((a) => entityIds.includes(a.entity_id))
      ) {
        store.putTake({ ...take, stale: true, stale_reason: reason });
        store.event('stale', take.id, { reason });
        changed.push(take.id);
      }
    return { takes: changed, regeneration_authorized: false };
  });
}
