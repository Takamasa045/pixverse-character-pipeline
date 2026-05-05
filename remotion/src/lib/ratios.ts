import type { SupportedAspectRatio } from "./types";

const DIMENSIONS: Record<SupportedAspectRatio, { height: number; width: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
  "3:2": { width: 1620, height: 1080 },
  "2:3": { width: 1080, height: 1620 },
  "21:9": { width: 2520, height: 1080 },
};

export const getDimensionsForRatio = (aspectRatio: SupportedAspectRatio) => DIMENSIONS[aspectRatio];
