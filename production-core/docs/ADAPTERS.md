# Create and Canvas boundaries

The adapters use Node built-ins and CLI argument arrays. They do not call private
HTTP generation endpoints. Import them from `src/pixverse.mjs` and
`src/canvas.mjs`. The executor owns durable reservation, budget approval,
submission states, known provider IDs, and whether an operation may run. Never
call an adapter from a production dry-run.

Built-in adapters expose `prepare(intent)` in addition to `submit(intent, token)`.
The executor first reuses any durable job, then runs offline validation and read-only
preparation **before** claiming a paid attempt or reserving credits. Create preparation
queries the live registry and builds exact argv; preset preparation checks CLI version
and current info; Canvas preparation queries capabilities and performs Graph dry-run.
A failed preparation records `preflight_failed` in the audit history with no job,
reservation or paid attempt. Once the cause is fixed, the same exact approved intent
can run again without a provider reconciliation for a request that was never sent.

Preparation returns an opaque, one-use token scoped to that adapter instance and
exact intent content. The executor passes it to `submit` only after the transactional
claim. Tokens contain no public argv and cannot be serialized for later use. Concurrent
read-only preparations still compete for one durable claim. Existing jobs bypass all
preparation, including after restarting the process. A direct `submit(intent)` call
retains compatibility by preparing first; production callers must use the executor.

Only submission crosses a mutation boundary: Create/MiniApp/template create, or
Canvas patch **apply** (before dispatch). Any exception after that boundary remains
`unknown_submission`; an unconfirmed Canvas apply retains unresolved exposure even
if dispatch never began. Partial IDs are retained, and generic/custom adapter exceptions
are never inferred to be safely unsent. A custom adapter's `prepare` must be strictly
read-only. Do not put uploads, patch apply, generation, purchases or retries there.

## Create

```js
import { createPixVerseAdapter, validateCreateIntent } from './src/pixverse.mjs';
const resolved = validateCreateIntent(provisionalIntent, capturedCapability);
// Hash resolved.parameters into the final immutable approved intent first.
const adapter = createPixVerseAdapter();
adapter.validate(intent); // Offline; requires intent.capability_snapshot.
// Only the durable executor calls submit/status/download after approval.
```

`normalizeCreateCapability(snapshot,{mode,model})` accepts the installed CLI's
`pixverse_create_capability_query.v1` response and applies the selected model's
parameter overrides. No model table is embedded in this code.
`validateCreateIntent(intent,snapshot)` returns `{capability,parameters}`. It
resolves defaults, evaluates supported registry rules, rejects illegal values
instead of accepting implicit CLI adjustments, and preserves explicit `false`.
Unknown conditions and unevaluated validation rules fail closed.

`inputs` are immutable asset snapshots. Each has `kind`, `path` and/or
`provider_id`, region/workspace, and an optional `binding:{asset,role,order,target}`.
An optional `parameter` names an exact CLI registry media parameter. With no
explicit parameter, documented command forms bind image-to-video's image,
reference's image/video/audio arrays, image's images, transition's images,
modify's video and images, and motion-control's image and video. `binding.order`
controls order inside each media type. Roles remain part of the intent; the
adapter does not turn a role into an undocumented provider control field.
Provider IDs with unknown or mismatched region/workspace are rejected. Resolved
parameters can pass through validation repeatedly without appending inputs twice.
Conflicting pre-resolved inputs are rejected.

`buildCreateCommand(intent,snapshot)` returns an argv array. It uses `--no-wait`
and `--json`, an executor-owned idempotency key when the registry supports it,
and a tracing-only `--client-request-id` for voice/music. The executor must never
automatically resubmit an ambiguous voice/music request. Explicit `audio:false`
and `multi_shot:false` become `--no-audio` and `--no-multi-shot`. CLI default-on
multi-shot is visible in resolved parameters; the planner must explicitly select
the strategy before approval.

The default adapter re-queries installed capabilities before submission. If the
approved snapshot resolves differently, it stops before creation. Supply captured
fixtures through `capabilities` for offline tests only. Status/download use the
existing ID exclusively; a failed transfer never calls create.

