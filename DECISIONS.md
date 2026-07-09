# DECISIONS.md

このファイルは、この repo の判断履歴を残す場所です。

新しい判断は上に追記します。長い議論ではなく、後から AI エージェントが「なぜそうなっているか」を読める粒度にします。

## How To Write

各 entry は次の形にする。

```md
## YYYY-MM-DD - Short decision title

Status: accepted | proposed | superseded

Decision:
- ...

Reason:
- ...

Impacted files:
- ...

Follow-up:
- ...
```

## 2026-07-09 - Codify reusable lessons into `references/`

Status: accepted

Decision:

- Adopt the Shotpack pattern: reusable operational lessons are written into tracked `references/`, not left only in chat, private memory, or raw `output/runs/`.
- Add `references/credit-estimation.md` for planning estimates and post-run calibration.
- Add `references/exit-codes.md` for timeout / auth / credit / generation / validation handling.
- Add `references/lesson-codification.md` plus Loop 10 as the promotion workflow.
- Keep `references/model-support.md` as the only model table. Do not split a second model matrix into `model-constraints.md`.
- Keep unfinished work in `NEXT_ACTIONS.md` and durable policy changes in `DECISIONS.md`.

Reason:

- Shotpack already treats measured credit rows, exit contracts, and model limits as source-of-truth references that agents recalibrate after real runs.
- Character pipeline had strong run-review docs, but durable operational knowledge still risked staying in session notes.
- OSS safety still applies: promote generalized rules, never account balances, private paths, or raw logs.

Impacted files:

- `references/credit-estimation.md`
- `references/exit-codes.md`
- `references/lesson-codification.md`
- `LOOPS.md`
- `AGENTS.md`
- `SKILL.md`
- `CHECKS.md`
- `VISION.md`
- `agents/pixverse-production-agents.md`
- `references/pixverse-best-practices.md`

Follow-up:

- After the next measured full run, calibrate remaining provisional rows in `references/credit-estimation.md` using public-safe per-job costs.
- If pipeline runtime gains exact credit estimation, replace the job-count-only preflight with that estimate while keeping this table for planning.

## 2026-07-09 - First Loop 10 calibration from local run evidence

Status: accepted

Decision:

- Calibrate `references/credit-estimation.md` with measured job payload rates:
  - `v6` 720p with audio: `10 cr / sec`
  - `pixverse-c1` 720p no audio: `8 cr / sec`
  - `create extend` `v6` 720p with audio: `10 cr / sec`
- Expand `references/final-video-qa-gate.md` with identity-vs-gear, scale-without-text, action causality, audio loudness thresholds, pre-credit gate, and common fix map.
- Expand `references/prompt-library.md` with production lessons for identity anchors, scale markers, action causality, category negatives, reference lock, start-frame design, and no burned-in text.
- Keep source evidence in ignored `output/`; promote only generalized public-safe rules.

Reason:

- Local QA and create payloads already contained reusable lessons and measured costs.
- Waiting for a new paid run would leave agents repeating known failures.
- Account balances and private paths stay out of tracked docs.

Impacted files:

- `references/credit-estimation.md`
- `references/final-video-qa-gate.md`
- `references/prompt-library.md`
- `references/pixverse-best-practices.md`
- `CHECKS.md`
- `NEXT_ACTIONS.md`

Follow-up:

- Still provisional: image generation, `create voice`, upscale, 1080p bands, and third-party video models.

## 2026-07-04 - Upgrade runtime wrappers to PixVerse CLI 1.2.x

Status: accepted

Decision:

- Pin the repo-local PixVerse CLI to `pixverse@^1.2.7`.
- Replace the removed `create speech` runtime path with `create voice` audio assets layered through Remotion `narrationSrc`.
- Add `voiceId` as the PixVerse preset voice field; keep legacy `ttsSpeaker` / `tts_speaker` loading only for backward-compatible config parsing.
- Keep `speechJobs` as a legacy plan alias while adding `voiceJobs` for the current CLI terminology.

Reason:

- PixVerse CLI `1.2.0` removed `create speech` and added `create voice` / `create music`.
- Treating old numeric `ttsSpeaker` values as `--voice-id` would be unsafe because CLI 1.2 voice IDs are PixVerse preset IDs.
- Separate audio assets fit the pipeline's Remotion timeline and avoid mutating generated video clips for narration.

Impacted files:

