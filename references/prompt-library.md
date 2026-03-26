# Prompt Library

## Prompt Construction Guide

### Phase 2: カット画像プロンプト (Nano Banana)

必須要素:
- `"character naturally composited into real photograph"` — 必ず含める
- 背景には `"photorealistic"` `"real"` を明示
- キャラ説明は性別・髪型・服装を毎回書く（一貫性のため）

テンプレート:
```
[キャラ説明] in [シーン説明].
Photorealistic [背景説明].
Character naturally composited into real photograph.
[ショットサイズ], [ライティング]
```

### Phase 3: I2V プロンプト (PixVerse)

必須要素:
- 動きの始まりと終わりを書く（transition description）
- キャラの微動: まばたき、髪の揺れ、呼吸、手の動き
- 背景の動き: 風、光の変化、雲、葉のざわめき
- カメラワークを文中に含める

テンプレート:
```
[キャラ] [動き・変化を2-4文で]. [背景の動き]. [カメラワーク].
```

### Phase 3 / Mode B: Base Prompt (generation.prompt)

`generation.prompt.base` / `perRatio` で使用:
```
A talking character derived from the provided character image, speaking directly to camera, [expression], [movement_style], [lighting], [background], [framing], [quality]
```

### Phase 3 / Mode C: Per-Cut Reference Prompt

ストーリー動画では、各カットを `pixverse create reference --images` で個別に作る。`project.yaml` では各カットの `clips[].source: reference` に対応する `prompt` として使う。

テンプレート:
```
[Scene setup]. The same character from the reference image [character action], [secondary motion], [background motion]. [Camera work], [framing], [lighting].
```

必須要素:
- `"The same character from the reference image"` で参照対象を固定
- 1カットにつき1つの明確な動きだけに絞る
- 背景変化も1つ書く
- カメラワークは毎カット変える

4ビートの基本形:
1. `hook` — 世界観と異変の導入
2. `reveal` — キャラの正面登場
3. `conflict` — 動きのピーク
4. `payoff` — 引きや締め

---

## Camera Work Vocabulary

カットごとにカメラワークを変えること（Critical Rule 6）。以下から選ぶ:

| Category | Camera Moves |
|----------|-------------|
| Push/Pull | slow push in, pull back, dolly in, dolly out |
| Tracking | tracking follow, lateral tracking, arc around |
| Pan/Tilt | slow pan left, pan right, tilt up, tilt down |
| Static | static wide, static MCU (medium close-up), static CU (close-up) |
| Crane | crane up, crane down, high angle descent |
| Special | orbit, Dutch angle drift, rack focus, handheld subtle |

---

## Style Templates

### News Anchor

**16:9**
```
A professional news anchor derived from the provided character image, speaking directly to camera, composed expression, subtle head movements, studio lighting, photoreal newsroom background, medium shot, broadcast quality
```

**9:16**
```
A professional news anchor derived from the provided character image, in vertical portrait frame, speaking to camera, composed expression, subtle head movements, studio lighting, photoreal newsroom background, upper body close-up
```

### Casual Presenter

**16:9**
```
A friendly presenter derived from the provided character image, speaking to camera with warm smile, natural gestures, soft natural lighting, photoreal lifestyle background, medium shot, approachable and polished
```

**9:16**
```
A friendly presenter derived from the provided character image, in vertical portrait frame, speaking to camera with warm smile, natural gestures, soft lighting, photoreal lifestyle background, upper body close-up
```

### Corporate Host

**16:9**
```
A professional business host derived from the provided character image, speaking to camera, confident expression, measured gestures, even lighting, photoreal corporate office background, medium shot, trustworthy presentation
```

**9:16**
```
A professional business host derived from the provided character image, in vertical portrait frame, speaking to camera, confident expression, even lighting, photoreal corporate office background, upper body close-up
```

### Outdoor Adventure

**16:9**
```
A lively explorer derived from the provided character image, standing in a scenic outdoor location, expressive gestures, golden hour sunlight, photoreal mountain trail or forest background, wide shot, cinematic adventure feel
```

**9:16**
```
A lively explorer derived from the provided character image, in vertical portrait frame, outdoors with wind-blown hair, energetic expression, golden hour lighting, photoreal nature background, upper body shot
```

### Tech Demo

**16:9**
```
A knowledgeable tech presenter derived from the provided character image, speaking to camera in a modern workspace, focused expression, clean gestures, cool-toned lighting, photoreal minimalist studio background, medium shot, professional tech review style
```

**9:16**
```
A knowledgeable tech presenter derived from the provided character image, in vertical portrait frame, speaking confidently, clean gestures, cool-toned lighting, photoreal desk setup background, upper body close-up
```

### Anime Character Intro

**16:9**
```
An animated character derived from the provided character image, lively pose in a detailed environment, expressive eyes, dynamic hair movement, soft cinematic lighting, photoreal city street blended with character art style, medium shot, character introduction scene
```

**9:16**
```
An animated character derived from the provided character image, in vertical portrait frame, cheerful expression, slight head tilt, soft lighting, photoreal urban background blended with character art, upper body close-up, character showcase
```

## Notes

- Keep prompts simple; 1-2 sentences is enough.
- Do not describe lip sync. `create speech` handles speech animation separately.
- If ratios need different framing, set `generation.prompt.perRatio`.
- If the selling point is "character into realistic background", make the background explicit: `photoreal office`, `live-action studio`, `real-world city street`, etc.
