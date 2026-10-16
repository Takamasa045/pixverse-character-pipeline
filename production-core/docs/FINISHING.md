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

Supported operations are hard cuts, source trims, still-image holds, explicit rectangular crops, proportional fit with black padding, explicit output dimensions/fps, native source audio opt-in, timed audio tracks with gain, UTF-8 SRT sidecars, and optional basic subtitle burn-in with a supplied font and safe area. Native audio is muted unless the clip explicitly sets `audio: true`; `false` stays false. A missing native audio stream blocks an explicitly audible clip. Soundtrack gain is linear, 0–4; mixing does not promise a loudness target or prevent clipping. The requested video dimensions must be even and match the declared aspect ratio. Clip lengths must sum to the requested duration for each selected delivery. Images require `source_in_ms: 0`.

Dissolves, speed changes, effects, audio loops/fades, arbitrary per-caption styling/position/animation, and overlapping burn-in layers are blocked with specific issue codes. They are not silently flattened. Arbitrary NLE project interchange, motion graphics and strict speech synchronization are outside this adapter.

## Basic safe-area subtitles

Set a delivery's `caption_mode` explicitly: `off`, `sidecar` (the default), `burn_in`, or `both`. Burn-in requires an existing font path and an explicit safe area in output pixels. No font is downloaded or installed. An optional already installed Python 3 + Pillow runtime measures and rasterizes text; FFmpeg overlays those small transparent bitmaps. This also works when FFmpeg was built without drawtext/libfreetype. Missing Python/Pillow or an unsupported font produces a capability blocker before encoding. The normal cut/audio/sidecar path does not require Python or Pillow. The library can select an existing runtime with `options.python`.

```json
{
  "id": "ja-portrait",
  "locale": "ja",
  "aspect": "9:16",
  "width": 1080,
  "height": 1920,
  "duration_ms": 4000,
  "caption_mode": "both",
  "caption_style": {
    "font_path": "./fonts/supplied-font.ttf",
    "font_size": 48,
    "safe_area": {"x": 80, "y": 1380, "width": 920, "height": 300},
    "padding": 16,
    "line_spacing": 10,
    "align": "center",
    "vertical_align": "bottom",
    "color": "#ffffffff",
    "background_color": "#000000cc"
  }
}
```

Safe areas are project requirements, not a claim about every social application's controls. Rectangles must lie inside the output frame. The renderer measures actual multiline glyph bounds, includes padding, and rejects overflow instead of silently shrinking, clipping, wrapping or moving text. Use explicit newlines or revise font size/area after a blocker. Font size is an integer from 1–512; a collection can choose `font_index` (default 0). Supported horizontal alignment is `left`/`center`/`right`, vertical alignment is `top`/`center`/`bottom`. Colors are explicit 6/8-digit hex. Defaults are white text, transparent background, zero padding, 4-pixel line spacing, centered and bottom-aligned. Basic burn-in supports at most 64 nonoverlapping captions per delivery; complex layering needs another adapter. Each caption uses the half-open range `[start_ms,end_ms)`.

The delivery record includes `caption_layout` with the exact font hash, Pillow version, safe area and measured glyph/background rectangles. Those details participate in the fingerprint. A font changed at the same path invalidates the output, and a change during encoding blocks certification. For burn-in, `technical_qc.caption_safe_area: 'geometry_pass_applied'` confirms that the measured text was overlaid in the stated area. A sidecar with `caption_style` can be measured and accompanied by the layout metadata, but reports `geometry_pass_not_applied`; an SRT alone cannot enforce positioning in another player. `off` suppresses both output and font processing. Font coverage, shaping, contrast, reading speed and actual legibility still require the final visual review; a measured box is not a language-quality assessment.

## Explicit vertical/horizontal reframing

Add `crop: {x,y,width,height}` to an individual clip using source pixels. The crop must lie inside the probed source dimensions; FFmpeg applies it before proportional fit/padding. Use a delivery-specific `timeline.clips` for a portrait reframe so the horizontal timeline remains unchanged. Coordinates for rotated metadata are ambiguous; sources with nonzero rotation must be normalized/reviewed before this crop path is accepted. The adapter never guesses a subject position or silently chooses a crop.

