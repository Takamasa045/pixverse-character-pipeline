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

- A visible character changes into a different age, gender, body type, face, hair, outfit, or person category.
- The clip only preserves similar gear or colors while losing the reference character's identity.
- The requested physical situation is not legible, such as a "3-meter slope" that is only stated in text.
- The final video is effectively silent when sound is part of the intended impact.
- Captions are clipped, unreadable, or contradict the image.
- A generated cut contains severe object artifacts that distract from the action.
- Any variant is missing, failed, black, or materially shorter than planned.

If a hard fail exists, do not say the video is complete. Report it as generated but not accepted.

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
- Audio:
- Failed/skipped variants:

映像QA:
- Character identity:
- Request fit:
- Cut-by-cut notes:
- Subtitles:
- Sound:

次の対応:
- Accept:
- Regenerate:
- Prompt changes:
- Sound/edit changes:
```

## Regeneration Loop

When QA fails:

1. Keep the failed run as evidence.
2. Name the next attempt with a new run id, such as `slope-mower-v2`.
3. Regenerate only the failed cuts when the pipeline supports it; otherwise create a new config with stricter prompts.
4. Strengthen prompts around the failed criteria instead of only changing style words.
5. Run the same QA gate again before reporting completion.
