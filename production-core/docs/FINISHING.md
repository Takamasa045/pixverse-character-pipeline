# Local editing and delivery

`src/finish.mjs` assembles existing, reviewed material with the installed FFmpeg and FFprobe. It never calls PixVerse, generates replacement media, installs software, or deletes existing source material. The same module ships in both skill repositories.

Run from the repository root:

```sh
node production-core/src/cli.mjs finish production.json --takes takes.json --out ./deliveries --dry-run
node production-core/src/cli.mjs finish production.json --takes takes.json --out ./deliveries
node production-core/src/cli.mjs finish production.json --takes takes.json --out ./deliveries --variant ja-wide
```

The CLI requires a validated production document. Paths in the document and take list resolve relative to that production file. The library API also supports `baseDir`, explicit `ffmpeg`/`ffprobe` executables, `phase: 'rough' | 'final'`, `variantIds`, and a ledger `cost_report`. Dry-run reads and probes source files and returns intended paths, without writing files or invoking generation adapters.

## Timeline contract

Times are integer milliseconds. A delivery can override `timeline.clips`, `timeline.audio`, and/or `timeline.captions` independently. Otherwise it uses the production timeline. Items with `locale`, `delivery_id`, or `variant_id` are included only in the matching delivery. Unscoped items are shared.

```json
{
  "fps": 30,
  "clips": [
    {"shot_id":"arrival","take_id":"take-2","source_in_ms":500,"duration_ms":1800,"audio":false},
    {"shot_id":"smile","take_id":"take-5","source_in_ms":0,"duration_ms":2200,"audio":true,"volume":0.7}
  ],
  "audio": [
    {"asset_id":"narration-ja","start_ms":0,"source_in_ms":0,"duration_ms":4000,"volume":0.8,"locale":"ja"}
  ],
  "captions": [
    {"start_ms":0,"end_ms":1800,"text":"到着しました。","locale":"ja"}
  ]
}
```

Supported operations are hard cuts, source trims, still-image holds, proportional fit with black padding, explicit output dimensions/fps, native source audio opt-in, timed audio tracks with gain, and UTF-8 SRT sidecars. Native audio is muted unless the clip explicitly sets `audio: true`; `false` stays false. A missing native audio stream blocks an explicitly audible clip. Soundtrack gain is linear, 0–4; mixing does not promise a loudness target or prevent clipping. The requested video dimensions must be even and match the declared aspect ratio. Clip lengths must sum to the requested duration for each selected delivery. Images require `source_in_ms: 0`.

Dissolves, speed changes, crops, effects, audio loops/fades, caption styling, positioned captions and subtitle burn-in are blocked with specific issue codes. They are not silently flattened. A sidecar does not establish on-screen subtitle safe areas or typography; use another verified finishing adapter when those are required. Arbitrary NLE project interchange, motion graphics and strict speech synchronization are outside this adapter.

## Acceptance and file gates

Every visual take must belong to the project and shot, have `status: 'accepted'`, `stale: false`, a real nonempty local file and a matching SHA-256. If a shot has a selected `take_id`, the timeline must use that same take. Technical, creative and continuity QA must each be `pass`; audio must be `pass` or `not_applicable`. QA includes a reviewer and notes. Audio assets require the same QA evidence and a matching local hash. Missing files, changed content, unknown QA, stale takes, out-of-range edits and unsupported processing block output. A remote provider ID alone is not a re-editable local delivery.

`inspectDelivery(production, takes, options)` returns `{ok, issues, sources}`. `renderDeliveries(...)` throws `DeliveryGateError` with `code: 'DELIVERY_BLOCKED'` and structured issues when gates fail. Sources are rehashed after rendering so a file changed during a render cannot be certified by an old snapshot.

Each render produces a content-addressed MP4, a per-delivery JSON record, an optional SRT, and a `delivery.v1` manifest. The manifest records source hashes and adopted QA, the exact timeline, delivery dimensions/language/fps/duration, FFprobe results, a full decode check, output hashes and cost evidence. `generation_jobs: 0` means this finishing operation submitted no jobs. An absent cost report remains `actual_credits: null`; it does not turn the cost of previously generated media into zero.

`status: 'completed'` means the requested local encoding and technical checks completed. `acceptance: 'pending_creative_delivery_review'` and each output's `creative_delivery_review: 'pending'` deliberately keep the final human viewing gate open. The adapter does not certify identity, acting, pacing, black-frame intent, audio quality, loudness or subtitle appearance from a probe. Watch the assembled output at normal speed before publishing.

The same timeline, specification, source bytes and QA reuse an output only after its MP4 and SRT hashes match the stored record. A subtitle-only change produces a new fingerprint for its affected delivery; other languages can reuse their previous output. A changed source, timeline, QA, dimensions or quality phase creates a separate output. Untracked files and mismatched caches are preserved and reported. A per-output lock prevents concurrent duplicate local encodes. After an interrupted process, an existing lock requires inspection; it is never cleared automatically. Disk/tool failures preserve source media and known provider IDs, and never trigger new generation. Only temporary files created by the current invocation are cleaned up.

## Local changes and time-based issues

`editTimeline(production, {clips?, audio?, captions?})` returns a new production revision and an impact report. It replaces the supplied arrays without mutating the original. `impact.delivery_ids` names the changed variants, while `impact.generate` stays empty. Update the production document with the returned `production`, then render the affected variants.

```sh
node production-core/src/cli.mjs edit production.json --patch captions-patch.json
node production-core/src/cli.mjs issue production.json --start-ms 3500 --end-ms 4100 --kind continuity
```

`locateIssue` maps the half-open edit range `[start_ms, end_ms)` into exact shot/take source ranges. The library accepts `delivery_id` to choose a specific edit. Caption, timing, volume and technical issues propose review of the local edit. Other categories identify candidate shots and propose reviewing references, performance, source audio or takes. These proposals never authorize or submit generation. Any later paid change still passes through the normal plan and approval ledger.

## Verification

```sh
node --test production-core/test/finish.test.mjs
```

The tests create tiny synthetic local media and cover real FFmpeg trims, still holds, audio mixing, explicit audio OFF checked in decoded PCM, SRT, dimensions/fps/duration, full decode, output hashes, language-specific subtitle revisions, reuse, time-range mapping, adoption/hash/stale gates, interrupted locks, source changes during rendering, and failed output/tool writes. They do not claim real PixVerse generation quality or a tested cloud editing route.
