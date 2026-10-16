# PixVerse Character Pipeline

[English](./README.md) | 日本語

このリポジトリは、CLI を人が直接叩くための説明書というより、AI エージェントに自然言語で依頼して使うためのパイプラインです。  
ユーザーは「何を作りたいか」を自然文で伝え、エージェントはそれを `project.yaml` に正規化し、PixVerse と Remotion で最終動画まで実行します。  
この repo で案内している画像生成・動画生成の標準フローはすべて PixVerse CLI ベースで、Remotion は staging と最終 render にのみ使います。

## 多言語対応と自然言語での使い方

この repo の入口は、コマンドや YAML ではなく「こういう動画を作りたい」という自然文の依頼です。

- README は英語版と日本語版を用意しています。
- 生成動画は `project.yaml` の `locales` で、日本語・英語など複数言語を 1 つの案件として扱えます。
- ユーザーは日本語でも英語でも依頼できます。エージェントは不足情報だけを短く確認し、`validate`、`plan`、必要に応じて `run --dry-run` まで進めます。
- Michibiki への handoff / export も、同じ自然文の中で「Michibiki に渡したい」「HyperFrames や Remotion 側で編集したい」と頼めます。

## Agent Compatibility

このリポは Claude Code と Codex の両方で使える前提で整理しています。

- 実行本体は tool-agnostic で、`project.yaml` と `remotion/./bin/pipeline` が中心
- `.claude/*` はローカル補助設定であり、パイプライン実行の必須条件ではない
- `CLAUDE.md` と `AGENTS.md` に、それぞれの入口向けの同等ガイドを置く
- coordinator / story / planning / QA の sub-agent 分担案も repo 内に含める

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
日本語版と英語版を作って、最後に Michibiki へ渡せる handoff も作って。
HyperFrames か Remotion の編集 project として続きから触れるようにしたい。
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

## 制作ルーティング

プロンプトを書く前に、まず「どの workflow で作るか」を決めます。

- model / workflow の選び方は [`references/model-routing.md`](./references/model-routing.md)
- PixVerse CLI の model support は [`references/model-support.md`](./references/model-support.md)
- PixVerse 制作の実務メモは [`references/pixverse-best-practices.md`](./references/pixverse-best-practices.md)
- クレジット概算は [`references/credit-estimation.md`](./references/credit-estimation.md)
- retry / exit 契約は [`references/exit-codes.md`](./references/exit-codes.md)
- run の教訓を references に戻す手順は [`references/lesson-codification.md`](./references/lesson-codification.md)
- エージェント分担は [`agents/pixverse-production-agents.md`](./agents/pixverse-production-agents.md)

ここでは PixVerse CLI に専念します。runtime の中心は引き続き `project.yaml` -> `validate` -> `plan` -> `run --dry-run` / 承認後 `run` / local `render` です。直接 PixVerse CLI を使う場合も、credit 境界と QA gate は同じです。

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
3. 各カットのナレーションは `pixverse create voice` で音声アセット化するか、`audioFile` を使う
4. 各ビートを `source: reference` として `project.yaml` に書く
5. 最後に `./bin/pipeline run` で reference 生成から BGM / テロップ込みの最終 render まで進める

キャラ画像が添付されたときの既定動作:

1. 複数画像でも既定では `speaker.mode: single` として扱う
2. `generation.model: v6` を維持する
3. `source: reference` では既定で `generation.referenceModel: v6` を使う。C1 寄りのシネマティックな reference 表現を狙う場合だけ `pixverse-c1` に上書きする
4. `generation.image.enabled: true` を維持する
5. この workflow の `generation.image.model` 既定値は `gemini-3.1-flash`、`generation.image.quality` 既定値は `1080p`。PixVerse CLI 1.2.7 では `gpt-image-2.0`、`qwen-image`、`gemini-3.0`、Seedream/Kling 系 image model も利用できる
6. PixVerse の I2I (`create image`) でベース静止画を作ってから、I2V (`create video --image`) を実行する
7. ユーザーが明示的に story / teaser / trailer / multi-cut を要求した場合、または複数の参照画像を渡した場合を除き、`source: reference` や `pixverse create reference` に切り替えない

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
        durationSeconds: 5
        overlayText: 春のキャンペーン開始
        overlayStyle: title
      - id: teaser-beat
        source: reference
        prompt: The same character from the reference image stands in a moonlit shrine courtyard, slow push in, vertical portrait framing.
        text: 物語の扉が開く。
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
  model: v6
  referenceModel: v6
  quality: 720p
  upscale: true
  generateAudio: false
  image:
    enabled: true
    model: gemini-3.1-flash
    quality: 1080p
  prompt:
    base: A talking character derived from the provided character image, speaking directly to camera in a photoreal live-action environment with realistic depth and polished cinematic lighting
