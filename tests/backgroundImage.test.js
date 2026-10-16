import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundImageDrawRect, clearBackgroundImage, normalizeBackgroundImage, normalizeBackgroundPosition, normalizeBackgroundScale, showBackgroundImage } from "../src/whiteboard/backgroundImage.js";
import { boardPagesMap, normalizeBoardPages } from "../src/whiteboard/pages.js";
import { materialCache } from "../src/whiteboard/materialCache.js";

const background = { type: "rtdb-capture", classId: "class-1", assetId: "page_CAPTURE", scale: .5375, x: .25, y: .7, updatedAt: 2, updatedBy: "teacher" };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PDF 截圖題目顯示", () => {
  it("限制派送版面的縮放與位置範圍", () => {
    expect([normalizeBackgroundScale(0), normalizeBackgroundScale(.75), normalizeBackgroundScale(3)]).toEqual([.1, .75, 1.5]);
    expect([normalizeBackgroundPosition(-1), normalizeBackgroundPosition(.25), normalizeBackgroundPosition(2), normalizeBackgroundPosition(undefined)]).toEqual([0, .25, 1, .5]);
    expect(normalizeBackgroundImage({ ...background, x: -.2, y: 1.3 })).toMatchObject({ x: 0, y: 1 });
  });

  it("只接受 PDF 截圖參照，不再讀取 Drive 底圖", () => {
    expect(normalizeBackgroundImage(background)).toEqual(background);
    const drive = { sourceUrl: "https://drive.google.com/file/d/1234567890abcdef/view", imageUrl: "https://drive.google.com/thumbnail?id=1234567890abcdef&sz=w2000", scale: 1 };
    for (const value of [null, drive, { ...background, assetId: "main" }, { ...background, type: "other" }]) expect(normalizeBackgroundImage(value)).toBeNull();
  });

  it("頁序轉換保留已確認的 PDF 大小與位置", () => {
    const pages = normalizeBoardPages({ page_CAPTURE: { id: "page_CAPTURE", order: 1, createdAt: 1, createdBy: "teacher", backgroundImage: background } });
    expect(boardPagesMap(pages).page_CAPTURE.backgroundImage).toEqual(background);
  });

  it("渲染使用派送版面，卸載時釋放教材", async () => {
    const properties = new Map(), attributes = new Map(), release = vi.fn();
    const status = { remove: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => status) });
    vi.spyOn(materialCache, "acquire").mockResolvedValue({ url: "blob:pdf-capture", release });
    const element = {
      hidden: true, parentElement: { append: vi.fn() },
      style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) },
      getAttribute: key => attributes.get(key) || null, removeAttribute: key => attributes.delete(key),
      set src(value) { attributes.set("src", value); }
    };
    showBackgroundImage(element, background);
    await vi.waitFor(() => expect(element.hidden).toBe(false));
    expect(Object.fromEntries(properties)).toEqual({ "--background-size": "53.75%", "--background-x": "25%", "--background-y": "70%" });
    expect(attributes.get("src")).toBe("blob:pdf-capture");
    clearBackgroundImage(element);
    expect(release).toHaveBeenCalledOnce();
    expect(element.hidden).toBe(true);
    expect(attributes.has("src")).toBe(false);
  });

  it("匯出依已確認的大小位置計算題目範圍", () => {
    expect(backgroundImageDrawRect({ ...background, scale: .5, x: .25, y: .75 }, 800, 400)).toEqual({ x: 0, y: 700, width: 800, height: 400 });
  });
});
