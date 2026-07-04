# PixVerse CLI Production Best Practices

このファイルは、PixVerse CLI で作るためのベストプラクティスです。Canvas / Mini Apps は扱わず、CLI の command family、モデル、プロンプト、バッチ、アセット管理、QC に集中します。

Research snapshot:

- Official CLI blog and README describe PixVerse CLI as scriptable generation for video, images, audio, templates, asset management, and agent workflows.
- `pixverse@latest` observed locally on 2026-07-04 JST: `1.2.7`.
- CLI 1.2.0 removed `create speech` and added `create voice` / `create music`; this repo now uses `create voice` audio assets for narration.

## Core Principle

CLI production should run in this order:

1. Define the output and acceptance criteria.
2. Route to one CLI command family.
3. Pick the model and mode constraints.
4. Write prompt files, not only inline strings.
5. Check account / slots for batch work.
6. Submit with `--json`, `--no-wait`, and idempotency keys.
7. Wait / batch-status / download assets.
8. Run machine QA and visual QA.
9. Accept, regenerate, extend, upscale, or discard.

## Universal CLI Rules

- Use `--json` for every agent-run command.
- Use `--prompt -`, `--text -`, or `--lyrics -` for long generated prompt files.
- Use `--idempotency-key` for create, reference, transition, modify, extend, and upscale steps.
- Use `--no-wait` for batches; poll with `task status --ids` or `task wait`.
- Use `--count` only when you want parallel candidates from the same prompt.
- Check `account info` and `account slots` before parallel work.
- Keep private assets out of remote upload paths.
- Capture stdout and stderr separately.
- Keep failed outputs as evidence until QA and regeneration notes are written.

## Prompt Engineering Rules

Use prompts as production instructions, not decorative prose. A good prompt names the subject, action, environment, camera, timing, style boundary, and one acceptance target.

Universal prompt shape:

```text
[subject / reference binding].
[one action with start and end state].
[environment and secondary motion].
[camera movement and framing].
[lighting / realism / style boundary].
```

Best practices:

- Write one clip prompt for one visual job. If the shot needs a new location, new action, or story beat, split it into another clip.
- Prefer concrete movement over adjectives: "slow push in while the character raises one hand" beats "cinematic and dynamic".
- For character work, repeat stable identity anchors: body type, hair, outfit, key color, prop, and "same character from the reference image".
- For I2V, describe only motion and camera when the still image already defines appearance. Do not fight the source image with new costume or background details.
- For T2V, include subject appearance, setting, and camera because there is no grounding image.
- For reference video, explicitly assign each reference: character, prop, environment, logo, or style.
- For C1 candidates, describe physical choreography, contact, spatial continuity, VFX timing, or action staging; do not use C1 just as a vague "more cinematic" switch.
- For V6 candidates, keep prompts clean and general-purpose for fast social/product/announcement shots.
- For transition, write start-frame behavior, transformation path, and end-frame arrival. Do not ask for a whole new story.
- For modify, use `@image1`, `@image2`, etc. exactly matching the `--images` order and target one localized change.
- For voice, keep the text natural and separate from visual prompt text. Use `voiceId` only for confirmed PixVerse preset voice IDs.
- Avoid stacking too many camera moves. One primary camera move per clip is easier to QA and regenerate.

Regeneration prompt loop:

1. Name the failed visual criterion.
2. Remove instructions that did not matter.
3. Add one stronger constraint for the failed criterion.
4. Keep the same model and seed-like job context when testing a prompt-only correction.
5. Change model or command family only when the failure is structural.

## Text-to-Video

Use:

```bash
pixverse create video \
  --prompt ./prompts/shot-01.txt \
  --model v6 \
  --quality 720p \
  --duration 5 \
  --aspect-ratio 9:16 \
  --no-audio \
  --no-wait \
  --json
```

Best practices:

- Put one clear action in one clip.
- Avoid asking for multiple scene changes unless using `--multi-shot` intentionally.
- Use `--no-multi-shot` when you need a single continuous shot.
- Use `--audio` only when native generated audio is part of the test.
- For product/social tests, generate 2-4 candidates with the same structure before polishing one prompt.

## Image-to-Video

Use:

```bash
pixverse create video \
  --image ./references/base-still.png \
  --prompt ./prompts/i2v-motion.txt \
  --model v6 \
  --quality 720p \
  --duration 5 \
  --aspect-ratio 9:16 \
  --no-audio \
  --json
```

Best practices:

- Use I2V when the subject, product, character, or environment must remain grounded.
- Describe motion, not static appearance already present in the image.
- Add only one camera move per clip.
- If the still is weak, regenerate the still instead of overloading the I2V prompt.
- For character videos in this repo, the default remains I2I base still -> I2V.

## Text/Image-to-Image

Use:

```bash
pixverse create image \
  --image ./references/character.png \
  --prompt ./prompts/turnaround.txt \
  --model gemini-3.1-flash \
  --quality 1080p \
  --aspect-ratio 16:9 \
  --json
```

Best practices:

- Use image generation to create turnarounds, base stills, product plates, and environment plates.
- Use `gpt-image-2.0` when high-detail still generation and `--detail-level` matter.
- Keep this repo's character workflow default as `gemini-3.1-flash` until runtime defaults are intentionally changed.
- Use `--images` when combining character, prop, and environment references.
- Do not commit generated private reference images to tracked docs.

## Reference Video

Use:

```bash
pixverse create reference \
  --images ./references/character.png ./references/prop.png \
  --prompt ./prompts/reference-shot-01.txt \
  --model v6 \
  --quality 720p \
  --duration 5 \
  --aspect-ratio 9:16 \
  --no-audio \
  --json
```

