import { describe, expect, it } from "vitest";
import { backgroundImageDrawRect, googleDriveCanvasImageUrl, googleDriveFileId, normalizeBackgroundImage, normalizeBackgroundPosition, normalizeBackgroundScale, normalizeGoogleDriveImageUrl, showBackgroundImage } from "../src/whiteboard/backgroundImage.js";
import { boardPagesMap, normalizeBoardPages } from "../src/whiteboard/pages.js";

const fileId = "1AbCdEfGhIjKlMnOpQrStUvWxYz234567";

describe("Google Drive 白板底圖", () => {
  it("支援常見的 Google Drive 分享網址", () => {
    expect(googleDriveFileId(`https://drive.google.com/file/d/${fileId}/view?usp=sharing`)).toBe(fileId);
    expect(googleDriveFileId(`https://drive.google.com/open?id=${fileId}`)).toBe(fileId);
    expect(normalizeGoogleDriveImageUrl(`https://drive.google.com/file/d/${fileId}/view`).imageUrl).toBe(`https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`);
  });

  it("匯出 Canvas 時使用允許跨網域讀取的 Google 圖片網址", () => {
    const background = normalizeGoogleDriveImageUrl(`https://drive.google.com/file/d/${fileId}/view`);
    expect(googleDriveCanvasImageUrl(background)).toBe(`https://lh3.googleusercontent.com/d/${fileId}=w2000`);
    expect(googleDriveCanvasImageUrl(null)).toBeNull();
  });

  it("拒絕非 Google Drive 網址並限制縮放範圍", () => {
    expect(() => normalizeGoogleDriveImageUrl("https://example.com/image.png")).toThrow("Google Drive");
    expect([normalizeBackgroundScale(0), normalizeBackgroundScale(.75), normalizeBackgroundScale(3)]).toEqual([.1, .75, 1.5]);
    expect([normalizeBackgroundPosition(-1), normalizeBackgroundPosition(.25), normalizeBackgroundPosition(2), normalizeBackgroundPosition(undefined)]).toEqual([0, .25, 1, .5]);
  });

  it("舊底圖預設置中，並限制位置在白板範圍內", () => {
    const value = { sourceUrl: `https://drive.google.com/file/d/${fileId}/view`, imageUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`, scale: 1, updatedAt: 2, updatedBy: "teacher" };
    expect(normalizeBackgroundImage(value)).toMatchObject({ x: .5, y: .5 });
    expect(normalizeBackgroundImage({ ...value, x: -.2, y: 1.3 })).toMatchObject({ x: 0, y: 1 });
  });

  it("頁序轉換會保留每一頁自己的底圖", () => {
    const backgroundImage = { sourceUrl: `https://drive.google.com/file/d/${fileId}/view`, imageUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`, scale: .8, x: .3, y: .7, updatedAt: 2, updatedBy: "teacher" };
    const pages = normalizeBoardPages({ main: { id: "main", order: 0, createdAt: 1, createdBy: "teacher", backgroundImage } });
    expect(boardPagesMap(pages).main.backgroundImage).toEqual(backgroundImage);
  });

  it("渲染時同時保留底圖縮放比例與位置", () => {
    const properties = new Map(), attributes = new Map();
    const element = {
      hidden: true,
      style: { setProperty: (key, value) => properties.set(key, value), removeProperty: (key) => properties.delete(key) },
      getAttribute: (key) => attributes.get(key) || null,
      set src(value) { attributes.set("src", value); }
    };
    showBackgroundImage(element, { sourceUrl: `https://drive.google.com/file/d/${fileId}/view`, imageUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`, scale: .5375, x: .25, y: .7, updatedAt: 2, updatedBy: "teacher" });
    expect(Object.fromEntries(properties)).toEqual({ "--background-size": "53.75%", "--background-x": "25%", "--background-y": "70%" });
    expect(element.hidden).toBe(false);
  });

  it("匯出時依白板位置與 object-fit contain 計算底圖範圍", () => {
    const background = { sourceUrl: `https://drive.google.com/file/d/${fileId}/view`, imageUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`, scale: .5, x: .25, y: .75, updatedAt: 2, updatedBy: "teacher" };
    expect(backgroundImageDrawRect(background, 800, 400, 1600, 1200)).toEqual({ x: 0, y: 700, width: 800, height: 400 });
  });
});
