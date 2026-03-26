# PixVerse Character Pipeline

[English](./README.md)

このリポジトリは、CLI を人が直接叩くための説明書というより、AI エージェントに自然言語で依頼して使うためのパイプラインです。  
ユーザーは「何を作りたいか」を自然文で伝え、エージェントはそれを `project.yaml` に正規化し、PixVerse と Remotion で最終動画まで実行します。

## まずどう頼むか

AI エージェントへの入口は、コマンドではなく依頼文です。

たとえば次のように頼めます。

```text
このキャラ画像から、日本語と英語の案内動画を作って。
背景は実写っぽいスタジオで、16:9 と 9:16 の両方ほしい。
まずは dry-run で計画だけ見せて。
```

```text
このキャラを使って、春キャンペーンの短い告知動画を作って。
冒頭は PixVerse 生成、最後は手元の endcard.png を使って。
BGM は assets/bgm.mp3 を使ってください。
```

```text
この画像を元に、縦動画の SNS 用キャラクター動画を作って。
英語だけでいいです。実写背景は都会のオフィス風で。
```

```text
このキャラをリファレンスしてから、神社の夜を舞台に4カットの短いストーリー動画を作って。
各カットは別シーンにして、最後にBGMとテロップを入れて。
```

```text
既存の spokesperson.yaml を読み込んで、今の project.yaml 形式で実行して。
最終的に render までやって。
```

## AI エージェントへの依頼仕様

エージェントは、自然言語の依頼から次の情報を解釈または確認して実行します。

- `project`
  - 案件名
  - 日付
  - slug
- `speaker`
  - キャラ名
  - キャラ画像パス
  - `single` または `reference`
- `locales`
  - 言語ごとの clip 構成
  - テーマ色
  - BGM
- `clips`
  - `generated | reference | video | image`
  - クリップ順
  - テキスト、音声、素材パス
  - オーバーレイ文言
- `render`
  - アスペクト比
  - FPS
  - 出力先
- `generation`
  - PixVerse モデル
  - 品質
  - upscale の有無
  - 実写背景の雰囲気を決める prompt

## エージェントが足りない情報を聞くとき

依頼文だけで不足がある場合、エージェントは次の順で短く確認します。

1. 案件名と日付
2. キャラ画像パス
3. 生成したい言語
4. 各言語の clip 構成
5. アスペクト比
6. 実写背景の方向性

確認のゴールは、最終的に `project.yaml` を組める状態にすることです。

## エージェントの実行ルール

このリポを使う AI エージェントは、基本的に次の順で動きます。

1. 自然言語の依頼を `project.yaml` に正規化する
2. `project.yaml` または legacy の `spokesperson.yaml` を読み込む
3. `validate` で検証する
4. `plan` で job 数と variant 数を確認する
5. ユーザーが確認優先なら `run --dry-run` を使う
6. 実行許可があるなら `run` で PixVerse 生成から最終 render まで進める
7. ローカル素材だけのときは `render` を使う

ストーリー依頼の既定動作:

1. 3-5 個のビートに分解する
2. 各ビートを `pixverse create reference --images` で個別生成する
3. 各カットに `pixverse create speech` を重ねる
4. 各ビートを `source: reference` として `project.yaml` に書く
5. 最後に `./bin/pipeline run` で reference 生成から BGM / テロップ込みの最終 render まで進める

シェルの Node / PATH 解決が不安定な環境では、`pnpm pipeline:*` ではなく `./bin/pipeline` を正式入口として使います。

## 依頼から実行までの例

### 例1: まず計画だけ見たい

ユーザー:

```text
このキャラ画像から、実写背景の日本語・英語動画を作って。
16:9 と 9:16 の両方ほしい。まずは dry-run で。
```

エージェント:

- 不足情報があれば追加で聞く
- `project.yaml` を作る
- `./bin/pipeline validate`
- `./bin/pipeline plan`
- `./bin/pipeline run --dry-run`
- 出力予定の variant と manifest を報告する

### 例2: ローカル素材だけで render したい

ユーザー:

```text
この動画素材と endcard 画像をつないで、英語の 16:9 を 1 本だけ出して。
PixVerse 生成はなしで。
```

エージェント:

- `video` / `image` clip の `project.yaml` を組む
- `./bin/pipeline validate`
- `./bin/pipeline render --lang en --ratio 16:9`

### 例3: 旧 config をそのまま使いたい

ユーザー:

```text
fixtures/legacy/spokesperson.yaml を使って render して。
```

エージェント:

- legacy config を読み込む
- 内部で `project.yaml` 相当へ正規化する
- 通常の pipeline と同じ手順で実行する

## `project.yaml` の意味

自然言語の依頼は、最終的に次のような構造へ落ちます。

