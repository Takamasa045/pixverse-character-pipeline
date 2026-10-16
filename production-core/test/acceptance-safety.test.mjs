import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { fileHash } from '../src/contracts.mjs';
import { reviewTake } from '../src/review.mjs';
import { adoptTake, syncCanvas } from '../src/sync.mjs';
import { inspectDelivery } from '../src/finish.mjs';

// This source file stands in for already-saved bytes; injected media probing
// keeps these boundary tests read-only, offline and independent of generation.
const source = fileURLToPath(import.meta.url);
const context = { region: 'global', workspace_id: '0' };
const qa = {
  technical: 'pass',
  creative: 'pass',
  continuity: 'pass',
  audio: 'not_applicable',
  reviewer: 'fixture',
  notes: 'Contract fixture; no creative quality claim.',
};
function production() {
  return {
    schema_version: 'production.v1',
    project_id: 'safety',
    revision: 1,
    context,
    brief: {
      deliveries: [
        { id: 'wide', locale: 'ja', aspect: '16:9', width: 160, height: 90, duration_ms: 2000 },
      ],
    },
    shots: ['first', 'dependent', 'unrelated'].map((shot_id) => ({
      shot_id,
      take_id: 'old-' + shot_id,
    })),
    dependencies: [{ id: 'dependent', depends_on: ['first'] }],
    assets: [],
    timeline: {
      fps: 10,
      clips: [
        { shot_id: 'first', take_id: 'new', source_in_ms: 0, duration_ms: 1000 },
        { shot_id: 'dependent', take_id: 'old-dependent', source_in_ms: 0, duration_ms: 1000 },
      ],
      audio: [],
      captions: [],
    },
  };
}
function take(id = 'new', shot_id = 'first') {
  return {
    id,
    project_id: 'safety',
    shot_id,
    kind: 'video',
    path: source,
    sha256: fileHash(source),
    status: 'downloaded',
    stale: false,
    qa: null,
    provenance: { backend: 'local', context, entity_revisions: [] },
  };
}
function entity(store, id) {
  store.saveDocument('entity', { id, revision: 1, kind: 'character', status: 'accepted', context });
}
const probe = async () => ({
  video: true,
  width: 160,
  height: 90,
  duration_ms: 3000,
  fps: 10,
  audio_streams: 1,
});

test('missing pinned entity revisions cannot disappear from individual character review', () => {
  const store = new Store(':memory:');
  try {
    const t = take();
    t.provenance.entity_revisions = [
      { id: 'cat-a', revision: 1 },
      { id: 'cat-b', revision: 1 },
    ];
    store.putTake(t);
    assert.throws(
      () => reviewTake(store, t.id, qa, { accept: true }),
      /pinned entity revision is missing/,
    );
    assert.equal(store.take(t.id).status, 'downloaded');
    entity(store, 'cat-a');
    entity(store, 'cat-b');
    assert.throws(() => reviewTake(store, t.id, qa, { accept: true }), /each visible character/);
    store.putTake({ ...t, status: 'accepted', qa });
    assert.throws(() => adoptTake(store, production(), 'first', t.id), /each visible character/);
    const reviewed = reviewTake(
      store,
      t.id,
      {
        ...qa,
        entities: ['cat-a', 'cat-b'].map((entity_id) => ({
          entity_id,
          face: 'pass',
          wardrobe: 'pass',
          voice: 'not_applicable',
          position: 'pass',
        })),
      },
      { accept: true },
    );
    assert.equal(reviewed.status, 'accepted');
  } finally {
    store.close();
  }
});

test('unknown or mismatched source context blocks QA and adoption', () => {
  for (const bad of [
    undefined,
    { region: 'global', workspace_id: '' },
    { region: 'cn', workspace_id: 'elsewhere' },
  ]) {
    const store = new Store(':memory:');
    try {
      const p = production(),
        t = take();
      t.provenance.context = bad;
      store.saveDocument('production', p);
      store.putTake(t);
      assert.throws(() => reviewTake(store, t.id, qa, { accept: true }), /context/);
      store.putTake({ ...t, status: 'accepted', qa });
      assert.throws(() => adoptTake(store, p, 'first', t.id), /context/);
      assert.equal(store.document('production', p.project_id).revision, 1);
    } finally {
      store.close();
    }
  }
});

test('re-review cannot silently replace an existing take content hash', () => {
  const store = new Store(':memory:');
  try {
    const t = { ...take(), sha256: '0'.repeat(64), status: 'accepted', qa };
    store.putTake(t);
    assert.throws(
      () => reviewTake(store, t.id, qa, { accept: true, reevaluate: true }),
      /take bytes changed/,
    );
    assert.equal(store.take(t.id).sha256, t.sha256);
    assert.equal(store.history(t.id).length, 0);
    assert.throws(() => adoptTake(store, production(), 'first', t.id), /take bytes changed/);
  } finally {
    store.close();
  }
});

