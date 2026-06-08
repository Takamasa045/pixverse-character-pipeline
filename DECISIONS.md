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
- Use `create speech` or `audioFile` for narration.

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
