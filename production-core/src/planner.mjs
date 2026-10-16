import { assertProduction, hash, fileHash, requireValue } from './contracts.mjs';
export function planProduction(production, { resolveIntent } = {}) {
  const p = assertProduction(production),
    intents = [],
    blocked = [],
    reuse = [];
  const work = [...p.shots, ...(p.jobs ?? [])];
  for (const shot of work) {
    if (shot.take_id) {
      reuse.push({ shot_id: shot.shot_id, take_id: shot.take_id });
      continue;
    }
    if (!shot.generation) {
      blocked.push({ shot_id: shot.shot_id, reason: 'no accepted take or generation route' });
      continue;
    }
    const g = shot.generation,
      parameters = structuredClone(g.parameters ?? {});
    if (
      shot.audio?.strict_dialogue &&
      shot.audio?.visible_mouth &&
      shot.audio?.same_voice &&
      !shot.audio?.verified_sync_evidence
    )
      blocked.push({
        shot_id: shot.shot_id,
        reason:
          'strict same-voice visible dialogue requires a verified sync route; independent TTS is insufficient',
      });
    const controls = new Map();
    for (const binding of shot.references ?? [])
      for (const [feature, value] of Object.entries(binding.controls ?? {})) {
        const key = `${binding.target ?? ''}:${feature}`,
          serialized = hash(value);
        if (controls.has(key) && controls.get(key) !== serialized)
          blocked.push({ shot_id: shot.shot_id, reason: `conflicting reference control ${key}` });
        controls.set(key, serialized);
      }
    if (g.mode === 'video' && shot.generation_strategy !== 'native_sequence')
      parameters.multi_shot = false;
    if (g.mode === 'video' && shot.generation_strategy === 'native_sequence')
      parameters.multi_shot = true;
    const inputs = (shot.references ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((binding) => {
        const asset = p.assets.find((a) => a.id === binding.asset);
        requireValue(
          asset.region === p.context.region && asset.workspace_id === p.context.workspace_id,
          `reference ${asset.id}: context mismatch`,
        );
        const copy = structuredClone(asset);
        if (copy.path) {
          const actual = fileHash(copy.path);
          requireValue(
            !copy.sha256 || copy.sha256 === actual,
            `reference ${copy.id}: content hash mismatch`,
          );
          copy.sha256 = actual;
        }
        requireValue(
          Boolean(copy.sha256 || copy.provider_id),
          `reference ${copy.id}: identity unknown`,
        );
        if (copy.status !== 'accepted')
          blocked.push({
            shot_id: shot.shot_id,
            reason: `reference ${copy.id} requires acceptance before generation`,
          });
        return { ...copy, binding };
      });
    let request = {
      project_id: p.project_id,
      shot_id: shot.shot_id,
      attempt: g.attempt ?? 1,
      backend: g.backend,
      mode: g.mode,
      model: g.model,
      parameters:
        g.mode === 'voice'
          ? { ...parameters, text: parameters.text ?? shot.prompt ?? shot.purpose }
          : { ...parameters, prompt: parameters.prompt ?? shot.prompt ?? shot.purpose },
      inputs,
      context: p.context,
      entity_revisions: shot.entity_revisions ?? [],
      capability_hash: hash(g.capability_snapshot ?? null),
      ...(g.canvas ? { canvas: g.canvas } : {}),
    };
    if (resolveIntent && g.capability_snapshot) {
      try {
        const resolved = resolveIntent({
          ...request,
          id: 'planning',
          capability_snapshot: g.capability_snapshot,
        });
        request = { ...request, parameters: resolved.parameters ?? request.parameters };
      } catch (e) {
        blocked.push({ shot_id: shot.shot_id, reason: `capability: ${e.message}` });
      }
    }
    if (g.mode === 'voice') {
      const voiceIdentity = {
        parameters: request.parameters,
        inputs: request.inputs,
        context: request.context,
        model: request.model,
        backend: request.backend,
        attempt: request.attempt,
        locale: shot.locale ?? null,
        voice_revision: shot.voice_revision ?? null,
        performance: shot.performance ?? null,
        entity_revisions: request.entity_revisions,
        capability_hash: request.capability_hash,
      };
      request = {
        ...request,
        shot_id: `voice-${hash({ ...voiceIdentity, attempt: 0 }).slice(0, 24)}`,
        audio_identity: voiceIdentity,
      };
    }
    const intent = {
      ...request,
      id: hash(request),
      upper_credits: g.upper_credits ?? null,
      price_evidence: g.price_evidence ?? null,
      capability_snapshot: g.capability_snapshot ?? null,
    };
    if (intent.attempt > p.execution_policy.max_attempts)
      blocked.push({ shot_id: shot.shot_id, reason: 'attempt limit exceeded' });
    if (
      intent.upper_credits === null ||
      !Number.isFinite(intent.upper_credits) ||
      intent.upper_credits < 0 ||
      !intent.price_evidence ||
      intent.price_evidence.surface !== 'cli'
    )
      blocked.push({
        shot_id: shot.shot_id,
        reason: 'CLI/workspace upper price and evidence required for strict budget',
      });
    if (!intent.capability_snapshot)
      blocked.push({
        shot_id: shot.shot_id,
        reason: 'capability snapshot required before generation',
      });
    const duplicate = intents.find((i) => i.id === intent.id);
    if (duplicate) {
      duplicate.owners.push(shot.shot_id);
      if (duplicate.upper_credits !== intent.upper_credits)
        blocked.push({
          shot_id: shot.shot_id,
          reason: 'conflicting upper prices for the same shared voice request',
        });
    } else intents.push({ ...intent, owners: [shot.shot_id] });
  }
  const identity = {
    schema_version: 'execution-plan.v1',
    project_id: p.project_id,
    revision: p.revision,
    context: p.context,
    intents,
    reuse,
    policy: p.execution_policy,
  };
  return {
    ...identity,
    id: hash(identity),
    brief: p.brief,
    sequence: p.shots.map((s) => ({
      shot_id: s.shot_id,
      purpose: s.purpose,
      edit_duration_ms: s.edit_duration_ms,
      entry_state: s.entry_state,
      exit_state: s.exit_state,
      camera: s.camera,
      audio: s.audio,
      strategy: s.generation_strategy,
    })),
    blocked,
    total_upper_credits: intents.every((i) => i.upper_credits !== null)
      ? intents.reduce((n, i) => n + i.upper_credits, 0)
      : null,
    generation_permitted: p.execution_policy.allowed_scope === 'generation' && blocked.length === 0,
    notes: [
      'Planning makes zero provider calls. Generated storyboards and auditions require separate intents.',
      'A local budget is not a provider billing cap. Unknown actual costs retain their reservation.',
    ],
  };
}
export function impactAnalysis(production, changed) {
  const set = new Set(changed),
    affected = new Set(changed);
  let again = true;
  while (again) {
    again = false;
    for (const node of production.dependencies ?? [])
      if ((node.depends_on ?? []).some((id) => affected.has(id)) && !affected.has(node.id)) {
        affected.add(node.id);
        again = true;
      }
  }
  for (const s of production.shots)
    if (
      (s.references ?? []).some((r) => set.has(r.asset)) ||
      (s.entity_revisions ?? []).some((e) => set.has(e.id))
    )
      affected.add(s.shot_id);
  const shots = production.shots.filter((s) => affected.has(s.shot_id)).map((s) => s.shot_id);
  return {
    changed: [...set],
    stale: [...affected],
    shots,
    deliveries: shots.length ? production.brief.deliveries.map((d) => d.id) : [],
    regeneration_authorized: false,
  };
}
export function voiceKey({ text, locale, voice_revision, performance, context, model }) {
  return hash({ text, locale, voice_revision, performance, context, model }); // no aspect ratio: voice is shared across framing variants
}
