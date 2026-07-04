# PixVerse CLI Production Agent Roles

Use these roles when a PixVerse request is bigger than a narrow docs fix or a single local render.

## Coordinator

Owns:

- final goal
- completion criteria
- `project.yaml` ownership
- approval boundary
- final report

Rules:

- only the Coordinator runs full `run` or delegates it explicitly
- never spend PixVerse credits without human approval
- keep public docs free of private assets and account details

## Model Router

Owns:

- purpose classification
- workflow choice
- model candidate choice
- fallback recommendation

Reads:

- `references/model-routing.md`
- `references/model-support.md`
- `CHECKS.md`

Outputs:

- selected workflow
- selected model candidates
- reason
- credit / slot risk note

## Prompt Designer

Owns:

- base prompt
- per-ratio prompt
- per-cut reference prompt
- negative or consistency constraints

Reads:

- `references/prompt-library.md`
- `references/pixverse-best-practices.md`
- `templates/shotlist.yaml`

Outputs:

- prompt pack
- beat notes
- known risk per shot

## CLI Operator

Owns:

- validation commands
- plan / dry-run
- full run only after approval
- manifest path reporting
- direct PixVerse CLI command execution when explicitly approved

Reads:

- `CHECKS.md`
- `SKILL.md`
- `references/model-routing.md`
- `references/model-support.md`

Outputs:

- config path
- run-id
- command family
- variant count
- job counts
- exact error strings

## Asset / Task Manager

Owns:

- `--no-wait` task IDs
- batch status checks
- asset download paths
- parent / child lineage for extend and upscale
- stdout / stderr separation

Reads:

- `references/pixverse-best-practices.md`
- `templates/cli-batch-plan.md`
- `templates/qc-report.md`

Outputs:

- task ID list
- completed / failed / pending counts
- downloaded asset paths
- exact remote error payloads

## Audio Operator

Owns:

- CLI voice generation plan
- CLI music generation plan
- audio file handoff into Remotion

Reads:

- `references/model-support.md`
- `references/pixverse-best-practices.md`

Outputs:

- voice model / preset choice
- music model choice
- generated audio path
- language / duration notes

## QC Checker

Owns:

- machine QA
- visual QA
- character reference QA
- regeneration recommendation

Reads:

- `CHECKS.md`
- `references/final-video-qa-gate.md`
- `templates/qc-report.md`

Outputs:

- PASS / conditional PASS / QA FAIL
- manifest and MP4 evidence
- cut-by-cut notes
- regenerate / accept decision

## CPP Publisher

Owns:

- post package after QA
- Japanese and optional English post drafts
- hashtag and campaign-safe wording
- production note

Reads:

- `templates/cpp-post-package.md`
- `LOOPS.md` Loop 7
- accepted QC report

Outputs:

- post copy
- selected final MP4 path
- public-safe workflow summary

## Ownership Matrix

| File or artifact | Owner |
|:---|:---|
| `project.yaml` | Coordinator |
| model / workflow decision | Model Router |
| prompt text | Prompt Designer |
| command execution log | CLI Operator |
| task IDs and downloads | Asset / Task Manager |
| voice / music assets | Audio Operator |
| `manifest.json` review | QC Checker |
| final MP4 acceptance | QC Checker + Coordinator |
| X / CPP copy | CPP Publisher |

## Parallel Work Rule

Agents can work in parallel only when their write surfaces do not overlap. If multiple agents need `project.yaml`, the Coordinator remains the single editor and accepts structured suggestions from the others.
