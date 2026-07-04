# PixVerse CLI Model Support

Synced on 2026-07-04 against:

- PixVerse CLI npm package: latest observed `pixverse@1.2.7`
- PixVerse official CLI README / npm README
- PixVerse official CLI changelog
- PixVerse official Skills repository
- `npx pixverse@latest --help` output for command flags

Compatibility note:

- This repo pins `pixverse@^1.2.7` in `remotion/package.json`.
- Runtime wrappers have been refreshed for CLI 1.2.x behavior: narration uses `create voice` audio assets instead of the removed `create speech` video mutation step.
- `create music` is documented for direct CLI production and BGM preparation, but the pipeline does not auto-generate music from config yet.
- Legacy `ttsSpeaker` / `tts_speaker` inputs are accepted for config compatibility, but use `voiceId` for PixVerse preset voice IDs.

## Repository Defaults

| Config field | Repo default | CLI latest default | Reason |
|:---|:---|:---|:---|
| `generation.model` | `v6` | `v6` | Stable default for T2V / I2V / generated clips |
| `generation.quality` | `720p` | `720p` | Conservative default for batch cost and render stability |
| `generation.referenceModel` | `v6` | `v6` | CLI supports V6 reference; C1 remains an explicit override |
| `generation.generateAudio` | `false` | CLI defaults audio on where supported | Repo keeps audio opt-in for predictable rendering |
| `generation.image.model` | `gemini-3.1-flash` | `gpt-image-2.0` | Repo keeps Gemini 3.1 Flash for character I2I consistency until changed intentionally |
| `generation.image.quality` | `1080p` | `1080p` | Compatible baseline for character base stills |

## Video Models

