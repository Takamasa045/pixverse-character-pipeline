# Read-only migration and old-format boundaries

`src/compat.mjs` imports old documents into a `production.v1` draft plus candidate takes and a migration report. It performs no upload, download, generation, account switch or source rewrite. A migrated document is not automatically a valid production or a completed delivery: unknown context, shot intent, source files and QA remain visible until reviewed.

```sh
node production-core/src/cli.mjs migrate old-project.json --kind character --out migration.json
node production-core/src/cli.mjs migrate old-storyboard.json --kind shotpack --out migration.json
node production-core/src/cli.mjs migrate old-manifest.json --kind manifest --out migration.json
node production-core/src/cli.mjs migrate .pixverse/characters.json --kind registry --out registry-migration.json
```

The destination must be new. The original input is retained in migration provenance. No missing three-view sheet, voice or clip is generated to make an import look complete. Known local files receive hashes; missing files and provider IDs are listed. Candidate takes are `downloaded` or `completed`, never `accepted`; their QA is unknown. Historical `completed` cannot bypass the local-file or review gate. Old manifests with only a finished-film path do not prove that their editable source cuts exist. Run manifests therefore produce an inventory and request explicit import of the referenced render manifests.

The library accepts parsed objects, JSON filenames, or YAML with an injected `yamlParser`. The CLI can use a YAML parser already installed in the repository; it never installs a parser. File paths resolve relative to the supplied source file, or explicit `baseDir` when passing objects. YAML references to another storyboard are not followed implicitly: load and pass the storyboard explicitly, keeping ownership of which files enter the migration.

```js
import {readLegacyFile, importLegacy} from './production-core/src/compat.mjs';

const project = await readLegacyFile('project.yaml', {yamlParser});
const storyboard = await readLegacyFile('storyboard.yaml', {yamlParser});
const migrated = await importLegacy(project, {
  format: 'shotpack', storyboard, baseDir: process.cwd(),
  context: {region: 'global', workspace_id: '0'}
});
```

Supply context only after verifying the actual account, region and workspace. An absent context remains null in the draft and produces `CONTEXT_UNKNOWN`. A permissive migration is separate from execution validation: incomplete drafts cannot be approved for generation or passed off as final delivery. Correct missing design and context in a new production document; use review/adoption commands for existing sources. Imports set `allowed_scope: 'planning_only'`, zero budget, and never approve future jobs.

## Supported imports

| Input | Mapping and limits |
| --- | --- |
| Character `project.yaml` | Speaker images, local clips, generated/reference clip requirements, language-specific timing, explicitly requested ratios, narration file references, BGM and overlay text. Overlay style becomes a report item and timed sidecar text; old composition styling is not reproduced. Voice text without a supplied audio file stays unresolved. |
| Character `spokesperson.yaml` | Legacy `speaker`, `announcement`, `scripts`, `output`, and `prompt` normalize into the same draft. Per-locale text, existing file audio, supplied string `voice_id`, duration/ratios and explicit native-audio OFF are preserved. The original payload remains exact. Numeric `tts_speaker` is reported as unmapped; it is never guessed into a current voice ID. Known old-reader defaults for duration/ratios/fps/audio mode are reported explicitly. Missing source date stays null, and absent model/prompt metadata does not acquire invented generation settings. Ratio-specific prompts remain source metadata and require per-delivery planning. |
| Shotpack `project.yaml` plus storyboard | Shot intent/prompts, duration, audio/multi-shot OFF, reference paths/IDs, local pattern media and optional supplied manifest. Paid postprocessing is retained as source metadata and reported, never replayed. Missing entry/exit/camera design is not invented. |
| Shotpack `storyboard.yaml` | Same shot mapping; missing media remain unresolved until an existing manifest or local source mapping is supplied. |
| Shotpack `RenderManifest` | Scene ordering, timing, paths, provider IDs when present, output specifications and soundtrack. Unsupported transitions are reported. |
| Character `manifest.render.json` | Cuts, image/video/narration paths, overlay text, audio OFF, BGM, language, fps and dimensions. |
| Character run manifest | Inventory existing final files and preserve variants/stage IDs; import each actual render manifest explicitly to recover cut-level material. Missing completed files stay missing. |