```yaml
project:
  slug: my-campaign
  title: Spring Campaign
  date: "2026-03-21"

speaker:
  name: Reporter Hana
  images:
    - ./assets/hana.png
  mode: single

locales:
  ja:
    theme:
      background: "#111111"
      accent: "#ff6b35"
      text: "#ffffff"
    clips:
      - id: intro
        source: generated
        text: 本日のお知らせです
        ttsSpeaker: 1
        durationSeconds: 5
        overlayText: 春のキャンペーン開始
        overlayStyle: title
      - id: teaser-beat
        source: reference
        prompt: The same character from the reference image stands in a moonlit shrine courtyard, slow push in, vertical portrait framing.
        text: 物語の扉が開く。
        ttsSpeaker: 1
        durationSeconds: 4
        overlayText: 物語の扉が開く
        overlayStyle: subtitle
      - id: endcard
        source: image
        asset: ./assets/endcard.png
        durationSeconds: 3
        overlayText: example.com
        overlayStyle: endcard

render:
  aspectRatios: ["16:9", "9:16"]
  fps: 30
  outputDir: ./output

generation:
  model: v5.6
  quality: 1080p
  upscale: true
  ambientSound: null
  prompt:
    base: A talking character derived from the provided character image, speaking directly to camera in a photoreal live-action environment with realistic depth and polished cinematic lighting
```

PixVerse 側では `generation.prompt.base` / `generation.prompt.perRatio` を使って、キャラ画像から実写背景込みのシーンを生成します。`source: reference` のクリップは、各カットごとの `prompt` を使って `pixverse create reference --images` で個別生成されます。

`generated` / `reference` / `video` の各クリップでは、`audioVolume` (`0`-`1`) も指定でき、BGM に対する音量バランスを調整できます。

## 出力

`run` の結果は次の構成で出ます。

```text
output/<project-slug>/<run-id>/
  manifest.json
  <lang>/<ratio>/
    manifest.render.json
    character.mp4
    assets/*
```

- `manifest.json`
  - batch 全体の要約
- `manifest.render.json`
  - Remotion に渡す variant 単位の manifest
- `character.mp4`
  - 最終動画

Remotion 用の staging は `remotion/public/.pipeline/` に自動生成されます。

## セットアップ

### 1. PixVerse CLI を準備する

PixVerse CLI を使う前に、次を満たしておく必要があります。

- Node.js 20 以上
- PixVerse アカウント
- 有効な PixVerse の subscription

PixVerse CLI は Web と同じ credit を使います。大量実行の前に、残クレジット確認まで含めてセットアップしておくのが前提です。

インストール:

```bash
npm install -g pixverse
pixverse --version
```

グローバル install を避けたい場合は `npx pixverse` でも動かせます。

### 2. ログインする

```bash
pixverse auth login
```

- CLI が URL とコードを表示します
- ブラウザで認証すると、token は `~/.pixverse/` に保存されます
- token の有効期間は通常 30 日です

ログイン確認と credit 確認:

```bash
pixverse auth status
pixverse account info
```

### 3. このリポの依存を入れる

```bash
cd remotion
pnpm install
```

PixVerse を使う場合は `pixverse` を PATH 上に置くか、`PIXVERSE_BIN=/path/to/pixverse` を設定します。  
すでに `pixverse` コマンドが通っていれば、そのままこのリポから利用できます。

## CLI を直接使いたいとき

人が手で確認したい場合は、次のコマンドも使えます。

```bash
cd remotion

./bin/pipeline validate --config ../fixtures/generated/project.yaml
./bin/pipeline plan --config ../fixtures/generated/project.yaml
./bin/pipeline run --config ../fixtures/generated/project.yaml --dry-run
./bin/pipeline story --image ../fixtures/shared/assets/speaker.svg --config-out ./story.yaml
./bin/pipeline render --config ../fixtures/basic/project.yaml --lang en --ratio 16:9
```

- `validate`
  - config を正規化して検証する
- `plan`
  - variant 数と job 数を見る
- `run`
  - PixVerse 生成から最終 MP4 まで進める
- `story`
  - 対話で reference ストーリー用の `project.yaml` を作り、そのまま `dry-run` / `run` に進められる
- `render`
  - ローカル素材だけで 1 variant をレンダリングする

## Fixtures / Tests

- `fixtures/basic/project.yaml`
  - ローカル `video` + `image` の render smoke 用
- `fixtures/generated/project.yaml`
  - generated / video / image 混在の plan / dry-run 用
- `fixtures/reference-story/project.yaml`
  - per-cut `reference` ストーリー用
- `fixtures/legacy/spokesperson.yaml`
  - 旧フォーマット互換テスト用

```bash
cd remotion
pnpm typecheck
pnpm test
```