| Model | `--model` value | Quality | Duration | Aspect Ratio |
|:---|:---|:---|:---|:---|
| PixVerse V6 | `v6` | `360p` `540p` `720p` `1080p` | `1`-`15`s | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` `21:9` |
| PixVerse C1 | `pixverse-c1` | `360p` `540p` `720p` `1080p` | `1`-`15`s | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |
| Seedance 2.0 Standard | `seedance-2.0-standard` | `480p` `720p` `1080p` `2160p` | `4`-`15`s | `16:9` `4:3` `1:1` `3:4` `9:16` `21:9` |
| Seedance 2.0 Fast | `seedance-2.0-fast` | `480p` `720p` | `4`-`15`s | `16:9` `4:3` `1:1` `3:4` `9:16` `21:9` |
| Seedance 2.0 Mini | `seedance-2.0-mini` | `480p` `720p` | `4`-`15`s | `16:9` `4:3` `1:1` `3:4` `9:16` `21:9` |
| Google Gemini Omni | `gemini-omni-flash` | `720p` | `3`-`10`s | `16:9` `9:16` |
| Happy Horse 1.0 | `happyhorse-1.0` | `720p` `1080p` | `3`-`15`s | `16:9` `9:16` `1:1` `4:3` `3:4` |
| Kling O3 Pro | `kling-o3-pro` | `720p` | `3`-`15`s | `16:9` `9:16` `1:1` |
| Kling O3 Standard | `kling-o3-standard` | `720p` | `3`-`15`s | `16:9` `9:16` `1:1` |
| Kling 3.0 Pro | `kling-3.0-pro` | `720p` | `3`-`15`s | `16:9` `9:16` `1:1` |
| Kling 3.0 Standard | `kling-3.0-standard` | `720p` | `3`-`15`s | `16:9` `9:16` `1:1` |
| Grok Imagine 1.5 | `grok-imagine-1.5` | `480p` `720p` | `1`-`15`s | from image only |
| Grok Imagine | `grok-imagine` | `480p` `720p` | `1`-`15`s | `16:9` `4:3` `1:1` `9:16` `3:4` `3:2` `2:3` |
| Veo 3.1 Lite | `veo-3.1-lite` | `720p` `1080p` | `4` `6` `8`s | `16:9` `9:16` |
| Veo 3.1 Standard | `veo-3.1-standard` | `720p` `1080p` `2160p` | `4` `6` `8`s | `16:9` `9:16` |
| Veo 3.1 Fast | `veo-3.1-fast` | `720p` `1080p` `2160p` | `4` `6` `8`s | `16:9` `9:16` |
| Sora 2 Pro | `sora-2-pro` | `720p` `1080p` | `4` `8` `12`s | `16:9` `9:16` |
| Sora 2 | `sora-2` | `720p` | `4` `8` `12`s | `16:9` `9:16` |
| PixVerse v5.6 | `v5.6` | `360p` `480p` `540p` `720p` `1080p` | `1`-`10`s | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |
| PixVerse v5.5 | `v5.5` | `360p` `480p` `540p` `720p` `1080p` | `1`-`10`s | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |
| PixVerse v5 | `v5` | `360p` `480p` `540p` `720p` `1080p` | `1`-`10`s | `16:9` `4:3` `1:1` `3:4` `9:16` `3:2` `2:3` |

## Creation Mode Support

| Creation mode | Supported `--model` values |
|:---|:---|
| `create video` | `v6` `pixverse-c1` `seedance-2.0-standard` `seedance-2.0-fast` `seedance-2.0-mini` `gemini-omni-flash` `happyhorse-1.0` `kling-o3-pro` `kling-o3-standard` `kling-3.0-pro` `kling-3.0-standard` `grok-imagine-1.5` `grok-imagine` `veo-3.1-lite` `veo-3.1-standard` `veo-3.1-fast` `sora-2-pro` `sora-2` `v5.6` |
| `create reference` | `v6` `pixverse-c1` `seedance-2.0-standard` `seedance-2.0-fast` `seedance-2.0-mini` `gemini-omni-flash` `kling-o3-pro` `kling-o3-standard` `grok-imagine` `v5.6` |
| `create transition` (2 frames) | `v6` `pixverse-c1` `seedance-2.0-standard` `seedance-2.0-fast` `seedance-2.0-mini` `kling-o3-pro` `kling-o3-standard` `kling-3.0-pro` `kling-3.0-standard` `veo-3.1-lite` `veo-3.1-standard` `veo-3.1-fast` `v5.6` |
| `create transition` (3+ frames) | `v5` |
| `create extend` | `v6` `grok-imagine` |
| `create modify` | `v5.5` |
| `create motion-control` | `v5.6` |
| `create upscale` | no model value; use `--quality` |
| `create voice` | audio model family; see Voice / TTS Models |
| `create music` | audio model family; see Music Models |

## Image Models

| Model | `--model` value | Quality | Aspect Ratio |
|:---|:---|:---|:---|
| GPT Image 2 | `gpt-image-2.0` | `1080p` `1440p` `2160p` | `1:1` `16:9` `9:16` `4:3` `3:4` `3:2` `2:3` `2:1` `1:2` `21:9` |
| Nano Banana 2 | `gemini-3.1-flash` | `512p` `1080p` `1440p` `2160p` | `auto` plus common video/image ratios |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite` | `1080p` | `auto` plus common video/image ratios |
| Qwen Image | `qwen-image` | `720p` `1080p` | `1:1` `16:9` `9:16` `4:3` `3:4` `5:4` `4:5` `3:2` `2:3` `21:9` |
| Nano Banana Pro | `gemini-3.0` | `1080p` `1440p` `2160p` | `auto` plus common video/image ratios |
| Nano Banana | `gemini-2.5-flash` | `1080p` | `auto` plus common video/image ratios |
| Seedream 5.0 Lite | `seedream-5.0-lite` | `1440p` `1800p` `2160p` | `auto` plus common video/image ratios |
| Seedream 4.5 | `seedream-4.5` | `1440p` `2160p` | `auto` plus common video/image ratios |
| Seedream 4.0 | `seedream-4.0` | `1080p` `1440p` `2160p` | `auto` plus common video/image ratios |
| Kling Image O3 | `kling-image-o3` | `1080p` `1440p` `2160p` | common video/image ratios |
| Kling Image V3 | `kling-image-v3` | `1080p` `1440p` | common video/image ratios |

