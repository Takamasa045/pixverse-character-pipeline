---
name: character-video-pipeline
description: >
  Generate character videos from a single character image. Three modes:
  (A) Creative workflow — 3-view turnaround, cut image compositing, I2V, lip sync, Remotion edit.
  (B) Config-driven pipeline — project.yaml → validate → plan → run → render.
  (C) Reference story workflow — per-cut `pixverse create reference --images` → speech → pipeline timeline.
  Use when the user says "character video", "talking character", "lip sync video",
  "キャラクター動画", "多言語アナウンス動画", "multilingual video",
  "このキャラで動画作って", "キャラを実写背景に馴染ませて".
metadata:
  version: "3.2"
---

# Character Video Pipeline

キャラクター画像1枚から、実写背景に馴染ませた紹介動画・多言語アナウンス動画を制作する。

## When to Use

- キャラ画像から紹介動画・プロモ動画を作りたいとき
- アニメキャラ × フォトリアル背景の映像を作りたいとき
- キャラ一貫性を保ったまま複数カットの動画を作りたいとき
- 多言語・複数アスペクト比のバッチ生成が必要なとき

## Three Modes

| | Mode A: Creative Workflow | Mode B: Config-Driven Pipeline | Mode C: Reference Story Workflow |
|--|--------------------------|-------------------------------|----------------------------------|
| 駆動 | エージェントがフェーズごとに実行 | `./bin/pipeline` CLI が自動実行 | エージェントが各カットを個別生成し、最後だけ pipeline で編集 |
| 向き | 単言語、カット構成にこだわりたい | 多言語バッチ、再現性重視 | ティザー、トレーラー、物語型のマルチカット |
| 入力 | キャラ画像 + 対話 | `project.yaml` | キャラ画像 + 対話 |
| 画像/動画生成 | Nano Banana MCP + PixVerse I2V | PixVerse（プロンプト駆動） | PixVerse `create reference --images` を各カットごとに使う |
| 出力 | `manifest.json`（手動） → Remotion | `manifest.render.json`（自動） → Remotion | ローカル `video` クリップを並べた `project.yaml` → Remotion |

---

## Critical Rules

1. **3面図は必ず最初に作る** — キャラ一貫性の土台。複数カットに進む前に必須（Mode A）
2. **画像生成は Nano Banana を使う** — `maintainCharacterConsistency: true` + `blendImages: true`。3面図を `inputImagePath` に渡す（Mode A）
3. **動画生成は I2V のみ** — 合成画像を入力にする。T2V は使わない（キャラが崩れる）
4. **ナレーションは PixVerse `create speech`** — 動画に直接焼き込む。Remotion は `hasAudio: true` で音声をそのまま使う
5. **Every PixVerse call must include `--json`**
6. **カメラワークの重複禁止** — 全カット同じカメラワークにしない（→ `references/prompt-library.md`）
7. **固定尺スライドショー禁止** — カットごとに秒数を変えてリズムを作る（4/5/6/4/3s など）
8. **構成設計は `short-video-editing` スキルに従う**
9. **`story` / `teaser` / `trailer` / `multi-cut` 指示では Mode C を優先** — 共有ベース動画ではなく、各カットを個別に `pixverse create reference --images` で作る
10. **Mode C では `source: reference` を優先** — pipeline runtime で各カットを直接 reference 生成できる。すでにローカル素材化済みなら `video` へ落としてよい

---

## Mode A: Creative Workflow

```
キャラ画像 (1枚)
    ▼
Phase 1: 3面図生成 (Nano Banana)
    ▼
Phase 2: カット画像生成 (Nano Banana) — 実写背景に合成
    ▼
Phase 3: I2V 動画化 (PixVerse CLI)
    ▼
Phase 4: リップシンク TTS (PixVerse CLI)
    ▼
Phase 5: Remotion 編集・レンダリング
    ▼
完成動画 (.mp4)
```

### Phase 1: 3面図生成

Nano Banana MCP で正面・3/4・背面の3アングルを生成:

```
mcp__nano-banana-2__generate_image:
  prompt: "Character turnaround sheet of [キャラ説明].
           Three views side by side: front view, 3/4 view, and back view.
           Clean white background, full body, consistent proportions,
           character design reference sheet style"
  inputImagePath: [元キャラ画像の絶対パス]
  aspectRatio: "16:9"
  quality: "quality"
  maintainCharacterConsistency: true
  purpose: "character design reference sheet for video production"
  imageSize: "2K"
```

### Phase 2: カット画像生成

3面図を参照して、カットごとの合成画像を生成:

```
mcp__nano-banana-2__generate_image:
  prompt: "[キャラ説明] in [シーン説明].
           Photorealistic [背景説明].
           Character naturally composited into real photograph.
           [ショットサイズ], [ライティング]"
  inputImagePath: [3面図画像の絶対パス]
  aspectRatio: "16:9" or "9:16"
  quality: "quality"
  maintainCharacterConsistency: true
  blendImages: true
  purpose: "Video production reference image for I2V generation"
  imageSize: "2K"
```

プロンプトのコツ:
- `"character naturally composited into real photograph"` を必ず入れる
- 背景は `"photorealistic"` `"real"` を明示する
- キャラ説明は性別・髪型・服装を毎回書く（一貫性のため）

### Phase 3: I2V 動画化

```bash
pixverse create video \
  --image [合成画像パス] \
  --prompt "[シーンの動き・変化を2-4文で記述]" \
  --aspect-ratio 16:9 \
  --model v5.6 \
  --duration [4-8] \
  --quality 1080p \
  --no-wait --json
```

プロンプトのコツ:
- 動きの始まりと終わりを書く（transition_description）
- キャラの微動（まばたき、髪の揺れ、呼吸）を指示する
- 背景の動き（風、光、雲）も加える
- カメラワークを文中に含める（→ `references/prompt-library.md`）

### Phase 4: リップシンク TTS

ナレーション付きカットに適用:

```bash
pixverse create speech \
  --video [動画ファイルパス] \
  --tts-text "[ナレーションテキスト]" \
  --no-wait --json
```

注意:
- 日本語の場合「AI」→「えーあい」など読み補正が必要なことがある
- 生成後の動画は尺が変わる場合がある。`durationInFrames` を確認
- `--keep-original-sound` で元の動画音声を残せる

### Phase 5: Remotion 編集

manifest.json を手動で作成し、Remotion でレンダリング:

```json
{
  "bgm": "assets/audio/bgm.mp3",
  "bgmVolume": 0.12,
  "speakerImage": "assets/speaker.jpg",
  "theme": {
    "background": "#1a2e1a",
    "accent": "#D4913A",
    "text": "#ffffff"
  },
  "cuts": [
    {
      "id": "hook",
      "startFrame": 0,
      "durationInFrames": 120,
      "videoSrc": "assets/cuts/cut-hook.mp4",
      "imageSrc": null,
      "overlayText": "",
      "overlayStyle": "none",
      "hasAudio": false
    }
  ]
}
```

**overlayStyle**: `"none"` / `"subtitle"` / `"title"` / `"lower-third"` / `"endcard"`

**hasAudio ルール**:

| ケース | hasAudio | 説明 |
|--------|----------|------|
| PixVerse TTS 適用済み | `true` | 動画の音声をそのまま使う |
| BGM のみ | `false` | 動画をミュート再生 |
| エンドカード | `false` | 静止画なので音声なし |

レンダリング後は `ffprobe` で検証（尺・ストリーム・黒フレーム）。

---

## Mode B: Config-Driven Pipeline

Mode B は案内動画や多言語量産には向くが、強い場面転換が必要なストーリー動画にはそのままだと不向き。
`source: generated` はアスペクト比ごとに 1 本のベース動画を共有するため、カットごとに背景や演出を大きく変えたい場合は Mode C を使う。

### Config Model

`project.yaml` が入力:

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

`project.yaml` がない場合 → `references/interactive-questions.md` のフローでヒアリング。

