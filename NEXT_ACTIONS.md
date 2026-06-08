# NEXT_ACTIONS.md

このファイルは、この repo の次アクションを管理する場所です。

AI エージェントは作業開始時に読み、作業終了時に必要なら更新します。

## Status Legend

- todo: 未着手
- doing: 作業中
- blocked: 人間確認または外部条件待ち
- done: 完了

## Current Next Actions

### 1. Review and approve public operating OS draft

Status: todo

Owner: human

Why:

- `VISION.md` / `CHECKS.md` / `LOOPS.md` / `DECISIONS.md` / `NEXT_ACTIONS.md` and the expanded `AGENTS.md` should match how this OSS repo will actually be used.

Done when:

- Human approves the direction or requests corrections.

### 2. Keep content operations optional

Status: done

Owner: agent

Decision:

- This repo's core is the PixVerse character pipeline.
- Content repurposing stays as an optional, generalized loop.
- Private event, client, seminar, sales, or campaign details should live outside this OSS repo.

Why:

- The repo currently contains mostly pipeline, fixture, reference, and submission materials.
- OSS docs should be useful to contributors without exposing private operation details.

Done when:

- Reflected in `VISION.md`, `LOOPS.md`, `CHECKS.md`, and `AGENTS.md`.

### 3. Reconcile README naming in submission docs

Status: todo

Owner: agent

Observation:

- `submission/github-readiness-checklist.md` and `submission/submission-checklist.md` mention `README.en.md`, while this repo currently uses `README.md` and `README.ja.md`.

Done when:

- Submission docs use the actual README filenames.

### 4. Keep ignored run logs out of tracked docs

Status: done

Owner: agent

Decision:

- `output/runs/**/*.md` contains auto-generated run logs with `Human Eval pending`.
- `output/` is ignored and should remain local evidence.
- Public docs should contain only summarized, private-safe learnings.

Done when:

- Reflected in `VISION.md`, `CHECKS.md`, `LOOPS.md`, and `AGENTS.md`.

### 5. Produce one real public sample MP4

Status: blocked

Owner: human approval required

Why:

- Submission docs say the strongest proof is one real PixVerse-generated sample, not only dry-run or local render.

Blocked by:

- Explicit approval to spend PixVerse credits.
- Confirmation of sample character image and public usage rights.

Done when:

- A sample MP4 exists and is approved for submission or GitHub demo use.

### 6. Run verification after operating docs are approved

Status: todo

Owner: agent

Suggested commands:

```bash
cd remotion
pnpm typecheck
pnpm test
```

Why:

- The operating docs do not require runtime verification, but the current working tree has runtime changes that should eventually be verified before commit or push.

Done when:

- Test results are recorded in the final report or in a follow-up run log.

### 7. Create a first-run operator guide

Status: todo

Owner: agent

Why:

- A new AI agent can read the repo, but a human operator may still need a short "what to ask first" guide.

Possible shape:

- "I have a character image and want a Japanese/English vertical announcement."
- "I want a 4-cut teaser using this character."
- "I only want to render existing local clips."

Done when:

- The guide is added to README or a small `START_HERE.md`, if approved.

### 8. Decide whether public backlog belongs in GitHub Issues

Status: todo

Owner: human + agent

Why:

- `NEXT_ACTIONS.md` is useful for repo-local operating context, but concrete OSS contributor tasks may be better as GitHub Issues.

Done when:

- The maintainer decides which items stay in `NEXT_ACTIONS.md` and which move to GitHub Issues.

### 9. Add explicit OSS contribution notes if needed

Status: todo

Owner: agent

Why:

- `AGENTS.md` now guides AI agents, but external human contributors may expect `CONTRIBUTING.md` if the repo receives outside contributions.

Done when:

- Either `CONTRIBUTING.md` is added, or README explains that `AGENTS.md` / `CHECKS.md` are the current contributor workflow.
