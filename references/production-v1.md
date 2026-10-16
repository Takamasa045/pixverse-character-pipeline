# production.v1 operator guide

This guide is the current route for both skills. The root `SKILL.md` describes creative decisions; [`../production-core/docs/CONTRACT.md`](../production-core/docs/CONTRACT.md) defines machine fields. New input is JSON. Old YAML and manifests belong at the migration boundary.

## Two entries, one core

| Responsibility | Owner |
|---|---|
| Adopted identity/body, voice, wardrobe, world/place and prop revisions | Character Pipeline |
| Brief, sequence, shot/take adoption, issues, timeline and delivery | Shotpack |
| Reference provenance, capability snapshots, intent hashes, execution state, credit reservation and Canvas merge | Shared core |

The canonical code is `production-core/` in [pixverse-shotpack](https://github.com/Takamasa045/pixverse-shotpack). Character Pipeline carries a byte-for-byte vendored copy, so neither repository requires a sibling checkout at runtime. Shotpack's `tools/sync-core.mjs` maintains the copy; run it with `--check` before release. Use the same explicit `--db` path when both entry points work on one production. Do not create independent ledgers or submit through both backends.

## Local start

Use Node >=22.18 (including its built-in SQLite support). The core needs no new npm dependency, login or media download for validation, planning, dry-run and fixture tests. Optional finishing tools must already be available when the chosen adapter needs them. Do not install the old Remotion dependency tree merely to plan a production.

From the repository root, start with a planning fixture:

```bash
./bin/production validate production-core/fixtures/station-story.json
./bin/production plan production-core/fixtures/station-story.json
./bin/production run production-core/fixtures/station-story.json --dry-run
node --test production-core/test/*.test.mjs
```

[`station-story.json`](../production-core/fixtures/station-story.json), [`weekly-guide.json`](../production-core/fixtures/weekly-guide.json) and [`bottle-action.json`](../production-core/fixtures/bottle-action.json) are planning-only examples. They do not contain adopted media, final timelines or permission to generate. Attach accepted reference assets, exact entity revisions, real region/workspace, current capability snapshots and CLI upper-credit price evidence to turn a chosen plan into executable work. Use your own `production.json` for subsequent commands.

These commands do not submit generation jobs. Read their unresolved requirements before proceeding. The dry-run never calls adapters. A plan describes intended work; it is not a completed media bundle. Read-only capability discovery for the installed CLI is explicit:

```bash
./bin/production capabilities video --model v6
```

Store its actual schema in the planned generation's capability snapshot. Offline planning validates the supplied snapshot and records the resolved executable path without invoking it; paid execution records its version and rechecks the installed capabilities. `PIXVERSE_BIN` may select an explicit executable. The executable path is bound into CLI plan approval, so a different local/global CLI resolution needs replanning. Capability discovery itself does not grant generation permission. Increment the production revision when changing persisted content.

To persist a character contract and read an exact revision:

```bash
./bin/production character register character.json --db work/production.sqlite
./bin/production character get white-cat --revision 1 --db work/production.sqlite
```

Character identity, wardrobe, voice and world each have stable IDs and immutable revisions. Pin the adopted revisions in each production; do not silently replace a past work's references with the registry's latest entry. Registration requires `status: accepted`, a reviewer, context and accepted references/provenance; it does not create a review by itself. Link wardrobe, voice, place and props by exact entity revision. New generated media still needs its own take review.

## Template and MiniApp candidates

`./bin/production preset-candidates catalog.json` compares supplied current catalog snapshots against editing, output, duration and aspect requirements without provider calls. A selected `backend: "preset"` generation uses schema-validated MiniApps or a verified CLI 1.4.8 legacy template contract, with the same approval/ledger/resume gates. Inputs retain accepted asset provenance and actual uploaded media paths; no upload or authorization is implicit. See [ADAPTERS.md](../production-core/docs/ADAPTERS.md) for the snapshot schema.

The modern CLI 1.4.9 ordered/fixed-output template execution path is conditionally blocked until its actual slot and result schemas can be read and tested. Candidate comparison reports this limitation; it never invents payloads, fixed outputs or editing capabilities.

## Generation approval and resume

Before paid work, show target shots, model/mode, reference roles, backend, context, retry count, upper credits and evidence for prices. Include reference creation and performance trials when needed. Unknown price must remain unknown and blocks a claimed exact ceiling. A count of jobs is not a credit budget.

After the human has approved this concrete scope, record that approval, then use its ID:

```bash
./bin/production approve production.json --db work/production.sqlite --actor reviewer
./bin/production run production.json --db work/production.sqlite --approval APPROVAL_ID
```

Do not execute these examples as permission to generate. `approve` records authorization already received from the human. A changed request or out-of-scope spend needs a new reviewed plan. Work within existing authorization should proceed without repeated per-job permission questions.

For an identical retry already included in the original attempt limit and ceiling, use `retry-approval production.json --from APPROVAL_ID --db work/production.sqlite`. It verifies a confirmed failed/reviewed rejected result, unchanged resolved inputs/model/context and a bounded next attempt. It cannot authorize changed content or an uncertain submission. Other revisions use a newly reviewed plan.

Inspect state, then resume an intent with known provider results or reconcile an uncertain outcome with explicit evidence:

```bash
./bin/production status PROJECT_ID --db work/production.sqlite
./bin/production costs PROJECT_ID --db work/production.sqlite
./bin/production resume INTENT_ID --db work/production.sqlite
./bin/production reconcile INTENT_ID --results results.json --evidence "provider lookup result" --db work/production.sqlite
./bin/production download INTENT_ID --provider PROVIDER_ID --out media/take.mp4 --db work/production.sqlite
```

Reconciliation must enumerate all terminal results and retain every known provider ID. Evidence explicitly confirms that this is the complete request outcome; it atomically clears unresolved exposure only when final per-result costs are known. Reconciliation is an evidence-based state operation, not a new generation approval. Never manufacture a lookup result to unblock execution. Run again with the same production and ledger to resume. The intent hash covers resolved inputs, references/content, model, parameters, backend, region/workspace and intentional attempt. Same shot ID does not mean same request. A purposeful new take has a new attempt. Preserve explicit OFF settings in both the plan and provider call.

The ledger persists budget reservation and submitting state before the external call. Known IDs return to status/download. An uncertain submission with no IDs stays `unknown_submission` until reconciled; do not automatically resubmit. Partial successful IDs survive a nonzero exit. Download or disk failures must retry retrieval, not generation. Provider idempotency for supported image/video requests is distinct from voice/music tracing IDs; the core does not claim provider-wide exactly-once behavior.

## Review, edit and delivery

Production data uses string IDs and integer milliseconds. `completed`, `downloaded`, `reviewed` and `accepted` are separate states. Pin adopted take IDs in the timeline, retain source ranges and provenance, and review technical, creative, continuity and audio dimensions. AI and human judgments should be identifiable. An asset without actual local media cannot be declared a finished local delivery.

For existing local media, `local-take local-input.json --db work/production.sqlite` records `{project_id,shot_id,kind,path,context,provenance,entity_revisions?}` as downloaded with no QA and no provider call. Review and adopt it through the same ledger. Download and inspect an actual generated take, then record its review. `qa.json` supplies reviewer, notes and each of technical/creative/continuity/audio as `pass`, `fail` or `not_applicable`; adoption requires the applicable gates to pass:

```bash
./bin/production review TAKE_ID --qa qa.json --accept --db work/production.sqlite
./bin/production adopt production.json --shot SHOT_ID --take TAKE_ID --db work/production.sqlite
```

Save the returned adopted production to a new JSON file; it carries a new immutable revision. Use `review --reevaluate` only after rechecking a stale take. Two visible registered characters require individual `qa.entities` observations for face, wardrobe, voice and position. Use shot/take and time ranges for issues. First consider trim/order, subtitle placement or audio correction. Regeneration is a scoped last step under existing policy. Mark affected derived work stale after a character, voice, Canvas take or timeline change; stale is a request for review, not a new paid job.

```bash
./bin/production issue production.json --start-ms 7000 --end-ms 10000 --kind creative
./bin/production edit production.json --patch timeline-patch.json
./bin/production finish production.json --takes takes.json --out delivery
```

`edit` returns a separate updated production and affected delivery IDs; save it under a new file/revision after review. It does not generate media. `takes.json` is an array of actual adopted take records, obtainable from the ledger's project status. Use `--variant DELIVERY_ID` to finish only one requested variant; `finish --dry-run` validates source files and local probe requirements without rendering.

The local finishing adapter uses existing **FFmpeg and ffprobe**. It supports ordered cuts, source trimming, image holds, explicit source-pixel crops with optional protected regions, scale-to-fit with padding, requested dimensions/fps, explicit native audio, external audio trim/delay/volume/mix and SRT sidecars. Basic subtitle burn-in requires an existing Python/Pillow runtime, a supplied font and an explicit output-pixel safe area. Black/silence intervals and mean/peak volume are measured; only explicit delivery QC thresholds reject intentional black or silence. See the exact contract in [FINISHING.md](../production-core/docs/FINISHING.md). It hashes sources, checks accepted/non-stale QA, probes duration/specifications, decodes output and reuses only a matching output fingerprint/hash. It does not submit generation.

Animated reframing, speed changes, transitions beyond a cut, visual effects, arbitrary caption animation/layers and audio fade/loop are explicitly unsupported. Use a separately implemented adapter when required; do not silently ignore these requests. `phase: rough` selects local encoding quality but still requires accepted source inputs; placeholder rough-edit planning remains an agent task. Output `creative_delivery_review` is `pending` until final human viewing. After watching it, `delivery-review bundle.json --qa delivery-qa.json` verifies unchanged output hashes and records a separate reviewed bundle. Its QA includes reviewer/notes and creative/continuity/audio/captions/specification (`creative` and `specification` must pass; other dimensions may be an explicit `not_applicable`). A successful render is technically checked media, not automatic creative sign-off.

Return actual outputs only; report unsupported editing, missing tools, failed QA or unknown cost explicitly. MP4 playback and creative quality require review beyond JSON fixture success.

## Canvas synchronization

Treat Canvas human edits as valid input. Read current graph and capabilities before mutation; validate and apply a scoped patch, then dispatch owned nodes only. Preserve unmanaged nodes, user layout and large string IDs. Compare base/local/remote fields: one-sided edits may merge, competing edits produce visible conflicts. Do not overwrite remote history with an old local copy.

Do not infer that Create and Canvas support identical parameters. In particular Create's edit/extend `task_type` must not be added to a Canvas node whose current schema lacks it. Select Create as the owner up front when necessary, or block the request. Never quietly dispatch both backends for the same intent. The default Canvas adapter has bounded HTTPS media transfer, with disk/size checks and no-overwrite saving. `download-take` verifies that the recorded human-selected history is still selected before and after transfer. A changed selection retains saved bytes but blocks completion; relative or unavailable URLs remain explicit blockers. Do not treat the cloud node or a planned local path as a downloaded or delivered file.

Canvas sync is available as a local, persistent operation:

```bash
./bin/production canvas-sync production.json --sync sync.json --db work/production.sqlite
./bin/production download-take TAKE_ID --out media/selected --db work/production.sqlite
# Or attach media already saved and independently verified:
./bin/production attach TAKE_ID --file media/selected.mp4 --evidence "verified saved Canvas selection" --db work/production.sqlite
```

`sync.json` includes base/local/remote graphs, explicit matching `context` and node-to-shot mappings. Missing or different region/workspace blocks import. A selected history enters the timeline as an unreviewed take: attach its verified local file, review, then adopt it. Conflicts return without changing the saved production. This local sync does not write or dispatch Canvas nodes.

Independent image/voice/music work can use the optional production `jobs` array with the same generation fields as a shot. It does not add edit duration. Voice jobs with identical resolved text, locale, voice revision, acting, model, inputs and context share a single intent across aspect owners; changed pronunciation creates a new intent. Retain locale/voice_revision/performance explicitly. The finish adapter consumes accepted audio assets in the timeline; creating voice alone never marks a visible mouth synchronized.

## Three acceptance scenarios

These are fixture and operator review scenarios, not measured examples of generated picture quality.

### A. Recurring guide, two languages and two aspects

Ask: “Use last week's guide character for a 20-second service introduction, Japanese and English, vertical and horizontal. Narration is fine.”

Read the adopted identity, outfit and voice revisions. Plan only the four requested delivery combinations. Share a narration request across aspect variants when text, language, voice and acting match. Keep Japanese and English audio separate. Review timing, pronunciation and framing; TTS over a visible mouth is not verified lip sync.

Repair: “Fix only the English pronunciation of the service name.” Invalidate English narration, captions and dependent edits. Reuse face, Japanese media and unaffected shots. Acceptance: no unrelated video request, no aspect-only duplication of identical audio, and no changes to previous character revisions.

### B. Two cats at a station

Ask: “This cat waits anxiously at a station and relaxes when it finds its friend, in 20 seconds.”

Resolve both characters, clothes, station and ticket. Give each shot a purpose, duration, gaze and entry/exit state. Confirm the full emotional arc in a rough edit. Review identity separately for both cats, held hand, direction and their relative positions.

Repair: “The moment of recognition is unclear.” First check gaze, position and cut order, then identify one shot if generation is necessary. Acceptance: shot IDs remain stable after reordering; changing the recognition shot leaves unrelated accepted intents reusable; continuity QA still applies to neighbors and the final edit.

### C. Product handling

Ask: “Pick up this bottle, open its cap and place it on the table in 12 seconds; keep its shape and logo.”

No recurring person means no forced Character registration. Bind the product photo as appearance and a supplied motion clip as motion; create previsualization only when needed and authorized. Review contact, hand anatomy, cap location and causal action.

Repair: “Only the logo is wrong.” If exact lettering is required, use the actual product asset or an editorial treatment supported by the finishing adapter. Acceptance: report any unsupported local edit or unverified logo fidelity; never mark the output accepted merely because generation completed.

## Migration and rollback

```bash
./bin/production migrate old-input.json --kind character
./bin/production migrate old-input.json --kind shotpack
./bin/production migrate old-registry.json --kind registry
./bin/production migrate old-manifest.json --kind manifest
```

Use the appropriate kind for a legacy character project, Shotpack project, official persistent-assets registry or manifest. The adapter imports to a separate new result plus a report; it does not overwrite the source. The dependency-free CLI always reads **JSON** and can also parse YAML when a `yaml` dependency already exists in the checkout. When that parser is unavailable it stops: convert a copy with existing trusted tooling, or call the library with an explicitly supplied `yamlParser`. No parser is installed automatically. A Shotpack project with a separate storyboard needs that parsed storyboard explicitly (or a combined JSON input). Legacy spokesperson YAML/JSON is normalized directly with `--kind character`; numeric legacy speakers remain unresolved rather than becoming guessed current voice IDs. Official registry import/export supports version 2 characters/items and retains unknown metadata; imported entries are not automatically accepted entities. Retain provider IDs, context, source hashes and real paths where available. Unknown QA, price, region/workspace and absent files stay unresolved. Migration never regenerates images, voice or video and never promotes a “completed” manifest entry without files and QA into accepted delivery.

For a checked legacy consumer export, use:

```bash
./bin/production export production.json --takes takes.json --format shotpack --variant DELIVERY_ID
```

The exporter validates accepted source files and reports edit features that the old consumer cannot represent. A blocked export has no manifest. The final delivery bundle includes known costs or null through an optional production `cost_report` copied from `costs`; unknown charges are never presented as zero.

Keep the original inputs, media, old Git revision and ledger before switching. The root `./bin/pipeline --legacy …` (and Character's `remotion/bin/pipeline --legacy …`) explicitly selects the old runtime; without `--legacy`, `pipeline` forwards to the new production entry. Read [`legacy-entrypoints.md`](legacy-entrypoints.md) first. Rollback means choosing the preserved old runtime and inputs deliberately; it does not convert new SQLite history into an old manifest or refund external jobs. Avoid concurrent paid runs of old and new workflows against the same project. Do not delete caches or media during migration.

## Validation and limitations

Run the repository's core tests and the representative fixtures before release. Include crash/resume, unknown voice submission, partial IDs, concurrent budget reservation, explicit OFF, contextual reference mismatch, Canvas conflicts/large IDs/unmanaged nodes, missing files and storage failures. Use fixtures for contract checks; separately authorized live tests are required for provider integration, exact prices, identity/voice retention, lip sync, local-edit side effects and final creative quality.

The old reference documents are historical context. Their fixed model tables, mandatory three-view/I2I pipelines and old CLI pins are not current routing rules. Current capability schemas and the executed CLI binary take precedence. No current-generation or Canvas support is invented from a marketing example.
