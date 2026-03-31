# Pipeline Diagram

## Flow Overview

```mermaid
flowchart TD
    Start([Start]) --> InputCheck{"project.yaml or spokesperson.yaml?"}
    InputCheck --> Normalize[Load + normalize config]
    Normalize --> Validate[Validate files and schema]
    Validate --> Plan[Compute variants and job counts]
    Plan --> Credit{"generated clips exist?"}
    Credit -->|No| Stage[Stage local assets]
    Credit -->|Yes| CreditCheck[PixVerse credit check]
    CreditCheck --> BaseImage{"generation.image.enabled?"}
    BaseImage -->|Yes| CreateImage[Create base images per aspect ratio]
    BaseImage -->|No| Base[Create base videos per aspect ratio]
    CreateImage --> Base
    Base --> Speech[Create speech jobs per generated clip]
    Speech --> Post{Ambient sound / upscale?}
    Post -->|Ambient sound| Sound[Create sound jobs]
    Post -->|Upscale only| Upscale[Create upscale jobs]
    Sound --> Upscale
    Upscale --> Download[Download generated clip assets]
    Download --> Stage
    Stage --> RenderManifest[Write manifest.render.json per variant]
    RenderManifest --> Render[Render final MP4 with Remotion]
    Render --> RunManifest[Write run manifest.json]
    RunManifest --> Done([Done])
```

## Job Count Formula

```text
image_jobs     = aspect_ratios if generated clips exist and generation.image.enabled else 0
base_jobs      = aspect_ratios if generated clips exist else 0
reference_jobs = reference_clips x aspect_ratios
speech_jobs    = narrated_generated_or_reference_clips x aspect_ratios
sound_jobs     = generated_or_reference_clips x aspect_ratios if ambientSound else 0
upscale_jobs   = generated_or_reference_clips x aspect_ratios if upscale else 0
total_jobs     = image_jobs + base_jobs + reference_jobs + speech_jobs + sound_jobs + upscale_jobs
```