Optional `protected_regions` identify required source regions such as a face, hands or logo. Every declared rectangle must lie in the source and remain fully inside the crop. If the requested crop removes one, `CROP_PROTECTED_REGION_CLIPPED` blocks delivery rather than regenerating or automatically recentering a shot.

```json
{
  "shot_id":"arrival", "take_id":"take-2", "source_in_ms":500, "duration_ms":1800,
  "audio":false,
  "crop":{"x":660,"y":0,"width":608,"height":1080},
  "protected_regions":[{"x":720,"y":100,"width":400,"height":800,"label":"Required person"}]
}
```

Crop bounds and declared region containment are technical checks. `framing_review: 'pending_visual_review'` retains the human gate for composition and any important elements the user did not annotate. The source file, adopted take and other variants are preserved. Camera paths, animated reframing, multi-layer composites and arbitrary transforms remain optional external-adapter work.

## Acceptance and file gates

Every visual take must belong to the project and shot, have `status: 'accepted'`, `stale: false`, a real nonempty local file and a matching SHA-256. If a shot has a selected `take_id`, the timeline must use that same take. Technical, creative and continuity QA must each be `pass`; audio must be `pass` or `not_applicable`. QA includes a reviewer and notes. Audio assets require the same QA evidence and a matching local hash. Missing files, changed content, unknown QA, stale takes, out-of-range edits and unsupported processing block output. A remote provider ID alone is not a re-editable local delivery.

`inspectDelivery(production, takes, options)` returns `{ok, issues, sources}`. `renderDeliveries(...)` throws `DeliveryGateError` with `code: 'DELIVERY_BLOCKED'` and structured issues when gates fail. Sources are rehashed after rendering so a file changed during a render cannot be certified by an old snapshot.

Each render produces a content-addressed MP4, a per-delivery JSON record, an optional SRT, and a `delivery.v1` manifest. The manifest records source hashes and adopted QA, the exact timeline, delivery dimensions/language/fps/duration, FFprobe results, a full decode check, output hashes and cost evidence. `generation_jobs: 0` means this finishing operation submitted no jobs. An absent cost report remains `actual_credits: null`; it does not turn the cost of previously generated media into zero.

After decoding, the local quality analyzer records `measurements.black_intervals_ms`, `silence_intervals_ms`, `mean_volume_db` and `peak_volume_db`. Detector settings are included. Digital silence is the measured string `'-inf'`; `null` means unavailable. Mean/peak dB measurements are not integrated perceptual LUFS or a promise of audio quality. Without `delivery.qc`, observations are left for review and do not reject intentional black or silent scenes. Explicit policy keys are `max_black_interval_ms`, `max_silence_interval_ms`, `min_mean_volume_db`, `max_peak_volume_db`, and boolean `expected_audio`. An unsupported policy key blocks preflight rather than being ignored.

```json
{"qc":{"expected_audio":true,"max_silence_interval_ms":1200,"max_black_interval_ms":250,"min_mean_volume_db":-30,"max_peak_volume_db":-1}}
```

Only supplied limits block output, before publication of the completed MP4/manifest. `expected_audio: false` permits intended silence and disables silence/loudness limits; an explicit black-duration limit still applies. `expected_audio: true` checks for an audio stream; require a silence/loudness limit as well when audible content is required. `quality_review` distinguishes observations awaiting review from explicit policy success. These checks do not certify the artistic meaning of black frames or a natural voice, and never request replacement generation.

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

