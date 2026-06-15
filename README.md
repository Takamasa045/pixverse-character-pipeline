# PixVerse Character Pipeline

[日本語](./README.ja.md)

This repository is an agent-first pipeline for generating character videos. Rather than running CLI commands directly, you describe what you want in natural language, and the AI agent normalizes your request into `project.yaml`, then drives PixVerse and Remotion to produce the final MP4.
All image and video generation paths documented in this repo are implemented through PixVerse CLI; Remotion is used for staging and the final render only.

## Agent Compatibility

This repo is meant to work with both Claude Code and Codex.

- The runtime is tool-agnostic: `project.yaml` + `remotion/./bin/pipeline`
- `.claude/*` files are optional local helpers, not required to run the pipeline
- `CLAUDE.md` and `AGENTS.md` document the same workflow from each tool's entrypoint
- A recommended multi-agent split is included for coordinator / story / planning / QA roles

## What It Does

- Turn a character image into a talking character video placed in a photoreal, live-action-style environment
- Batch-process projects from `project.yaml` across multiple locales and aspect ratios
- Mix `generated | reference | video | image` clips in the same timeline
- Turn PixVerse outputs into `manifest.render.json` files and final `character.mp4` renders
- Accept legacy `spokesperson.yaml` as a backward-compatible input format

## How to Ask the Agent

The entry point is a natural-language request, not a command.

```text
Create a Japanese and English announcement video from this character image.
Use a photoreal studio background, both 16:9 and 9:16.
Show me the dry-run plan first.
```

```text
Make a short promo video for a spring campaign using this character.
First clip is PixVerse-generated, last clip uses my endcard.png.
Use assets/bgm.mp3 for background music.
```

```text
Generate a vertical SNS character video from this image, English only.
Urban office-style photoreal background.
```

```text
Reference this character first, then build a 4-cut shrine-at-night story teaser.
Make each cut a different scene, then add BGM and captions in the final render.
```

If information is missing, the agent will ask follow-up questions in this order:

1. Project name and date
2. Character image path(s)
3. Target locales
4. Clip composition per locale
5. Aspect ratios
6. Background style / prompt direction

The goal is to build a valid `project.yaml`, then execute the pipeline.

## Agent Execution Flow

1. Normalize the natural-language request into `project.yaml`
2. Load `project.yaml` (or legacy `spokesperson.yaml`)
3. `validate` the config
4. `plan` to confirm variant and job counts
5. `run --dry-run` if the user wants to review first
6. `run` for full execution (PixVerse generation through final render)
7. `render` for configs using only local `video` / `image` clips

Default behavior for story / teaser / trailer requests:

1. Break the concept into 3-5 story beats
2. Generate each beat independently with `pixverse create reference --images`
3. Add speech per cut with `pixverse create speech`
4. Write those beats as `source: reference` clips in `project.yaml`
5. Use `./bin/pipeline run` to do reference generation, BGM / caption staging, and final render

Default behavior for attached character image(s):

1. Treat it as `speaker.mode: single` by default, even when multiple images are attached
2. Keep `generation.model: v6`
3. Use `generation.referenceModel: v6` for `source: reference` clips; set `pixverse-c1` only when you explicitly want C1-style cinematic reference behavior
4. Keep `generation.image.enabled: true`
5. Default this workflow's `generation.image.model` to `gemini-3.1-flash` and `generation.image.quality` to `1080p` (PixVerse CLI 1.1.12 also supports `gpt-image-2.0`, `qwen-image`, `gemini-3.0`, and Seedream/Kling image models)
6. Start from PixVerse I2I (`create image`) and then run I2V (`create video --image`)
7. Do not switch to `source: reference` or `pixverse create reference` unless the user explicitly asks for a story / teaser / trailer / multi-cut workflow or provides multiple reference images

## Setup

### 0. Clone the Repository

```bash
git clone https://github.com/Takamasa045/pixverse-character-pipeline.git
cd pixverse-character-pipeline
```

### 1. PixVerse CLI

Prerequisites:
- Node.js 20+
- PixVerse account with active subscription

The recommended path is the repo-local CLI installed by `pnpm install` in step 3. If you need a global CLI for manual checks, use:

