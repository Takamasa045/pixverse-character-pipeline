import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { hash, fileHash, requireValue } from './contracts.mjs';
export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(kind TEXT,id TEXT,revision INTEGER,payload TEXT NOT NULL,PRIMARY KEY(kind,id,revision));
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,project_id TEXT,plan_id TEXT,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT,state TEXT NOT NULL,payload TEXT NOT NULL,reserved REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS results(intent_id TEXT,provider_id TEXT,payload TEXT NOT NULL,PRIMARY KEY(intent_id,provider_id));
      CREATE TABLE IF NOT EXISTS takes(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,payload TEXT NOT NULL);`);
    const v = this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get();
    requireValue(!v || v.value === 'production-store.v1', 'unsupported database schema');
    this.db.prepare("INSERT OR IGNORE INTO metadata VALUES('schema','production-store.v1')").run();
  }
  close() {
    this.db.close();
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  event(kind, target, payload) {
    this.db
      .prepare('INSERT INTO events(at,kind,target,payload) VALUES(?,?,?,?)')
      .run(new Date().toISOString(), kind, target, JSON.stringify(payload));
  }
  saveDocument(kind, value) {
    return this.transaction(() => {
      const id = value.id ?? value.project_id,
        revision = value.revision;
      requireValue(
        typeof id === 'string' && Number.isSafeInteger(revision),
        'document ID/revision required',
      );
      const old = this.document(kind, id, revision);
      if (old) {
        requireValue(hash(old) === hash(value), 'immutable revision already exists');
        return old;
      }
      const latest = this.document(kind, id);
      requireValue(!latest || revision === latest.revision + 1, 'revision must advance by one');
      this.db
        .prepare('INSERT INTO documents VALUES(?,?,?,?)')
        .run(kind, id, revision, JSON.stringify(value));
      this.event('revision', id, { kind, revision });
      return value;
    });
  }
  document(kind, id, revision) {
    const r =
      revision === undefined
        ? this.db
            .prepare(
              'SELECT payload FROM documents WHERE kind=? AND id=? ORDER BY revision DESC LIMIT 1',
            )
            .get(kind, id)
        : this.db
            .prepare('SELECT payload FROM documents WHERE kind=? AND id=? AND revision=?')
            .get(kind, id, revision);
    return r ? JSON.parse(r.payload) : null;
  }
  documents(kind) {
    return this.db
      .prepare('SELECT payload FROM documents WHERE kind=? ORDER BY id,revision')
      .all(kind)
      .map((r) => JSON.parse(r.payload));
  }
  approve(plan, actor) {
    requireValue(typeof actor === 'string' && actor.trim(), 'approval actor required');
    requireValue(
      plan.generation_permitted && plan.blocked.length === 0,
      'plan has unresolved generation conditions',
    );
    requireValue(Number.isFinite(plan.policy.max_credits), 'finite project budget required');
    requireValue(
      plan.total_upper_credits <= plan.policy.max_credits,
      'planned upper cost exceeds budget',
    );
    const value = {
      id: hash({ plan: plan.id, actor, at: new Date().toISOString() }),
      project_id: plan.project_id,
      plan_id: plan.id,
      actor,
      created_at: new Date().toISOString(),
      scope: plan.intents.map((i) => i.id),
      max_credits: plan.policy.max_credits,
      policy: plan.policy,
      intents: plan.intents,
    };
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO approvals VALUES(?,?,?,?)')
        .run(value.id, value.project_id, value.plan_id, JSON.stringify(value));
      this.event('approval', value.id, value);
    });
    return value;
  }
  approval(id) {
    const r = this.db.prepare('SELECT payload FROM approvals WHERE id=?').get(id);
    return r ? JSON.parse(r.payload) : null;
  }
  approveRetry(plan, parentId) {
    const parent = this.approval(parentId);
    requireValue(
      parent?.intents && parent.project_id === plan.project_id,
      'original approval not found for this project',
    );
    requireValue(plan.generation_permitted && plan.blocked.length === 0, 'retry plan is blocked');
    requireValue(
      plan.policy.max_credits <= parent.max_credits &&
        plan.policy.max_attempts <= parent.policy.max_attempts,
      'retry exceeds the original authorization',
    );
    const signature = (i) => {
      const copy = structuredClone(i);
      for (const k of [
        'id',
        'attempt',
        'upper_credits',
        'price_evidence',
        'capability_snapshot',
        'owners',
      ])
        delete copy[k];
      if (copy.audio_identity) delete copy.audio_identity.attempt;
      return hash(copy);
    };
    for (const intent of plan.intents) {
      const original = parent.intents.find((i) => signature(i) === signature(intent));
      requireValue(
        original &&
          intent.attempt === original.attempt + 1 &&
          intent.upper_credits <= original.upper_credits,
        'retry changes the approved request or per-job ceiling',
      );
      const previous = this.job(original.id),
        results = this.results(original.id);
      const rejected = this.takes(plan.project_id).some(
        (t) => t.intent_id === original.id && t.qa && Object.values(t.qa).includes('fail'),
      );
      requireValue(
        previous &&
          !previous.unresolved_submission &&
          results.length &&
          results.every((r) => ['completed', 'provider_failed'].includes(r.status)) &&
          (previous.state === 'provider_failed' || rejected),
        'retry requires a confirmed failed or reviewed rejected result',
      );
    }
    const value = {
      ...parent,
      id: hash({ parent: parent.id, plan: plan.id, at: new Date().toISOString() }),
      plan_id: plan.id,
      scope: plan.intents.map((i) => i.id),
      intents: plan.intents,
      parent_approval_id: parent.id,
      created_at: new Date().toISOString(),
    };
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO approvals VALUES(?,?,?,?)')
        .run(value.id, value.project_id, value.plan_id, JSON.stringify(value));
      this.event('retry_approval', value.id, { parent: parent.id, scope: value.scope });
    });
    return value;
  }
  job(id) {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    return r ? { ...JSON.parse(r.payload), state: r.state, reserved: r.reserved } : null;
  }
  jobs(project) {
    return this.db
      .prepare('SELECT id FROM jobs WHERE project_id=?')
      .all(project)
      .map((r) => this.job(r.id));
  }
  results(id) {
    return this.db
      .prepare('SELECT payload FROM results WHERE intent_id=?')
      .all(id)
      .map((r) => JSON.parse(r.payload));
  }
  exposure(project) {
    return this.jobs(project).reduce((n, j) => n + j.reserved, 0);
  }
  costReport(project) {
    const jobs = this.jobs(project).map((j) => {
      const results = this.results(j.id),
        known = results.length > 0 && results.every((r) => Number.isFinite(r.cost_credits));
      return {
        intent_id: j.id,
        state: j.state,
        upper_credits: j.upper_credits,
        exposure_credits: j.reserved,
        actual_credits: known ? results.reduce((n, r) => n + r.cost_credits, 0) : null,
        unresolved_submission: Boolean(j.unresolved_submission),
        price_evidence: j.price_evidence,
      };
    });
    return {
      schema_version: 'cost-report.v1',
      project_id: project,
      exposure_credits: this.exposure(project),
      actual_credits: jobs.every((j) => j.actual_credits !== null && !j.unresolved_submission)
        ? jobs.reduce((n, j) => n + j.actual_credits, 0)
        : null,
      jobs,
      provider_billing_cap: false,
    };
  }
  claim(intent, plan, approvalId) {
    return this.transaction(() => {
      const existing = this.job(intent.id);
      if (existing) return { claimed: false, job: existing };
      const unknown = this.jobs(intent.project_id).find(
        (j) =>
          (j.shot_id === intent.shot_id ||
            (j.owners ?? []).some((owner) => (intent.owners ?? []).includes(owner))) &&
          (j.unresolved_submission || ['submitting', 'unknown_submission'].includes(j.state)),
      );
      requireValue(
        !unknown,
        'previous submission for this shot is unresolved; reconcile before a new intent',
      );
      const a = this.approval(approvalId);
      requireValue(
        a && a.plan_id === plan.id && a.scope.includes(intent.id),
        'approval does not cover this exact plan',
      );
      requireValue(plan.generation_permitted, 'planning_only or blocked plan');
      const attempts = this.jobs(intent.project_id).filter(
        (j) =>
          j.shot_id === intent.shot_id ||
          (j.owners ?? []).some((owner) => (intent.owners ?? []).includes(owner)),
      ).length;
      requireValue(attempts < plan.policy.max_attempts, 'paid attempt limit reached for this shot');
      requireValue(
        intent.upper_credits !== null && Number.isFinite(intent.upper_credits),
        'unknown upper cost',
      );
      requireValue(
        this.exposure(intent.project_id) + intent.upper_credits <= a.max_credits,
        'budget reservation exceeded',
      );
      this.db
        .prepare('INSERT INTO jobs VALUES(?,?,?,?,?)')
        .run(
          intent.id,
          intent.project_id,
          'submitting',
          JSON.stringify(intent),
          intent.upper_credits,
        );
      this.event('submitting', intent.id, {
        approval: approvalId,
        upper_credits: intent.upper_credits,
      });
      return { claimed: true, job: this.job(intent.id) };
    });
  }
  record(intent, response, { confirmed = false, evidence = null } = {}) {
    return this.transaction(() => {
      const job = this.job(intent.id);
      requireValue(job, 'unknown intent');
      for (const result of response.results ?? []) {
        requireValue(typeof result.id === 'string' && result.id, 'provider ID must be string');
        const old = this.results(intent.id).find((r) => r.id === result.id);
        const merged = { ...old, ...result };
        if (old?.status === 'completed' && ['submitted', 'running'].includes(result.status))
          merged.status = 'completed';
        this.db
          .prepare('INSERT OR REPLACE INTO results VALUES(?,?,?)')
          .run(intent.id, result.id, JSON.stringify(merged));
        if (merged.status === 'completed') {
          const takeId = hash({ intent: intent.id, provider: merged.id }),
            existing = this.take(takeId);
          if (!existing)
            this.putTake({
              id: takeId,
              project_id: intent.project_id,
              shot_id: intent.shot_id,
              intent_id: intent.id,
              provider_id: merged.id,
              kind: merged.kind,
              status: merged.path ? 'downloaded' : 'completed',
              ...(merged.path ? { path: merged.path } : {}),
              stale: false,
              qa: null,
              provenance: {
                backend: intent.backend,
                context: intent.context,
                inputs: intent.inputs,
                entity_revisions: intent.entity_revisions ?? [],
                owners: intent.owners ?? [],
              },
            });
          else if (
            merged.path &&
            (existing.status === 'completed' ||
              existing.path !== merged.path ||
              !existsSync(existing.path ?? ''))
          ) {
            const restored =
              existing.sha256 &&
              existsSync(merged.path) &&
              fileHash(merged.path) === existing.sha256;
            this.putTake({
              ...existing,
              path: merged.path,
              status: restored ? existing.status : 'downloaded',
              qa: restored ? existing.qa : null,
              stale: existing.sha256 && !restored ? true : existing.stale,
            });
          }
        }
      }
      const results = this.results(intent.id),
        terminal =
          results.length > 0 &&
          results.every((r) => ['completed', 'provider_failed'].includes(r.status));
      // Partial failures without IDs are uncertain and keep the full reservation.
      const uncertain =
        !confirmed &&
        Boolean(
          job.unresolved_submission ||
          response.error ||
          (response.exit_code ?? 0) !== 0 ||
          response.raw?.fail_count,
        );
      this.db
        .prepare('UPDATE jobs SET payload=? WHERE id=?')
        .run(JSON.stringify({ ...job, unresolved_submission: uncertain }), intent.id);
      if (confirmed) this.event('reconciled', intent.id, { evidence, results: response.results });
      let state =
        results.length === 0
          ? 'unknown_submission'
          : terminal
            ? results.every((r) => r.status === 'provider_failed')
              ? 'provider_failed'
              : uncertain
                ? 'partial'
                : 'completed'
            : 'submitted';
      const knownCost =
        terminal &&
        !uncertain &&
        results.every((r) => Number.isFinite(r.cost_credits) && r.cost_credits >= 0);
      const reserve = knownCost ? results.reduce((n, r) => n + r.cost_credits, 0) : job.reserved;
      this.db
        .prepare('UPDATE jobs SET state=?,reserved=? WHERE id=?')
        .run(state, reserve, intent.id);
      this.event('provider_result', intent.id, { state, response });
      return this.job(intent.id);
    });
  }
  setState(id, state, details = {}) {
    this.transaction(() => {
      requireValue(this.job(id), 'unknown job');
      this.db.prepare('UPDATE jobs SET state=? WHERE id=?').run(state, id);
      this.event(state, id, details);
    });
  }
  putTake(take) {
    this.db.prepare('INSERT OR REPLACE INTO takes VALUES(?,?)').run(take.id, JSON.stringify(take));
    return take;
  }
  take(id) {
    const r = this.db.prepare('SELECT payload FROM takes WHERE id=?').get(id);
    return r ? JSON.parse(r.payload) : null;
  }
  takes(project) {
    return this.db
      .prepare('SELECT payload FROM takes')
      .all()
      .map((r) => JSON.parse(r.payload))
      .filter((t) => !project || t.project_id === project);
  }
  history(target) {
    return this.db
      .prepare('SELECT * FROM events WHERE target=? ORDER BY seq')
      .all(target)
      .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  }
}
export class Executor {
  constructor(store, adapters) {
    this.store = store;
    this.adapters = adapters;
  }
  async run(plan, { approval, dryRun = false } = {}) {
    if (dryRun) return { dry_run: true, plan, provider_calls: 0 };
    requireValue(plan.generation_permitted, 'generation blocked; inspect plan');
    const report = [];
    for (const intent of plan.intents) {
      // Known durable jobs must never require a fresh provider preflight or re-submission.
      const existing = this.store.job(intent.id);
      if (existing) {
        report.push({ id: intent.id, state: existing.state, reused: true });
        continue;
      }
      const adapter = this.adapters[intent.backend];
      requireValue(adapter, 'backend adapter unavailable');
      for (const ref of intent.entity_revisions ?? []) {
        const entity = this.store.document('entity', ref.id, ref.revision);
        requireValue(entity, 'pinned entity revision is not in the shared registry');
        requireValue(
          entity.context.region === intent.context.region &&
            entity.context.workspace_id === intent.context.workspace_id,
          'pinned entity context mismatch',
        );
      }
      // Validation happens before a reservation. A pre-submit validation failure is not an unknown submission.
      let prepared;
      try {
        if (adapter.validate) await adapter.validate(intent);
        // Built-in prepare methods contain only read-only queries/dry-run. No job, reservation
        // or paid attempt exists until they succeed. A later throw is conservatively unknown.
        if (adapter.prepare) prepared = await adapter.prepare(intent);
      } catch (error) {
        this.store.event('preflight_failed', intent.id, { error: String(error), submitted: false });
        throw error;
      }
      const { claimed, job } = this.store.claim(intent, plan, approval);
      if (!claimed) {
        report.push({ id: intent.id, state: job.state, reused: true });
        continue;
      }
      try {
        const response = await adapter.submit(intent, prepared);
        report.push(this.store.record(intent, response));
      } catch (error) {
        this.store.setState(intent.id, 'unknown_submission', { error: String(error) });
        report.push({ id: intent.id, state: 'unknown_submission', error: String(error) });
      }
    }
    return {
      project_id: plan.project_id,
      jobs: report,
      exposure_credits: this.store.exposure(plan.project_id),
    };
  }
  async resume(id) {
    const intent = this.store.job(id);
    requireValue(intent, 'unknown intent');
    const results = this.store.results(id);
    requireValue(
      results.length > 0,
      'unknown_submission: reconcile provider history before any new attempt',
    );
    for (const result of results)
      if (!['completed', 'provider_failed'].includes(result.status)) {
        const response = await this.adapters[intent.backend].status(intent, result.id, {
          kind: result.kind,
        });
        this.store.record(intent, response);
      }
    return this.store.job(id);
  }
  async reconcile(id, results, evidence) {
    requireValue(
      typeof evidence === 'string' && evidence.trim(),
      'provider reconciliation evidence required',
    );
    const intent = this.store.job(id);
    requireValue(intent, 'unknown intent');
    requireValue(
      Array.isArray(results) &&
        results.length > 0 &&
        results.every((r) => ['completed', 'provider_failed'].includes(r.status)),
      'reconciliation must enumerate all terminal provider results',
    );
    requireValue(
      this.store.results(id).every((old) => results.some((r) => r.id === old.id)),
      'reconciliation must retain every known provider ID',
    );
    return this.store.record(intent, { results }, { confirmed: true, evidence });
  }
  async download(id, providerId, destination) {
    const intent = this.store.job(id);
    requireValue(intent, 'unknown intent');
    const result = this.store.results(id).find((r) => r.id === providerId);
    requireValue(result?.status === 'completed', 'download requires completed provider result');
    if (result.path && existsSync(result.path)) return result;
    try {
      const response = await this.adapters[intent.backend].download(
        intent,
        providerId,
        destination,
        { kind: result.kind },
      );
      this.store.record(intent, response);
      requireValue(
        response.results?.some((r) => r.id === providerId && r.path),
        'download did not return a saved file',
      );
      return response;
    } catch (e) {
      this.store.setState(id, 'download_failed', { provider_id: providerId, error: String(e) });
      throw e;
    }
  }
}
