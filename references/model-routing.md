# PixVerse CLI Routing

このファイルは、自然言語の依頼を PixVerse CLI の command family、model candidate、safe execution loop へ落とすためのルーターです。

Research snapshot:

- Checked against official PixVerse CLI / Skills / Platform docs and `pixverse@latest` help on 2026-07-04 JST.
- Current npm latest observed locally: `pixverse@1.2.7`.
- This repo pins `pixverse@^1.2.7` in `remotion/package.json`; runtime narration uses `create voice` audio assets.

## Scope

- CLI production only. Canvas and Mini Apps are intentionally out of scope.
- Runtime truth remains `project.yaml` and `remotion/./bin/pipeline`.
- Model and mode truth is `references/model-support.md`.
- Full `run`, `pixverse create ...`, `task wait` for generated tasks, and `asset download` can consume credits or touch remote assets. Follow `CHECKS.md`.

## Command Family Router

| Intent | Primary CLI command | Model candidate | Repo surface | Use when |
|:---|:---|:---|:---|:---|
| Generate a video from text | `pixverse create video --prompt` | `v6` first | `source: generated` | No fixed visual reference is required |
| Animate one image | `pixverse create video --image` | `v6`; `grok-imagine-1.5` only for image-derived aspect | `source: generated` with I2V | A base still or product/character image should stay visually grounded |
| Create a base still or edited reference image | `pixverse create image --prompt [--image/--images]` | repo default `gemini-3.1-flash`; CLI default `gpt-image-2.0` | `generation.image.*` | Character turnarounds, product stills, environment plates |
| Generate with character references | `pixverse create reference --images` | `v6`; C1 candidate for action/continuity; Seedance for mixed refs | `source: reference` | Story, teaser, multi-subject, or reference-locked cuts |
| Match a motion reference | `pixverse create motion-control --image --video` | `v5.6` | external CLI step, then `source: video` | A character should follow a known motion clip |
| Bridge keyframes | `pixverse create transition --images` | `v6`; `v5` for 3+ frame transition | external CLI step, then `source: video` | First/last-frame or multi-frame transition is the point |
| Modify an existing video | `pixverse create modify --video --prompt` | `v5.5` | external CLI step, then `source: video` | Replace subject, outfit, background, or object at a keyframe |
| Extend a clip | `pixverse create extend --video` | `v6` or `grok-imagine` | post-process step | A good clip needs more duration |
| Upscale a clip | `pixverse create upscale --video` | target quality flag | post-process step | Accepted output needs higher resolution |
| Generate voiceover audio | `pixverse create voice --text` | `speech-2.8-hd` first | local audio asset, then `audioFile` or edit layer | Need separate TTS audio in CLI 1.2+ |
| Generate music | `pixverse create music --prompt` | `music-2.6` first | local BGM asset | Need CLI-produced BGM |
| Create from templates/effects | `pixverse create template` | template-defined | external CLI step, then `source: video/image` | Effect/template output is the intended format |
| Batch and monitor | `--count`, `--no-wait`, `task status --ids`, `task wait` | mode-dependent | operator runbook | Variants should run in parallel under slot/credit control |

## Routing Steps

1. Classify the job: T2V, I2V, T2I/I2I, reference, motion-control, transition, modify, post-process, voice, music, template, or local render.
2. Choose the simplest CLI command that preserves the necessary reference signal.
3. Choose the model from `references/model-support.md`.
4. Decide whether this repo's pipeline can run it directly. If not, treat the CLI result as a generated local asset and feed it back as `source: video`, `source: image`, `audioFile`, or BGM.
5. Before generation, report command family, model, count, quality, duration, audio setting, off-peak setting, and expected asset type.
6. Use `--json`, `--no-wait`, task IDs, and idempotency keys for repeatable agent workflows.
7. Download and inspect assets only after the remote generation has completed.
8. Run machine QA and visual QA before accepting the result.

## Model Routing Rules

### V6

Use `v6` as the default video model for this repo.

Best fit:

- T2V / I2V everyday production.
- Short ads, announcements, explainers, and social variants.
- Reference clips when the current compatible default is enough.
- Extend / transition workflows that should remain within PixVerse's current default model family.

Keep `v6` unless there is a specific continuity, choreography, provider, or mode reason to switch.

### C1 Candidate

Use `pixverse-c1` as a candidate, not as a silent default.

