import { PDF_LIMITS, validateCapture } from "../pdf/limits.js";

// Inspect the JPEG dimensions before handing untrusted bytes to an image decoder.
export function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("教材圖片無法解碼。");
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const size = (bytes[offset] << 8) | bytes[offset + 1];
    if (size < 2 || offset + size > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4], width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width > 0 && height > 0 && Math.max(width, height) <= PDF_LIMITS.captureEdge) return { width, height };
      break;
    }
    offset += size;
  }
  throw new Error("教材圖片尺寸異常或無法解碼。");
}

export function createMaterialCache({
  read = async (classId, assetId) => (await import("../firebase/materialRepository.js")).getMaterial(classId, assetId),
  decode = (url) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("教材圖片無法解碼。")); image.src = url; }),
  createUrl = (blob) => URL.createObjectURL(blob), revokeUrl = (url) => URL.revokeObjectURL(url), maxEntries = PDF_LIMITS.materials
} = {}) {
  const entries = new Map();
  function releaseImage(entry) {
    if (entry.url) revokeUrl(entry.url);
    entry.url = null; entry.image = null; entry.decoding = null;
  }
  function clear(classId) {
    for (const [key, entry] of entries) if (!classId || entry.classId === classId) {
      entry.invalid = true; releaseImage(entry); entries.delete(key);
    }
  }
  async function acquire(background) {
    const { classId, assetId } = background, key = `${classId}/${assetId}`;
    let entry = entries.get(key);
    if (!entry) {
      for (const [oldKey, old] of entries) if (entries.size >= maxEntries && !old.refs) { old.invalid = true; releaseImage(old); entries.delete(oldKey); }
      if (entries.size >= maxEntries) throw new Error("教材快取已滿，請關閉其他教材頁面後重試。");
      entry = { classId, refs: 0, invalid: false };
      entries.set(key, entry);
      entry.loading = (async () => {
        const asset = validateCapture(await read(classId, assetId));
        const binary = atob(asset.base64), bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        if (bytes.length !== asset.byteLength) throw new Error("教材圖片大小異常。");
        const size = jpegDimensions(bytes);
        if (size.width !== asset.width || size.height !== asset.height) throw new Error("教材圖片尺寸異常。");
        if (entry.invalid) throw new Error("教材權限已失效。");
        entry.blob = new Blob([bytes], { type: "image/jpeg" });
        entry.width = size.width; entry.height = size.height;
      })();
      entry.loading.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
    }
    entry.refs++;
    let released = false;
    const release = () => { if (released) return; released = true; entry.refs--; if (!entry.refs) releaseImage(entry); };
    try {
      await entry.loading;
      if (entry.invalid) throw new Error("教材權限已失效。");
      if (!entry.decoding) entry.decoding = (async () => {
        entry.url = createUrl(entry.blob);
        const image = await decode(entry.url);
        if (entry.invalid) throw new Error("教材權限已失效。");
        if (image.naturalWidth !== entry.width || image.naturalHeight !== entry.height) throw new Error("教材圖片尺寸異常。");
        entry.image = image;
      })();
      await entry.decoding;
      return { image: entry.image, url: entry.url, release };
    } catch (error) { release(); throw error; }
  }
  return { acquire, clear };
}

export const materialCache = createMaterialCache();
