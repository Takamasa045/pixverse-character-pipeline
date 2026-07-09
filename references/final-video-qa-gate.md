# Final Video QA Gate

Use this gate after a PixVerse generation or local render finishes, before reporting a video as complete.

This gate separates a technically completed render from an accepted video. A render can be complete while the creative output still fails.

## Required Review Roles

Run at least two independent reviews after generation:

- Asset QC: checks manifest consistency, file presence, duration, resolution, frame rate, black frames, audio presence, and obvious delivery issues.
- Video QA: checks character identity, shot intent, visual continuity, subtitles, sound, and whether the video satisfies the original request.

The main coordinator may summarize the result, but should not be the only reviewer for visible-character outputs.

## Hard Fail Conditions

Mark the output as `QA FAIL` if any of these occur:

### Character identity

- A visible character changes into a different age, gender, body type, face, hair, outfit, or person category.
- The clip only preserves similar gear or colors while losing the reference character's identity.
- A chibi / stylized reference drifts into realistic adult proportions, or the reverse.
- Face-defining traits (glasses, face shape, silhouette, key props) disappear for most of the cut.

### Request fit / action legibility

- The requested physical situation is not legible without reading the text overlay, such as a "3-meter slope" that only exists as caption copy.
- The key action is not visible as cause and effect in-frame. Example: a mowing cut must show dense weeds in front of the blade and cut material behind it, not bare-soil scraping.
- Category drift replaces the requested subject class. Example: roadside weeds become rice / wheat / crop rows; horror junk creatures become cute mascots.
- Continuity-critical objects change identity between adjacent cuts when the story requires the same pile, prop, or location.

### Delivery defects

- The final video is effectively silent when sound is part of the intended impact.
- Captions are clipped, unreadable, or contradict the image.
- Generated on-video text competes with Remotion captions or becomes readable letters that were not requested.
- A generated cut contains severe object artifacts, white-flash frames, or other defects that distract from the action.
- Any variant is missing, failed, black, or materially shorter than planned.

If a hard fail exists, do not say the video is complete. Report it as generated but not accepted.

## Audio Thresholds

Use measured loudness, not only "track exists".

| Verdict | Practical signal | Action |
|---------|------------------|--------|
| hard fail when sound is required | mean around `-90 dB` or no meaningful peaks | regenerate sound plan or mix before acceptance |
| practical pass band observed in accepted drafts | mean around `-25 dB`, peaks around `-8` to `-7 dB` | continue visual QA |
| conditional | audio present but wrong genre / no action foley | accept only if the request did not need impact sound |

An AAC track with near-silence is still a sound fail.

## Conditional Pass

Use `条件付きPASS` when:

- mechanical checks pass
- character identity is acceptable
- the main request is mostly met
- remaining weaknesses are explicit and local, such as one cut that under-communicates scale

Do not use conditional pass to hide a hard fail. List the exact cuts and the upgrade path for the next run id.

## Minimum Evidence

Create or inspect these artifacts:

- Final `manifest.json`
- Per-variant `manifest.render.json`
- Final MP4 path
- `ffprobe` duration, streams, resolution, and frame rate
- Black-frame check
- Audio level or silence check
- Whole-video contact sheet
- Per-cut contact sheet for any suspicious cut
- Side-by-side comparison between the reference image and generated character clips
- Optional local-only previs contact sheet before the first paid multi-cut run

## Pre-Credit Gate

Before spending credits on a multi-cut story or action piece:

1. Write per-cut acceptance criteria in plain language.
2. Prefer a local previs / storyboard contact sheet when the cut roles are still unclear.
3. Confirm which cuts are identity-critical, scale-critical, and action-critical.
4. Report job counts and `references/credit-estimation.md` estimates.
5. Only then ask for full `run` approval.

## Final Report Template

Use this shape in the final report:

```text
総合判定: PASS / 条件付きPASS / QA FAIL

生成結果:
- Config:
- Run ID:
- Variant:
- Final MP4:
- Manifest:

機械チェック:
- Duration:
- Resolution/FPS:
- Black frames:
- Audio mean/max:
- Failed/skipped variants:

映像QA:
- Character identity:
- Request fit / scale:
- Action causality:
- Cut-by-cut notes:
- Subtitles:
- Sound:

次の対応:
- Accept:
- Regenerate:
- Prompt changes:
- Sound/edit changes:
- Lesson for references/:
```

## Regeneration Loop

When QA fails:

1. Keep the failed run as evidence.
2. Name the next attempt with a new run id, such as `project-v2`.
3. Regenerate only the failed cuts when possible; do not re-spend on accepted cuts.
4. Strengthen prompts around the failed criteria instead of only changing style words.
5. Prefer local-only audio / caption / telop repair when the picture already passes.
6. Run the same QA gate again before reporting completion.
7. If the failure teaches a reusable rule, promote it through `references/lesson-codification.md`.

## Common Fix Map

| Failure | Prompt / production fix |
|---------|-------------------------|
| character becomes a different worker | repeat body type, face, glasses, silhouette, and "same character from the reference image" |
| gear colors match but identity fails | reject; identity is not clothing color alone |
| scale claim is text-only | force road below, ditch/curb, top and bottom embankment edges, or other measurable markers into the frame |
| action is illegible | write start state, tool contact, and end state in one cut |
| wrong subject category | add explicit negatives for the drifted class |
| cute mascot drift | require unsettling / practical-effect language when the brief needs it |
| readable generated text | ban signs, letters, and burned-in captions; put copy in Remotion |
| white flash / severe frame defect | reject the clip; regenerate with flash-safe continuity and keep local cut cleanup only as temporary evidence |
| silent final | add foley / voice / BGM before acceptance when impact depends on sound |
| abrupt per-cut native audio | prefer one narration plan or a later mix pass instead of mismatched generated audio beds |