Consider it when:

- the scene depends on physical contact, fast action, fantasy VFX, or transformations
- a storyboard / multi-shot sequence needs stronger continuity
- V6 keeps failing a named character or prop continuity gate

Do not use C1 just because it is newer. For clean product clips, talking-heads, and fast social variants, V6 is usually the more practical first pass.

### Seedance 2.0

Use Seedance candidates when the CLI feature itself matters:

- `seedance-2.0-standard` for higher-quality or 2160p-capable video/reference/transition work
- `seedance-2.0-fast` or `seedance-2.0-mini` for cheaper/faster variant tests
- Seedance reference when you need mixed image/video/audio references in `create reference`

Seedance mixed references can make a workflow more complex. Use them only when image-only reference prompts are not enough.

### Grok Imagine

Use `grok-imagine` when the request values fast creative ideation or the mode specifically supports it.

Use `grok-imagine-1.5` only for image-to-video; it requires `--image` and derives aspect ratio from the input image.

### Veo / Sora / Kling / Happy Horse

Treat these as provider-specific candidates, not repo defaults.

- Use when the user explicitly wants that model family.
- Use when the requested duration, quality, or style fits that model's constraints.
- Keep the output as an external CLI asset unless the pipeline wrapper supports it.

### Image Models

- Repo default for character I2I remains `gemini-3.1-flash`.
- CLI latest default is `gpt-image-2.0`; use it when high-detail still generation and `--detail-level` matter.
- Use `seedream-5.0-lite` or `gemini-3.0` / `gemini-3.1-flash` when you need higher-resolution stills and the model supports the requested ratio.

## CLI Safety Rules

- Always use `--json` for agent-run commands.
- Prefer `--no-wait` for batches, then `task status --ids` or `task wait`.
- Use `--idempotency-key` for any retryable create step.
- Check `pixverse account info --json` and `pixverse account slots --json` before batch generation.
- Do not pass private or confidential local files to `--image`, `--images`, `--video`, `--audios`, or `asset upload`.
- Treat local file upload as remote asset creation.
- Store prompts in files and pass `--prompt -` or `--prompt ./file.txt` when prompts are long.
- Capture stderr separately; stdout must remain parseable JSON.

## CLI Batch Pattern

```bash
pixverse account info --json
pixverse account slots --json

pixverse create video \
  --prompt ./prompts/variant-01.txt \
  --model v6 \
  --quality 720p \
  --duration 5 \
  --aspect-ratio 9:16 \
  --no-audio \
  --no-wait \
  --idempotency-key <stable-key> \
  --json > /tmp/pv-variant-01.json

ID=$(jq -r '.video_id // .video_ids[0]' /tmp/pv-variant-01.json)
pixverse task wait "$ID" --type video --json
pixverse asset download "$ID" --json
```

For this repo's config-driven path, keep using:

```bash
cd remotion
./bin/pipeline validate --config <path>
./bin/pipeline plan --config <path>
./bin/pipeline run --config <path> --dry-run
```

Full `run` requires explicit approval.

## Regeneration Rules

Regenerate only after naming the failed dimension.

| Failure | CLI-first response |
|:---|:---|
| Character drift | Reduce action, strengthen identity, use `create reference --images`, consider C1 only after V6 fails the named gate |
| Prop deformation | Add material, rigidity, attachment, contact points, and negative constraints |
| Motion mismatch | Use `motion-control` if a motion reference exists; otherwise simplify movement |
| Scene transition is weak | Use `transition --images` with first/last frames |
| Clip is too short but good | Use `extend` before regenerating from scratch |
| Resolution is low but accepted | Use `upscale` after visual QA passes |
| Voice/BGM missing | Use `create voice` / `create music` as separate audio assets in CLI 1.2+ |
| Batch duplicates risk credit spend | Add idempotency keys and reuse run IDs |
| Output technically completed but visually wrong | Mark QA FAIL and keep the failed asset as evidence |

## Sources

- Official CLI blog: https://pixverse.ai/en/blog/pixverse-cli-generate-ai-videos-images-from-terminal
- Official CLI repo: https://github.com/PixVerseAI/cli
- Official Skills repo: https://github.com/PixVerseAI/skills
- Official CLI changelog: https://github.com/PixVerseAI/cli/blob/main/CHANGELOG.md
- Official Platform docs: https://docs.platform.pixverse.ai/
