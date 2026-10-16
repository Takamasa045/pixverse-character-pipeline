# Agent entry point

The current operating contract is [`SKILL.md`](SKILL.md), with [`references/production-v1.md`](references/production-v1.md) for commands and migration. Read `VISION.md` and `CHECKS.md`; use `LOOPS.md` for repeated work, `DECISIONS.md` for durable decisions and `NEXT_ACTIONS.md` for unresolved work.

## Current architecture

- Character Pipeline owns adopted revisions of identity/body, outfit, voice, world/place and props. Shotpack owns sequence, take adoption, timeline, issues and delivery.
- Shared code is canonical in Shotpack's `production-core/` and vendored identically into Character Pipeline. Do not create another generation/budget/resume engine. Synchronize the vendored copy and verify hashes when changing the core.
- New work uses JSON `production.v1` and root `./bin/production`, Node >=22.18 with built-in SQLite and no new npm dependencies. The previous YAML/Remotion entry is legacy opt-in only. Archived `references/legacy-*.md` and older role/workflow files do not override current contracts.
- Use one production coordinator and one backend owner for each intent. The two entries must use the same explicit `--db` path when handling one production. Do not run old and new paid workflows concurrently.

## Before editing or executing

1. Read `git status --short`, preserve existing user changes, and check free storage before copying assets or installing anything. Do not remove files/caches to gain space.
2. Make a concise plan and choose the smallest meaningful local checks. Validation, plan and `run --dry-run` make no provider generation calls. Offline core use does not require npm installation or authentication changes.
3. Paid work needs the human's concrete approved target, retry limit and upper credits, recorded against the resolved plan. Unknown cost/context/capability blocks generation. `approve` records existing human permission; it never authorizes work by itself. Honor valid scope without unnecessary repeat prompts.
4. Never verify code or documents by spending credits unless the human approved that trial. Do not create OAuth grants, expand permissions, publish, push, merge or distribute packages unless explicitly requested.

## Runtime invariants

- Immutable adopted entity revisions; retain provenance, hashes and region/workspace. Keep provider IDs as strings and times as integer milliseconds.
- Intent hashes reflect every resolved request input and intentional attempt. Same shot ID is not a cache key for changed content. Explicit `false` must reach the provider as off.
- Reserve costs and persist submitting state before network submission. Keep partial IDs on nonzero exits; reconcile uncertain submission instead of resubmitting. Download failure never becomes a new generation request. Voice/music trace IDs do not imply deduplication.
- Separate completion, download, QA and acceptance. Preserve rejected takes and adoption history. Scope invalidation to affected dependencies; stale does not authorize regeneration.
- Read current Canvas graph/capabilities; validate scoped changes, merge base/local/remote and preserve human choices, layout, unmanaged nodes and large IDs. Report conflicts. Do not send undeclared fields or secretly fail over to Create.
- Return real adopted, checked files and report unresolved costs/QA. Never represent a dry-run path or missing manifest asset as a finished MP4. TTS overlaid on video is narration, not proven lip sync.

## Contributor checks and reporting

Test changes with neutral fixtures and fault cases relevant to the edit: resume/duplicate submission, concurrent budget reservation, explicit OFF, QA failure, missing files, Canvas conflict and context mismatch. Mock success is contract evidence only. Run supported existing local finishing tests without fetching new production assets.

Report changed files, checks/results, real deliverables, unchanged authorization boundaries, unverified provider/creative behavior and remaining blockers. Record durable operating lessons publicly in generalized form; keep tokens, account state, private paths/media and raw production logs out of tracked files. Do not change unrelated work.
