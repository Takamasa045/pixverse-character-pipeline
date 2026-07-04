# PixVerse CLI Batch Plan

## Scope

- Project:
- Command family:
- Asset type: video / image / audio
- Approval required before:

## Environment

- CLI version:
- Workspace:
- Account / slots checked:
- Off-peak:

## Inputs

- Prompt folder:
- Reference images:
- Reference videos:
- Reference audio:
- Existing asset IDs:

## Defaults

- Model:
- Quality:
- Duration:
- Aspect ratio:
- Audio: on / off / separate voice / separate music
- Count per prompt:

## Jobs

| Job | Prompt file | Command | Model | Output JSON | Idempotency key | Status |
|:---|:---|:---|:---|:---|:---|:---|
| 01 | | | | | | planned |

## Commands

```bash
pixverse account info --json
pixverse account slots --json
```

```bash
# Fill one command per job before execution.
pixverse create video \
  --prompt ./prompts/job-01.txt \
  --model v6 \
  --quality 720p \
  --duration 5 \
  --aspect-ratio 9:16 \
  --no-audio \
  --no-wait \
  --idempotency-key <stable-key> \
  --json > /tmp/job-01.json
```

## Tracking

- Submitted IDs:
- Batch status command:
- Download directory:
- Completed:
- Failed:
- Pending:

## QA

- Machine QA owner:
- Visual QA owner:
- Accepted IDs:
- Regenerate IDs:
- Discard IDs:
