# PixVerse Character Pipeline

English | [日本語](#lang-ja) | [简体中文](#lang-zh) | [한국어](#lang-ko) | [Español](#lang-es) | [Français](#lang-fr)

> Each language section below includes the full prose guide. CLI commands, YAML keys, and file names stay in their literal form so they match the actual runtime.

## English

This repository is an agent-first pipeline for generating character videos. Describe the video you want in natural language; the AI agent turns that request into `project.yaml`, then drives PixVerse and Remotion to produce the final MP4.

- This README includes six language entry points in one file.
- One request can target multiple video locales, such as Japanese and English, through `locales` in `project.yaml`.
- The agent should ask only for missing production choices, then run `validate`, `plan`, and optionally `run --dry-run` before any PixVerse credit-spending step.
- Michibiki handoff / export can be requested in the same natural-language prompt when you want downstream editing, preview, or project generation.

```text
Create Japanese and English announcement videos from this character image.
Use a photoreal studio background, 16:9 and 9:16, then prepare a Michibiki handoff.
Show me the dry-run plan first.
```

### Agent Compatibility

This repo is designed to work with both Claude Code and Codex. The runtime is tool-agnostic: `project.yaml` and `remotion/./bin/pipeline` are the core interface. `.claude/*` files are optional local helpers, not required runtime inputs. `CLAUDE.md` and `AGENTS.md` describe the same workflow from each agent's entrypoint.

### What It Does

- Turn a character image into a talking character video placed in a photoreal, live-action-style environment.
- Batch-process projects from `project.yaml` across multiple locales and aspect ratios.
- Mix `generated | reference | video | image` clips in the same timeline.
- Turn PixVerse outputs into `manifest.render.json` files and final `character.mp4` renders.
- Accept legacy `spokesperson.yaml` as a backward-compatible input format.
- Prepare optional Michibiki handoff files for Remotion, HyperFrames, or Editframe workflows.

### Production Routing

For bigger requests, first route the production choice before writing prompts. Use `references/model-routing.md` to choose the PixVerse CLI command family: text-to-video, image-to-video, image generation, reference video, motion control, transition, modify, extend, upscale, voice, music, template, batch, or local render. Keep model details in `references/model-support.md`, production practices in `references/pixverse-best-practices.md`, credit planning in `references/credit-estimation.md`, retry contracts in `references/exit-codes.md`, and agent role splits in `agents/pixverse-production-agents.md`; routing docs should explain why a command family is chosen, not maintain another model matrix. After a substantial run, promote reusable lessons into `references/` with `references/lesson-codification.md` instead of leaving them only in chat or ignored run logs.

The runtime path remains `project.yaml` -> `validate` -> `plan` -> `run --dry-run` / approved `run` / local `render`. Direct PixVerse CLI commands are documented as production building blocks and should still follow the same credit and QA gates.

### Request and Execution Flow

The entry point is a natural-language request, not a command. The agent normalizes the request into `project.yaml`. If information is missing, it asks briefly for the project name, character image, target locales, clip composition, aspect ratios, and background direction.

Execution starts with `validate`, then `plan`, then `run --dry-run` when review is needed. A full `run` can consume PixVerse credits and requires explicit approval. Configs using only local `video` / `image` clips use `render`.

For story / teaser / trailer requests, the default behavior is to split the concept into 3-5 beats and write each beat as a `source: reference` clip. For the normal attached-character-image workflow, defaults are `speaker.mode: single`, `generation.model: v6`, `generation.referenceModel: v6`, and `generation.image.enabled: true`.

### Setup and Main Commands

Prerequisites are Node.js 20+, a PixVerse account, and an active subscription. Run `pnpm install` inside `remotion` to install dependencies and the repo-pinned PixVerse CLI (`pixverse@^1.2.7`). Login with `pixverse auth login`; check status with `pixverse auth status` and `pixverse account info`.

Main commands are `./bin/pipeline validate`, `./bin/pipeline plan`, `./bin/pipeline run --dry-run`, `./bin/pipeline story`, and `./bin/pipeline render`. Prefer `./bin/pipeline` over `pnpm pipeline:*` when shell PATH resolution is unreliable.

### `project.yaml` and Output

`project.yaml` contains `project`, `speaker`, `locales`, `render`, and `generation`. Each locale defines its own `clips`; every clip uses one source type: `generated`, `reference`, `video`, or `image`.

PixVerse uses `generation.prompt.base` / `generation.prompt.perRatio` as shared video motion prompts. The default path creates a base still through PixVerse I2I, then runs I2V from that image. `source: reference` clips use a per-cut `prompt` and are generated with `pixverse create reference --images`.

Outputs are grouped under `output/<project-slug>/<run-id>/`, including the batch `manifest.json`, per-variant `manifest.render.json`, final `character.mp4`, and staging assets.

### Michibiki Integration

Michibiki is an optional downstream video-production layer. Use it when PixVerse Character Pipeline should produce source renders and manifests, then hand them to Remotion, HyperFrames, or Editframe for project generation, preview, or repurposing.

`export` creates Michibiki `handoff.json`, `video-spec.json`, and per-variant `video-specs/<lang>-<ratio>.json`. With `--run-michibiki` and `--michibiki-path`, this pipeline can invoke Michibiki project generation, but preview and final render remain explicit Michibiki-side steps.

Use `--michibiki-handoff` when an already planned or rendered output should continue in Michibiki. Dry-runs can create planned handoffs with predicted paths, but real editing should use a handoff after a real `run` or local `render` so the referenced MP4 exists.

### Fixtures / Tests

`fixtures/basic/project.yaml` is for local render smoke tests, `fixtures/generated/project.yaml` is for generated / video / image plan and dry-run checks, `fixtures/reference-story/project.yaml` is for per-cut reference stories, and `fixtures/legacy/spokesperson.yaml` checks legacy compatibility. Validate with `pnpm typecheck` and `pnpm test` inside `remotion`.

All image and video generation paths documented in this repo are implemented through PixVerse CLI; Remotion is used for staging and the final render only.

<a id="lang-ja"></a>

## 日本語

このリポジトリは、AI エージェントに自然言語で依頼してキャラクター動画を作るためのパイプラインです。作りたい動画を文章で伝えると、エージェントが `project.yaml` に正規化し、PixVerse と Remotion で最終 MP4 まで進めます。

- 基本的な入口はこの README 内で 6 言語に切り替えられます。別 README へ移動する必要はありません。
- `project.yaml` の `locales` で、日本語・英語など複数言語の動画を 1 つの依頼として扱えます。
- エージェントは不足情報だけを確認し、PixVerse credit を使う前に `validate`、`plan`、必要に応じて `run --dry-run` を実行します。
- Michibiki への handoff / export も、「Michibiki に渡したい」「Remotion や HyperFrames で続きから編集したい」と自然文で頼めます。

```text
このキャラ画像から、日本語版と英語版の案内動画を作って。
実写っぽいスタジオ背景で、16:9 と 9:16 の両方。最後に Michibiki handoff も作って。
まずは dry-run の計画だけ見せて。
```

### エージェント互換性

この repo は Claude Code と Codex のどちらでも使えるように整理しています。実行本体は tool-agnostic で、`project.yaml` と `remotion/./bin/pipeline` が中心です。`.claude/*` はローカル補助設定であり、必須ではありません。`CLAUDE.md` と `AGENTS.md` は、それぞれのエージェント入口向けに同じ workflow を説明します。

### できること

- キャラクター画像を、実写風背景になじむ talking character video にする。
- `project.yaml` から複数言語・複数アスペクト比の variant を batch 処理する。
- `generated | reference | video | image` clip を同じ timeline に混在させる。
- PixVerse の出力を `manifest.render.json` と最終 `character.mp4` に変換する。
- legacy の `spokesperson.yaml` を後方互換入力として受け付ける。
- Michibiki へ渡す Remotion / HyperFrames / Editframe 向け handoff を作る。

### 制作ルーティング

大きめの依頼では、プロンプトを書く前に「どの CLI command family で作るか」を決めます。`references/model-routing.md` を使い、text-to-video、image-to-video、image generation、reference video、motion control、transition、modify、extend、upscale、voice、music、template、batch、local render を選びます。モデル表は `references/model-support.md` に寄せ、routing 側では「なぜその command family か」を説明します。

runtime の中心は引き続き `project.yaml` -> `validate` -> `plan` -> `run --dry-run` / 承認後 `run` / local `render` です。直接 PixVerse CLI を使う場合も、credit 境界と QA gate は同じです。

### 依頼と実行の流れ

入口はコマンドではなく自然文です。エージェントは依頼文を `project.yaml` に正規化し、必要な情報が足りない場合は案件名、キャラ画像、生成言語、clip 構成、アスペクト比、背景方向性の順に短く確認します。

実行は `validate`、`plan`、必要に応じて `run --dry-run` の順に確認し、PixVerse credit を使う通常の `run` は明示許可後に行います。ローカル `video` / `image` だけを使う config では `render` を使います。

story / teaser / trailer では、3-5 個の beat に分解し、各 beat を `source: reference` として個別生成します。キャラ画像が添付された通常 workflow では、既定で `speaker.mode: single`、`generation.model: v6`、`generation.referenceModel: v6`、`generation.image.enabled: true` を使います。

### セットアップと主なコマンド

前提は Node.js 20+、PixVerse account、有効な subscription です。`cd remotion` して `pnpm install` を実行すると、repo-pinned の PixVerse CLI (`pixverse@^1.2.7`) も入ります。ログインは `pixverse auth login`、確認は `pixverse auth status` と `pixverse account info` です。

主な入口は `./bin/pipeline validate`、`./bin/pipeline plan`、`./bin/pipeline run --dry-run`、`./bin/pipeline story`、`./bin/pipeline render` です。PATH 解決が不安定な環境では `pnpm pipeline:*` より `./bin/pipeline` を優先します。

### `project.yaml` と出力

`project.yaml` は `project`、`speaker`、`locales`、`render`、`generation` を持ちます。`locales` 配下に言語ごとの `clips` を置き、各 clip は `generated`、`reference`、`video`、`image` のいずれかになります。

PixVerse は `generation.prompt.base` / `generation.prompt.perRatio` を動画 motion prompt として使います。既定では PixVerse I2I で base still を作り、その画像から I2V を実行します。`source: reference` clip は各 cut の `prompt` を使って `pixverse create reference --images` で個別生成されます。

出力は `output/<project-slug>/<run-id>/` 配下にまとまり、batch 全体の `manifest.json`、variant ごとの `manifest.render.json`、最終 `character.mp4`、staging assets が残ります。

### Michibiki 連携

Michibiki は後段の動画制作レイヤーです。PixVerse Character Pipeline で作った source render や manifest を、Remotion / HyperFrames / Editframe の project 生成、preview、再編集へ渡したいときに使います。

`export` は Michibiki 用の `handoff.json`、`video-spec.json`、variant ごとの `video-specs/<lang>-<ratio>.json` を作ります。`--run-michibiki` と `--michibiki-path` を付けると Michibiki 側の project generation まで呼べますが、preview や final render は Michibiki 側で明示実行します。

すでに `run` または `render` した結果を Michibiki に続けたい場合は `--michibiki-handoff` を使います。dry-run でも予定 path 付き handoff は作れますが、実編集には参照先 MP4 が存在する real `run` または local `render` 後の handoff を使います。

### Fixtures / Tests

`fixtures/basic/project.yaml` は local render smoke、`fixtures/generated/project.yaml` は generated / video / image 混在の plan / dry-run、`fixtures/reference-story/project.yaml` は per-cut reference story、`fixtures/legacy/spokesperson.yaml` は legacy 互換確認用です。検証は `cd remotion` 後に `pnpm typecheck` と `pnpm test` を実行します。

<a id="lang-zh"></a>

## 简体中文

这个仓库是面向 AI Agent 的角色视频制作流水线。你只需要用自然语言描述想要的视频，Agent 会把请求整理成 `project.yaml`，再通过 PixVerse 和 Remotion 生成最终 MP4。

- 基础入口在同一个 README 中支持 6 种语言切换。
- 一个请求可以通过 `project.yaml` 里的 `locales` 同时生成多语言版本，例如日语和英语。
- Agent 应只追问缺失的制作信息，并在消耗 PixVerse credits 之前执行 `validate`、`plan`，必要时执行 `run --dry-run`。
- 如果需要后续编辑、预览或项目生成，也可以在同一个自然语言请求中要求 Michibiki handoff / export。

```text
请用这张角色图片制作日语和英语的公告视频。
背景使用写实摄影棚风格，输出 16:9 和 9:16，并准备 Michibiki handoff。
请先给我 dry-run 计划。
```

### Agent 兼容性

这个仓库可以同时配合 Claude Code 和 Codex 使用。运行核心与具体工具无关，主要入口是 `project.yaml` 和 `remotion/./bin/pipeline`。`.claude/*` 只是本地辅助配置，不是运行必需项。`CLAUDE.md` 和 `AGENTS.md` 分别面向不同 Agent 入口说明同一套 workflow。

### 功能范围

- 将角色图片转换成置于写实环境中的 talking character video。
- 通过 `project.yaml` 批量生成多语言、多画幅 variant。
- 在同一 timeline 中混合 `generated | reference | video | image` clip。
- 将 PixVerse 输出整理成 `manifest.render.json` 和最终 `character.mp4`。
- 兼容旧格式 `spokesperson.yaml`。
- 生成可交给 Michibiki 的 Remotion / HyperFrames / Editframe handoff 文件。

### 请求与执行流程

入口是自然语言请求，而不是命令。Agent 会把请求整理成 `project.yaml`。如果信息不足，会按项目名、角色图片、目标语言、clip 结构、画幅、背景方向的顺序简短确认。

执行时先运行 `validate`、`plan`，必要时再运行 `run --dry-run`。会消耗 PixVerse credits 的正式 `run` 需要明确许可。只使用本地 `video` / `image` 素材的 config 使用 `render`。

story / teaser / trailer 请求默认拆成 3-5 个 beat，并把每个 beat 写成 `source: reference` clip。普通角色图片 workflow 默认使用 `speaker.mode: single`、`generation.model: v6`、`generation.referenceModel: v6`、`generation.image.enabled: true`。

### 安装与主要命令

需要 Node.js 20+、PixVerse account 和有效 subscription。在 `remotion` 目录执行 `pnpm install` 会安装 repo-pinned PixVerse CLI (`pixverse@^1.2.7`)。登录使用 `pixverse auth login`，状态检查使用 `pixverse auth status` 和 `pixverse account info`。

主要入口是 `./bin/pipeline validate`、`./bin/pipeline plan`、`./bin/pipeline run --dry-run`、`./bin/pipeline story`、`./bin/pipeline render`。如果 shell PATH 不稳定，优先使用 `./bin/pipeline`，而不是 `pnpm pipeline:*`。

### `project.yaml` 与输出

`project.yaml` 包含 `project`、`speaker`、`locales`、`render`、`generation`。`locales` 中放置各语言的 `clips`，每个 clip 的 `source` 可以是 `generated`、`reference`、`video` 或 `image`。

PixVerse 使用 `generation.prompt.base` / `generation.prompt.perRatio` 作为视频 motion prompt。默认流程是 PixVerse I2I 生成 base still，再从该图片执行 I2V。`source: reference` clip 会使用每个 cut 的 `prompt`，通过 `pixverse create reference --images` 单独生成。

输出会集中在 `output/<project-slug>/<run-id>/`。其中包含 batch 级 `manifest.json`、variant 级 `manifest.render.json`、最终 `character.mp4` 和 staging assets。

### Michibiki 集成

Michibiki 是后续视频制作层。它用于把 PixVerse Character Pipeline 生成的 source render 和 manifest 交给 Remotion / HyperFrames / Editframe，继续进行项目生成、预览或再编辑。

`export` 会生成 Michibiki 用的 `handoff.json`、`video-spec.json` 和每个 variant 的 `video-specs/<lang>-<ratio>.json`。加上 `--run-michibiki` 和 `--michibiki-path` 可以从此 pipeline 调用 Michibiki 的 project generation，但 preview 和 final render 仍需在 Michibiki 中显式执行。

如果已经完成 `run` 或 `render`，并想继续交给 Michibiki，请使用 `--michibiki-handoff`。dry-run 也可以生成带预测路径的 handoff，但真正编辑时应使用 real `run` 或 local `render` 后、引用 MP4 已存在的 handoff。

### Fixtures / Tests

`fixtures/basic/project.yaml` 用于 local render smoke test，`fixtures/generated/project.yaml` 用于 generated / video / image 混合的 plan / dry-run，`fixtures/reference-story/project.yaml` 用于 per-cut reference story，`fixtures/legacy/spokesperson.yaml` 用于 legacy 兼容。验证时在 `remotion` 目录运行 `pnpm typecheck` 和 `pnpm test`。

<a id="lang-ko"></a>

## 한국어

이 저장소는 AI 에이전트가 캐릭터 영상을 만들기 위한 파이프라인입니다. 원하는 결과를 자연어로 설명하면, 에이전트가 이를 `project.yaml`로 정리하고 PixVerse와 Remotion으로 최종 MP4를 만듭니다.

- 기본 안내는 이 README 안에서 6개 언어로 전환해 볼 수 있습니다.
- `project.yaml`의 `locales`를 통해 일본어와 영어처럼 여러 언어 버전을 한 번에 요청할 수 있습니다.
- 에이전트는 부족한 정보만 확인하고, PixVerse 크레딧을 쓰기 전에 `validate`, `plan`, 필요 시 `run --dry-run`을 실행해야 합니다.
- 이후 편집, 미리보기, 프로젝트 생성을 위해 Michibiki handoff / export도 같은 자연어 요청에 포함할 수 있습니다.

```text
이 캐릭터 이미지로 일본어와 영어 안내 영상을 만들어 주세요.
실사풍 스튜디오 배경으로 16:9와 9:16을 만들고, Michibiki handoff도 준비해 주세요.
먼저 dry-run 계획을 보여 주세요.
```

### Agent 호환성

이 저장소는 Claude Code와 Codex 모두에서 사용할 수 있도록 정리되어 있습니다. 실행 핵심은 특정 도구에 묶이지 않으며, `project.yaml`과 `remotion/./bin/pipeline`이 중심입니다. `.claude/*`는 로컬 보조 설정일 뿐 필수 실행 조건은 아닙니다. `CLAUDE.md`와 `AGENTS.md`는 각 Agent 진입점에 맞춰 같은 workflow를 설명합니다.

### 할 수 있는 일

- 캐릭터 이미지를 실사풍 환경에 자연스럽게 들어간 talking character video로 만듭니다.
- `project.yaml`을 기반으로 여러 언어와 여러 화면비 variant를 batch 처리합니다.
- 같은 timeline 안에서 `generated | reference | video | image` clip을 섞어 사용할 수 있습니다.
- PixVerse 출력을 `manifest.render.json`과 최종 `character.mp4`로 정리합니다.
- 기존 `spokesperson.yaml`을 backward-compatible 입력으로 받을 수 있습니다.
- Michibiki로 넘길 Remotion / HyperFrames / Editframe handoff 파일을 준비합니다.

### 요청과 실행 흐름

진입점은 명령어가 아니라 자연어 요청입니다. Agent는 요청을 `project.yaml`로 정규화합니다. 정보가 부족하면 프로젝트 이름, 캐릭터 이미지, 대상 언어, clip 구성, 화면비, 배경 방향 순서로 짧게 확인합니다.

실행은 `validate`, `plan`, 필요 시 `run --dry-run` 순서로 확인합니다. PixVerse 크레딧을 사용하는 실제 `run`은 명시적인 허가 후에 실행합니다. 로컬 `video` / `image` clip만 사용하는 config는 `render`를 사용합니다.

story / teaser / trailer 요청은 기본적으로 3-5개의 beat로 나누고, 각 beat를 `source: reference` clip으로 작성합니다. 일반 캐릭터 이미지 workflow는 기본적으로 `speaker.mode: single`, `generation.model: v6`, `generation.referenceModel: v6`, `generation.image.enabled: true`를 사용합니다.

### 설정과 주요 명령

필요 조건은 Node.js 20+, PixVerse account, 활성 subscription입니다. `remotion` 디렉터리에서 `pnpm install`을 실행하면 repo-pinned PixVerse CLI (`pixverse@^1.2.7`)도 설치됩니다. 로그인은 `pixverse auth login`, 확인은 `pixverse auth status`와 `pixverse account info`를 사용합니다.

주요 진입점은 `./bin/pipeline validate`, `./bin/pipeline plan`, `./bin/pipeline run --dry-run`, `./bin/pipeline story`, `./bin/pipeline render`입니다. shell PATH 해석이 불안정한 환경에서는 `pnpm pipeline:*`보다 `./bin/pipeline`을 우선 사용합니다.

### `project.yaml`과 출력

`project.yaml`은 `project`, `speaker`, `locales`, `render`, `generation`으로 구성됩니다. `locales` 아래에는 언어별 `clips`를 두며, 각 clip은 `generated`, `reference`, `video`, `image` 중 하나를 source로 가집니다.

PixVerse는 `generation.prompt.base` / `generation.prompt.perRatio`를 공유 video motion prompt로 사용합니다. 기본 경로는 PixVerse I2I로 base still을 만든 뒤, 그 이미지를 사용해 I2V를 실행하는 방식입니다. `source: reference` clip은 cut별 `prompt`를 사용해 `pixverse create reference --images`로 개별 생성됩니다.

출력은 `output/<project-slug>/<run-id>/` 아래에 모입니다. 여기에는 batch 전체 `manifest.json`, variant별 `manifest.render.json`, 최종 `character.mp4`, staging assets가 포함됩니다.

### Michibiki 연동

Michibiki는 후단 영상 제작 레이어입니다. PixVerse Character Pipeline이 만든 source render와 manifest를 Remotion / HyperFrames / Editframe 프로젝트 생성, preview, 재편집으로 넘기고 싶을 때 사용합니다.

`export`는 Michibiki용 `handoff.json`, `video-spec.json`, variant별 `video-specs/<lang>-<ratio>.json`을 만듭니다. `--run-michibiki`와 `--michibiki-path`를 추가하면 이 pipeline에서 Michibiki project generation까지 호출할 수 있지만, preview와 final render는 Michibiki 쪽에서 명시적으로 실행해야 합니다.

이미 `run` 또는 `render`한 결과를 Michibiki에서 이어가려면 `--michibiki-handoff`를 사용합니다. dry-run도 예상 경로가 포함된 handoff를 만들 수 있지만, 실제 편집에는 참조 MP4가 존재하는 real `run` 또는 local `render` 이후의 handoff를 사용합니다.

### Fixtures / Tests

`fixtures/basic/project.yaml`은 local render smoke test용, `fixtures/generated/project.yaml`은 generated / video / image 혼합 plan / dry-run용, `fixtures/reference-story/project.yaml`은 per-cut reference story용, `fixtures/legacy/spokesperson.yaml`은 legacy 호환 확인용입니다. 검증은 `remotion` 디렉터리에서 `pnpm typecheck`와 `pnpm test`를 실행합니다.

<a id="lang-es"></a>

## Español

Este repositorio es un pipeline pensado para trabajar con agentes de IA y crear videos de personajes. Describe el resultado en lenguaje natural; el agente lo convierte en `project.yaml` y usa PixVerse y Remotion para generar el MP4 final.

- La entrada básica está en este mismo README en seis idiomas.
- Una sola solicitud puede producir varias versiones de idioma, como japonés e inglés, mediante `locales` en `project.yaml`.
- El agente debe pedir solo los datos faltantes y ejecutar `validate`, `plan` y, si hace falta, `run --dry-run` antes de gastar créditos de PixVerse.
- También puedes pedir un handoff / export a Michibiki para seguir editando o previsualizando en Remotion, HyperFrames o Editframe.

```text
Crea videos de anuncio en japonés e inglés a partir de esta imagen de personaje.
Usa un fondo de estudio fotorrealista, 16:9 y 9:16, y prepara un handoff para Michibiki.
Primero muéstrame el plan dry-run.
```

### Compatibilidad con agentes

Este repositorio está organizado para funcionar tanto con Claude Code como con Codex. El runtime es independiente de la herramienta: el centro es `project.yaml` junto con `remotion/./bin/pipeline`. Los archivos `.claude/*` son ayudas locales opcionales, no requisitos para ejecutar el pipeline. `CLAUDE.md` y `AGENTS.md` describen el mismo workflow desde cada punto de entrada.

### Qué hace

- Convierte una imagen de personaje en un talking character video integrado en un entorno fotorrealista.
- Procesa proyectos desde `project.yaml` en varios idiomas y relaciones de aspecto.
- Mezcla clips `generated | reference | video | image` en la misma timeline.
- Convierte salidas de PixVerse en `manifest.render.json` y videos finales `character.mp4`.
- Acepta `spokesperson.yaml` como formato legacy compatible.
- Prepara archivos de handoff para Michibiki, Remotion, HyperFrames o Editframe.

### Cómo pedirlo y cómo se ejecuta

El punto de entrada es una solicitud en lenguaje natural, no un comando. El agente normaliza la solicitud en `project.yaml`. Si faltan datos, pregunta en este orden: nombre del proyecto, imagen del personaje, idiomas objetivo, composición de clips, relaciones de aspecto y dirección visual del fondo.

La ejecución empieza con `validate`, sigue con `plan` y usa `run --dry-run` cuando se quiere revisar antes. El `run` real, que puede gastar créditos de PixVerse, requiere aprobación explícita. Para configs que solo usan clips locales `video` / `image`, se usa `render`.

Para story / teaser / trailer, el comportamiento por defecto es dividir la idea en 3-5 beats y escribir cada beat como un clip `source: reference`. Para una imagen de personaje normal, el default es `speaker.mode: single`, `generation.model: v6`, `generation.referenceModel: v6` y `generation.image.enabled: true`.

### Setup y comandos principales

Los requisitos son Node.js 20+, una cuenta de PixVerse y una subscription activa. Dentro de `remotion`, `pnpm install` instala también la PixVerse CLI fijada por el repo (`pixverse@^1.2.7`). El login se hace con `pixverse auth login`; el estado se revisa con `pixverse auth status` y `pixverse account info`.

Los comandos principales son `./bin/pipeline validate`, `./bin/pipeline plan`, `./bin/pipeline run --dry-run`, `./bin/pipeline story` y `./bin/pipeline render`. Si la resolución de PATH del shell no es estable, usa `./bin/pipeline` antes que `pnpm pipeline:*`.

### `project.yaml` y salida

`project.yaml` contiene `project`, `speaker`, `locales`, `render` y `generation`. Dentro de `locales`, cada idioma define sus `clips`, y cada clip usa una fuente `generated`, `reference`, `video` o `image`.

PixVerse usa `generation.prompt.base` / `generation.prompt.perRatio` como prompts de movimiento para el video compartido. El flujo por defecto es PixVerse I2I para crear una base still y luego I2V desde esa imagen. Los clips `source: reference` usan un `prompt` por corte y se generan con `pixverse create reference --images`.

La salida queda agrupada en `output/<project-slug>/<run-id>/`, con `manifest.json` del batch, `manifest.render.json` por variant, el `character.mp4` final y los staging assets.

### Integración con Michibiki

Michibiki es una capa posterior de producción de video. Sirve para tomar los renders y manifests generados por PixVerse Character Pipeline y continuar con generación de proyectos, preview o reedición en Remotion, HyperFrames o Editframe.

`export` crea para Michibiki `handoff.json`, `video-spec.json` y `video-specs/<lang>-<ratio>.json` por variant. Con `--run-michibiki` y `--michibiki-path`, este pipeline puede invocar la generación del proyecto en Michibiki, pero el preview y el render final siguen siendo pasos explícitos del lado de Michibiki.

Si ya existe un resultado de `run` o `render` y quieres continuarlo en Michibiki, usa `--michibiki-handoff`. Un dry-run también puede generar handoff con rutas previstas, pero para edición real conviene usar un handoff posterior a un real `run` o local `render`, donde el MP4 referenciado ya exista.

### Fixtures / Tests

`fixtures/basic/project.yaml` sirve para smoke test de local render; `fixtures/generated/project.yaml`, para plan / dry-run con generated / video / image; `fixtures/reference-story/project.yaml`, para story con reference por corte; y `fixtures/legacy/spokesperson.yaml`, para compatibilidad legacy. Para verificar, entra en `remotion` y ejecuta `pnpm typecheck` y `pnpm test`.

<a id="lang-fr"></a>

## Français

Ce dépôt est un pipeline conçu pour les agents IA afin de créer des vidéos de personnages. Décrivez le résultat souhaité en langage naturel; l'agent le transforme en `project.yaml`, puis utilise PixVerse et Remotion pour produire le MP4 final.

- L'entrée de base est disponible dans ce README en six langues.
- Une seule demande peut cibler plusieurs langues de sortie, par exemple japonais et anglais, via `locales` dans `project.yaml`.
- L'agent doit demander uniquement les informations manquantes, puis exécuter `validate`, `plan` et éventuellement `run --dry-run` avant toute dépense de crédits PixVerse.
- Vous pouvez aussi demander un handoff / export Michibiki pour continuer le montage, la prévisualisation ou la génération de projet avec Remotion, HyperFrames ou Editframe.

```text
Crée des vidéos d'annonce en japonais et en anglais à partir de cette image de personnage.
Utilise un décor de studio photoréaliste, en 16:9 et 9:16, puis prépare un handoff Michibiki.
Montre-moi d'abord le plan dry-run.
```

### Compatibilité avec les agents

Ce dépôt est organisé pour fonctionner avec Claude Code et Codex. Le runtime ne dépend pas d'un outil particulier: les éléments centraux sont `project.yaml` et `remotion/./bin/pipeline`. Les fichiers `.claude/*` sont des aides locales facultatives, pas des prérequis d'exécution. `CLAUDE.md` et `AGENTS.md` décrivent le même workflow depuis chaque point d'entrée.

### Ce que le pipeline fait

- Transforme une image de personnage en talking character video intégré dans un environnement photoréaliste.
- Traite des projets depuis `project.yaml` avec plusieurs langues et plusieurs formats d'image.
- Mélange des clips `generated | reference | video | image` dans la même timeline.
- Convertit les sorties PixVerse en `manifest.render.json` et en vidéos finales `character.mp4`.
- Accepte l'ancien format `spokesperson.yaml` comme entrée compatible.
- Prépare des fichiers de handoff Michibiki pour Remotion, HyperFrames ou Editframe.

### Demande et déroulement

Le point d'entrée est une demande en langage naturel, pas une commande. L'agent normalise la demande en `project.yaml`. S'il manque des informations, il demande brièvement le nom du projet, l'image du personnage, les langues cibles, la composition des clips, les formats d'image et la direction visuelle du décor.

L'exécution commence par `validate`, puis `plan`, et utilise `run --dry-run` lorsqu'une revue préalable est souhaitée. Le vrai `run`, qui peut consommer des crédits PixVerse, nécessite une autorisation explicite. Pour les configs qui n'utilisent que des clips locaux `video` / `image`, utilisez `render`.

Pour les demandes story / teaser / trailer, le comportement par défaut consiste à découper le concept en 3-5 beats et à écrire chaque beat comme clip `source: reference`. Pour un workflow standard avec image de personnage, les valeurs par défaut sont `speaker.mode: single`, `generation.model: v6`, `generation.referenceModel: v6` et `generation.image.enabled: true`.

### Installation et commandes principales

Les prérequis sont Node.js 20+, un compte PixVerse et une subscription active. Dans le dossier `remotion`, `pnpm install` installe aussi la PixVerse CLI fixée par le repo (`pixverse@^1.2.7`). La connexion se fait avec `pixverse auth login`; l'état se vérifie avec `pixverse auth status` et `pixverse account info`.

Les commandes principales sont `./bin/pipeline validate`, `./bin/pipeline plan`, `./bin/pipeline run --dry-run`, `./bin/pipeline story` et `./bin/pipeline render`. Lorsque la résolution du PATH shell est instable, privilégiez `./bin/pipeline` plutôt que `pnpm pipeline:*`.

### `project.yaml` et sorties

`project.yaml` contient `project`, `speaker`, `locales`, `render` et `generation`. Dans `locales`, chaque langue définit ses `clips`; chaque clip utilise une source `generated`, `reference`, `video` ou `image`.

PixVerse utilise `generation.prompt.base` / `generation.prompt.perRatio` comme prompts de mouvement vidéo. Le flux par défaut crée d'abord une base still avec PixVerse I2I, puis lance I2V depuis cette image. Les clips `source: reference` utilisent un `prompt` par cut et sont générés avec `pixverse create reference --images`.

Les sorties sont regroupées sous `output/<project-slug>/<run-id>/`, avec le `manifest.json` du batch, un `manifest.render.json` par variant, le `character.mp4` final et les staging assets.

### Intégration Michibiki

Michibiki est une couche de production vidéo en aval. Elle sert à envoyer les source renders et manifests produits par PixVerse Character Pipeline vers la génération de projets, la prévisualisation ou la réédition dans Remotion, HyperFrames ou Editframe.

`export` crée pour Michibiki `handoff.json`, `video-spec.json` et `video-specs/<lang>-<ratio>.json` pour chaque variant. Avec `--run-michibiki` et `--michibiki-path`, ce pipeline peut invoquer la génération de projet côté Michibiki, mais la preview et le final render restent des étapes explicites côté Michibiki.

Pour continuer dans Michibiki à partir d'un résultat déjà produit par `run` ou `render`, utilisez `--michibiki-handoff`. Un dry-run peut aussi créer un handoff avec chemins prévus, mais pour une édition réelle il faut utiliser un handoff après un real `run` ou un local `render`, afin que le MP4 référencé existe déjà.

### Fixtures / Tests

`fixtures/basic/project.yaml` sert au smoke test de local render; `fixtures/generated/project.yaml`, au plan / dry-run avec generated / video / image; `fixtures/reference-story/project.yaml`, au story reference par cut; et `fixtures/legacy/spokesperson.yaml`, à la compatibilité legacy. Pour vérifier, entrez dans `remotion` puis exécutez `pnpm typecheck` et `pnpm test`.

## Agent Compatibility

This repo is meant to work with both Claude Code and Codex.

- The runtime is tool-agnostic: `project.yaml` + `remotion/./bin/pipeline`
- `.claude/*` files are optional local helpers, not required to run the pipeline
- `CLAUDE.md` and `AGENTS.md` document the same workflow from each tool's entrypoint
- A recommended multi-agent split is included for coordinator / story / planning / QA roles

## What It Does

- Turn a character image into a talking character video placed in a photoreal, live-action-style environment
- Batch-process projects from `project.yaml` across multiple locales and aspect ratios
- Mix `generated | reference | video | image` clips in the same timeline
- Turn PixVerse outputs into `manifest.render.json` files and final `character.mp4` renders
- Accept legacy `spokesperson.yaml` as a backward-compatible input format
- Prepare optional Michibiki handoff files for Remotion, HyperFrames, or Editframe workflows

## How to Ask the Agent

The entry point is a natural-language request, not a command.

```text
Create a Japanese and English announcement video from this character image.
Use a photoreal studio background, both 16:9 and 9:16.
Show me the dry-run plan first.
```

```text
Make a short promo video for a spring campaign using this character.
First clip is PixVerse-generated, last clip uses my endcard.png.
Use assets/bgm.mp3 for background music.
```

```text
Generate a vertical SNS character video from this image, English only.
Urban office-style photoreal background.
```

```text
Reference this character first, then build a 4-cut shrine-at-night story teaser.
Make each cut a different scene, then add BGM and captions in the final render.
```

```text
Create Japanese and English versions, then prepare a Michibiki handoff.
I want to continue editing the generated video as a HyperFrames or Remotion project.
```

If information is missing, the agent will ask follow-up questions in this order:

1. Project name and date
2. Character image path(s)
3. Target locales
4. Clip composition per locale
5. Aspect ratios
6. Background style / prompt direction

The goal is to build a valid `project.yaml`, then execute the pipeline.

## Agent Execution Flow

1. Normalize the natural-language request into `project.yaml`
2. Load `project.yaml` (or legacy `spokesperson.yaml`)
3. `validate` the config
4. `plan` to confirm variant and job counts
5. `run --dry-run` if the user wants to review first
6. `run` for full execution (PixVerse generation through final render)
7. `render` for configs using only local `video` / `image` clips

Default behavior for story / teaser / trailer requests:

1. Break the concept into 3-5 story beats
2. Generate each beat independently with `pixverse create reference --images`
3. Generate narration audio per cut with `pixverse create voice`, or use `audioFile`
4. Write those beats as `source: reference` clips in `project.yaml`
5. Use `./bin/pipeline run` to do reference generation, BGM / caption staging, and final render

Default behavior for attached character image(s):

1. Treat it as `speaker.mode: single` by default, even when multiple images are attached
2. Keep `generation.model: v6`
3. Use `generation.referenceModel: v6` for `source: reference` clips; set `pixverse-c1` only when you explicitly want C1-style cinematic reference behavior
4. Keep `generation.image.enabled: true`
5. Default this workflow's `generation.image.model` to `gemini-3.1-flash` and `generation.image.quality` to `1080p` (PixVerse CLI 1.2.7 also supports `gpt-image-2.0`, `qwen-image`, `gemini-3.0`, and Seedream/Kling image models)
6. Start from PixVerse I2I (`create image`) and then run I2V (`create video --image`)
7. Do not switch to `source: reference` or `pixverse create reference` unless the user explicitly asks for a story / teaser / trailer / multi-cut workflow or provides multiple reference images

## Setup

### 0. Clone the Repository

```bash
git clone https://github.com/Takamasa045/pixverse-character-pipeline.git
cd pixverse-character-pipeline
```

### 1. PixVerse CLI

Prerequisites:
- Node.js 20+
- PixVerse account with active subscription

The recommended path is the repo-local CLI installed by `pnpm install` in step 3. If you need a global CLI for manual checks, use:

```bash
npm install -g pixverse
pixverse --version
```

Or use `npx pixverse@latest` to avoid global install.

### 2. Login

```bash
pixverse auth login
```

The CLI displays a URL and code. Authenticate in your browser; the token is saved to `~/.pixverse/` (valid ~30 days).

```bash
pixverse auth status
pixverse account info
```

### 3. Install Dependencies

```bash
cd remotion
pnpm install
```

`pnpm install` installs the repo-pinned PixVerse CLI (`pixverse@^1.2.7`). `./bin/pipeline` uses `PIXVERSE_BIN` when set, otherwise it prefers `remotion/node_modules/.bin/pixverse`, then falls back to `pixverse` on PATH.

## Main Commands

```bash
cd remotion

./bin/pipeline validate --config ../fixtures/generated/project.yaml
./bin/pipeline plan --config ../fixtures/generated/project.yaml
./bin/pipeline run --config ../fixtures/generated/project.yaml --dry-run
./bin/pipeline story --image ../fixtures/shared/assets/speaker.svg --config-out ./story.yaml
./bin/pipeline render --config ../fixtures/basic/project.yaml --lang en --ratio 16:9
```

- `validate`: normalize and validate config input
- `plan`: inspect variant counts and job counts
- `run`: PixVerse generation → render manifests → final MP4s
- `story`: interactively build a reference-story `project.yaml`, then optionally `dry-run` or `run`
- `render`: render a single variant using only local clips

Full `run` uses PixVerse `--idempotency-key` for create jobs. The key is derived from project slug, run-id, variant, stage, and command args, so retrying the same `--run-id` is less likely to spend credits twice while edited prompts/configs still create fresh jobs.

`pnpm pipeline:*` is available as a convenience alias. Prefer `./bin/pipeline` when shell PATH resolution is unreliable.

## `project.yaml` Shape

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

PixVerse uses `generation.prompt.base` / `generation.prompt.perRatio` for shared video motion prompts. The default path is PixVerse I2I then PixVerse I2V: `generation.image.enabled` defaults to `true`, so the pipeline first creates a base still with `generation.image.*`, downloads it locally, then runs I2V from that still. `generation.image.model` is the PixVerse CLI image model name; this workflow defaults to `gemini-3.1-flash` at `1080p`, while PixVerse CLI 1.2.7 also supports current image models such as `gpt-image-2.0`, `qwen-image`, `gemini-3.0`, `seedream-5.0-lite`, and Kling image models. When `generation.image.prompt` is omitted, it falls back to `generation.prompt`. The default video generation profile is `v6` at `720p`.

`source: reference` clips additionally provide a per-cut `prompt` and use `pixverse create reference --images` instead of the shared base-video flow. They use `generation.referenceModel` (`v6` by default; `pixverse-c1` remains available as an override). `generateAudio: true` maps to PixVerse CLI `--audio`; the default `false` maps to `--no-audio`. Narration text in `generated` / `reference` clips is turned into a separate PixVerse `create voice` audio asset and layered in Remotion; use `audioFile` for pre-recorded narration, and `voiceId` only for confirmed PixVerse preset voice IDs. The legacy `ambientSound` field is accepted as a compatibility alias, but the pipeline no longer calls the removed `create sound` command. `generated`, `reference`, and `video` clips may also set `audioVolume` (`0`-`1`) to rebalance narration or clip audio against BGM.

For the full PixVerse CLI model table, mode matrix, and source reconciliation notes, see [`references/model-support.md`](./references/model-support.md).

## Output Layout

```text
output/<project-slug>/<run-id>/
  manifest.json
  <lang>/<ratio>/
    manifest.render.json
    character.mp4
    assets/*
```

Remotion staging assets are generated automatically under `remotion/public/.pipeline/`.

## Optional Michibiki Export / Handoff

Michibiki is an optional downstream video-production layer. Use it when PixVerse Character Pipeline should produce the character-video source, then hand that result to another engine route such as Remotion, HyperFrames, or Editframe for editing, previewing, or repurposing.

Use `export` when Remotion, HyperFrames, or Editframe project generation should happen in [Michibiki](https://github.com/Takamasa045/michibiki), similar to the PixVerse Shotpack handoff.

```bash
cd remotion
./bin/pipeline export \
  --config ../fixtures/generated/project.yaml \
  --engine remotion
```

By default the export is written under:

```text
output/<project-slug>/michibiki/
  handoff.json
  video-spec.json
  video-specs/<lang>-<ratio>.json
  README.md
```

Add `--run-michibiki` and `--michibiki-path` to ask this pipeline to invoke Michibiki project generation:

```bash
./bin/pipeline export \
  --config ../fixtures/generated/project.yaml \
  --engine remotion \
  --remotion-mode standalone \
  --michibiki-path ../../michibiki \
  --run-michibiki
```

This runs `pnpm michibiki generate --spec ... --engine remotion --remotion-mode standalone` from the Michibiki repository. It does not run Michibiki preview or final render; those remain explicit Michibiki-side steps. Omit `--remotion-mode standalone` if you intentionally want Michibiki to use an external Remotion monorepo.

Use `--michibiki-handoff` when an already planned or rendered PixVerse Character Pipeline output should continue in Michibiki for engine routing, timeline editing, preview, or repurposing.

```bash
cd remotion
./bin/pipeline run \
  --config ../fixtures/generated/project.yaml \
  --dry-run \
  --michibiki-handoff
```

The handoff is written next to the run manifest by default:

```text
output/<project-slug>/<run-id>/michibiki/
  handoff.json
  video-spec.json
  video-specs/<lang>-<ratio>.json
  README.md
```

- `video-spec.json` is the primary Michibiki `VideoSpec`.
- `video-specs/` contains one spec per supported locale / aspect-ratio variant.
- `handoff.json` lists all variants, points back to the PixVerse `manifest.json`, and records the recommended Michibiki commands.
- `--michibiki-handoff-dir <dir>` writes the handoff somewhere else.
- `--michibiki-engine remotion|hyperframes|editframe|auto` changes the recommended engine for run handoffs.

Then run Michibiki from its repository:

```bash
cd ../michibiki
pnpm michibiki decide --spec ../pixverse-character-pipeline/output/<project-slug>/<run-id>/michibiki/video-spec.json
pnpm michibiki generate --spec ../pixverse-character-pipeline/output/<project-slug>/<run-id>/michibiki/video-spec.json --engine editframe
```

Michibiki saves generated projects, previews, and final renders under `outputs/jobs/<job-id>/` in the Michibiki repository. Character Pipeline keeps only the source renders and handoff files under `output/<project-slug>/<run-id>/`.

Dry-runs produce a planned handoff with predicted final MP4 paths. For actual downstream editing, run the handoff after a real `run` or local `render` so the referenced MP4 exists.

## Fixtures / Tests

- `fixtures/basic/project.yaml`: local `video` + `image` render smoke test
- `fixtures/generated/project.yaml`: mixed generated / video / image plan and dry-run fixture
- `fixtures/reference-story/project.yaml`: per-cut `reference` story fixture
- `fixtures/legacy/spokesperson.yaml`: legacy-format compatibility fixture

```bash
cd remotion
pnpm typecheck
pnpm test
```