Best practices:

- Use reference for story, teaser, multi-subject, or continuity-sensitive cuts.
- Say which reference image controls which subject or prop.
- Keep the action narrow.
- Use C1 only when choreography, physical contact, VFX, or continuity justifies it.
- Use Seedance 2.0 reference when you need mixed image/video/audio references.
- Review character identity side-by-side before acceptance.

## Motion Control

Use:

```bash
pixverse create motion-control \
  --image ./references/character.png \
  --video ./references/motion.mp4 \
  --model v5.6 \
  --quality 720p \
  --json
```

Best practices:

- Use this when the motion is more important than a prose prompt can reliably describe.
- Keep the character image clean and centered.
- Use short, legible motion reference clips.
- QA for identity drift and whether the generated motion actually follows the reference.

## Transition

Use:

```bash
pixverse create transition \
  --images ./frames/start.png ./frames/end.png \
  --prompt ./prompts/transition.txt \
  --model v6 \
  --quality 720p \
  --duration 5 \
  --json
```

Best practices:

- Use transition when start and end frames matter more than freeform movement.
- For 2 frames, use current supported 2-frame models.
- For 3+ frames, route to `v5` based on current CLI model support.
- Do not use transition to repair a bad story beat; fix the beat first.

## Modify

Use:

```bash
pixverse create modify \
  --video <video_id_or_path> \
  --images ./references/new-object.png \
  --prompt "At @image1, replace the handheld object while preserving the actor and camera motion." \
  --keyframe-time 1200 \
  --model v5.5 \
  --quality 720p \
  --json
```

Best practices:

- Use modify for localized changes, not full creative rewrites.
- Reference uploaded images as `@image1`, `@image2`, matching `--images` order.
- Set `--keyframe-time` to the frame where the change should anchor.
- If the whole clip concept is wrong, regenerate instead of modifying.

## Extend And Upscale

Use:

```bash
pixverse create extend --video <video_id> --prompt ./prompts/extend.txt --model v6 --duration 5 --json
pixverse create upscale --video <video_id> --quality 1080p --json
```

Best practices:

- Extend only clips that already pass visual QA.
- Upscale only accepted clips; do not spend credits improving rejected material.
- Record parent and child IDs so the lineage is clear.

## Voice And Music

CLI 1.2+ uses separate audio assets:

```bash
pixverse create voice --text ./voiceover.txt --model speech-2.8-hd --voice-id <preset_voice_id> --output ./voiceover.mp3 --json
pixverse create music --prompt ./music-prompt.txt --instrumental --duration-seconds 60 --output ./bgm.mp3 --json
```

Best practices:

- Generate audio separately when you need reusable voiceover or BGM.
- Use `voice models`, `voice presets`, and `music models` to inspect live catalogs.
- Keep output audio paths outside tracked docs unless the audio is public-safe.
- In this repo, feed accepted audio back as `audioFile` or BGM for Remotion rendering.
- For lyrics-capable music models, choose exactly one direction before generating: `--lyrics`, `--auto-lyrics`, or `--instrumental`.
- Treat `--lyrics` like other text inputs: literal text, local file path, or `-` for stdin.
- Use `--duration-seconds` when the edit needs a fixed music bed length.
- For `lyria-3-pro-preview`, put lyric-like or mood instructions in `--prompt` and use `--image` for moodboard references; do not plan around a separate `--lyrics` handoff.
- This pipeline does not auto-run `create music` from `project.yaml`; create BGM as a direct CLI prep step, review it, then reference the accepted local file with `bgm`.

## Batch Production

Use batch when:

- variants share the same structure
- you need prompt A/B tests
- you need multiple aspect ratios or languages
- you need several candidates before human review

Run pattern:

```bash
pixverse account info --json
pixverse account slots --json

for f in prompts/*.txt; do
  key="project-$(basename "$f" .txt)-v1"
  pixverse create video \
    --prompt "$f" \
    --model v6 \
    --quality 720p \
    --duration 5 \
    --aspect-ratio 9:16 \
    --no-audio \
    --no-wait \
    --idempotency-key "$key" \
    --json > "/tmp/${key}.json" &
done
wait

IDS=$(jq -r '.video_id // .video_ids[]?' /tmp/project-*.json | paste -sd, -)
pixverse task status --ids "$IDS" --type video --json
```

Best practices:

- Keep batch size within available video slots.
- Use deterministic keys.
- Save one JSON file per submitted job.
- Do not call a batch done until every ID has completed or failed.

## Asset Management

- Use `asset list --source create --type video --json` to find generated assets.
- Use `asset upload` only for public-safe or approved inputs.
- Use saved folders / workspace commands only when the operator has confirmed the correct workspace.
- Download final candidates into ignored output folders, then stage only public-safe summaries in tracked docs.

## QA And Regeneration

Machine QA:

- manifest present
- asset IDs and downloaded paths recorded
- duration, resolution, FPS, audio stream checked
- black frame / silence checked where relevant
- failed IDs and exact errors recorded

Visual QA:

- character identity
- prop shape
- action legibility
- camera motion
- caption readability
- sound fit
- request fit

Regeneration should target one named failure. If the problem is a story or offer problem, rewrite the brief/shotlist before changing models.

## Sources

- Official CLI blog: https://pixverse.ai/en/blog/pixverse-cli-generate-ai-videos-images-from-terminal
- Official CLI repo: https://github.com/PixVerseAI/cli
- Official CLI changelog: https://github.com/PixVerseAI/cli/blob/main/CHANGELOG.md
- Official Skills repo: https://github.com/PixVerseAI/skills
- Official Platform docs: https://docs.platform.pixverse.ai/
