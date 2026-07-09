# PixVerse CLI Exit Codes

直接 `pixverse` を叩く Mode A / Mode C と、Mode B の `./bin/pipeline` の両方で使う終了コード契約。

## Authoritative Mapping

| Exit code | Meaning | Agent action | Report as |
|-----------|---------|--------------|-----------|
| `0` | success | continue | final totals only |
| `2` | timeout | double timeout once and retry once | `timeout_exhausted` if still failing |
| `3` | auth expired | `pixverse auth login` then retry once | `auth_failed` if still failing |
| `4` | out of credits | stop immediately; do not submit more jobs | `credit_insufficient` |
| `5` | generation failed | strengthen the failed criterion and retry up to 2 times | `generation_failed` after 2 failures |
| `6` | validation error | stop; fix config / prompt / args first | `validation_error` |

## Mode B Pipeline Notes

`./bin/pipeline` は PixVerse CLI を subprocess として呼び、非 0 exit を error string として表面化する。

現状の runtime 挙動:

- preflight credit check は job count ベースの粗い比較（`references/credit-estimation.md`）
- create 系 job には deterministic `--idempotency-key` を付ける
- partial failure でも既存 output / staged asset を消さない
- failed / skipped variant は exact error を残し、`NEXT_ACTIONS.md` または Loop 10 へ戻す

pipeline が exit code ごとに専用 state machine を持っていない場合でも、エージェントの判断はこの表に合わせる。

## Handling Notes

### exit 2

```bash
pixverse task wait <id> --json --timeout 300
# only if that fails:
pixverse task wait <id> --json --timeout 600
```

- 遅い third-party model は `--no-wait` + 明示的 `task wait` を優先する

### exit 3

```bash
pixverse auth login
pixverse auth status --json
```

- 認証復旧後、同じ idempotency scope で 1 回だけ再実行する

### exit 4

- 以降の create / reference / voice / upscale を投入しない
- plan の job count と `references/credit-estimation.md` を見直し、人間承認を取り直す
- tracked docs に残高を書かない

### exit 5

- 失敗した visual / audio criterion を 1 つ名指しする
- prompt または model / command family のどちらを変えるかを先に決める
- 同一 clip / stage への再投入は最大 2 回
- 失敗成果物は evidence として保持する

### exit 6

- その場の value guess で再投入しない
- invalid duration、invalid aspect ratio、missing image path、unsupported model を config 側へ戻す
- `references/model-support.md` と `project.yaml` を直してから `validate`

## Other Errors

`1` や未知のコードは infrastructure error として扱う。

- 生成済みファイルは保持する
- exact command + stderr を残す
- 同じ key で無闇に連打しない

## Related Truth Sources

- Credit planning: `references/credit-estimation.md`
- Model / mode limits: `references/model-support.md`
- Production practices: `references/pixverse-best-practices.md`
- Final acceptance: `references/final-video-qa-gate.md`
