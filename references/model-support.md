# PixVerse CLI Model Support

Synced on 2026-05-28 against:

- PixVerse CLI npm package: `pixverse@1.1.10`
- PixVerse official CLI blog for v1.1.9 behavior
- PixVerse Platform V6 and Model Overview docs

This file is the repo-local model table used by `SKILL.md`, `README.md`, and `README.ja.md`.
When sources disagree, prefer the official platform docs for model capability and the current CLI help for command flags.

## Repository Defaults

| Config field | Default | Reason |
|:---|:---|:---|
| `generation.model` | `v6` | Default video model; supports `1`-`15`s and `21:9` |
| `generation.quality` | `720p` | Conservative video default for batch cost and render stability |
| `generation.referenceModel` | `v6` | Current CLI supports `v6` for `create reference`; `pixverse-c1` remains a valid override |
| `generation.generateAudio` | `false` | Maps to `--no-audio` by default; set `true` to pass `--audio` on supported generation commands |
| `generation.image.model` | `gemini-3.1-flash` | Strong image/layout following and broad aspect-ratio support |
| `generation.image.quality` | `1080p` | Compatible baseline for `gemini-3.1-flash`; raise to `2160p` for final stills when credits allow |

## Video Models

| Model | `--model` value | Modes | Quality | Duration | Aspect Ratio |
|:---|:---|:---|:---|:---|:---|
| PixVerse V6 | `v6` | Video, Transition (first/last frame), Extend, Reference/Fusion | `360p` `540p` `720p` `1080p` | `1`-`15` | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` `21:9` |
| PixVerse C1 | `pixverse-c1` | Video, Transition (first/last frame), Reference | `360p` `540p` `720p` `1080p` | `1`-`15` | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |
| PixVerse v5.6 | `v5.6` | Video, Transition, Reference, Extend, Motion Control | `360p` `540p` `720p` `1080p` | `1`-`10` | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |
| PixVerse v5.5 | `v5.5` | Video, Transition, Extend | `360p` `480p` `540p` `720p` `1080p` | `1`-`10` | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |
| PixVerse v5 | `v5` | Video, Transition, Reference, Extend, Speech | `360p` `480p` `540p` `720p` `1080p` | `1`-`10` | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |
| PixVerse V5 Fast | `v5-fast` | Video | `360p` `480p` `540p` `720p` `1080p` | `1`-`10` | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |
| PixVerse V4.5 | `v4.5` | Transition | `360p` `480p` `540p` `720p` `1080p` | `1`-`10` | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |
| Sora 2 | `sora-2` | Video | `720p` | `4` `8` `12` | `16:9` `9:16` |
| Sora 2 Pro | `sora-2-pro` | Video | `720p` `1080p` | `4` `8` `12` | `16:9` `9:16` |
| Veo 3.1 Standard | `veo-3.1-standard` | Video, Transition | `720p` `1080p` | `4` `6` `8` | `16:9` `9:16` |
| Veo 3.1 Fast | `veo-3.1-fast` | Video, Transition | `720p` `1080p` | `4` `6` `8` | `16:9` `9:16` |
| Veo 3.1 Lite | `veo-3.1-lite` | Video | `720p` `1080p` | `4` `5` `6` | `16:9` `9:16` |
| Grok Imagine | `grok-imagine` | Video, Extend, Reference | `480p` `720p` | `1`-`15` | `16:9` `4:3` `1:1` `9:16` `3:4` `3:2` `2:3` |
| Happy Horse 1.0 | `happyhorse-1.0` | Video | `720p` `1080p` | `3`-`15` | `16:9` `9:16` `1:1` `4:3` `3:4` |
| Seedance 2.0 Standard | `seedance-2.0-standard` | Video, Reference, Transition | `480p` `720p` `1080p` | `4`-`15` | `16:9` `4:3` `1:1` `3:4` `9:16` `21:9` |
| Seedance 2.0 Fast | `seedance-2.0-fast` | Video, Reference, Transition | `480p` `720p` | `4`-`15` | `16:9` `4:3` `1:1` `3:4` `9:16` `21:9` |
| Kling O3 Pro | `kling-o3-pro` | Video, Reference, Transition | `720p` | `3`-`15` | `16:9` `9:16` `1:1` |
| Kling O3 Standard | `kling-o3-standard` | Video, Reference, Transition | `720p` | `3`-`15` | `16:9` `9:16` `1:1` |
| Kling 3.0 Pro | `kling-3.0-pro` | Video, Transition | `720p` | `3`-`15` | `16:9` `9:16` `1:1` |
| Kling 3.0 Standard | `kling-3.0-standard` | Video, Transition | `720p` | `3`-`15` | `16:9` `9:16` `1:1` |

## Creation Mode Support

| Creation mode | Supported `--model` values |
|:---|:---|
| `create video` | `v6` `pixverse-c1` `v5.6` `v5.5` `v5` `v5-fast` `seedance-2.0-standard` `seedance-2.0-fast` `grok-imagine` `veo-3.1-lite` `veo-3.1-standard` `veo-3.1-fast` `sora-2-pro` `sora-2` `kling-o3-pro` `kling-o3-standard` `kling-3.0-pro` `kling-3.0-standard` `happyhorse-1.0` |
| `create reference` | `v6` `pixverse-c1` `v5` `v5.6` `seedance-2.0-standard` `seedance-2.0-fast` `kling-o3-pro` `kling-o3-standard` `grok-imagine` |
| `create transition` (2 frames) | `v6` `pixverse-c1` `v5.6` `v5.5` `v5` `v4.5` `seedance-2.0-standard` `seedance-2.0-fast` `veo-3.1-standard` `veo-3.1-fast` `kling-o3-pro` `kling-o3-standard` `kling-3.0-pro` `kling-3.0-standard` |
| `create transition` (3+ frames) | `v5` `v4.5` |
| `create extend` | `v6` `v5.5` `v5` `grok-imagine` |
| `create modify` | `v5.5` |
| `create motion-control` | `v5.6` |
| `create speech` | `v5` |
| `create sound` | Removed in recent CLI; use `--audio` / `--no-audio` on supported generation commands |

## Image Models

| Model | `--model` value | Quality | Aspect Ratio |
|:---|:---|:---|:---|
| Qwen Image | `qwen-image` | `720p` `1080p` | `1:1` `16:9` `9:16` `4:3` `3:4` `5:4` `4:5` `3:2` `2:3` `21:9` |
| GPT Image 2 | `gpt-image-2.0` | `1080p` `1440p` `2160p` | `1080p`: `1:1` `3:2` `2:3`; `1440p`: `1:1` `16:9` `9:16`; `2160p`: `16:9` `9:16` |
| Seedream 5.0 Lite | `seedream-5.0-lite` | `1440p` `1800p` `2160p` | `auto` `1:1` `16:9` `9:16` `4:3` `3:4` `5:4` `4:5` `3:2` `2:3` `21:9` |
| Seedream 4.5 | `seedream-4.5` | `1440p` `2160p` | `auto` `1:1` `16:9` `9:16` `4:3` `3:4` `5:4` `4:5` `3:2` `2:3` `21:9` |
| Seedream 4.0 | `seedream-4.0` | `1080p` `1440p` `2160p` | `auto` `1:1` `16:9` `9:16` `4:3` `3:4` `5:4` `4:5` `3:2` `2:3` `21:9` |
| Gemini 2.5 Flash (Nanobanana) | `gemini-2.5-flash` | `1080p` | `auto` `1:1` `16:9` `9:16` `4:3` `3:4` `5:4` `4:5` `3:2` `2:3` `21:9` |
| Gemini 3.0 (Nano Banana Pro) | `gemini-3.0` | `1080p` `1440p` `2160p` | `auto` `1:1` `16:9` `9:16` `4:3` `3:4` `5:4` `4:5` `3:2` `2:3` `21:9` |
| Gemini 3.1 Flash (Nano Banana 2) | `gemini-3.1-flash` | `512p` `1080p` `1440p` `2160p` | `auto` `1:1` `16:9` `9:16` `4:3` `3:4` `5:4` `4:5` `3:2` `2:3` `21:9` |
| Kling Image O3 | `kling-image-o3` | `1080p` `1440p` `2160p` | `16:9` `9:16` `1:1` `4:3` `3:4` `3:2` `2:3` `21:9` |
| Kling Image V3 | `kling-image-v3` | `1080p` `1440p` | `16:9` `9:16` `1:1` `4:3` `3:4` `3:2` `2:3` `21:9` |

## Source Reconciliation Notes

- `pixverse@1.1.10` is the current npm latest checked with `npm view pixverse version`; the repo now pins `^1.1.10`.
- PixVerse Platform docs list V6 support for Reference-to-Video/Fusion, and the official CLI blog says v1.1.9 added `v6` support for `create reference`.
- The same CLI blog says `create sound` was removed in v1.1.8. This pipeline maps `generation.generateAudio` to `--audio` / `--no-audio` instead of submitting a separate sound task.
- PixVerse CLI v1.1.9 changed the CLI's own default image model to `gpt-image-2.0`; this repo intentionally keeps `gemini-3.1-flash` as its workflow default for character I2I consistency.
- Official skills `create-video.md` includes `Veo 3.1 Lite` as `4` `5` `6`s, while the npm README says `4` `6` `8`s. This repo follows official skills.
- Official skills `create-video.md` caps `Veo 3.1 Standard` and `Veo 3.1 Fast` at `1080p`, while the npm README lists `2160p`. This repo follows official skills.
- The npm README mode matrix lists `Veo 3.1 Lite` for 2-frame transition, but official `transition.md` and the official model reference mark Lite as video-only. This repo follows official skills.
- Image-only ratios `auto`, `5:4`, and `4:5` are listed above for direct `pixverse create image`. The config-driven pipeline only accepts renderable video ratios; it now includes `21:9`.