```bash
npm install -g pixverse
pixverse --version
```

Or use `npx pixverse@latest` to avoid global install.

### 2. Login

```bash
pixverse auth login
```

The CLI displays a URL and code. Authenticate in your browser; the token is saved to `~/.pixverse/` (valid ~30 days).

```bash
pixverse auth status
pixverse account info
```

### 3. Install Dependencies

```bash
cd remotion
pnpm install
```

`pnpm install` installs the repo-pinned PixVerse CLI (`pixverse@^1.1.12`). `./bin/pipeline` uses `PIXVERSE_BIN` when set, otherwise it prefers `remotion/node_modules/.bin/pixverse`, then falls back to `pixverse` on PATH.

## Main Commands

```bash
cd remotion

./bin/pipeline validate --config ../fixtures/generated/project.yaml
./bin/pipeline plan --config ../fixtures/generated/project.yaml
./bin/pipeline run --config ../fixtures/generated/project.yaml --dry-run
./bin/pipeline story --image ../fixtures/shared/assets/speaker.svg --config-out ./story.yaml
./bin/pipeline render --config ../fixtures/basic/project.yaml --lang en --ratio 16:9
```

- `validate`: normalize and validate config input
- `plan`: inspect variant counts and job counts
- `run`: PixVerse generation → render manifests → final MP4s
- `story`: interactively build a reference-story `project.yaml`, then optionally `dry-run` or `run`
- `render`: render a single variant using only local clips

Full `run` uses PixVerse `--idempotency-key` for create jobs. The key is derived from project slug, run-id, variant, stage, and command args, so retrying the same `--run-id` is less likely to spend credits twice while edited prompts/configs still create fresh jobs.

`pnpm pipeline:*` is available as a convenience alias. Prefer `./bin/pipeline` when shell PATH resolution is unreliable.

## `project.yaml` Shape

```yaml
project:
  slug: my-campaign
  title: Spring Campaign
  date: "2026-03-21"

speaker:
  name: Reporter Hana
  images:
    - ./assets/hana.png
  mode: single

locales:
  ja:
    theme:
      background: "#111111"
      accent: "#ff6b35"
      text: "#ffffff"
    clips:
      - id: intro
        source: generated
        text: 本日のお知らせです
        ttsSpeaker: 1
        durationSeconds: 5
        overlayText: 春のキャンペーン開始
        overlayStyle: title
      - id: teaser-beat
        source: reference
        prompt: The same character from the reference image stands in a moonlit shrine courtyard, slow push in, vertical portrait framing.
        text: 物語の扉が開く。
        ttsSpeaker: 1
        durationSeconds: 4
        overlayText: 物語の扉が開く
        overlayStyle: subtitle
      - id: endcard
        source: image
        asset: ./assets/endcard.png
        durationSeconds: 3
        overlayText: example.com
        overlayStyle: endcard

render:
  aspectRatios: ["16:9", "9:16"]
  fps: 30
  outputDir: ./output

generation:
  model: v6
  referenceModel: v6
  quality: 720p
  upscale: true
  generateAudio: false
  image:
    enabled: true
    model: gemini-3.1-flash
    quality: 1080p
  prompt:
    base: A talking character derived from the provided character image, speaking directly to camera in a photoreal live-action environment with realistic depth and polished cinematic lighting
```

PixVerse uses `generation.prompt.base` / `generation.prompt.perRatio` for shared video motion prompts. The default path is PixVerse I2I then PixVerse I2V: `generation.image.enabled` defaults to `true`, so the pipeline first creates a base still with `generation.image.*`, downloads it locally, then runs I2V from that still. `generation.image.model` is the PixVerse CLI image model name; this workflow defaults to `gemini-3.1-flash` at `1080p`, while PixVerse CLI 1.1.12 also supports current image models such as `gpt-image-2.0`, `qwen-image`, `gemini-3.0`, `seedream-5.0-lite`, and Kling image models. When `generation.image.prompt` is omitted, it falls back to `generation.prompt`. The default video generation profile is `v6` at `720p`.