```

PixVerse 側では `generation.prompt.base` / `generation.prompt.perRatio` を共有ベース動画向けの動画用プロンプトとして使います。既定では PixVerse の I2I → I2V フローで、`generation.image.enabled` は `true` です。そのため、まず `generation.image.*` を使ってベース静止画を作ってローカルに保存し、その静止画から I2V を実行します。`generation.image.model` は PixVerse CLI に渡す image model 名で、この workflow の既定値は `gemini-3.1-flash` の `1080p` です。PixVerse CLI 1.2.7 では `gpt-image-2.0`、`qwen-image`、`gemini-3.0`、`seedream-5.0-lite`、Kling 系 image model なども利用できます。`generation.image.prompt` を省略した場合は `generation.prompt` がフォールバックとして使われます。動画生成の既定プロファイルは `v6` の `720p` です。

`source: reference` のクリップは、各カットごとの `prompt` を使って `pixverse create reference --images` で個別生成されます。既定の `generation.referenceModel` は `v6` で、必要なら `pixverse-c1` に上書きできます。`generateAudio: true` は PixVerse CLI の `--audio` に対応し、既定の `false` は `--no-audio` に対応します。`generated` / `reference` の `text` は PixVerse `create voice` の音声アセットとして生成し、Remotion でカットに重ねます。既存音声を使う場合は `audioFile`、PixVerse の特定プリセット声を使う場合は確認済みの `voiceId` を指定します。旧 `ambientSound` フィールドは互換用の別名として受け付けますが、削除済みの `create sound` は呼びません。`generated` / `reference` / `video` の各クリップでは、`audioVolume` (`0`-`1`) も指定でき、BGM に対する音量バランスを調整できます。

PixVerse CLI の全モデル表、mode matrix、source 差分メモは [`references/model-support.md`](./references/model-support.md) を参照してください。

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

## Michibiki への任意 export / handoff

Michibiki は、この pipeline の後段に置ける動画制作レイヤーです。PixVerse Character Pipeline でキャラクター動画の素材・render・manifest を作り、その結果を Remotion / HyperFrames / Editframe などの project 生成、preview、再編集へ渡したいときに使います。

Remotion / HyperFrames / Editframe などの動画 project 生成を [Michibiki](https://github.com/Takamasa045/michibiki) 側に任せたい場合は、PixVerse Shotpack と同じように `export` を使います。

```bash
cd remotion
./bin/pipeline export \
  --config ../fixtures/generated/project.yaml \
  --engine remotion
```

既定では次の場所に Michibiki 用ファイルが出ます。

```text
output/<project-slug>/michibiki/
  handoff.json
  video-spec.json
  video-specs/<lang>-<ratio>.json
  README.md
```

この pipeline から Michibiki の project 生成まで呼びたい場合は、`--run-michibiki` と `--michibiki-path` を付けます。

```bash
./bin/pipeline export \
  --config ../fixtures/generated/project.yaml \
  --engine remotion \
  --remotion-mode standalone \
  --michibiki-path ../../michibiki \
  --run-michibiki
```

これは Michibiki リポジトリ上で `pnpm michibiki generate --spec ... --engine remotion --remotion-mode standalone` を実行します。Michibiki の preview や最終 render は実行しません。そこは Michibiki 側で明示的に実行します。外部の Remotion monorepo をあえて使いたい場合だけ `--remotion-mode standalone` を外します。

PixVerse Character Pipeline で作った動画を Michibiki 側でエンジン選定、タイムライン編集、preview、再編集に回したい場合は、`--michibiki-handoff` を付けます。

```bash
cd remotion
./bin/pipeline run \
  --config ../fixtures/generated/project.yaml \
  --dry-run \
  --michibiki-handoff
```

既定では run manifest の隣に handoff が出ます。

```text
output/<project-slug>/<run-id>/michibiki/
  handoff.json
  video-spec.json
  video-specs/<lang>-<ratio>.json
  README.md
```

- `video-spec.json` は Michibiki に渡す主 `VideoSpec`
- `video-specs/` は locale / aspect ratio ごとの `VideoSpec`
- `handoff.json` は全 variant、PixVerse の `manifest.json` への参照、Michibiki の推奨コマンドを記録
- `--michibiki-handoff-dir <dir>` で出力先を変更可能
- `--michibiki-engine remotion|hyperframes|editframe|auto` で run handoff の推奨エンジンを変更可能

Michibiki 側では次のように読み込みます。

```bash
cd ../michibiki
pnpm michibiki decide --spec ../pixverse-character-pipeline/output/<project-slug>/<run-id>/michibiki/video-spec.json
pnpm michibiki generate --spec ../pixverse-character-pipeline/output/<project-slug>/<run-id>/michibiki/video-spec.json --engine editframe
```

Michibiki 側で生成される編集 project、preview、最終 render は、Michibiki リポジトリ内の `outputs/jobs/<job-id>/` に保存されます。Character Pipeline 側には、元の render と handoff ファイルだけを `output/<project-slug>/<run-id>/` 配下に残します。

dry-run でも予定パスつきの handoff は作れます。実際に Michibiki で編集・preview する場合は、参照先 MP4 が存在するように real `run` または local `render` 後に handoff を使ってください。

## セットアップ

### 0. リポジトリをクローンする

```bash
git clone https://github.com/Takamasa045/pixverse-character-pipeline.git
cd pixverse-character-pipeline
```

### 1. PixVerse CLI を準備する

PixVerse CLI を使う前に、次を満たしておく必要があります。

- Node.js 20 以上
- PixVerse アカウント
- 有効な PixVerse の subscription

PixVerse CLI は Web と同じ credit を使います。大量実行の前に、残クレジット確認まで含めてセットアップしておくのが前提です。

この repo では、手順 3 の `pnpm install` で入るローカル CLI を推奨します。手元で CLI を直接確認したい場合だけ、グローバルに入れます。

```bash
npm install -g pixverse
pixverse --version
```

グローバル install を避けたい場合は `npx pixverse@latest` でも動かせます。

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

`pnpm install` で、この repo が pin している PixVerse CLI (`pixverse@^1.2.7`) も入ります。`./bin/pipeline` は `PIXVERSE_BIN` があればそれを使い、未指定なら `remotion/node_modules/.bin/pixverse`、最後に PATH 上の `pixverse` を使います。

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

通常の `run` では PixVerse の `--idempotency-key` を create job に付けます。key は project slug、run-id、variant、stage、実際の command args から作るため、同じ `--run-id` の再試行では二重 credit 消費を起こしにくく、prompt/config を変えた場合は別 job として扱われます。

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
