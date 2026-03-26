# PixVerse Character Pipeline

[日本語](./README.ja.md)

This repository is an agent-first pipeline for generating character videos. Rather than running CLI commands directly, you describe what you want in natural language, and the AI agent normalizes your request into `project.yaml`, then drives PixVerse and Remotion to produce the final MP4.

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

## Setup

### 1. PixVerse CLI

Prerequisites:
- Node.js 20+
- PixVerse account with active subscription

```bash
npm install -g pixverse
pixverse --version
```

Or use `npx pixverse` to avoid global install.

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

Ensure `pixverse` is on PATH, or set `PIXVERSE_BIN=/path/to/pixverse`.

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
  model: v5.6
  quality: 1080p
  upscale: true
  ambientSound: null
  prompt:
    base: A talking character derived from the provided character image, speaking directly to camera in a photoreal live-action environment with realistic depth and polished cinematic lighting
```

PixVerse uses `prompt.base` / `prompt.perRatio` to turn the input character image into a generated scene. `source: reference` clips additionally provide a per-cut `prompt` and use `pixverse create reference --images` instead of the shared base-video flow.

`generated`, `reference`, and `video` clips may also set `audioVolume` (`0`-`1`) to rebalance narration or clip audio against BGM.

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
