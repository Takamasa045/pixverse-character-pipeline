# Interactive Question Flow

When `project.yaml` is not provided, collect inputs in this order and convert them into the neutral schema. Do not start generation during Q&A.

If the user asks for a story, teaser, trailer, or multi-cut video, default to a reference-driven per-cut workflow:
- draft 3-5 story beats first
- generate each beat as its own reference clip
- write the result into `project.yaml` as `source: reference` clips unless the user already has local rendered assets

## Group 1: Project

**Ask**
> What is this project called, and what date should be attached to it?

**Extract**
- `project.title`
- `project.date` — default to today's date in `YYYY-MM-DD`
- `project.slug` — derive from title unless the user cares

## Group 2: Speaker

**Ask**
> Provide 1-7 character image paths. I will use 1 image for `single` mode and 2-7 for `reference` mode.

**Extract**
- `speaker.images`
- `speaker.mode`
- `speaker.name`

## Group 3: Locales

**Ask**
> Which locales should I generate? Default is `ja` + `en`.

**Extract**
- `locales.<lang>`

## Group 4: Clips Per Locale

For each locale, ask:

> List the clips in order. For each clip, tell me whether it is `generated`, `video`, or `image`.

Story-mode default:
> If the user clearly wants a story or teaser but did not specify clips, propose 3-5 beats first and ask for corrections instead of asking them to invent clip types from scratch.

**Extract**
- `locales.<lang>.clips[].id`
- `locales.<lang>.clips[].source`
- `locales.<lang>.clips[].durationSeconds`
- `locales.<lang>.clips[].text` or `audioFile` for `generated`
- `locales.<lang>.clips[].asset` for `video` / `image`
- `locales.<lang>.clips[].overlayText`
- `locales.<lang>.clips[].overlayStyle`

For story-mode, also extract:
- each beat's role (`hook`, `reveal`, `conflict`, `payoff`, `endcard`)
- per-beat camera distinction
- whether the final `project.yaml` should stay `source: reference` or be converted to local `video` clips

## Group 5: Render Settings

> Render settings:
> - Aspect ratios: `16:9`, `9:16`
> - FPS: `30`
> - Output directory: `./output`
>
> Reply with changes or say `ok`.

**Extract**
- `render.aspectRatios`
- `render.fps`
- `render.outputDir`

## Group 6: Generation Settings

> Generation settings:
> - Model: `v5.6`
> - Quality: `1080p`
> - Upscale: `yes`
> - Ambient sound: `none`
>
> Reply with changes or say `ok`.

**Extract**
- `generation.model`
- `generation.quality`
- `generation.upscale`
- `generation.ambientSound`
- `generation.prompt.base`
- `generation.prompt.perRatio`

## After All Answers

1. Generate `project.yaml`.
2. Show the resolved YAML.
3. Run `pipeline:plan` semantics: variant count, job count, credits needed.
4. Wait for explicit approval before `pipeline:run`.

For config schema details and legacy compatibility, see `SKILL.md`.