- `remotion/package.json`
- `remotion/pnpm-lock.yaml`
- `remotion/src/lib/pixverse.ts`
- `remotion/src/lib/pipeline.ts`
- `remotion/src/lib/config.ts`
- `remotion/src/lib/manifest.ts`
- `remotion/src/lib/planner.ts`
- `README.md`
- `README.ja.md`
- `SKILL.md`
- `references/model-support.md`
- `references/pixverse-best-practices.md`

Follow-up:

- Add direct pipeline support for `create music` only if config-level BGM generation becomes a real requirement.

## 2026-07-04 - Focus production routing on PixVerse CLI

Status: accepted

Decision:

- Add a CLI production routing layer that chooses PixVerse command family, model candidates, batch pattern, post-process steps, audio steps, and QC before prompt writing.
- Keep `references/model-support.md` as the only model table.
- Remove Canvas / Mini Apps from the repo-local best-practice surface for now.
- Add reusable templates for brief, shotlist, CLI batch plan, generation plan, QC report, and accepted-output post package.

Reason:

- The repo should be a PixVerse CLI production operation workspace, not only a prompt collection.
- Existing defaults still matter: normal character-image workflows stay `single` -> I2I -> V6, while story / teaser / trailer uses per-cut reference clips.
- Public OSS docs must avoid private run logs, account state, campaign data, and raw generated output.

Impacted files:

- `references/model-routing.md`
- `references/pixverse-best-practices.md`
- `agents/pixverse-production-agents.md`
- `templates/*`
- `README.md`
- `README.ja.md`
- `SKILL.md`
- `LOOPS.md`

Follow-up:

- Refresh `references/model-support.md` separately when doing a PixVerse CLI compatibility pass.

## 2026-06-15 - Add optional Michibiki export and handoff

Status: accepted

Decision:

- Keep Michibiki integration optional and opt-in through `export`, `--michibiki-handoff`, and `--run-michibiki`.
- Use `export --engine remotion|hyperframes|editframe|auto` as the Shotpack-like path for generating downstream video projects in Michibiki.
- Write Michibiki-compatible `VideoSpec` files under the ignored run output, not tracked docs.
- Prefer Editframe as the handoff default because PixVerse outputs are finished video assets that usually need timeline editing or repurposing.

Reason:

- PixVerse Character Pipeline should remain the generation/render source of truth.
- Michibiki should receive a clean downstream handoff without changing the normal pipeline or spending extra PixVerse credits.
- Remotion / HyperFrames / Editframe project generation belongs in Michibiki when the user wants engine routing or downstream video project scaffolding.
- Public docs can explain the integration without exposing local absolute paths or private generated output.

Impacted files:

- `remotion/src/lib/michibiki.ts`
- `remotion/src/lib/pipeline.ts`
- `remotion/src/cli/pipeline.ts`
- `README.md`
- `README.ja.md`

Follow-up:

- If Michibiki expands `VideoSpec` aspect-ratio support, remove or reduce skipped handoff variants.

## 2026-06-08 - Treat operating docs as public OSS workflow

Status: accepted

Decision:

- Keep `VISION.md`, `AGENTS.md`, `CHECKS.md`, `LOOPS.md`, `DECISIONS.md`, and `NEXT_ACTIONS.md` public-safe.
- Treat them as contributor / maintainer workflow, not private memory.
- Keep the repo core focused on the PixVerse character pipeline.
- Keep content repurposing as an optional generalized loop.
- Do not promote raw `output/` or `output/runs/` logs into tracked docs without summarizing and removing private context.

Reason:

- This repository is already published as OSS.
- Public docs should help external contributors and future agents without exposing personal operation details, private assets, or account state.

Impacted files:

- `VISION.md`
- `AGENTS.md`
- `CHECKS.md`
- `LOOPS.md`
- `NEXT_ACTIONS.md`

Follow-up:

- Consider moving public backlog items to GitHub Issues once they become concrete contributor tasks.

## 2026-06-08 - Add project operating OS files

Status: accepted

Decision:

- Add `VISION.md`, `CHECKS.md`, `LOOPS.md`, `DECISIONS.md`, and `NEXT_ACTIONS.md`.
- Extend `AGENTS.md` without replacing its existing PixVerse pipeline instructions.
- Keep the first pass as documentation and operating structure only.
- Do not run PixVerse generation while drafting the operating OS.

Reason:

- The repo already has a strong execution surface, but the ongoing loop needs explicit purpose, checks, decisions, and next actions.
- AI agents need a stable place to recover context before editing or spending credits.

Impacted files:

- `VISION.md`
- `AGENTS.md`
- `CHECKS.md`
- `LOOPS.md`
- `DECISIONS.md`
- `NEXT_ACTIONS.md`

