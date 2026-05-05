# AGENTS.md

This repository is designed to work with both Codex and Claude Code.
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

`pnpm install` installs the repo-pinned PixVerse CLI (`pixverse@^1.1.6`). If `PIXVERSE_BIN` is set, it wins; otherwise `./bin/pipeline` prefers `remotion/node_modules/.bin/pixverse` and then `pixverse` on `PATH`.

## Standard Workflow

1. Turn the user request into `project.yaml`
2. Run `./bin/pipeline validate --config <path>`
3. Run `./bin/pipeline plan --config <path>`
4. Run `./bin/pipeline run --config <path> --dry-run`
5. Run `./bin/pipeline run --config <path>` or `render`

## Clip Modes

- `generated`: shared I2V pipeline. Can use PixVerse TTS, `audioFile`, or be silent.
- `reference`: per-cut PixVerse reference generation for story / teaser / trailer workflows. Uses `generation.referenceModel` (`pixverse-c1` by default), not the shared `generation.model`.
- `video` / `image`: local assets only.

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
- Do not assume ElevenLabs. Speech comes from PixVerse `create speech` or from `audioFile`.

## Tool Notes

- Codex users should rely on this `AGENTS.md`.
- Claude Code users should rely on `CLAUDE.md`.
- `.claude/launch.json` and `.claude/settings.local.json` are optional local helpers, not runtime requirements.
