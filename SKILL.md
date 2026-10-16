---
name: pixverse-character-pipeline
description: >
  Reuse a recurring character across productions with adopted revisions of identity,
  wardrobe, voice and world. Prepare performance and reference contracts, then hand
  the production to Shotpack through the shared production.v1 core.
---

# PixVerse Character Pipeline

Use this entry when the user says “the same character as last time”, supplies a recurring character, or needs consistent people, voices, outfits or locations across works. The previous skill name `character-video-pipeline` is a legacy alias in documentation; this repository's current skill name is `pixverse-character-pipeline`.

## Character workflow

1. Resolve the person by stable entity ID and adopted revision, previous accepted take, or supplied references. Ask only when identity is ambiguous. Reuse sufficient existing references; do not automatically generate a three-view sheet or I2I image.
2. Freeze identity and body, then track wardrobe/role, voice, world/place and props in separate revisions. Keep scene state (wet coat, ticket in right hand, gaze, emotion) in the production. An outfit change does not overwrite the character's face or previous works.
3. Describe what changes this time and what stays fixed. Bind assets to `identity`, `appearance`, `motion`, `layout`, `audio` or `timing`, with order and target. Retain source, hash, provider ID and region/workspace; a URL alone is insufficient provenance.
4. Prepare the character bundle and each scene's performance brief: action, emotion, gaze, partner, dialogue, references and invariants. Inspect only the angles and movements this work needs. A representative performance trial is optional when already validated under the same conditions; any new generation belongs in the approved budget.
5. Choose an honest audio promise. Narration uses supplied audio or independent TTS. Generated dialogue requires review of words, speaker, voice and mouth movement. Exact text plus the same voice on a visible face requires a separately verified synchronization path; without one, report the requirement unresolved.
6. Hand frozen entity revisions and performance conditions to Shotpack. Shotpack is the single production coordinator; Character does not start a second generation loop. Return only for missing or conflicting character contracts.
7. After delivery, offer successful accepted assets for a new adopted revision. Never promote an unreviewed or failed take to the reusable identity. `character register/get` persists and retrieves revisions; review adoption intentionally.

Share identical narration across aspect variants. A language, script, pronunciation or acting change creates a different audio request. Do not merge voices merely because the same person speaks. Review two-character scenes per person, including clothing, position, voice and gaze.

## Shared execution contract

Use the root `./bin/production` entry point and the local `production-core/`. Read [`references/production-v1.md`](references/production-v1.md) for commands, migration and the three acceptance scenarios. [`production-core/docs/CONTRACT.md`](production-core/docs/CONTRACT.md) defines exact fields. Node >=22.18 is required; planning and tests need no npm install or login. Use JSON `production.v1` documents for new productions; increment the revision when changing persisted content.

1. Preserve the original request; separate assumptions from explicit requirements. Check available storage and existing assets before copying media.
2. Show the production card, changes, references by role, unresolved requirements, delivery variants and cost range. Run `validate`, `plan`, then `run --dry-run`; dry-run makes no provider calls.
3. Resolve current provider capabilities and actual region/workspace before proposing generation. Missing capability, price or context is a blocker, never permission to guess. Model and mode determine supported controls. A template/MiniApp is a candidate only after its actual input and output contract is read.
4. For paid work, record the human's approved scope, attempts and credit ceiling against the concrete plan. Existing valid approval covers work within that scope; do not ask again per job. `approve` records permission already given; it does not grant permission on the human's behalf. Unknown costs cannot be treated as zero.
5. Use one shared SQLite ledger and one backend owner per intent. Persist submission before external work; retain partial provider IDs even after errors. Resume known IDs. An unknown submission stays blocked for reconciliation; never submit again merely because it timed out. Voice/music tracing IDs do not guarantee provider deduplication.
6. Keep generated, downloaded, reviewed and accepted states separate. Check identity, continuity, technical properties, sound and story. A completed task does not mean an accepted take. Treat model-based QA as evidence; human creative acceptance is distinct.
7. Handle issues by shot/take and time range. Try editing, captions or audio correction before paid regeneration. Preserve original takes. Stale dependencies need review; `stale` does not authorize a new job.
8. Before Canvas mutation read capabilities and graph, validate the patch, apply it, then dispatch only owned targets. Merge base/local/remote changes; preserve human adoption and unmanaged nodes. Surface conflicts. Never add Create-only `task_type` to a Canvas schema that does not declare it, or send an in-flight Canvas job through Create.
9. Deliver only existing, accepted, checked files with timeline, subtitles when requested, provenance, costs (including unknowns), QA and resume information. A plan or placeholder path is not a finished MP4. Use finish adapters only for their supported operations; unsupported edits must be reported.

Explicit `false` controls must remain off at the provider boundary. IDs remain strings; production times use integer milliseconds. Do not store credentials in production data or publish private media, logs or account information. Never remove user files or caches to make room.

## Current limits and compatibility

The common core implements production state and adapter contracts; mock/fixture tests do not prove image quality, voice fidelity, lip sync, precise prices or all Canvas model capabilities. Verify these with a separately authorized bounded live trial. TTS over video is narration, not verified lip sync. Do not claim exact identity preservation, logo preservation or provider-wide exactly-once execution.

Previous YAML/manifest formats are compatibility inputs, not the new source of truth. Keep original files untouched; migration reports unresolved assets, QA and costs. [`references/legacy-entrypoints.md`](references/legacy-entrypoints.md) indexes the archived old instructions. `./bin/pipeline --legacy …` and the previous Remotion workflow are explicit legacy routes; do not use them by default or run old and new paid flows for the same work.