`format` accepts `character`, `shotpack`, and `manifest`, with explicit aliases `character-project`, `shotpack-project`, `shotpack-storyboard`, `shotpack-manifest`, `character-render`, and `character-run`.

The report separates missing files, unknown provider IDs, unknown context, unreviewed QA, missing character facets, unresolved voice/reference/generated media, unsupported transitions and unreplayed postprocessing. Unknown historical costs remain null. An unsafe numeric provider ID is reported rather than converted after precision has already been lost. Supply original decimal IDs as strings.

## Official v2 character/item registry

`importRegistry(registry, {kind?, baseDir?})` accepts `version: 2` with a `characters` or `items` map. It returns entity drafts, image assets, the migration report, registry kind, and root metadata. Item entries map to generic `prop` entity drafts. The cloud `image_id` is the reusable reference; a missing optional local preview does not mean the cloud reference failed. Numeric workspace `0` is preserved as a known workspace. Decimal IDs larger than JavaScript's safe integer range must arrive as strings. Unknown entry fields, root metadata, generation parameters and provenance survive `exportRegistry(bundle)`.

The exporter returns `{registry, report}` in memory. It preserves original numeric ID representation when still safe and unchanged. Unknown region/workspace stays unknown; no region is inferred from ID digits. Entries without a valid image ID cannot be exported as valid references and are reported. Imported references do not acquire fabricated prompts, model settings, voice continuity, wardrobe revisions or accepted QA. Registry export is not a new registration, upload or proof of access.

The boundary follows the [official persistent asset protocol at the audited revision](https://github.com/PixVerseAI/skills/blob/6f2c5641031f3d3bd2e54db5280dec735ce94eb3/skills/references/persistent-assets.md). Registry create/use/migrate are agent procedures, not invented installed shell subcommands.

## Old consumer exports

`await exportLegacy(production, takes, {format, variantId?, baseDir?})` checks actual source files, hashes and accepted QA before returning `{manifest, report}`. Failed source gates return `manifest: null`. The default is the old Shotpack render manifest; `character` exports the old Character render manifest. `ready_for_delivery` remains false because a boundary export does not render or review a new finished film. Render-manifest paths use the old consumer's public-asset conventions; `report.asset_staging` maps verified absolute source paths to the required public destinations. Copy them into an isolated export directory before using the old composition. This adapter does not stage or overwrite assets. The report remains incomplete while staging is required.

```sh
node production-core/src/cli.mjs export production.json --takes takes.json --format shotpack --variant ja-wide
node production-core/src/cli.mjs export production.json --takes takes.json --format character --variant ja-wide
```

Library formats also include `shotpack-storyboard`, `shotpack-project`, `character-project`, `shotpack-manifest`, and `character-render`. Project exports use one explicitly selected delivery. They return JSON objects, which can be serialized without introducing a new YAML dependency. Actual project dates must be supplied with `date` or retained original provenance. A Character project requires verified speaker reference images; the exporter reports their absence instead of generating placeholders. A Shotpack project returns project/storyboard/render-manifest objects and a required staging map; it performs no source copying. Its old runtime requires an existing full-length audio file, so missing audio is reported rather than assigned a nonexistent placeholder.

Nonzero source trims, image-only Shotpack scenes, arbitrary audio placement/mixes and timed captions may not fit the old consumer. The old Shotpack composition always mutes scene videos, so requested native audio is reported as unrepresentable. Its visual styling and the Character composition's fades/crops also need review; exporting a boundary document does not reproduce the new FFmpeg presentation exactly. A single full-length aligned soundtrack can map to the old audio/BGM field. Other losses produce `report.complete: false`. Resolve those reports or flatten a reviewed local edit before using the old consumer. `report.complete` describes representability only; it never upgrades creative QA. Use the new [finishing path](FINISHING.md) to retain exact trims, tracks and sidecars.

## Verification

```sh
node --test production-core/test/compat.test.mjs
```

Tests cover source-byte preservation, locale/ratio timing, explicit OFF, missing files under legacy completed status, unreplayed postprocessing, required external storyboard input, source-relative paths, optional YAML injection, both old render manifests, verified old-format exports, staging/reference/date blockers, unknown metadata, exact registry roundtrip, context gaps and safe large IDs. These are local boundary/contract tests; no account assets are mutated.
