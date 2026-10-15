import { PDF_LIMITS } from "./limits.js";

const clamp = (value) => Math.max(0, Math.min(1, value));
export function pointerPosition(event, rect) {
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}
export function selectionRect(start, end) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}
export function selectionPixels(selection, width, height) {
  if (!selection || ![selection.x, selection.y, selection.width, selection.height].every(Number.isFinite)) return null;
  const x = Math.round(clamp(selection.x) * width), y = Math.round(clamp(selection.y) * height);
  const right = Math.round(clamp(selection.x + selection.width) * width), bottom = Math.round(clamp(selection.y + selection.height) * height);
  return right - x >= 2 && bottom - y >= 2 ? { x, y, width: right - x, height: bottom - y } : null;
}
export function boundedScale(width, height, requested) {
  return Math.min(requested, PDF_LIMITS.canvasEdge / Math.max(width, height), Math.sqrt(PDF_LIMITS.canvasPixels / (width * height)));
}
