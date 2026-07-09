# Lesson Codification into `references/`

Shotpack と同じ運用パターンを、この repo でも使う。

一時ログや private memory に教訓を閉じ込めるのではなく、**再利用できる運用知識だけを `references/` に成文化**する。

## Why

- AI エージェントは session memory より tracked docs を優先して読む
- raw `output/runs/` は private path や未整理メモを含みやすい
- 同じ失敗を次の run で繰り返さないために、判断ルールを public-safe な正本へ戻す

## Destination Map

| Learning type | Write here | Do not write here |
|---------------|------------|-------------------|
| model / mode / duration limits | `references/model-support.md` | private chat only |
| why a command family or model was chosen | `references/model-routing.md` | campaign-specific memory only |
| prompt / camera / style reusable rules | `references/prompt-library.md` | one-off shot text dump |
| CLI production rules, batch, regeneration | `references/pixverse-best-practices.md` | raw terminal transcript |
| credit heuristics after measurement | `references/credit-estimation.md` | account balances |
| exit / retry contract | `references/exit-codes.md` | one-off stack traces |
| acceptance / hard-fail criteria | `references/final-video-qa-gate.md` | private client notes |
| durable project policy | `DECISIONS.md` | temporary scratch |
| unfinished work | `NEXT_ACTIONS.md` | buried in run logs |

## Promote When

次をすべて満たす場合に `references/` へ昇格する。

1. 同じ状況で再発しうる
2. 1 回限りの path / 固有名詞 / account state に依存しない
3. 判断ルールとして 1-10 行で書ける
4. 既存 references と矛盾しない、または既存を更新する理由がある

## Do Not Promote

- PixVerse token / credit balance / auth payload
- private client / event / seminar 固有情報
- local absolute path を必要とするメモ
- まだ再現条件が不明な感覚的コメント
- raw `manifest.json` / full run log の貼り付け

## Promotion Workflow

1. `output/**/manifest.json` や local run notes を読む
2. 失敗 / 成功の原因を 1 文で一般化する
3. Destination Map で書き先を決める
4. public-safe な rule / table / checklist に書き直す
5. 既存 truth source と矛盾しないか確認する
6. 必要なら `DECISIONS.md` に「なぜ変えたか」を 1 entry 追加する
7. 未完了タスクだけ `NEXT_ACTIONS.md` に残す
8. raw log は `output/` に置き、tracked docs へ丸ごと移さない

## Preferred Rule Shape

悪い例:

```text
slope-mower の cut2 がダメだった
```

良い例:

```text
Visible-character clips fail QA when the body type, face, glasses, or proportions drift from the reference, even if gear colors match.
```

悪い例:

```text
残高が 842 から 610 になった
```

良い例:

```text
v6 720p no-audio is about 9 cr/sec. Recalibrate this row if measured cost drifts.
```

## After Every Substantial Run

最低限これを分ける。

1. **Accept / reject decision** → final report and optional `templates/qc-report.md`
2. **Reusable operational learning** → `references/*`
3. **Unfinished work** → `NEXT_ACTIONS.md`
4. **Policy change** → `DECISIONS.md`

成功 run でも、クレジット較正や QA hard-fail の一般化があれば `references/` を更新する。

## Related Loops

- Loop 8: run review and next actions
- Loop 10: lesson codification into `references/`
- Loop 5: CLI compatibility refresh for model tables

## First Codification Batch (2026-07-09)

Local ignored evidence was summarized into tracked references without promoting private paths or balances:

| Source class | Promoted into |
|--------------|---------------|
| measured `cost_credits` for V6 / C1 / extend | `references/credit-estimation.md` |
| character drift, scale-only-text, silent audio, action causality | `references/final-video-qa-gate.md` |
| identity anchors, negatives, start-frame, no burned-in text | `references/prompt-library.md` |
| previs-before-credit, regenerate only failed cuts, local audio repair | `references/pixverse-best-practices.md` |

Keep future batches small: one failure class or one measured rate at a time.
