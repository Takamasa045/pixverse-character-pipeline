# VISION.md

このリポジトリは、PixVerse CLI と Remotion を、AI エージェントが継続的に扱える制作パイプラインとして整えるための作業場です。

人が毎回コマンドを思い出して実行するのではなく、AI エージェントが既存の文脈を読み、`project.yaml` を組み、計画を出し、検証して、次の改善につなげられる状態を目指します。

## Project Purpose

- キャラクター画像から、実写背景になじむ案内動画・プロモ動画・ストーリー動画を作る。
- 自然言語の依頼を `project.yaml` に正規化し、再現可能な制作フローに落とす。
- PixVerse CLI の生成力と Remotion の編集・レンダリングを、AI エージェントが安全に運用できる形にする。
- 多言語、多アスペクト比、dry-run、manifest、legacy config 互換を、単発ではなく反復可能な運用にする。

## Who This Is For

- キャラクター動画を短い依頼文から作りたい制作者。
- PixVerse CLI を手動実行ではなく、AI エージェント経由で運用したい人。
- デモ、教材、SNS、告知、プロモーション用に動画制作フローを再利用したい人。
- CLI、YAML、Remotion による自動化を受け入れられる terminal-first な制作チーム。

## Core Values

- Agent-first: 入口はコマンド暗記ではなく、自然言語の依頼と repo 内文脈。
- Plan before spend: PixVerse credit を使う前に `validate`、`plan`、`run --dry-run` で確認する。
- Reproducible output: `project.yaml`、`manifest.json`、`manifest.render.json` を制作の証跡にする。
- Local truth: README、SKILL、references、fixtures、manifest を優先して判断する。
- Compatible, not blindly latest: PixVerse CLI や Remotion は、最新化より「現在の repo で動く互換性」を優先する。
- Small changes: 大きな構成変更より、運用しながら改善できる小さな差分を積む。

## Creative Direction

この repo の標準表現は、キャラクターをただ動かすことではなく、キャラクターを実写風の環境に自然になじませることです。

既定の方向性:

- photoreal / live-action-style background
- character naturally composited into real photograph
- clean composition
- polished cinematic lighting
- subtle movement, natural blinking, speaking directly to camera

ストーリー、ティザー、トレーラーでは、1 本の共有ベース動画ではなく、3-5 個の beat に分けて `source: reference` を使うことを優先します。

## What This Repo Is

- AI エージェント向けの PixVerse Character Pipeline。
- `project.yaml` を中心にした制作 OS。
- PixVerse CLI の model / command 追随メモ。
- Remotion render manifest の staging と final MP4 出力環境。
- GitHub 公開や PixVerse skill submission のための説明・チェック材料。

## Open Source Boundary

この repo は OSS として公開される前提で読む。

公開してよいもの:

- project の目的、設計思想、workflow、検証手順。
- PixVerse CLI と Remotion の integration pattern。
- neutral fixture、sample config、prompt template。
- contributor / maintainer 向けの作業ループ。
- 一般化された submission / demo checklist。

公開しないもの:

- PixVerse account、token、credit 残高、認証状態。
- private client / event / seminar の固有情報。
- 未公開キャラクター画像、音声、動画素材、個人ファイルパス。
- DM、メール、売上、参加者情報などの運用生データ。
- `output/` や `output/runs/` の生ログを、確認なしで tracked file に昇格したもの。

この repo 内の運用ファイルは、private memory ではなく公開 contributor workflow として書く。

## What This Repo Is Not

- 汎用動画編集ソフトではない。
- すべての PixVerse 機能を薄く包む wrapper ではない。
- 手動 CLI コマンド集だけの README ではない。
- PixVerse credit を自動で消費し続ける unattended generator ではない。
- セミナーや SNS 投稿だけを管理するコンテンツ repo ではない。ただし、完成物を公開可能な発信素材へ展開する optional loop は持つ。

## Truth Sources

AI エージェントは、判断前に次を優先して読む。

1. `VISION.md`
2. `AGENTS.md`
3. `README.md` または `README.ja.md`
4. `SKILL.md`
5. `references/interactive-questions.md`
6. `references/model-support.md`
7. `references/credit-estimation.md` and `references/exit-codes.md` for spend / retry planning
8. `references/lesson-codification.md` when promoting run learnings
9. `fixtures/*/project.yaml`
10. `output/**/manifest.json` when reviewing a completed or dry-run output

`output/` is ignored by git. It may be used as local evidence during a session, but permanent public knowledge should be summarized into tracked docs without private details. Reusable operational lessons belong in `references/`, unfinished work in `NEXT_ACTIONS.md`, and policy changes in `DECISIONS.md`.

## Success Definition

この repo がよい状態とは、次の状態です。

- 初見の AI エージェントが、目的と制約を読んで迷わず作業に入れる。
- 生成前に job count、variant count、credit risk が見える。
- 実行後に manifest と出力ファイルで検証できる。
- なぜその既定値・モデル・手順になったかが `DECISIONS.md` に残っている。
- 次にやることが `NEXT_ACTIONS.md` で分かる。
- 失敗や未評価の出力が、次の改善ループへ戻る。
- 再利用できる運用教訓が `references/` に成文化され、session memory に閉じない。