```js
const adapter = createPixVerseAdapter({
  run: async (argv, { context }) => ({ raw: parsedStdout, exit_code: 0, stderr: '' }),
  capabilities: snapshotOrModeModelMapOrAsyncIntentFunction,
});
```

The exported `cliRunner(binary='pixverse')` implements that same interface with
`execFile`, without a shell. It captures stdout once, parses once, preserves
stderr and nonzero status, and fixes `PIXVERSE_REGION` to the approved context
(the CLI environment otherwise overrides its flag). Every command also carries
explicit `--region` and `--workspace-id`. The runner does not retry.

`normalizeCreateResult(raw,kind,exit_code)` returns
`{results:[{id,status,kind,url?,path?,cost_credits?}],exit_code,error?,issues?,raw}`.
It retains singular, plural, completed items, failed IDs and ID-keyed status
responses even on nonzero exits. Unusable IDs are reported in `issues` without
discarding valid siblings. Missing cost is unknown. The current CLI's downloadable
media IDs must be positive safe integers; Canvas IDs have a different contract.

## Canvas

Canvas runs only through Graph patch and dispatch. A `capability_ref:create.*`
is validation metadata and never switches the backend to Create.

The Canvas intent extension is:

```json
{
  "canvas": {
    "project_id": "9999999999999999999999",
    "node_id": "video_1",
    "baseline_history_id": "9999999999999999999998",
    "patch": {
      "schema_version": "canvas_agent_graph.v1",
      "base_edit_version": 12,
      "nodes": []
    },
    "capability_snapshot": {},
    "dispatch_plan_id": "only-if-confirmation-is-required"
  }
}
```

IDs are nonempty strings and never converted to JavaScript numbers.
`baseline_history_id` is the last synchronized selected history, or `null` only
for a new node. A patch must contain the exact approved target node. An actual
node needs the fields required by its current Canvas schema. The example is a
shape, not an executable patch. An empty patch is rejected.

`validateCanvasPatch(patch,liveSnapshot,{project_id,context})` checks the selected
node and selector against a compatible live query. It uses that query's v2 field
mapping and associated Create registry only for validation. It refuses unmapped
payload parameters (including `task_type` when Canvas has no mapping), missing
route conditions, wrong node model placement and unsupported node types. Final
DAG/reference/ownership checks remain with the CLI's official dry-run. The
adapter accepts caller-authored public Graph patches; it does not invent a
translation for unpublished node payloads.

The explicit boundaries are:

1. `prepareCanvasPatch(intent,{run,snapshot})` validates, then sends dry-run.
   Success requires exit 0, `ErrCode===0` and `Resp.valid===true`.
2. `applyCanvasPatch(intent,prepared,{run})` requires the same exact patch, hash
   and stable idempotency key. Success requires `valid` and `applied` true.
3. `dispatchCanvasPatch(intent,applied,{run})` dispatches the one intended node
   only when it appears in `diff.executable_node_ids`, at the returned edit
   version. It preserves matching confirmation plans and never dispatches other
   ready or metadata nodes.

`createCanvasAdapter({run,capabilities?,downloadMedia?})` exposes offline
`validate`, `prepare`, `submit`, `status`, `download`, `graph`, `versions`, `selectVersion`.
`prepare` queries Canvas capabilities unless a fixture provider is injected, then
performs dry-run. After the durable claim, `submit` uses apply and dispatch. An unconfirmed apply/dispatch retains the known
node ID for inspection; there is no fallback to Create and no automatic retry.
`READY`, `BLOCKED`, and `METADATA` are not completion. An unchanged or missing
selected history cannot complete a new intent. A completed candidate still needs
technical, creative, continuity and audio review in the shared core.

`selectVersion` calls the documented `node version apply`, treating `applied:false`
as an already-current successful no-op. It then reads the graph to get the new
edit version. It does not redispatch or invalidate downstream nodes itself.

Canvas's default download transport uses an absolute HTTPS media URL returned by
the current known node, through Node `fetch`; it never interprets a history/node
ID as a Create media ID. `downloadCanvasSelection` also serves human selections
imported from Canvas without a generation intent:

