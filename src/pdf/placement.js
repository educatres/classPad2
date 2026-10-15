import { backgroundImagePlacementRect, normalizeBackgroundPosition, normalizeBackgroundScale } from "../whiteboard/backgroundImage.js";

export function normalizeCapturePlacement(value = {}) {
  return { scale: normalizeBackgroundScale(value?.scale), x: normalizeBackgroundPosition(value?.x), y: normalizeBackgroundPosition(value?.y) };
}

export function moveCapturePlacement(start, dx, dy) {
  return normalizeCapturePlacement({ ...start, x: start.x + dx, y: start.y + dy });
}

// Resize along the image diagonal while keeping the top-left corner fixed.
// Deltas use the same normalized 4:3 board coordinates as image placement.
export function resizeCapturePlacement(start, imageWidth, imageHeight, dx, dy) {
  const rect = backgroundImagePlacementRect(start, imageWidth, imageHeight);
  const factor = 1 + (rect.width * dx * 1600 + rect.height * dy * 1200) / (rect.width ** 2 + rect.height ** 2);
  const scale = normalizeBackgroundScale(start.scale * factor);
  const resized = backgroundImagePlacementRect({ ...start, scale }, imageWidth, imageHeight);
  return normalizeCapturePlacement({ scale, x: (rect.x + resized.width / 2) / 1600, y: (rect.y + resized.height / 2) / 1200 });
}
