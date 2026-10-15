export const PDF_LIMITS = Object.freeze({
  fileBytes: 30 * 1024 * 1024,
  pages: 200,
  captureEdge: 1600,
  captureBytes: 262144,
  base64Length: 349528,
  materials: 20,
  canvasPixels: 4_000_000,
  canvasEdge: 4096
});

export const CAPTURE_ID = /^page_[A-Za-z0-9_-]{6,48}$/;

export function validateCapture(value) {
  if (!value || value.mimeType !== "image/jpeg" || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || value.width < 1 || value.height < 1 || Math.max(value.width, value.height) > PDF_LIMITS.captureEdge
    || !Number.isInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > PDF_LIMITS.captureBytes
    || typeof value.base64 !== "string" || value.base64.length > PDF_LIMITS.base64Length
    || value.base64.length !== 4 * Math.ceil(value.byteLength / 3)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64)) throw new Error("教材圖片格式或大小不符合限制。");
  return value;
}
