# Project purpose

Character Pipeline keeps a recurring person, voice and world usable across productions. The adopted reference and revision matter as much as the current prompt. The ordinary request is “this character, with these changes, in the next work”; users should not need to learn internal modes or rebuild reference sheets every time.

Character owns identity/body, wardrobe/role, voice, place/world and props as separately versioned reusable assets. Scene state belongs to the work. Shotpack owns the production's story, shots, adopted takes, editing and delivery. Both use one shared core for state, references, capabilities, execution, cost, Canvas synchronization and resume.

## Success

- A new work pins the correct adopted revisions without regenerating sufficient references.
- “Same face and voice, winter outfit” creates a wardrobe change without altering old works.
- Same narration is shared across aspect variants; a different language or performance remains distinct.
- “Only this shot” and “only the English pronunciation” affect the necessary dependencies.
- A known successful job is never sent again on resume; uncertain outcomes stay visible.
- A delivery contains real accepted files and QA, not planned paths.
- Canvas human edits are preserved and conflicts are reviewable.

These are measurable behavior requirements. Registry storage and passing mocks do not guarantee better face matching, voice fidelity, lip sync or total production cost. Evaluate those with bounded, separately approved real productions.

## Boundaries

The core is a small local library and CLI, canonical in Shotpack and vendored identically here. New work uses `production.v1`; old YAML, manifests, Remotion and FFmpeg remain compatibility inputs or optional adapters. There is no mandatory three-view generation, I2I step, fixed model table, shot count or new web service.

Use current provider capabilities for the actual binary, model/mode and region/workspace. Do not fabricate a synchronization or local-edit feature. Exact dialogue with a visible mouth needs a verified path; independent TTS alone cannot meet that promise.

Keep contributor documentation public-safe and protect original media, credentials and user changes. The current entry points are `SKILL.md`, `AGENTS.md` and `references/production-v1.md`. Historical rationale remains in `DECISIONS.md`; later dated decisions supersede old defaults.