### Clip Semantics

- `source: generated` — requires `text` or `audioFile`, uses PixVerse `create speech`
- `source: video` — requires `asset`, uses local file in Remotion
- `source: image` — requires `asset`, renders as still/endcard

Optional: `overlayText`, `overlayStyle`, `ttsSpeaker`, `hasAudio`

---

## Mode C: Reference Story Workflow

ストーリー型の依頼では、キャラを各カットで直接リファレンスしながら別シーンを個別生成し、`source: reference` クリップとして pipeline に流す。

```
キャラ画像 (1-7枚)
    ▼
Phase 1: 3-5個のストーリービートを設計
    ▼
Phase 2: 各ビートを `pixverse create reference --images` で個別生成
    ▼
Phase 3: 各カットへ `pixverse create speech` でTTSを重ねる
    ▼
Phase 4: pipeline 内で download / sound / upscale を処理
    ▼
Phase 5: `manifest.render.json` を組み、BGM・テロップ付きで render
    ▼
完成動画 (.mp4)
```

### When Mode C Is The Default

- ユーザーが「物語」「ティザー」「トレーラー」「マルチカット」「このキャラを主人公に」と言ったとき
- シーンごとに背景、カメラ、演出を大きく変えたいとき
- 1言語でも、映像体験を優先したいとき

### Story Construction Rules

1. 3-5 カットで組む
2. 各カットに明確な役割を持たせる
3. 各カットごとに `camera work` を変える
4. ナレーションは 1 カット 1 文までに圧縮する
5. 最終 `project.yaml` はまず `source: reference` を使う。ローカル素材が確定している場合だけ `source: video` に落とす

### PixVerse Per-Cut Generation

```bash
pixverse create reference \
  --images [キャラ画像1..n] \
  --prompt "[シーン説明]. [キャラの動き]. [背景の動き]. [カメラワーク]." \
  --aspect-ratio 9:16 \
  --model v5.6 \
  --duration [4-6] \
  --quality 1080p \
  --no-wait --json
```

注意:
- `pixverse create reference --images` は 1-7 枚で使える
- ただし pipeline config の `speaker.mode=reference` は 2-7 枚必須
- 画像が1枚なら `speaker.mode: single` のまま `source: reference` クリップを使ってよい
- 画像が2枚以上なら `speaker.mode: reference` にしてもよい

### Final Timeline Config Pattern

```yaml
speaker:
  name: My Character
  images:
    - ./assets/character.png
  mode: single

locales:
  ja:
    bgm: ./assets/bgm.mp3
    bgmVolume: 0.35
    clips:
      - id: beat-01
        source: reference
        prompt: The same character from the reference image steps into a moonlit shrine path, slow push in, vertical portrait framing.
        text: 物語が動き出す。
        ttsSpeaker: 1
        durationSeconds: 4
        overlayText: 物語の始まり
        overlayStyle: subtitle
        hasAudio: true
      - id: beat-02
        source: reference
        prompt: The same character from the reference image turns toward camera as the gate glows behind them, gentle orbit shot.
        durationSeconds: 4
        overlayText: 目覚める力
        overlayStyle: subtitle
```

Mode C では `./bin/pipeline run --config <story.yaml>` を使い、`referenceJobs` を含む PixVerse 生成と Remotion 編集の両方が走る。すでにローカル `video` 素材だけで組んでいる場合だけ `render` を使う。

### Core Commands

```bash
cd remotion
./bin/pipeline validate --config <path>
./bin/pipeline plan --config <path>
./bin/pipeline run --config <path> [--dry-run] [--run-id <id>]
./bin/pipeline story --image <path> [--config-out <path>] [--dry-run] [--run]
./bin/pipeline render --config <path> --lang <lang> --ratio <ratio> [--run-id <id>]
```

`pnpm pipeline:*` も使えるが、PATH が不安定な場合は `./bin/pipeline` を使う。

### Pipeline Workflow