```js
import { downloadCanvasSelection } from './src/canvas.mjs';
const result = await downloadCanvasSelection(
  {
    project_id,
    node_id,
    history_id,
    context,
    destination: outputDirectory,
    kind: 'video',
  },
  { run, downloadOptions: { fetchImpl: fixtureFetch } },
);
```

The helper reads the selected history before and after transferring its media.
When `node get` lacks a derived state, it checks the documented graph status. A
history or URL change blocks completion and retains downloaded bytes for review.
Results include path, SHA256, bytes and the exact history ID. IDs remain strings.
This verifies the downloaded selection, not which generation request created it.

`src/media-download.mjs` bounds transfers to 256 MiB and 120 seconds by default.
`downloadOptions` can set `maxBytes`, `timeoutMs`, `maxRedirects`, `reserveBytes`,
`fetchImpl` and test filesystem operations. HTTP, embedded URL credentials,
insecure redirects, invalid/oversized Content-Length, excess streamed bytes,
truncation, empty content and non-media responses are rejected. No OAuth token
or authentication headers are sent to the URL. The destination is a directory;
safe generated filenames use a hash of project/node/history/context. Atomic
hardlink publication refuses files, directories and symlinks already occupying
that filename. Failure cleans only this operation's new staging files. Existing
user files remain intact. Storage exhaustion and unsupported hardlinks report an
error without generating media. Relative Graph media paths are not converted
into invented HTTP endpoints; if no HTTPS `url` accompanies them, a fresh
documented node/version lookup is required.

`downloadMedia` remains injectable for other verified finishing transports. It
must follow the same no-overwrite/no-generation contract.

### Human editing and synchronization

`mergeCanvasGraph({base,local,remote,managedNodeIds})` compares complete graph
snapshots from the previous sync, local changes, and current remote state. Nodes
are keyed by string ID; individual object fields merge independently. Arrays are
atomic fields. Remote-only nodes, layout and metadata survive. Local mutation of
unmanaged nodes is a conflict. `source_type` never proves agent ownership.
Ownership is source `agent` or nonempty agent-patch metadata.

The return is:

```js
{
  graph, conflicts:[{path,reason,base,local,remote,node_id?}],
  adopted_versions:[{
    node_id,history_id,previous_history_id,file_path,
    source:'canvas_human_selection',requires_qa:true,
  }],
  stale_node_ids, patch, requires_resolution,
}
```

A same-field concurrent edit preserves the remote value while unresolved and
returns no patch. Remote selected-history changes are import candidates with QA
required. Dependants become stale; stale never grants generation permission.
Local history changes require the version-apply operation. Local dependency
changes require explicit Graph node recreation and return a conflict. The adapter
never silently deletes/recreates nodes or reuses soft-deleted IDs. The patch
exporter supports documented top-level authoring fields and rejects attempted
local changes to raw server-only fields instead of discarding them. A caller
must resolve raw-to-authoring fields explicitly if the server Graph uses another
layout.

## Evidence, tests and limits

Run `node --test production-core/test/adapters.test.mjs production-core/test/media-download.test.mjs production-core/test/presets.test.mjs` from the repository.
Fixtures are capability responses, not evidence of media quality. Their sources
and versions are recorded in `test/fixtures/ADAPTER-SOURCES.json`. Tests use an
injected runner and perform no live mutations or downloads.

