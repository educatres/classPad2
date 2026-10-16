import { describe, expect, it, vi } from "vitest";
import { boundedScale, pointerPosition, selectionPixels, selectionRect } from "../src/pdf/geometry.js";
import { PDF_LIMITS, validateCapture } from "../src/pdf/limits.js";
import { compressCapture } from "../src/pdf/capture.js";
import { boardPagesMap, normalizeBoardPages } from "../src/whiteboard/pages.js";
import { normalizeBackgroundImage } from "../src/whiteboard/backgroundImage.js";

describe("PDF 框選與暫存", () => {
  it("相對實際 Canvas 計算四個拖曳方向，Retina 像素與縮放不影響選取區域", () => {
    const rect = { left: 100, top: 200, width: 400, height: 600 };
    for (const [a, b] of [[{ x: .2, y: .3 }, { x: .8, y: .9 }], [{ x: .8, y: .9 }, { x: .2, y: .3 }], [{ x: .2, y: .9 }, { x: .8, y: .3 }], [{ x: .8, y: .3 }, { x: .2, y: .9 }]]) {
      const start = pointerPosition({ clientX: rect.left + a.x * rect.width, clientY: rect.top + a.y * rect.height }, rect);
      const end = pointerPosition({ clientX: rect.left + b.x * rect.width, clientY: rect.top + b.y * rect.height }, rect);
      expect(selectionPixels(selectionRect(start, end), 800, 1200)).toEqual({ x: 160, y: 360, width: 480, height: 720 });
    }
    expect(pointerPosition({ clientX: -10, clientY: 900 }, rect)).toEqual({ x: 0, y: 1 });
    expect(selectionPixels({ x: .5, y: .5, width: 0, height: 1 }, 800, 1200)).toBeNull();
    expect(selectionPixels({ x: .9, y: .9, width: .5, height: .5 }, 100, 100)).toEqual({ x: 90, y: 90, width: 10, height: 10 });
  });
  it("高 DPI 與旋轉長頁仍限制四百萬像素和長邊", () => {
    for (const [w, h] of [[600, 900], [900, 600], [10000, 100]]) {
      const scale = boundedScale(w, h, 20);
      expect(w * h * scale * scale).toBeLessThanOrEqual(PDF_LIMITS.canvasPixels + 1);
      expect(Math.max(w, h) * scale).toBeLessThanOrEqual(4096);
    }
  });
  it("壓縮有有限終點，白底、小圖不放大，釋放暫存畫布", async () => {
    const context = { fillRect: vi.fn(), drawImage: vi.fn() }, canvas = { getContext: () => context };
    const makeCanvas = () => canvas, encode = vi.fn(async () => new Blob([new Uint8Array(262145)], { type: "image/jpeg" }));
    await expect(compressCapture({ width: 3000, height: 2000 }, { makeCanvas, encode })).rejects.toThrow("縮小選取範圍");
    expect(encode).toHaveBeenCalledTimes(6); expect(canvas.width).toBe(0);
    const small = await compressCapture({ width: 300, height: 200 }, { makeCanvas, encode: async () => new Blob(["abc"], { type: "image/jpeg" }) });
    expect(small).toMatchObject({ width: 300, height: 200, byteLength: 3, base64: "YWJj" });
    expect(context.fillStyle).toBe("#fff");
  });
  it("二進位及 Base64 邊界必須相符，拒絕 Data URL 與異常尺寸", () => {
    const capture = { mimeType: "image/jpeg", base64: "A".repeat(349526) + "==", width: 1600, height: 1000, byteLength: 262144 };
    expect(validateCapture(capture)).toBe(capture);
    for (const changes of [{ byteLength: 262145 }, { width: 1601 }, { height: 0 }, { base64: "data:image/jpeg;base64,AAAA" }, { base64: "A=" }]) expect(() => validateCapture({ ...capture, ...changes })).toThrow();
  });
  it("截圖參照可往返序列化，拒絕無效參照與其他來源", () => {
    const backgroundImage = { type: "rtdb-capture", classId: "class-1", assetId: "page_ABCDEF", scale: .8, x: .4, y: .6, updatedAt: 1, updatedBy: "teacher" };
    expect(boardPagesMap(normalizeBoardPages({ page_ABCDEF: { id: "page_ABCDEF", order: 2, backgroundImage } })).page_ABCDEF.backgroundImage).toEqual(backgroundImage);
    expect(normalizeBackgroundImage({ ...backgroundImage, assetId: "main" })).toBeNull();
    expect(normalizeBackgroundImage({ type: "arbitrary", sourceUrl: "https://example.com/a" })).toBeNull();
  });
});
