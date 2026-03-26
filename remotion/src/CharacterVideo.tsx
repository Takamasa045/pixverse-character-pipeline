import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio, Video } from "@remotion/media";
import { DEFAULT_THEME } from "./lib/constants";
import type { OverlayStyle, RenderManifest } from "./lib/types";

export type CharacterVideoProps = {
  manifestPath: string;
};

const useManifest = (path: string): RenderManifest | null => {
  const [manifest, setManifest] = React.useState<RenderManifest | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    fetch(staticFile(path))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load render manifest: ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          setManifest(data as RenderManifest);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setManifest(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return manifest;
};

const Overlay: React.FC<{ text: string; style: OverlayStyle; accent: string }> = ({
  text,
  style,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  if (style === "none" || !text) {
    return null;
  }

  const opacity = interpolate(
    frame,
    [0, 20, Math.max(21, durationInFrames - 10), durationInFrames],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  if (style === "title") {
    const scale = spring({ fps, frame, config: { damping: 14, mass: 0.8 } });

    return (
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: "#fff",
            textAlign: "center",
            textShadow: "0 4px 30px rgba(0,0,0,0.6)",
            transform: `scale(${scale})`,
            fontFamily: '"Avenir Next", "Hiragino Sans", "Noto Sans JP", sans-serif',
            lineHeight: 1.2,
            maxWidth: "80%",
            whiteSpace: "pre-line",
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    );
  }

  if (style === "subtitle") {
    const translateY = interpolate(frame, [0, 25], [40, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });

    return (
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: "12%",
          opacity,
        }}
      >
        <div
          style={{
            fontSize: 40,
            fontWeight: 800,
            color: "#fff",
            textAlign: "center",
            textShadow: "0 2px 20px rgba(0,0,0,0.45)",
            transform: `translateY(${translateY}px)`,
            fontFamily: '"Avenir Next", "Hiragino Sans", "Noto Sans JP", sans-serif',
            lineHeight: 1.3,
            maxWidth: "85%",
            whiteSpace: "pre-line",
            padding: "20px 28px",
            borderRadius: 18,
            background: "rgba(10, 7, 24, 0.56)",
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
            backdropFilter: "blur(10px)",
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    );
  }

  if (style === "lower-third") {
    const slideX = interpolate(frame, [0, 20], [-300, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });

    return (
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "flex-start",
          paddingBottom: "6%",
          paddingLeft: "5%",
          opacity,
        }}
      >
        <div
          style={{
            background: `${accent}DD`,
            padding: "12px 32px",
            borderRadius: 6,
            transform: `translateX(${slideX}px)`,
          }}
        >
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: "#fff",
              fontFamily: '"Avenir Next", "Hiragino Sans", "Noto Sans JP", sans-serif',
              whiteSpace: "pre-line",
            }}
          >
            {text}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  if (style === "endcard") {
    const bounce = spring({ fps, frame: Math.max(0, frame - 10), config: { damping: 10 } });

    return (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity,
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: "#fff",
            textAlign: "center",
            textShadow: "0 4px 30px rgba(0,0,0,0.6)",
            transform: `scale(${bounce})`,
            fontFamily: '"Avenir Next", "Hiragino Sans", "Noto Sans JP", sans-serif',
            lineHeight: 1.2,
            maxWidth: "82%",
            whiteSpace: "pre-line",
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    );
  }

  return null;
};

const EndCard: React.FC<{ image: string }> = ({ image }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 150], [1, 1.05], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Img
        src={staticFile(image)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "blur(30px) brightness(0.4)",
          transform: "scale(1.2)",
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <Img
          src={staticFile(image)}
          style={{
            height: "70%",
            objectFit: "contain",
            transform: `scale(${scale})`,
            filter: "drop-shadow(0 10px 40px rgba(0,0,0,0.5))",
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const CutScene: React.FC<{
  accent: string;
  cut: RenderManifest["cuts"][number];
  isLast: boolean;
  speakerImage: string;
}> = ({ accent, cut, isLast, speakerImage }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeOut = isLast
    ? 1
    : interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const opacity = Math.min(fadeIn, fadeOut);
  const drift = interpolate(frame, [0, durationInFrames], [0, 15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, durationInFrames], [1.05, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      {cut.videoSrc ? (
        <Video
          src={staticFile(cut.videoSrc)}
          muted={!cut.hasAudio}
          volume={
            cut.hasAudio
              ? (currentFrame) =>
                  interpolate(
                    currentFrame,
                    [0, 5, Math.max(6, durationInFrames - 10), durationInFrames],
                    [0, cut.audioVolume ?? 1, cut.audioVolume ?? 1, 0],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  )
              : undefined
          }
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `translateX(${drift}px) scale(${scale})`,
          }}
        />
      ) : (
        <EndCard image={cut.imageSrc ?? speakerImage} />
      )}
      {cut.narrationSrc ? <Audio src={staticFile(cut.narrationSrc)} /> : null}
      <Overlay text={cut.overlayText} style={cut.overlayStyle} accent={accent} />
    </AbsoluteFill>
  );
};

const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 75%, rgba(0,0,0,0.3) 100%)",
      pointerEvents: "none",
    }}
  />
);

const Loading: React.FC<{ manifestPath: string }> = ({ manifestPath }) => (
  <AbsoluteFill
    style={{
      background: "#0a0a0a",
      justifyContent: "center",
      alignItems: "center",
      color: "#fff",
      fontFamily: '"Avenir Next", sans-serif',
      fontSize: 28,
      padding: 48,
      textAlign: "center",
    }}
  >
    {`render manifest を読み込み中: ${manifestPath}`}
  </AbsoluteFill>
);

export const CharacterVideo: React.FC<CharacterVideoProps> = ({ manifestPath }) => {
  const manifest = useManifest(manifestPath);

  if (!manifest) {
    return <Loading manifestPath={manifestPath} />;
  }

  const theme = manifest.theme ?? DEFAULT_THEME;

  return (
    <AbsoluteFill style={{ background: theme.background }}>
      {manifest.narration ? <Audio src={staticFile(manifest.narration)} /> : null}
      {manifest.bgm ? (
        <Audio src={staticFile(manifest.bgm)} volume={manifest.bgmVolume ?? 0.15} loop />
      ) : null}
      {manifest.cuts.map((cut, index) => (
        <Sequence
          key={cut.id}
          from={cut.startFrame}
          durationInFrames={cut.durationInFrames}
          layout="none"
        >
          <CutScene
            accent={theme.accent}
            cut={cut}
            isLast={index === manifest.cuts.length - 1}
            speakerImage={manifest.speakerImage}
          />
        </Sequence>
      ))}
      <Vignette />
    </AbsoluteFill>
  );
};
