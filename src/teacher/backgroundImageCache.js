import { googleDriveCanvasImageUrl } from "../whiteboard/backgroundImage.js";
import { normalizeBoardPages } from "../whiteboard/pages.js";
import { materialCache } from "../whiteboard/materialCache.js";

const CACHE_NAME = "classpad-export-backgrounds-v1";

function persistentCacheKey(url) {
  const origin = globalThis.location?.origin?.startsWith("http") ? globalThis.location.origin : "https://classpad.local";
  return `${origin}/.classpad-cache/background/${encodeURIComponent(url)}`;
}

function validImageBlob(blob) {
  return blob?.size > 0 && String(blob.type || "").startsWith("image/");
}

export function createBackgroundImageCache({
  fetchImage = globalThis.fetch?.bind(globalThis),
  cacheStorage = globalThis.caches,
  ImageClass = globalThis.Image,
  createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
  revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL)
} = {}) {
  const blobs = new Map(), preloadPromises = new Map(), imagePromises = new Map();

  async function openPersistentCache() {
    if (!cacheStorage?.open) return null;
    try { return await cacheStorage.open(CACHE_NAME); } catch { return null; }
  }

  async function readBlob(url) {
    if (blobs.has(url)) return blobs.get(url);
    const cache = await openPersistentCache();
    const response = await cache?.match(persistentCacheKey(url));
    if (!response) return null;
    const blob = await response.blob();
    if (!validImageBlob(blob)) return null;
    blobs.set(url, blob);
    return blob;
  }

  async function precache(url) {
    if (preloadPromises.has(url)) return preloadPromises.get(url);
    const pending = (async () => {
      const saved = await readBlob(url);
      if (saved) return saved;
      if (!fetchImage) throw new Error("此瀏覽器無法預先下載底圖。");
      let response;
      try {
        response = await fetchImage(url, { mode: "cors", credentials: "omit", cache: "no-store" });
      } catch {
        throw new Error("底圖預先快取失敗，請確認網路連線與 Google Drive 圖片分享權限。");
      }
      if (!response?.ok) throw new Error(`底圖預先快取失敗（HTTP ${response?.status || "未知"}）。`);
      const cacheResponse = response.clone?.();
      const blob = await response.blob();
      if (!validImageBlob(blob)) throw new Error("Google Drive 回傳的底圖格式無法使用。");
      blobs.set(url, blob);
      const cache = await openPersistentCache();
      if (cache && cacheResponse) {
        try { await cache.put(persistentCacheKey(url), cacheResponse); } catch { /* 記憶體快取仍可供本次匯出使用 */ }
      }
      return blob;
    })();
    preloadPromises.set(url, pending);
    pending.catch(() => preloadPromises.delete(url));
    return pending;
  }

  async function loadImage(url) {
    if (imagePromises.has(url)) return imagePromises.get(url);
    const pending = (async () => {
      const blob = await readBlob(url);
      if (!blob) throw new Error("底圖尚未完成快取，請重新載入老師管理頁面後再試。");
      if (!ImageClass || !createObjectURL) throw new Error("此瀏覽器無法讀取已快取的底圖。");
      const objectUrl = createObjectURL(blob);
      return new Promise((resolve, reject) => {
        const image = new ImageClass();
        const finish = () => revokeObjectURL?.(objectUrl);
        image.onload = () => { finish(); resolve(image); };
        image.onerror = () => { finish(); reject(new Error("已快取的底圖無法解碼。")); };
        image.src = objectUrl;
      });
    })();
    imagePromises.set(url, pending);
    pending.catch(() => imagePromises.delete(url));
    return pending;
  }

  return { loadImage, precache, readBlob };
}

export const exportBackgroundImageCache = createBackgroundImageCache();

export function classroomBackgroundImageUrls(classroom) {
  return [...new Set(normalizeBoardPages(classroom?.boardPages).map((page) => page.backgroundImage?.type === "rtdb-capture" ? `rtdb-capture:${page.backgroundImage.classId}/${page.backgroundImage.assetId}` : googleDriveCanvasImageUrl(page.backgroundImage)).filter(Boolean))];
}

export async function precacheClassroomBackgrounds(classroom, cache = exportBackgroundImageCache) {
  const urls = classroomBackgroundImageUrls(classroom);
  await Promise.all(urls.map(async (url) => {
    if (url.startsWith("rtdb-capture:")) {
      const [classId, assetId] = url.slice("rtdb-capture:".length).split("/");
      const resource = await materialCache.acquire({ classId, assetId }); resource.release();
    } else await cache.precache(url);
  }));
  return { count: urls.length, urls };
}

export function loadCachedCanvasImage(url) {
  return exportBackgroundImageCache.loadImage(url);
}
