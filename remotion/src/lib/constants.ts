import type { SupportedAspectRatio, Theme } from "./types";

export const DEFAULT_THEME: Theme = {
  accent: "#FF6B35",
  background: "#0a0a0a",
  text: "#ffffff",
};

export const DEFAULT_ASPECT_RATIOS: SupportedAspectRatio[] = ["16:9", "9:16"];
export const DEFAULT_FPS = 30;
export const DEFAULT_OUTPUT_DIR = "./output";
export const DEFAULT_GENERATION = {
  ambientSound: null,
  image: {
    enabled: false,
    model: "gemini-3.1-flash",
    prompt: {
      base: "A photoreal live-action scene featuring the provided character naturally composited into the environment, camera-ready for subsequent image-to-video animation, with realistic depth, clean composition, and polished cinematic lighting",
    },
    quality: "1080p",
  },
  model: "v6",
  prompt: {
    base: "A talking character derived from the provided character image, speaking directly to camera with subtle head movements and natural blinking, placed in a photoreal live-action environment with realistic depth, clean composition, and polished cinematic lighting",
  },
  quality: "1080p",
  upscale: true,
};

export const SUPPORTED_ASPECT_RATIOS: SupportedAspectRatio[] = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
];