`source: reference` clips additionally provide a per-cut `prompt` and use `pixverse create reference --images` instead of the shared base-video flow. They use `generation.referenceModel` (`v6` by default; `pixverse-c1` remains available as an override). `generateAudio: true` maps to PixVerse CLI `--audio`; the default `false` maps to `--no-audio`. The legacy `ambientSound` field is accepted as a compatibility alias, but the pipeline no longer calls the removed `create sound` command. `generated`, `reference`, and `video` clips may also set `audioVolume` (`0`-`1`) to rebalance narration or clip audio against BGM.

For the full PixVerse CLI model table, mode matrix, and source reconciliation notes, see [`references/model-support.md`](./references/model-support.md).

## Output Layout

```text
output/<project-slug>/<run-id>/
  manifest.json
  <lang>/<ratio>/
    manifest.render.json
    character.mp4
    assets/*
```

Remotion staging assets are generated automatically under `remotion/public/.pipeline/`.

## Optional Michibiki Export / Handoff

Use `export` when Remotion, HyperFrames, or Editframe project generation should happen in [Michibiki](https://github.com/Takamasa045/michibiki), similar to the PixVerse Shotpack handoff.

```bash
cd remotion
./bin/pipeline export \
  --config ../fixtures/generated/project.yaml \
  --engine remotion
```

By default the export is written under:

```text
output/<project-slug>/michibiki/
  handoff.json
  video-spec.json
  video-specs/<lang>-<ratio>.json
  README.md
```

Add `--run-michibiki` and `--michibiki-path` to ask this pipeline to invoke Michibiki project generation:

```bash
./bin/pipeline export \
  --config ../fixtures/generated/project.yaml \
  --engine remotion \
  --remotion-mode standalone \
  --michibiki-path ../../michibiki \
  --run-michibiki
```

This runs `pnpm michibiki generate --spec ... --engine remotion --remotion-mode standalone` from the Michibiki repository. It does not run Michibiki preview or final render; those remain explicit Michibiki-side steps. Omit `--remotion-mode standalone` if you intentionally want Michibiki to use an external Remotion monorepo.

Use `--michibiki-handoff` when an already planned or rendered PixVerse Character Pipeline output should continue in Michibiki for engine routing, timeline editing, preview, or repurposing.

```bash
cd remotion
./bin/pipeline run \
  --config ../fixtures/generated/project.yaml \
  --dry-run \
  --michibiki-handoff
```

The handoff is written next to the run manifest by default:

```text
output/<project-slug>/<run-id>/michibiki/
  handoff.json
  video-spec.json
  video-specs/<lang>-<ratio>.json
  README.md
```

- `video-spec.json` is the primary Michibiki `VideoSpec`.
- `video-specs/` contains one spec per supported locale / aspect-ratio variant.
- `handoff.json` lists all variants, points back to the PixVerse `manifest.json`, and records the recommended Michibiki commands.
- `--michibiki-handoff-dir <dir>` writes the handoff somewhere else.
- `--michibiki-engine remotion|hyperframes|editframe|auto` changes the recommended engine for run handoffs.

Then run Michibiki from its repository:

```bash
cd ../michibiki
pnpm michibiki decide --spec ../pixverse-character-pipeline/output/<project-slug>/<run-id>/michibiki/video-spec.json
pnpm michibiki generate --spec ../pixverse-character-pipeline/output/<project-slug>/<run-id>/michibiki/video-spec.json --engine editframe
```

Michibiki saves generated projects, previews, and final renders under `outputs/jobs/<job-id>/` in the Michibiki repository. Character Pipeline keeps only the source renders and handoff files under `output/<project-slug>/<run-id>/`.

Dry-runs produce a planned handoff with predicted final MP4 paths. For actual downstream editing, run the handoff after a real `run` or local `render` so the referenced MP4 exists.

## Fixtures / Tests

- `fixtures/basic/project.yaml`: local `video` + `image` render smoke test
- `fixtures/generated/project.yaml`: mixed generated / video / image plan and dry-run fixture
- `fixtures/reference-story/project.yaml`: per-cut `reference` story fixture
- `fixtures/legacy/spokesperson.yaml`: legacy-format compatibility fixture

```bash
cd remotion
pnpm typecheck
pnpm test
```
