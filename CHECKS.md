# CHECKS.md

このファイルは、AI エージェントと人間が作業前後に確認するチェックリストです。

PixVerse credit を消費する操作、公開前確認、モデル更新、render 検証をここに集約します。

## Open Source Hygiene

この repo は OSS 公開前提で扱う。

- tracked file に private client / event / seminar の固有情報を書かない。
- PixVerse account、token、credit 残高、認証状態を書かない。
- local absolute path は、公開手順や submission 文面に残さない。
- `output/`、`output/runs/`、`remotion/public/.pipeline/` の生ログや生成物を、そのまま tracked file に昇格しない。
- sample asset を追加する場合、権利と公開範囲を確認する。
- contributor が読んでも意味が通る一般化された wording にする。

## Universal Pre-Check

作業前に確認する。

- `git status --short` で既存の未コミット差分を把握した。
- 依頼が「分析だけ」か「編集してよい」かを確認した。
- 生成実行が必要な場合、PixVerse credit を消費する可能性を明示した。
- `README.md` / `README.ja.md` / `SKILL.md` / `AGENTS.md` の該当箇所を読んだ。
- 対象 workflow に近い `fixtures/*/project.yaml` を確認した。
- 変更対象が docs だけか、runtime code も含むかを分けた。

## Safe Commands Before Approval

PixVerse credit を消費しない前提で実行できるもの。

```bash
cd remotion
./bin/pipeline validate --config <path>
./bin/pipeline plan --config <path>
./bin/pipeline run --config <path> --dry-run
./bin/pipeline render --config <path> --lang <lang> --ratio <ratio>
pnpm typecheck
pnpm test
```

注意:

- `render` は local `video` / `image` clip のみで使う。
- `run --dry-run` でも `output/` と `remotion/public/.pipeline/` に manifest が書かれることがある。
- `output/` は gitignore 対象だが、確認用の truth surface として読んでよい。

## Commands Requiring Explicit Approval

次は必ず人間の明示承認を取る。

```bash
cd remotion
./bin/pipeline run --config <path>
./bin/pipeline story --run
pixverse create ...
pixverse task wait ...
pixverse asset download ...
```

承認前に報告する内容:

- config path
- run-id
- variant count
- image/base/reference/speech/upscale job counts
- PixVerse credit or slot risk
- generated / reference / local clip の内訳

## Config Check

`project.yaml` を作る、または編集した後に確認する。

- `project.slug` は短く、出力パスとして安全。
- `project.date` は `YYYY-MM-DD`。
- `speaker.images` は存在する local path。
- 通常の添付画像 workflow は `speaker.mode: single`。
- story / teaser / trailer / multi-cut は `source: reference` を検討した。
- `render.aspectRatios` は supported ratio のみ。
- `generation.model` と `generation.referenceModel` の意図が説明できる。
- `generation.image.enabled` を変える場合、I2I を外す理由がある。
- `overlayText` は画面内に収まる長さ。
- BGM と video 音声の `audioVolume` が競合しない。

## Plan / Dry-Run Check

`plan` または `run --dry-run` の後に確認する。

- variant count が依頼と一致している。
- job count が想定範囲。
- generated clips と reference clips の数が意図通り。
- dry-run manifest の `status` が `planned`。
- 出力予定パスが `output/<project-slug>/<run-id>/` に集約される。
- failed / skipped がある場合、exact error を残す。

## Render Output QA

local render または full run の後に確認する。

- `manifest.json` が存在する。
- 各 variant に `manifest.render.json` が存在する。
- final MP4 path が manifest に記録されている。
- 期待する language / aspect ratio がすべて出ている。
- duration が clips の合計と大きくズレていない。
- video / image / bgm assets が staging にコピーされている。
- failed variant がある場合は `NEXT_ACTIONS.md` に戻す。

## Runtime Code Check

`remotion/src` を変えたときに実行する。

```bash
cd remotion
pnpm typecheck
pnpm test
```

必要に応じて追加:

```bash
cd remotion
./bin/pipeline validate --config ../fixtures/generated/project.yaml
./bin/pipeline plan --config ../fixtures/generated/project.yaml
./bin/pipeline run --config ../fixtures/generated/project.yaml --dry-run
./bin/pipeline render --config ../fixtures/basic/project.yaml --lang en --ratio 16:9
```

## PixVerse CLI Update Check

PixVerse CLI や model table を更新するとき。

- `npm view pixverse version` で latest を確認した。
- repo-local `remotion/node_modules/.bin/pixverse` の version を確認した。
- `create video` / `create reference` / `create image` / `create speech` / `create upscale` / `task wait` / `asset download` の help を確認した。
- `references/model-support.md` と code の既定値が矛盾しない。
- "latest everything" ではなく "latest compatible" として判断した。
- pinned exception がある場合、理由を `DECISIONS.md` に残した。

## Public / Submission Check

GitHub link、zip、PixVerse submission、public demo 配布前に確認する。

- private assets / private run logs が含まれていない。
- secrets / API keys / `.env` が含まれていない。
- local absolute path が README、submission、tracked docs に残っていない。
- `output/`、`remotion/public/.pipeline/`、`remotion/node_modules/` を含めない。
- README の日本語版と英語版の入口が一致している。
- sample MP4 を出す場合、権利と公開範囲を確認した。
- `submission/email-template.txt` の placeholder を埋めた。
- GitHub Issues / README / tracked docs に置く情報と、個人運用メモに残す情報を分けた。

## Human Review Points

人間が見るべきもの。

- キャラクターの一貫性。
- 実写背景へのなじみ方。
- 口パク、音声、BGM の自然さ。
- テロップの読みやすさ。
- 生成 credit を使う価値があるか。
- 公開・提出してよい素材か。
