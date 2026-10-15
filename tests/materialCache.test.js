import { describe, expect, it, vi } from "vitest";
import { createMaterialCache, jpegDimensions } from "../src/whiteboard/materialCache.js";

const bytes = Uint8Array.from([255, 216, 255, 192, 0, 11, 8, 0, 2, 0, 3, 1, 1, 17, 0, 255, 217]);
const asset = { mimeType: "image/jpeg", base64: Buffer.from(bytes).toString("base64"), byteLength: bytes.length, width: 3, height: 2 };
const background = { classId: "class-1", assetId: "page_ABCDEF" };
describe("共用教材記憶體快取", () => {
  it("12 格同時讀取只下載與解碼一次，最後釋放才撤銷 URL", async () => {
    const read = vi.fn(async () => asset), decode = vi.fn(async () => ({ naturalWidth: 3, naturalHeight: 2 })), revokeUrl = vi.fn();
    const cache = createMaterialCache({ read, decode, createUrl: () => "blob:one", revokeUrl });
    const resources = await Promise.all(Array.from({ length: 12 }, () => cache.acquire(background)));
    expect(read).toHaveBeenCalledOnce(); expect(decode).toHaveBeenCalledOnce();
    for (const resource of resources.slice(0, -1)) resource.release();
    expect(revokeUrl).not.toHaveBeenCalled(); resources.at(-1).release(); expect(revokeUrl).toHaveBeenCalledOnce();
    const next = await cache.acquire(background); expect(read).toHaveBeenCalledOnce(); next.release(); cache.clear();
  });
  it("失權時丟棄尚未完成的下載，清除後不復用舊結果", async () => {
    let finish; const read = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const decode = vi.fn(), cache = createMaterialCache({ read, decode });
    const pending = cache.acquire(background); cache.clear("class-1"); finish(asset);
    await expect(pending).rejects.toThrow("權限已失效"); expect(decode).not.toHaveBeenCalled();
  });
  it("拒絕偽造寬高、非 JPEG 及解碼失敗，可重試", async () => {
    expect(jpegDimensions(bytes)).toEqual({ width: 3, height: 2 });
    expect(() => jpegDimensions(new Uint8Array([1, 2, 3]))).toThrow();
    const cache = createMaterialCache({ read: async () => ({ ...asset, width: 4 }) });
    await expect(cache.acquire(background)).rejects.toThrow("尺寸異常");
    const decode = vi.fn().mockRejectedValueOnce(new Error("解碼失敗")).mockResolvedValue({ naturalWidth: 3, naturalHeight: 2 });
    const revokeUrl = vi.fn(), retryCache = createMaterialCache({ read: async () => asset, decode, createUrl: () => "blob:test", revokeUrl });
    await expect(retryCache.acquire(background)).rejects.toThrow("解碼失敗");
    const resource = await retryCache.acquire(background); resource.release(); expect(revokeUrl).toHaveBeenCalledTimes(2);
  });
});
