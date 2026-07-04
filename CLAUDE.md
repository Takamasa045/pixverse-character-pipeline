# CLAUDE.md

This repository is designed to work with both Claude Code and Codex.
The runtime itself is tool-agnostic: all execution goes through `project.yaml` and `remotion/./bin/pipeline`.

## First Things To Read

- `README.md` or `README.ja.md`
- `SKILL.md`
- `references/interactive-questions.md`

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
- Full `run` passes deterministic PixVerse `--idempotency-key` values scoped by project/run-id/variant/stage to reduce duplicate credit spend on retries.

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
- Output root and final MP4 paths, when rendered
- `manifest.json` path
- Any failed/skipped variant and exact error string

## Tool Notes

- Claude Code users should rely on this `CLAUDE.md`.
- Codex users should rely on `AGENTS.md`.
- `.claude/launch.json` and `.claude/settings.local.json` are optional local helpers, not runtime requirements.
