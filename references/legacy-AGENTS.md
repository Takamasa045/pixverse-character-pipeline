# AGENTS.md

This repository is designed to work with both Codex and Claude Code.
The runtime itself is tool-agnostic: all execution goes through `project.yaml` and `remotion/./bin/pipeline`.

This file is also the operating entrypoint for AI agents working in this repo. Keep the PixVerse execution rules below intact, and use the project operating files to preserve context across sessions.

This is a public OSS repository. Write operating notes as contributor-facing documentation, not private memory.

## First Things To Read

- `VISION.md`
- `CHECKS.md`
- `LOOPS.md`
- `DECISIONS.md`
- `NEXT_ACTIONS.md`
- `README.md` or `README.ja.md`
- `SKILL.md`
- `references/interactive-questions.md`

Read only the sections needed for the request, but do not skip `CHECKS.md` before any command that can write output or spend credits.

## Project Operating Loop

Use this loop for non-trivial work:

1. Understand the request and read the nearest source files.
2. Check `VISION.md` for project intent and boundaries.
3. Pick a loop from `LOOPS.md` when the task matches a repeated workflow.
4. Make a short plan before editing or running commands.
5. Use `CHECKS.md` before validation, dry-run, render, submission, or PixVerse generation.
6. Record lasting decisions in `DECISIONS.md`.
7. Record unresolved follow-ups in `NEXT_ACTIONS.md`.
8. When a run yields a reusable operational lesson, codify it into `references/` via Loop 10. Do not leave durable rules only in chat or private memory.

Do not turn every small task into heavy process. For a typo or a narrow docs fix, read the relevant file, patch it, and report the result.

## Operating File Roles

- `VISION.md`: project purpose, audience, values, scope, and success definition.
- `CHECKS.md`: pre-flight, dry-run, render, public submission, and PixVerse credit checks.
- `LOOPS.md`: repeatable workflows for announcement videos, reference stories, local render, CLI refresh, submission, content repurposing, run review, and lesson codification.
- `DECISIONS.md`: append-only record of decisions that should survive the current session.
- `NEXT_ACTIONS.md`: current backlog and blocked items for the next agent or human operator.
- `references/`: public-safe operational truth. Prefer updating these over accumulating private session notes.

Update these files only when the change is meant to affect future sessions. Keep temporary notes in the final response or ignored `output/` files.

## Open Source Safety

- Do not commit PixVerse account data, tokens, credit balances, private paths, or private client/event details.
- Do not promote raw `output/` or `output/runs/` logs into tracked docs without summarizing and removing private context.
- Promote reusable lessons into `references/` as generalized rules, tables, or checklists. Keep unfinished work in `NEXT_ACTIONS.md`.
- Keep `NEXT_ACTIONS.md` public-safe. Use GitHub Issues for external collaboration when an item becomes a real public task.
- Keep content repurposing loops optional and generalized; this repo's core is the PixVerse character pipeline.
- When in doubt, prefer generic examples and neutral fixtures.

## Required Local Setup

```bash
cd remotion
pnpm install
pixverse auth login
```

`pnpm install` installs the repo-pinned PixVerse CLI (`pixverse@^1.2.7`). If `PIXVERSE_BIN` is set, it wins; otherwise `./bin/pipeline` prefers `remotion/node_modules/.bin/pixverse` and then `pixverse` on `PATH`.

## Request Router

- Announcement / multilingual batch: use `source: generated` clips and the shared I2I -> I2V flow.
- Story / teaser / trailer / multi-cut: draft 3-5 beats and use `source: reference` per cut.
- Existing local assets only: use `source: video` / `source: image` and `render`.
- Legacy config: load `spokesperson.yaml`, normalize it, then use the standard workflow.

## Standard Workflow

1. Turn the user request into `project.yaml`
2. Run `./bin/pipeline validate --config <path>`
3. Run `./bin/pipeline plan --config <path>`
4. Run `./bin/pipeline run --config <path> --dry-run`
5. Run `./bin/pipeline run --config <path>` or `render`

## Clip Modes

- `generated`: shared I2V pipeline. Can create PixVerse voice audio from `text`, use `audioFile`, or be silent.
- `reference`: per-cut PixVerse reference generation for story / teaser / trailer workflows. Uses `generation.referenceModel` (`v6` by default; `pixverse-c1` is still a valid override).
- `video` / `image`: local assets only.

## Credit Boundary

- Safe to run before approval: `validate`, `plan`, `run --dry-run`, and local-only `render`.
- Requires explicit user approval: `run` without `--dry-run`, because it can submit PixVerse jobs and consume credits.
- Before batch generation, report planned variants, image/base/reference/voice/upscale job counts, and any obvious credit or slot risk.
- Use `references/credit-estimation.md` for planning estimates. Runtime still uses a coarse job-count gate; agents must report the better estimate before approval.
- Full `run` passes deterministic PixVerse `--idempotency-key` values scoped by project/run-id/variant/stage to reduce duplicate credit spend on retries.
- Retry and exit handling for direct CLI work follows `references/exit-codes.md`.
- Never run PixVerse generation just to verify documentation changes.
- After a substantial run, use Loop 10 / `references/lesson-codification.md` to calibrate credit rows, exit handling, prompt rules, or QA hard-fails when the learning is reusable.

## Recommended Sub-Agent Split

- Coordinator:
  owns `project.yaml`, chooses the mode, and is the only agent allowed to run the final `run` / `render`.
- Story Designer:
  breaks story requests into 3-5 beats and writes prompts for `source: reference` clips.
- Planner / Reviewer:
  runs `validate`, `plan`, and optionally `run --dry-run`, then reports job counts and risks.
- Output QA:
  checks `manifest.json`, output variants, durations, and final files after execution.

## Coordination Rules

- Only one agent edits `project.yaml`.
- Only one agent runs the final PixVerse mutation step for a given config or `run-id`.
- Parallel workers should stay read-only or dry-run-only unless the coordinator explicitly hands off ownership.
- Do not assume ElevenLabs. Narration comes from PixVerse `create voice` audio assets or from `audioFile`.

## Final Report Template

When a run or dry-run finishes, report:

- Config path and run-id
- Variant count and job counts
- Credit estimate from `references/credit-estimation.md` when generation is involved
- Output root and final MP4 paths, when rendered
- `manifest.json` path
- Any failed/skipped variant and exact error string
- Any reusable lesson promoted into `references/`

When documentation or operating files change, report:

- Files changed
- Whether PixVerse generation was avoided
- Verification performed, or why it was not needed
- Any follow-up added to `NEXT_ACTIONS.md`
- Any lesson codified into `references/`

## Tool Notes

- Codex users should rely on this `AGENTS.md`.
- Claude Code users should rely on `CLAUDE.md`.
- `.claude/launch.json` and `.claude/settings.local.json` are optional local helpers, not runtime requirements.
