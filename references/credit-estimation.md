# Credit Estimation Reference

Gate 前の見積もりと、run 後の較正に使う表。

モデルの可用性・duration / quality の正本は `references/model-support.md`。
このファイルは **クレジット見積もりだけ** を扱う。

価格はモデル追加より変わりやすい。CLI 実行前の `pixverse account info --json` と、実行後に観測した実消費を必ず正にする。

## Pipeline Reality Check

Mode B (`./bin/pipeline run`) の runtime は、現状:

```text
availableCredits < plan.totals.totalJobs なら停止
```

という **job 数ベースの粗いゲート** を使う。これは安全側の下限チェックであり、正確なクレジット見積もりではない。

エージェントは承認前に、下表で **おおよそのクレジット帯** を別途報告する。

## Job Count First

見積もりはまず `plan` の job count から始める。

```text
image_jobs     = aspect_ratios if generated clips exist and generation.image.enabled else 0
base_jobs      = aspect_ratios if generated clips exist else 0
reference_jobs = reference_clips x aspect_ratios
voice_jobs     = generated_or_reference_clips_with_text_and_without_audioFile x aspect_ratios
upscale_jobs   = generated_or_reference_clips x aspect_ratios if upscale else 0
total_jobs     = image_jobs + base_jobs + reference_jobs + voice_jobs + upscale_jobs
```

詳細は `references/pipeline-diagram.md`。

## Planning Baseline

| Stage | Model / action | Conditions | Estimate |
|-------|----------------|------------|----------|
| base / reference video | `v6` | 360p / no audio | `5 cr / sec` |
| base / reference video | `v6` | 540p / no audio | `7 cr / sec` |
| base / reference video | `v6` | 720p / no audio | `9 cr / sec` |
| base / reference video | `v6` | 1080p / no audio | `18 cr / sec` |
| base / reference video | `v6` | 360p / with audio | `7 cr / sec` |
| base / reference video | `v6` | 540p / with audio | `9 cr / sec` |
| base / reference video | `v6` | 720p / with audio | `10 cr / sec` (measured) |
| base / reference video | `v6` | 1080p / with audio | `23 cr / sec` |
| base / reference video | `pixverse-c1` | 360p / no audio | `6 cr / sec` |
| base / reference video | `pixverse-c1` | 540p / no audio | `8 cr / sec` |
| base / reference video | `pixverse-c1` | 720p / no audio | `8 cr / sec` (measured) |
| base / reference video | `pixverse-c1` | 1080p / no audio | `19 cr / sec` |
| base / reference video | `pixverse-c1` | 360p / with audio | `8 cr / sec` |
| base / reference video | `pixverse-c1` | 540p / with audio | `10 cr / sec` |
| base / reference video | `pixverse-c1` | 720p / with audio | `13 cr / sec` |
| base / reference video | `pixverse-c1` | 1080p / with audio | `24 cr / sec` |
| base / reference video | `v5.6` | 720p / 5s / no audio | `45 cr` |
| base / reference video | `v5.6` | 720p / 5s / with audio | `80 cr` |
| base / reference video | `v5.6` | 1080p / 5s / no audio | `75 cr` |
| base / reference video | `v5.6` | 1080p / 5s / with audio | `150 cr` |
| base image | `gemini-3.1-flash` / other image models | any supported setting | provisional until measured |
| third-party video | `sora-*`, `veo-*`, `grok-imagine`, `happyhorse-1.0`, `seedance-*`, `kling-*` | any supported setting | provisional until measured |
| narration | `create voice` | clip `text` without `audioFile` | provisional until measured |
| post-process | `create upscale` | 1 asset | official public table not yet published |
| post-process | `create extend` | `v6` 720p / with audio | `10 cr / sec` (measured, same band as create) |

`generateAudio: true` は video job の audio 有りの帯を使う。`create voice` は別 job として加算する。

Rows marked `(measured)` come from job payload `cost_credits` on local runs. Prefer them over the public list when they conflict, and re-check if CLI pricing changes.

## Measured Calibration Log

Public-safe samples only. No account balances.

| Observed job | Model | Quality | Duration | Audio | `cost_credits` | Implied rate | Status |
|--------------|-------|---------|----------|-------|----------------|--------------|--------|
| create video / reference | `v6` | 720p | 10s | with audio | `100` | `10 cr / sec` | calibrated into baseline |
| create extend | `v6` | 720p | 10s | with audio | `100` | `10 cr / sec` | calibrated into baseline |
| create reference | `pixverse-c1` | 720p | 4s | no audio | `32` | `8 cr / sec` | calibrated into baseline |
| create reference | `pixverse-c1` | 720p | 8s | no audio | `64` | `8 cr / sec` | matches 4s sample |

Notes:

- C1 720p no-audio measured at `8 cr / sec`, below the older public-table planning value of `10 cr / sec`.
- V6 720p with-audio measured at `10 cr / sec`, below the older planning value of `12 cr / sec`.
- Prefer per-job `cost_credits` over account balance diffs when parallel sessions may run.
- Still provisional: image models, `create voice`, upscale, 1080p bands, and third-party video models.

## Estimation Formula

### Video stages

```text
video_estimate = sum(
  duration_sec * per_second_rate(model, quality, generateAudio)
)
```

対象:

- generated clip の base video（aspect ratio ごと）
- `source: reference` clip の per-cut video

### Image stages

```text
image_estimate = image_jobs * provisional_image_rate
```

### Voice / upscale

```text
voice_estimate = provisional until measured
upscale_estimate = provisional until measured
```

### Display budget

承認前に提示する:

```text
display_estimate = video_estimate + image_estimate + voice_estimate + upscale_estimate
warning_threshold = account_balance * 0.8
```

## Warning Rules

- `display_estimate > balance * 0.8`: credit warning を明示する
- `display_estimate > balance`: full `run` に進まない
- 並列投入前に、対象 variant 全体の budget があることを確認する
- **残高そのものや account payload を tracked docs に書かない**

## Source Notes

- Model and mode truth: `references/model-support.md`
- Job counting: `references/pipeline-diagram.md`
- V6 / C1 pricing baseline: PixVerse Platform Model & Pricing
- voice / image / third-party / upscale: public table が薄いものは実測優先

## Calibration Rule

run 後に、推定と実績の差が大きい stage / model だけこの表を更新する。

手順:

1. `plan` の job count とこの表で `display_estimate` を出す
2. full `run` 前後で `pixverse account info --json` または job payload の `cost_credits` を読む
3. 差が大きい項目だけ、public-safe な数値としてこの表を直す
4. 個人の残高、token、private path は書かない
5. なぜ直したかを `DECISIONS.md` に 1 entry 残すか、Loop 10 の summary に残す

並行セッションがある場合、残高差分より **各タスクの `cost_credits`** を優先する。
