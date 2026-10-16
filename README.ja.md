# PixVerse Character Pipeline

前回と同じ人物・声・世界を、採用した版と素材から次の作品へ引き継ぐ。

[English](README.md) · [スキル入口](SKILL.md) · [利用ガイド](references/production-v1.md)

## 2つの入口と共通基盤

Character Pipelineは人物・体格・衣装・声・世界・小道具の採用版を管理します。Shotpackは企画、ショット、take採用、編集、納品を担当します。両方が共通の `production.v1` 契約と実行台帳を使い、Characterから作品を渡した後の進行役はShotpackに一本化します。

共通コードの正本はShotpackの `production-core/`、Character側は同一内容を同梱します。隣のリポジトリや追加サービスは不要です。新規制作の入口はルートの `./bin/production` です。

## 自然な言葉で依頼

- 「いつものキャラで20秒の案内。顔と声は同じ、服だけ冬服に」
- 「この猫が駅で友人を見つける短編。先に構成と費用を見せて」
- 「7〜10秒の手だけ直して。他の採用カットは使って」
- 「提供動画に字幕を付けて納品。新しい生成は不要」

制作カード、場面の意図、参照の役割、未解決条件、dry-runを示して進めます。有料処理は対象・試行上限・費用上限を具体化して承認を記録します。既存の承認範囲内で毎回許可を取り直す必要はありません。

## 費用ゼロで開始

**Node >=22.18** を使います。新基盤の検証・計画・fixture試験・dry-runにはnpm依存追加、ログイン、隣のrepoが要りません。

```bash
./bin/production validate production-core/fixtures/weekly-guide.json
./bin/production plan production-core/fixtures/weekly-guide.json
./bin/production run production-core/fixtures/weekly-guide.json --dry-run
node --test production-core/test/*.test.mjs
```

生成前にテンポを確認するには、`rough-plan production.json --font /path/to/existing-font.ttf --out previews` で無音の文章カードを並べます。既存FFmpeg/Pillowを使う計画用MP4で、完成品の採用とは別です。

`validate` は既定で計画検証です。未編集なら `ready_for_delivery: false` を返します。実編集は `validate production.json --phase delivery [--variant ID]` で確認し、`finish` でも同じ検証と素材・採用・QAゲートを通します。空の納品別clips指定は拒否します。

同梱fixtureは計画専用です。生成前に採用参照、実際のcontext、capability snapshot、価格根拠が必要です。Canvasの採用素材は、選択historyを取得前後に確認し、容量制限付きHTTPSで保存できます。

人物登録、承認後の実行、再開、仕上げ、移行、代表3例は[利用ガイド](references/production-v1.md)、正確な項目は[データ契約](production-core/docs/CONTRACT.md)を参照します。同じ作品を両入口で扱う時は明示的に同じ `--db` パスを指定します。

## 検証と品質の境界

採用版は変更せず新しい版を作ります。送信前に台帳と費用予約を保存し、既知IDを再開します。送信結果が不明なら照合待ちにして自動再投入しません。明示OFFは保持します。Canvasでの人の変更は差分として扱い、黙って巻き戻したりCreateで二重送信したりしません。

生成成功と作品への採用は別です。実ファイル、技術・人物・継続性・音・作品の検品を通して納品します。mock/fixtureの合格は画質・声の再現・口パク・正確な料金・全Canvas機能の実測ではありません。TTSの重畳はナレーションです。既存FFmpeg/ffprobeでcut・trim・明示cropと保護領域・fit/pad・音声mix・SRT別添を扱います。既存Python/Pillowと指定フォントがあれば安全領域内の基本字幕焼込も可能です。黒画面・無音区間・音量は測定し、指定された閾値だけで拒否します。複雑な演出効果・transitionは未対応として止めます。技術検査後も完成版の創作採用は別途必要です。実生成の創作品質は、別の上限付き試験で確認します。

## 既存作品の移行と復帰

旧コード・fixture・素材を保持し、[移行](references/production-v1.md#migration-and-rollback)は別の新形式とレポートを返します。原本を書換えたり、移行だけで再生成したり、QAや費用を推測で埋めたりしません。[旧入口文書](references/legacy-entrypoints.md)も原文保存しています。

旧runtimeは `./bin/pipeline --legacy …`（Characterは `remotion/bin/pipeline --legacy …` も可）で明示的に選びます。`--legacy` なしのpipelineは新productionへ転送します。旧入力、素材、Git版、台帳を保管して切り替えます。同じ案件で新旧の有料処理を同時実行しないでください。