test('changed adoption invalidates downstream continuity only and requires explicit reevaluation', () => {
  const store = new Store(':memory:');
  try {
    const p = production();
    store.saveDocument('production', p);
    for (const [id, shot] of [
      ['new', 'first'],
      ['old-dependent', 'dependent'],
      ['old-unrelated', 'unrelated'],
    ])
      store.putTake({ ...take(id, shot), status: 'accepted', qa });
    const next = adoptTake(store, p, 'first', 'new');
    assert.equal(store.take('old-dependent').stale, true);
    assert.equal(store.take('old-unrelated').stale, false);
    assert.equal(store.take('new').stale, false);
    assert.deepEqual(
      next.review_requirements.map((r) => r.shot_id),
      ['dependent'],
    );
    assert(next.review_requirements.every((r) => r.regeneration_authorized === false));
    assert.equal(store.jobs(p.project_id).length, 0);
    assert.throws(() => adoptTake(store, next, 'dependent', 'old-dependent'), /accepted current/);
    reviewTake(store, 'old-dependent', qa, { accept: true, reevaluate: true });
    const resolved = adoptTake(store, next, 'dependent', 'old-dependent');
    assert.deepEqual(resolved.review_requirements, []);
  } finally {
    store.close();
  }
});

test('same adopted take does not invalidate dependency reviews again', () => {
  const store = new Store(':memory:');
  try {
    const p = production();
    p.shots[0].take_id = 'new';
    store.saveDocument('production', p);
    store.putTake({ ...take(), status: 'accepted', qa });
    store.putTake({ ...take('old-dependent', 'dependent'), status: 'accepted', qa });
    const next = adoptTake(store, p, 'first', 'new');
    assert.equal(store.take('old-dependent').stale, false);
    assert.deepEqual(next.review_requirements, []);
  } finally {
    store.close();
  }
});

test('finishing blocks unknown or mismatched visual and audio context and unresolved dependencies', async () => {
  const p = production();
  p.shots[0].take_id = 'new';
  const takes = [
    { ...take(), status: 'accepted', qa },
    { ...take('old-dependent', 'dependent'), status: 'accepted', qa },
  ];
  assert.equal((await inspectDelivery(p, takes, { probe })).ok, true);
  for (const bad of [undefined, { region: 'cn', workspace_id: 'elsewhere' }]) {
    const altered = structuredClone(takes);
    altered[0].provenance.context = bad;
    assert(
      (await inspectDelivery(p, altered, { probe })).issues.some(
        (i) => i.code === 'SOURCE_CONTEXT_INVALID',
      ),
    );
    const withAudio = structuredClone(p);
    withAudio.assets = [
      { id: 'audio', kind: 'audio', path: source, sha256: fileHash(source), qa, ...(bad || {}) },
    ];
    withAudio.timeline.audio = [
      { asset_id: 'audio', start_ms: 0, source_in_ms: 0, duration_ms: 1000 },
    ];
    assert(
      (await inspectDelivery(withAudio, takes, { probe })).issues.some(
        (i) => i.code === 'SOURCE_CONTEXT_INVALID',
      ),
    );
  }
  p.review_requirements = [
    { shot_id: 'dependent', reason: 'upstream changed', regeneration_authorized: false },
  ];
  assert(
    (await inspectDelivery(p, takes, { probe })).issues.some(
      (i) => i.code === 'DEPENDENCY_REVIEW_REQUIRED',
    ),
  );
});

test('Canvas adoption also invalidates explicit production dependencies absent from Canvas edges', () => {
  const store = new Store(':memory:');
  try {
    const p = production();
    store.saveDocument('production', p);
    store.putTake({ ...take('old-dependent', 'dependent'), status: 'accepted', qa });
    store.putTake({ ...take('old-unrelated', 'unrelated'), status: 'accepted', qa });
    const base = {
      project_id: '99',
      edit_version: 1,
      nodes: [
        {
          node_id: 'canvas-first',
          node_type: 'video_generate',
          source: 'agent',
          history_id: '100',
        },
      ],
      edges: [],
    };
    const remote = structuredClone(base);
    remote.edit_version = 2;
    remote.nodes[0].history_id = '101';
    const result = syncCanvas(store, p, {
      base,
      local: base,
      remote,
      context,
      mappings: [{ node_id: 'canvas-first', shot_id: 'first', kind: 'video' }],
    });
    assert.equal(result.applied, true);
    assert.equal(store.take('old-dependent').stale, true);
    assert.equal(store.take('old-unrelated').stale, false);
    assert.deepEqual(
      result.production.review_requirements.map((r) => r.shot_id),
      ['dependent'],
    );
    assert.equal(store.jobs(p.project_id).length, 0);
  } finally {
    store.close();
  }
});

test('unknown production context and omitted pinned shot entities block adoption and finishing', async () => {
  const store = new Store(':memory:');
  try {
    const p = production(),
      t = { ...take(), status: 'accepted', qa };
    store.putTake(t);
    const unknown = structuredClone(p);
    delete unknown.context;
    assert.throws(() => adoptTake(store, unknown, 'first', t.id), /context/);
    assert(
      (await inspectDelivery(unknown, [t], { probe })).issues.some(
        (i) => i.code === 'PRODUCTION_CONTEXT_INVALID',
      ),
    );
    p.shots[0].entity_revisions = [{ id: 'required-character', revision: 1 }];
    entity(store, 'required-character');
    assert.throws(() => adoptTake(store, p, 'first', t.id), /entity revisions differ/);
    assert(
      (await inspectDelivery(p, [t], { probe })).issues.some(
        (i) => i.code === 'TAKE_ENTITY_REVISIONS_MISMATCH',
      ),
    );
    store.saveDocument('production', p);
    assert.throws(() => reviewTake(store, t.id, qa, { accept: true }), /entity revisions differ/);
    const missingHash = { ...t, id: 'missing-hash' };
    delete missingHash.sha256;
    store.putTake(missingHash);
    assert.throws(() => adoptTake(store, p, 'first', missingHash.id), /content hash required/);
  } finally {
    store.close();
  }
});
