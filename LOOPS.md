# LOOPS.md

このファイルは、この repo で繰り返し使う作業ループをまとめます。

各ループは、AI エージェントが何を読み、どの順で進め、どこで人間確認を挟むかを定義します。

## Loop 1: Multilingual Announcement Video

用途:

- 多言語の案内動画。
- イベント告知、サービス告知、短いアップデート動画。

入力:

- project title / date
- speaker image path
- locales
- script per locale
- aspect ratios
- background direction
- optional BGM / endcard

読むファイル:

- `VISION.md`
- `AGENTS.md`
- `README.ja.md` or `README.md`
- `references/interactive-questions.md`
- `fixtures/generated/project.yaml`
- `references/prompt-library.md`

手順:

1. 依頼文から不足情報を短く確認する。
2. `source: generated` 中心の `project.yaml` を作る。
3. `validate` を実行する。
4. `plan` で variant count と job count を出す。
5. 必要なら `run --dry-run` で manifest を確認する。
6. 人間承認後にのみ full `run` へ進む。
7. `manifest.json` と final MP4 を確認する。

出力:

- `project.yaml`
- dry-run manifest
- final MP4 per locale / ratio
- run summary

完了条件:

- 依頼された locale / ratio の全 variant が completed。
- failed variant がない。
- final MP4 path と manifest path が報告されている。

人間確認:

- 原稿の事実関係。
- 言語ごとのニュアンス。
- PixVerse credit 消費。
- 公開してよい素材か。

## Loop 2: Reference Story / Teaser

用途:

- 物語型のショート動画。
- teaser / trailer / multi-cut。

入力:

- character image path(s)
- world / setting
- visual mood
- 3-5 story beats
- narration / overlay
- aspect ratio
- optional BGM

読むファイル:

- `SKILL.md`
- `references/prompt-library.md`
- `references/interactive-questions.md`
- `fixtures/reference-story/project.yaml`
- `references/model-support.md`

手順:

1. 3-5 beats を `hook` / `reveal` / `conflict` / `payoff` / `endcard` に整理する。
2. 各 beat の camera work が重複しないようにする。
3. 各 clip を `source: reference` にする。
4. `generation.referenceModel` は既定 `v6`。C1 が必要な理由がある時だけ override する。
5. `validate`、`plan`、`run --dry-run` を実行する。
6. 人間承認後に full `run`。
7. 出力を見て、キャラ一貫性とテンポを評価する。

出力:

- reference story `project.yaml`
- beat-by-beat prompt
- dry-run manifest
- final MP4

完了条件:

- beat 数、尺、camera work が意図と一致。
- 全 reference clip が生成され、render されている。

人間確認:

- 物語の分かりやすさ。
- キャラ崩れ。
- 同じ camera work の繰り返し。
- 生成し直す価値がある clip。

## Loop 3: Local Asset Render

用途:

- 既存動画、画像、endcard を Remotion でつなぐ。
- PixVerse credit を使わない smoke test。

入力:

- local video / image paths
- overlay text
- BGM
- language
- aspect ratio

読むファイル:

- `fixtures/basic/project.yaml`
- `references/manifest-schema.md`
- `remotion/src/CharacterVideo.tsx`

手順:

1. `source: video` / `source: image` の config を作る。
2. `validate` を実行する。
3. `plan` で PixVerse job が 0 であることを確認する。
4. `render --lang <lang> --ratio <ratio>` を実行する。
5. output manifest と MP4 を確認する。

出力:

- local render MP4
- `manifest.json`
- `manifest.render.json`

完了条件:

- PixVerse job なしで completed。
- final MP4 が存在する。

人間確認:

- 素材権利。
- overlay の読みやすさ。
- BGM / original audio の音量。

## Loop 4: Legacy Config Migration

用途:

- 旧 `spokesperson.yaml` を現在の pipeline で扱う。

入力:

- legacy `spokesperson.yaml`
- desired output path

読むファイル:

- `fixtures/legacy/spokesperson.yaml`
- `fixtures/legacy/project.yaml`
- `remotion/src/lib/config.ts`
- `references/manifest-schema.md`

手順:

1. legacy config を読む。
2. 現行 `ProjectConfig` 相当に正規化される前提を確認する。
3. `validate` で source format を確認する。
4. `plan` で job count を確認する。
5. 必要なら dry-run。

出力:

- normalized config summary
- dry-run manifest
- migration notes

完了条件:

- legacy config が validate できる。
- 現行 config と出力意図が一致している。

人間確認:

- 古い原稿や素材をそのまま使ってよいか。
- 旧 ambient sound 指定の扱い。

## Loop 5: PixVerse CLI Compatibility Refresh

用途:

- PixVerse CLI の version / flags / model support を更新する。

入力:

- current npm version
- CLI help output
- official docs or npm README
- existing model support table

読むファイル:

- `references/model-support.md`
- `remotion/package.json`
- `remotion/src/lib/pixverse.ts`
- `remotion/src/lib/pipeline.ts`
- `remotion/src/test/pixverse.test.ts`
- `CHECKS.md`
- `DECISIONS.md`

手順:

1. upstream version と repo-pinned version を確認する。
2. CLI help を各 command で確認する。
3. docs と CLI help が食い違う場合、現在の CLI help と platform capability を分けて記録する。
4. wrapper args と tests を更新する。
5. `typecheck` と `test` を実行する。
6. 必要なら fixture dry-run を実行する。
7. 判断理由を `DECISIONS.md` に追記する。

出力:

- updated model support table
- updated arg builders / tests
- decision log entry

完了条件:

- tests が通る。
- docs と implementation の既定値が一致。
- pinned exception が説明されている。

人間確認:

- 互換性を壊していないか。
- credit 消費前の挙動が保たれているか。

## Loop 6: Public Submission / GitHub Readiness

用途:

- PixVerse skill submission。
- GitHub 公開。
- public demo / release material の準備。

入力:

- repo link or zip policy
- sample MP4
- terminal screenshot
- submission target
- public-safe release note

読むファイル:

- `submission/pixverse-cli-skill-submission.md`
- `submission/submission-checklist.md`
- `submission/github-readiness-checklist.md`
- `submission/email-template.txt`
- `CHECKS.md`

手順:

1. public check を実施する。
2. README / SKILL / references の整合を確認する。
3. sample MP4 と terminal screenshot の有無を確認する。
4. private assets、raw run logs、local absolute paths が tracked docs に入っていないか確認する。
5. email template の placeholder を埋める。
6. zip する場合、exclude list を確認する。

出力:

- submission email
- readiness report
- optional zip
- optional sample MP4 link
- optional release note

完了条件:

- private assets / secrets / ignored outputs を含めない。
- repo story が 2 分以内に伝わる。

人間確認:

- 公開範囲。
- 送信先。
- sample の品質。

## Loop 7: Content Repurposing

Status:

- Optional and public-safe.
- This repo's core is the PixVerse character pipeline. Content repurposing should stay generalized unless a downstream content repo owns the specific event or campaign details.

用途:

- 完成動画や repo の思想を、public demo、SNS、article、event copy、slide outline へ展開する。

入力:

- completed MP4 or dry-run proof
- target audience
- public event / campaign date, if applicable
- CTA
- allowed claims

読むファイル:

- `VISION.md`
- `README.ja.md`
- `submission/pixverse-cli-skill-submission.md`
- `output/**/manifest.json`

手順:

1. 完成物または proof を確認する。
2. 誰に向けた発信かを決める。
3. 「PixVerse CLI の使い方」だけでなく「AI エージェントが制作スタッフになる」文脈へつなげる。
4. public-safe な投稿、article outline、event copy、slide outline のいずれかに落とす。
5. 日付、URL、権利表記、claims を人間確認へ回す。
6. private campaign details はこの repo に残さず、必要なら下流の private workspace に置く。

出力:

- SNS post
- article outline / draft
- event copy
- slide outline

完了条件:

- 対象者、持ち帰れるもの、CTA が明確。
- 実際に repo や sample に基づいた内容になっている。

人間確認:

- 日付と募集条件。
- 言い過ぎがないか。
- PixVerse や第三者素材の扱い。
- この OSS repo に残してよい内容か。

## Loop 8: Run Review / Next Action

用途:

- 過去 run、dry-run、失敗、未評価メモを public-safe な次の改善に変える。

入力:

- `output/**/manifest.json`
- `output/runs/**/*.md`
- `git status`
- latest user goal

読むファイル:

- `CHECKS.md`
- `DECISIONS.md`
- `NEXT_ACTIONS.md`
- relevant manifest

手順:

1. manifest の summary を見る。
2. failed / planned / completed を分ける。
3. raw log に private path、personal note、account information がないか意識して読む。
4. `Human Eval pending` や failed output を探す。
5. 技術修正、docs 修正、sample 生成、公開準備に分類する。
6. public-safe な要約だけを `NEXT_ACTIONS.md` に 1-5 個の具体タスクとして戻す。
7. external contributor に依頼できる粒度になったら GitHub Issue 化を検討する。

出力:

- short review summary
- updated next actions
- optional decision entry

完了条件:

- 未評価 run が放置されていない。
- 次の一手が public-safe な形で repo 内または GitHub Issues に残る。

人間確認:

- どの出力を採用するか。
- 生成し直すか、docs 改善で済むか。

## Loop 9: PixVerse CLI Production Routing

用途:

- プロンプト集ではなく、目的、CLI command family、モデル候補、QC、再生成判断までを決める。
- `create video` / `create image` / `create reference` / `motion-control` / `transition` / `modify` / `extend` / `upscale` / `voice` / `music` / batch を使い分ける。

入力:

- user request
- character / product / environment references
- target platform
- desired output type
- public-safe constraints

読むファイル:

- `references/model-routing.md`
- `references/pixverse-best-practices.md`
- `references/model-support.md`
- `agents/pixverse-production-agents.md`
- `CHECKS.md`

手順:

1. 目的を T2V / I2V / image / reference / motion-control / transition / modify / post-process / audio / batch / local render に分類する。
2. Model Router が primary command family と fallback command family を選ぶ。
3. 必要なら `templates/brief.md`、`templates/shotlist.yaml`、`templates/cli-batch-plan.md` を作る。
4. pipeline で扱う場合だけ `project.yaml` に落とす。
5. `validate` と `plan` で job count と credit risk を確認する。
6. full `run` は明示承認後にだけ進める。
7. 生成後は `references/final-video-qa-gate.md` と `templates/qc-report.md` で採用判断を分ける。
8. QA を通った場合だけ post package や downstream edit に進む。

出力:

- command family / model routing summary
- optional brief / shotlist / CLI batch plan
- optional `project.yaml`
- job count and risk summary
- QC report
- optional accepted-output package

完了条件:

- なぜその command family と model candidate を選んだか説明できる。
- 直接 PixVerse CLI を使う場合も credit boundary と QA gate が明確。
- PixVerse credit を使う前に approval boundary が明確。

人間確認:

- 生成 credit を使ってよいか。
- どの出力を採用し、どれを再生成するか。