## Voice / TTS Models

| Model | `--model` value | Provider | Max characters |
|:---|:---|:---|---:|
| MiniMax Speech 2.8 HD | `speech-2.8-hd` | MiniMax | 10,000 |
| MiniMax Speech 2.8 Turbo | `speech-2.8-turbo` | MiniMax | 10,000 |
| Eleven Multilingual v2 | `eleven-multilingual-v2` | ElevenLabs | 10,000 |
| Eleven v3 | `eleven-v3` | ElevenLabs | 5,000 |
| Eleven Turbo v2.5 | `eleven-turbo-v2.5` | ElevenLabs | 40,000 |

Use `pixverse voice models` and `pixverse voice presets --model <id>` to inspect the live catalog before a real voice run.

## Music Models

| Model | `--model` value | Provider | Duration | Notes |
|:---|:---|:---|:---|:---|
| MiniMax Music 2.6 | `music-2.6` | MiniMax | `10`-`240`s | lyrics, auto lyrics, instrumental |
| ElevenLabs Music | `music-v1` | ElevenLabs | `10`-`240`s | lyrics, auto lyrics, instrumental |
| Google Lyria 3 Pro | `lyria-3-pro-preview` | Google | `10`-`240`s | image references; use prompt for instructions |

Use `pixverse music models` to inspect the live catalog before a real music run.

Music creation notes:

- Lyrics-capable models need one of `--lyrics`, `--auto-lyrics`, or `--instrumental`.
- `--lyrics` accepts literal text, a local file path, or `-` for stdin.
- `lyria-3-pro-preview` supports image references and expects lyric-like or mood instructions in `--prompt`; do not rely on a separate `--lyrics` input for it.

## Current CLI Command Flags To Account For

- All agent-run commands should use `--json`.
- `--prompt`, `--text`, and `--lyrics` accept literal text, local file paths, or `-` for stdin.
- Local oversized images are auto-resized to fit `1920x1920`; this does not make private upload safe.
- `--idempotency-key` is available across current create/post-process commands.
- `create reference` accepts `--images`; for Seedance 2.0 it can also accept `--videos` and `--audios`.
- `task status --ids <id1,id2,...> --type video|image|audio --json` supports batch polling.
- `account slots --json` shows current concurrent generation slots.
- `asset upload` supports local file or HTTPS URL for approved image/video/audio files.

## Source Reconciliation Notes

- `pixverse@1.2.7` was the npm latest observed on 2026-07-04 JST.
- CLI `1.2.6` fixed startup issues affecting `1.2.0`-`1.2.5`; `1.2.7` is the current latest package.
- CLI `1.2.5` added `seedance-2.0-mini`.
- CLI `1.2.4` added audio references to `create reference` for Seedance 2.0.
- CLI `1.2.3` added `2160p` to `seedance-2.0-standard`.
- CLI `1.2.1` raised Seedance 2.0 reference image limit to 9.
- CLI `1.2.0` removed `create speech`, added `create voice` and `create music`, and added `grok-imagine-1.5`.
- CLI `1.1.9` added `v6` support to `create reference` and changed the CLI image default to `gpt-image-2.0`.
- This repo intentionally keeps `gemini-3.1-flash` as the character I2I workflow default until changed by a separate runtime decision.

## Sources

- PixVerse CLI blog: https://pixverse.ai/en/blog/pixverse-cli-generate-ai-videos-images-from-terminal
- PixVerse CLI repo: https://github.com/PixVerseAI/cli
- PixVerse CLI changelog: https://github.com/PixVerseAI/cli/blob/main/CHANGELOG.md
- PixVerse Skills repo: https://github.com/PixVerseAI/skills
- PixVerse Platform docs: https://docs.platform.pixverse.ai/