Follow-up:

- Keep content operations optional and generalized unless a downstream private workspace owns specific event or campaign details.

## 2026-06-06 - Use deterministic PixVerse idempotency keys

Status: accepted

Decision:

- Full `run` supplies deterministic PixVerse `--idempotency-key` values for create jobs.
- Key scope includes project slug, run-id, language, aspect ratio, clip id, stage, and command args.

Reason:

- Retrying the same run should not silently double-spend credits.
- Edited prompts or configs should still create fresh jobs.

Impacted files:

- `remotion/src/lib/pixverse.ts`
- `remotion/src/lib/pipeline.ts`
- `remotion/src/test/pixverse.test.ts`
- `README.md`
- `README.ja.md`
- `SKILL.md`
- `references/model-support.md`

Follow-up:

- Keep reporting run-id and job counts before any full `run`.

## 2026-06-06 - Keep PixVerse CLI as repo-local preferred binary

Status: accepted

Decision:

- `./bin/pipeline` prefers `PIXVERSE_BIN` when set.
- Otherwise it uses `remotion/node_modules/.bin/pixverse` before falling back to `pixverse` on `PATH`.

Reason:

- The pipeline should use the repo-pinned PixVerse CLI for reproducibility.
- A global CLI may be newer, older, or authenticated differently.

Impacted files:

- `remotion/src/lib/pixverse.ts`
- `README.md`
- `README.ja.md`
- `AGENTS.md`

Follow-up:

- On CLI refresh, verify both package version and actual help output.

## 2026-06-06 - Default character image workflow to I2I then I2V

Status: accepted

Decision:

- Attached character images default to `speaker.mode: single`.
- The default path is PixVerse `create image` with `generation.image.model: gemini-3.1-flash` and `generation.image.quality: 1080p`, then `create video --image` with `generation.model: v6`.
- Do not switch to `source: reference` only because images are attached.

Reason:

- The normal announcement workflow needs a stable shared base and predictable multi-locale output.
- Reference mode is better reserved for story / teaser / trailer / multi-cut work.

Impacted files:

- `README.md`
- `README.ja.md`
- `SKILL.md`
- `references/interactive-questions.md`
- `references/prompt-library.md`
- `remotion/src/lib/config.ts`

Follow-up:

- Keep `references/model-support.md` current as PixVerse model support changes.

## 2026-06-26 - Visible character clips require reference-match QA

Status: accepted

Decision:

- Any generated or reference clip with a visible character must be compared against the source reference image before acceptance.
- Character identity is a hard gate: if age, body type, hair, outfit, face, or key props drift into a different person, the clip fails even when action, setting, or story causality is correct.
- Reviews for visible-character clips should record the reference-match criteria that passed and any accepted minor differences.

Reason:

- A Yamamba spray-shot revision fixed spray causality but drifted from the small vine-haired reference character into a different adult woman.
- Action continuity alone is not enough for character-video quality.

Impacted files:

- `CHECKS.md`

Follow-up:

- Regenerate the Yamamba spray cut and accept it only after side-by-side reference QC.

## 2026-06-06 - Use `source: reference` for story / teaser / trailer

Status: accepted

Decision:

- Story, teaser, trailer, and multi-cut requests should be broken into 3-5 beats.
- Each beat should usually become a `source: reference` clip.
- `generation.referenceModel` defaults to `v6`; use `pixverse-c1` only when there is a specific cinematic reference reason.

Reason:

- Strong scene changes are not well represented by one shared generated base clip.
- Per-cut prompt and camera work give better control.

Impacted files:

- `SKILL.md`
- `README.md`
- `README.ja.md`
- `references/prompt-library.md`
- `fixtures/reference-story/project.yaml`
- `remotion/src/lib/story.ts`

Follow-up:

- Add sample outputs when a real generated story run is approved.

## 2026-06-06 - Treat `create sound` as removed

Status: accepted

Decision:

- Do not call PixVerse `create sound`.
- Use `generation.generateAudio` to map to `--audio` or `--no-audio` on supported generation commands.
- Use `create voice` or `audioFile` for narration.

Reason:

- Recent PixVerse CLI removed `create sound`.
- The pipeline should keep sound job count at 0 and avoid stale commands.

Impacted files:

- `references/model-support.md`
- `references/pipeline-diagram.md`
- `remotion/src/lib/planner.ts`
- `remotion/src/lib/pixverse.ts`

Follow-up:

- Re-check this on future CLI refreshes.