The tests create tiny synthetic local media and cover real FFmpeg trims, still holds, audio mixing, explicit audio OFF checked in decoded PCM, SRT, dimensions/fps/duration, full decode, output hashes, language-specific subtitle revisions, reuse, time-range mapping, adoption/hash/stale gates, interrupted locks, source changes during rendering, and failed output/tool writes. With an existing font/Pillow runtime they also render Japanese/English burn-in over a narration mix, extract decoded pixels before/during/after the caption, and verify no visible text lies outside the safe area. A two-color image proves portrait crop selection while the horizontal output and source remain unchanged; losing an annotated subject blocks delivery. Quality tests verify measured silence, intentionally silent delivery, and explicit black/silence/loudness limits blocking before publication. Optional bitmap tests explicitly skip on hosts without a suitable installed runtime/font; capability-block tests cover the unavailable runtime path. These are local rendering/contract tests, not claims of real PixVerse generation quality.

## Text-only plan preview before generation

`renderPlanPreview(production, {outputDir, fontPath, dryRun, variantId?})` renders
planned shot cards without accepted material. The CLI entry is:

```sh
./bin/production rough-plan production.json --font /path/to/existing-font.ttf --out ./planning-preview --variant ja-wide
./bin/production rough-plan production.json --font /path/to/existing-font.ttf --out ./planning-preview --variant ja-wide --dry-run
```

This is the early check for order and tempo before paying for generated footage.
Every card visibly says `PLANNING PREVIEW | SILENT PLACEHOLDERS` and
`NOT GENERATED | NOT REVIEWED | NOT FINAL`. Cards show the original brief, intent,
shot purpose, entry/exit state, camera, sound intent and planned time range. Sound
intent is text only: the MP4 has no audio stream. The output contains no images,
voices, performances or generated assets. It creates no Store entries, Takes,
acceptance or QA records, and the final finishing gates above remain unchanged.
Its manifest reports `status:'planning_preview'`, `adoption:'not_reviewed'`,
`final_delivery:false`, `generation_jobs:0`, `provider_calls:0` and
`source_media_used:false`.

Choose a variant declared in the brief; multiple declared variants require an
explicit selection. The selected variant's timeline clip order and durations
are used when present, otherwise the planned shot order and edit durations are
used. Every clip must identify a known shot, and their lengths must sum to the
selected requested duration. Source media and timeline audio/captions are never
opened. The preview follows the declared aspect, uses even dimensions with a
maximum edge of 640 pixels, and requires at least 160×90 pixels for text. It uses
the declared integer fps (1–60), or 10 if absent. Cumulative nearest-frame
boundaries avoid drift; planned milliseconds, actual frame boundaries and a
one-frame timing tolerance are recorded. Each card must occupy at least one
frame. The text-only adapter supports at most 100 cards and 10 minutes.

An explicit existing font, Python 3 with Pillow, FFmpeg and FFprobe are required
for rendering; nothing is downloaded or installed. The library may select
existing tools with `python`, `ffmpeg` and `ffprobe`. Text wraps and uses a measured
8–22 pixel font to fit the card. Overflow rejects rather than truncating notes.
Font coverage, shaping and reading comfort still need visual review. The manifest
retains the exact rendered lines, measured glyph boxes, font digest, Pillow
version, input fingerprint, output SHA-256, dimensions, duration and full decode
result. These are technical preview observations, not final creative QA.

Dry-run validates the document, selected duration and existing font bytes, then
returns the intended paths and card specification. It writes no files and starts
zero external processes, including capability probes. It reports
`preview_rendered:false` and `font_layout_verified:false`; text layout and tool
availability remain untested until rendering.

Normal output is content addressed. The same specification and font bytes reuse
an existing result only after the manifest's record hash, exact specification
and MP4 SHA-256 match. Partial output, changed bytes or an existing lock block
without overwriting or removing those files. Rendering uses an exclusive local
lock and a private temporary directory; only that invocation's temporary files
and lock are cleaned. Failed local tools never request generation. Production
data and user source files remain unchanged.

```sh
node --test production-core/test/preview.test.mjs
```

The local tests render two tiny text cards and inspect decoded glyph pixels,
shot changes, duration and absence of audio. They verify zero-process dry-run,
variant selection, duration rejection, hash-checked reuse, source-file/data
immutability, output collision/tampering, lock preservation and failure cleanup.
Rendering tests explicitly skip if an existing font or local tool is absent.