1. Load and normalize config
2. Validate schema and file paths
3. Plan variants and job counts
4. Generate base videos per aspect ratio (generated clips exist の場合)
5. Generate speech per generated or reference clip
6. Optionally run sound and upscale
7. Download generated assets
8. Build `manifest.render.json` per variant
9. Render final `character.mp4` with Remotion
10. Write top-level `manifest.json`

### Legacy Compatibility

`spokesperson.yaml` は自動正規化:
- `announcement.topic/date` → `project.title/date`
- `scripts.<lang>` → `locales.<lang>.clips[0]`
- `output.*` → `render.*` / `generation.*`
- `prompt.*` → `generation.prompt.*`

---

## PixVerse Commands Reference

| Command | Purpose |
|---------|---------|
| `pixverse account info --json` | Credit check |
| `pixverse create video --image` | Base video from one image |
| `pixverse create reference --images` | Base video from multiple images |
| `pixverse create speech --tts-text` | TTS lip sync |
| `pixverse create speech --audio` | Audio-file lip sync |
| `pixverse create sound --prompt` | Optional ambient sound |
| `pixverse create upscale --quality` | Optional final upscale |
| `pixverse task wait <id> --json` | Wait for async jobs |
| `pixverse asset download <id> --dest <dir> --json` | Download generated video |

## Validation Checklist

- `speaker.images` is 1-7 files
- `generated` clips have `text` or `audioFile`
- `reference` clips have `prompt`
- `video` / `image` clips have `asset`
- `render.aspectRatios` only uses supported ratios
- all local file references exist before execution

## Output Layout

```text
output/<project-slug>/<run-id>/
  manifest.json
  <lang>/<ratio>/
    manifest.render.json
    character.mp4
    assets/*
```

Remotion staging assets → `remotion/public/.pipeline/`

## Example: 20秒プロモ動画

| # | 秒数 | ショット | カメラ | ナレーション | hasAudio |
|---|------|---------|-------|------------|----------|
| 1 | 4s | 背中ショット（フック） | tracking follow | なし（BGMのみ） | false |
| 2 | 4s | キャビン/書斎 | slow push in | 自己紹介 | true |
| 3 | 5s | スタジオ | static MCU | 番組説明 | true |
| 4 | 4s | 花畑/屋外 | slow dolly out | CTA | true |
| 5 | 3s | エンドカード | — | URL表示 | false |

## Example: 15秒ストーリーティザー

| # | 秒数 | ビート | カメラ | ナレーション | 実行方式 |
|---|------|--------|--------|--------------|----------|
| 1 | 3-4s | 封印のきしみ | lateral tracking | 夜の社で、封印が軋みはじめる | `create reference` |
| 2 | 3-4s | 術師の目覚め | slow push in | 呪符の術師が、静かに目を開く | `create reference` |
| 3 | 3-4s | 一札の斬撃 | tracking follow | 一枚の札が、闇を切り裂く | `create reference` |
| 4 | 3-4s | 門が開く | orbit → pull back | 結界の向こうへ、物語が動き出す | `create reference` |

## Dependencies

| ツール | 用途 |
|--------|------|
| Nano Banana MCP (`mcp__nano-banana-2__generate_image`) | 3面図 + カット画像生成 (Mode A) |
| PixVerse CLI (`pixverse create video`) | I2V 動画生成 |
| PixVerse CLI (`pixverse create speech`) | リップシンク TTS |
| Remotion | 編集・レンダリング |
| `short-video-editing` スキル | 構成設計・レビュー |
| `remotion-best-practices` スキル | Remotion コード |
| `pixverse-ai-image-and-video-generator` スキル | PixVerse CLI 全リファレンス |

## Reference Files

- `references/interactive-questions.md` — project.yaml なしの対話ヒアリングフロー
- `references/prompt-library.md` — プロンプト構築ガイド + カメラワーク語彙 + スタイルテンプレート
- `references/pipeline-diagram.md` — パイプライン Mermaid フローチャート + ジョブ数計算式
- `references/manifest-schema.md` — Creative / Pipeline 両 manifest の JSON スキーマ