The public contract was rechecked on 2026-10-16 against the
[official Canvas capability](https://github.com/PixVerseAI/skills/blob/6f2c5641031f3d3bd2e54db5280dec735ce94eb3/skills/capabilities/canvas.md),
[execution contract](https://github.com/PixVerseAI/skills/blob/6f2c5641031f3d3bd2e54db5280dec735ce94eb3/skills/references/execution-contract.md),
and [CLI changelog](https://github.com/PixVerseAI/cli/blob/86d5ec07f33c7ab8e503019b8f6161f698e042a0/CHANGELOG.md).
The installed CLI 1.4.8 help confirmed status/download argv, patch argument shape,
voice no-wait/JSON and request tracing. No authentication change was made.

Live generation, real media download, output quality, costs, account-specific permissions and
Canvas dispatch-result/task-history attribution have not been tested. Concurrent
human version switches can change the current history independently of the
submitted intent; current-history detection alone cannot prove which generation
request produced it. Such candidates require sync/provenance review before use.
Ordered template input/output contracts are verified separately below. Strict speech/lip
synchronization still requires a route-specific verified contract; image-to-video
behavior does not establish exact dialogue synchronization.

## Conditional preset candidates and execution

`src/presets.mjs` keeps MiniApps and templates outside model-based Create. A
preset generation is `{backend:'preset',mode:'miniapps'|'template',model:null,
preset_id,output_kind,parameters,inputs,preset_snapshot}`. The snapshot contains
`info`, the exact `context`, and `cli_version`. It can include `available` from
the account catalog and a local `analysis`; these are internal fields and never
sent as provider parameters. Use the normal shared ledger, bound approval and
budget before calling the adapter.

`planPresetCandidates({requirements,templates,miniapps,cli_version})` is pure and
makes zero provider calls. Each item wraps a saved `info` snapshot, optional
parameters and existing inputs. It compares output kind, fixed duration, aspects,
editable shots, local replacement, intermediate assets, continuity controls and
explicit requirement IDs. Missing or unverified controls remain unknown; a preset
name never proves matching identity, voice or semantic intent. Unknown account
availability requests discovery. No candidates supplied returns read-only
list→info commands. Candidate selection is never execution permission.

Evidence-backed local analysis has this shape:

```js
{
  evidence:{source:'saved info plus operator inspection',info_sha256:presetSnapshotHash(info)},
  semantic_fit_confirmed:true, confirmed_requirements:['opening-montage'],
  continuity_controls:['appearance-reference'],
  output:{kind:'video',fixed_duration_ms:5000,aspects:['9:16'],
    editable_shots:false,local_replacement:false,intermediate_assets:[]},
}
```

Analysis is bound to the exact snapshot hash. It records inspected constraints;
it cannot guarantee generated creative quality. Requirements use `output_kind`,
`duration_ms`, `aspects`, `requires_editable_shots`, `requires_local_replacement`,
`requires_intermediate_assets`, `continuity_controls`, `requirement_ids`, `intent`
and `context`. A mismatch rejects that preset. A missing fixed-duration contract
stays unknown instead of assuming an output override is possible.

`resolvePresetIntent`/`createPresetAdapter().validate` return resolved parameters
for hashing before approval. `createPresetAdapter({run,infoProvider?})` provides
submit/status/download. Before submitting, it checks the installed CLI version and
re-reads info, rejecting changed schemas. `infoProvider` is an offline fixture
injection. The runner signature is the same as Create; `--version` returns
`stdout:'1.4.8'` in a fixture. Real status/download always use the retained
provider identity and never create replacements.

MiniApps use their published flattened `params_schema`. The validator checks
required fields, enum values, text length, upload count and declared video size.
Unknown parameter types fail closed. Upload values require existing media-path
snapshots with the same context; local files and URLs become upload prerequisites
in a plan rather than triggering an implicit upload. MiniApps have no documented
idempotency flag. An ambiguous request is returned once for the durable core to
block and reconcile. Subsequent task/asset commands retain `project_id` with
`--type miniapps`. Completion inspects the first video, otherwise first image,
as the primary output. Missing inspection remains pending; a mismatched output
kind is surfaced. MiniApp output kind requires snapshot-bound analysis evidence,
since the normalized input schema does not establish an output kind.

The legacy template path supports the verified CLI 1.4.8 and 1.4.9
`effect_type`/`template_type` schema. It validates image counts or the supported
video alternative, preserves order, derives image/video output and uses the
intent's stable idempotency key. Arbitrary output overrides are rejected.

The ordered path is verified against the official
[CLI 1.4.9 source](https://github.com/PixVerseAI/cli/blob/86d5ec07f33c7ab8e503019b8f6161f698e042a0/dist/index.js),
[README](https://github.com/PixVerseAI/cli/tree/86d5ec07f33c7ab8e503019b8f6161f698e042a0#templates)
and [changelog](https://github.com/PixVerseAI/cli/blob/86d5ec07f33c7ab8e503019b8f6161f698e042a0/CHANGELOG.md).
The retrieved `dist/index.js` is 1,149,399 bytes with SHA-256
`ad2cef6c3b26157aa00125f8393346faa4fab97b631479093c3c0c99b31a5d54`;
the isolated executable is byte-identical. The pinned commit, digest and
sanitized read contract are retained in the neutral fixture.

`template_source:21|22` selects this path; legacy `effect_type` never determines
its input count. `input_fields` is the ordered schema. Each field has
`content_type:'image'|'video'|'text'`, optional `name`/`node_id`, `required`
(defaults to required unless exactly false), and positive optional `max_size`
(bytes), `min_duration`/`max_duration` (seconds). The CLI supports at most one
video field and one text field. Reference snapshots must match the context,
kind, declared byte limit and video duration limits before submission.

Image inputs reserve enough values for required fields, then fill optional
fields from left to right. An explicit empty image argument is retained only
when it describes the same representable mapping. For example optional→required
accepts `image:['', 'required.png']`; skipping an earlier optional field to fill a
later optional field is rejected. References can identify a field with the
internal `parameter` equal to its exact `node_id` or unique `name`, or follow the
existing `binding.order`. `video` and `prompt` require corresponding fields.
Omitted text uses the template default as the official CLI does. Text beyond
5000 Unicode characters is rejected instead of silently truncated.

Fixed settings reject `quality`, `duration`, `aspect_ratio`, `seed`, `count`,
`off_peak`, **and `idempotency_key`**. The adapter does not inject any of them.
`info.fixed_cost` is required as a current credit quote; an approved
`upper_credits` below it blocks planning/submission. The entire exact info
snapshot, including input constraints, declared `output` metadata and cost, is
bound into the plan and compared again immediately before the create command.
`output` describes the preset's declared media kinds, dimensions and duration;
these are compared to requirements and are never rewritten by local analysis.
They are metadata, not evidence of actual generated quality. The cost quote is
never copied into per-output `cost_credits`; actual billing remains unknown until
provider evidence is available.

The submission result is `outputs:[{media_id,media_type:'image'|'video'}]`.
All valid IDs and their individual kinds are recorded, including mixed image/video
outputs. Error envelopes can carry `valid_outputs` and `response.outputs`; valid
siblings survive a malformed result and the error preserves uncertainty. A valid
ID with an unverified media type is retained for explicit reconciliation.
Resume and download use each saved output's kind. Failed local storage, timeout,
or malformed output never triggers another create request. Since fixed templates
reject a provider idempotency key, the shared durable claim and unresolved-job
block are essential; an unknown submission requires provider-history reconciliation.

The installed global CLI is 1.4.8. Its read-only `template info` already exposes
ordered metadata, but its generation implementation does not support the new
path; the adapter rejects an ordered submission through 1.4.8. CLI 1.4.9 was
also executed from an isolated directory using existing dependencies, without
changing the global installation. Its `--version` and read-only `template info`
were verified. Select an installed, verified 1.4.9 executable with `PIXVERSE_BIN`
and capture its exact version in the preset snapshot. A change to the executable
or schema requires a new plan. Future CLI versions require contract verification.

Read-only catalog and detail queries succeeded on 2026-10-16. One current ordered
template exposed two required image fields, a declared 720×1280, 10-second video,
and a quote of 220 credits. This proves discovery access at that time, not
paid generation or creative quality. Tracked fixtures replace all account,
author, template/media IDs and asset values with neutral synthetic data; see
`fixtures/ordered-template-contract.json`. Its `live_read_contract` retains the
observed two-required-image shape, exact field types/constraints and output
metadata. Its separate `info`/response objects are synthetic exercises of the
source-verified optional/image/video/text and output contracts, rather than
claimed provider result captures. The tests cover optional/required
mapping, slot limits, quote/schema/version drift, fixed-control rejection, mixed
IDs, process restart and storage-failure recovery with exactly one create call.
No live generation, authentication change or paid call was made.

See also the [official MiniApps contract](https://github.com/PixVerseAI/skills/blob/main/skills/capabilities/miniapps.md)
and [legacy template contract](https://github.com/PixVerseAI/skills/blob/6f2c5641031f3d3bd2e54db5280dec735ce94eb3/skills/capabilities/template.md).
