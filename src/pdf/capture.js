import { PDF_LIMITS } from "./limits.js";

const toBlob = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("無法產生截圖，請重新框選。")), "image/jpeg", quality));
export async function compressCapture(source, { makeCanvas = () => document.createElement("canvas"), encode = toBlob } = {}) {
  const canvas = makeCanvas();
  let ratio = Math.min(1, PDF_LIMITS.captureEdge / Math.max(source.width, source.height));
  try {
    for (const quality of [.85, .75, .65, .55, .55, .55]) {
      canvas.width = Math.max(1, Math.round(source.width * ratio)); canvas.height = Math.max(1, Math.round(source.height * ratio));
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await encode(canvas, quality);
      if (blob.type !== "image/jpeg") throw new Error("此瀏覽器無法產生 JPEG 截圖。");
      if (blob.size <= PDF_LIMITS.captureBytes) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
        return { blob, base64: btoa(binary), mimeType: "image/jpeg", width: canvas.width, height: canvas.height, byteLength: blob.size };
      }
      if (quality <= .55) ratio *= .8;
    }
    throw new Error("截圖仍超過大小限制，請縮小選取範圍。");
  } finally { canvas.width = canvas.height = 0; }
}
