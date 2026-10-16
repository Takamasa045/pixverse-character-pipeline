# Checks

## Before work

- Inspect `git status --short`, available storage and the nearest source/test; preserve user changes and original inputs.
- Read `SKILL.md`, `AGENTS.md` and `references/production-v1.md`. New default: root `./bin/production`, JSON production.v1, Node >=22.18.
- No npm install or login is needed for offline core checks. Do not delete caches/media or copy a large dependency tree to fix storage.

## Offline plan

```bash
./bin/production validate production.json
./bin/production plan production.json
./bin/production run production.json --dry-run
```

Check exact requested language/aspect combinations, duration sum, immutable entity references, source hashes/provenance, context, reference role/order and declared capability support. Preserve explicit OFF. Show unknown requirements and cost evidence. No adapter call is allowed during dry-run.

## Before paid execution

- Human approval specifies concrete plan/scope, target shots, backend, attempts and credit ceiling. Record permission already given; do not invent it with `approve`.
- Include image/reference/voice trials, failures and permitted repair attempts in the estimate. Job count alone is insufficient. Unknown cost cannot be advertised as an exact upper bound.
- Same production uses one ledger and one backend owner per intent. Do not execute old and new paid runtimes together.
- Confirm current capability, actual binary, region/workspace and reference compatibility; never silently change authentication or workspace.
- Resume known provider IDs. Unknown submission must be reconciled. Download/storage failure cannot cause generation resubmission.

## Acceptance and output

- Separate completion, technical QC, creative acceptance, continuity, audio and final delivery.
- Compare faces, body, clothing, hair, props and colors with adopted references; check both people individually in a two-character shot.
- Check action before/contact/after, gaze, held hand, direction, relative positions, light and emotion across adjacent shots.
- Check voice, exact wording/pronunciation, required audio intent, subtitles and safe areas. Independent TTS is not proven lip sync.
- Resolve issues by shot/take and time range. Try edit/audio/caption repair first; invalidate only affected dependents.
- Deliver actual accepted files, timeline, requested captions, provenance, QA, costs including unknowns and resume information. A missing file or planned path is a failure, not completed delivery.

## Runtime checks

Run the core test suite documented by the repository and validate representative fixtures. Cover crash boundaries, uncertain voice submission, partial IDs, parallel cost reservation, explicit OFF, context mismatch, Canvas conflicts/large IDs/unmanaged nodes, storage failure and missing-file delivery. Test finishing against real local fixtures when the required local tools already exist. Mock results are not visual-quality evidence.

Legacy runtime checks remain documented in `references/legacy-CHECKS.md` and are used only when changing or intentionally running that runtime. Do not install legacy dependencies for new-core validation.

## Before release

- Compare Shotpack canonical core with the Character vendored copy, including hashes and tests.
- English/Japanese README and both agent entries agree on commands and limitations.
- No private paths, accounts, balances, tokens, unpublished media or raw production logs are added.
- Keep original input and Git baseline for rollback; no source rewrite in migration.
- Public push, package distribution, PR/merge and paid evaluation need their own explicit authorization when not already requested. Do not infer authorization from passing tests.
