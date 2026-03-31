# PixVerse CLI Skill Submission

## Recommended Subject

```text
[CLI Feedback/Skill Submission] Takamasa - PixVerse Character Pipeline
```

## Positioning

Submit this as both:

- `Skill Submission`: the repo is an agent-friendly PixVerse workflow
- `CLI Feedback`: it shows a concrete multi-step terminal workflow built on PixVerse CLI

## One-Paragraph Pitch

This repository packages PixVerse CLI into a reusable multilingual character-video workflow for AI agents and terminal-first creators. Its strongest use case is turning a character image into a talking character video placed inside a photoreal, live-action-style background, then combining that with multilingual speech generation and final MP4 rendering via Remotion. The workflow supports multiple locales, multiple aspect ratios, dry-run planning, legacy config compatibility, and deterministic output paths that are suitable for automation and OpenClaw-style agent environments.

## What Makes It Useful

- Agent-friendly entrypoints: `validate`, `plan`, `run`, `render`
- Character-image-to-live-action-scene workflow powered by PixVerse prompts
- Neutral config model: `project.yaml`
- Backward compatibility with legacy `spokesperson.yaml`
- Mixed clip model: `generated | video | image`
- Batch execution across locales and aspect ratios
- Deterministic manifests and output layout for downstream automation
- Local smoke-test path that does not require PixVerse credits

## Verified Workflow

```bash
cd remotion
pnpm pipeline:validate --config ../fixtures/generated/project.yaml
pnpm pipeline:plan --config ../fixtures/generated/project.yaml
pnpm pipeline:run --config ../fixtures/generated/project.yaml --dry-run
pnpm pipeline:render --config ../fixtures/basic/project.yaml --lang en --ratio 16:9
pnpm typecheck
pnpm test
```

## PixVerse CLI Coverage

- `pixverse account info --json`
- `pixverse create image`
- `pixverse create video --image`
- `pixverse create reference --images`
- `pixverse create speech --tts-text`
- `pixverse create speech --audio`
- `pixverse create sound --prompt`
- `pixverse create upscale --quality`
- `pixverse task wait <id> --json`
- `pixverse asset download <id> --dest <dir> --json`

## Suggested Email Body

```text
Hi Naomi,

I’m sharing a PixVerse CLI workflow/skill submission called “PixVerse Character Pipeline”.

It turns a single YAML config into multilingual character videos, with a strong focus on converting a character image into a talking character scene inside a photoreal, live-action-style background. PixVerse CLI handles generated clips, and Remotion handles final rendering. The workflow is designed for terminal-first creators and AI agent environments such as OpenClaw-style automation.

Highlights:
- agent-friendly commands: validate / plan / run / render
- character-image-to-live-action-scene generation as the main creative use case
- neutral YAML schema with legacy config compatibility
- support for mixed generated, video, and image clips
- multi-locale and multi-aspect-ratio batch execution
- deterministic manifests and output structure for automation
- local smoke-test path and dry-run support

Repo summary:
- README includes the workflow and config model
- SKILL.md describes the reusable agent skill
- fixtures cover local render smoke, dry-run planning, and legacy compatibility

Validated locally with:
- typecheck
- automated tests
- local render smoke path

I’d be happy to share more details, generated outputs, or discuss how this could fit advanced PixVerse skills for agent workflows.

Best,
Takamasa
```

## What To Attach

- repo link or zip
- 1 rendered sample MP4 if possible
- short screenshot or terminal capture of `pipeline:plan` / `pipeline:run --dry-run`
- short note explaining OpenClaw / AI agent relevance

## Honest Notes

- Local render and dry-run paths are validated.
- Full PixVerse generation path is implemented, but you should ideally attach one real generated sample before sending.
