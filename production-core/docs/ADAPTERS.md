# Create and Canvas boundaries

The adapters use Node built-ins and CLI argument arrays. They do not call private
HTTP generation endpoints. Import them from `src/pixverse.mjs` and
`src/canvas.mjs`. The executor owns durable reservation, budget approval,
submission states, known provider IDs, and whether an operation may run. Never
call an adapter from a production dry-run.

## Create

```js
import {createPixVerseAdapter,validateCreateIntent} from './src/pixverse.mjs';
const resolved = validateCreateIntent(provisionalIntent,capturedCapability);
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
  run:async (argv,{context}) => ({raw:parsedStdout,exit_code:0,stderr:''}),
  capabilities:snapshotOrModeModelMapOrAsyncIntentFunction,
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
`validate`, `submit`, `status`, `download`, `graph`, `versions`, `selectVersion`.
`submit` queries Canvas capabilities unless a fixture provider is injected, then
uses those three boundaries. An unconfirmed apply/dispatch retains the known
node ID for inspection; there is no fallback to Create and no automatic retry.
`READY`, `BLOCKED`, and `METADATA` are not completion. An unchanged or missing
selected history cannot complete a new intent. A completed candidate still needs
technical, creative, continuity and audio review in the shared core.

`selectVersion` calls the documented `node version apply`, treating `applied:false`
as an already-current successful no-op. It then reads the graph to get the new
edit version. It does not redispatch or invalidate downstream nodes itself.

Canvas has no documented generic media-ID download command. Without an injected
`downloadMedia`, download returns an explicit unsupported-transport result,
keeping the existing node. With it, the adapter reads the current known node and
passes only its newly completed trusted `file_path`, destination and context.
The injected transport must publish without overwrite and never generate media.
Relative Graph media paths are not converted into invented HTTP endpoints.

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

Run `node --test production-core/test/adapters.test.mjs` from the repository.
Fixtures are capability responses, not evidence of media quality. Their sources
and versions are recorded in `test/fixtures/ADAPTER-SOURCES.json`. Tests use an
injected runner and perform no live mutations or downloads.

The public contract was rechecked on 2026-10-16 against the
[official Canvas capability](https://github.com/PixVerseAI/skills/blob/6f2c5641031f3d3bd2e54db5280dec735ce94eb3/skills/capabilities/canvas.md),
[execution contract](https://github.com/PixVerseAI/skills/blob/6f2c5641031f3d3bd2e54db5280dec735ce94eb3/skills/references/execution-contract.md),
and [CLI changelog](https://github.com/PixVerseAI/cli/blob/86d5ec07f33c7ab8e503019b8f6161f698e042a0/CHANGELOG.md).
The installed CLI 1.4.8 help confirmed status/download argv, patch argument shape,
voice no-wait/JSON and request tracing. No authentication change was made.

Live generation, real output quality, costs, account-specific permissions and
Canvas dispatch-result/task-history attribution have not been tested. Concurrent
human version switches can change the current history independently of the
submitted intent; current-history detection alone cannot prove which generation
request produced it. Such candidates require sync/provenance review before use.
Template runtime input sequences, template-specific output kind and strict
speech/lip synchronization need their own discovered contracts and remain
fail-closed. They are not implemented by assuming image-to-video behavior.
