import { describe, expect, it } from "vitest";
import { moveCapturePlacement, normalizeCapturePlacement, resizeCapturePlacement } from "../src/pdf/placement.js";
import { backgroundImageDrawRect, backgroundImagePlacementRect } from "../src/whiteboard/backgroundImage.js";

describe("PDF 派送前白板版面", () => {
  it("依白板比例移動，同一個拖曳在 Retina 與縮放預覽得到相同版面", () => {
    const start = { scale: .6, x: .5, y: .5 };
    for (const width of [320, 640, 1280]) {
      expect(moveCapturePlacement(start, width * -.2 / width, width * .75 * .1 / (width * .75))).toEqual({ scale: .6, x: .3, y: .6 });
    }
    expect(moveCapturePlacement(start, -2, 3)).toEqual({ scale: .6, x: 0, y: 1 });
    expect(start).toEqual({ scale: .6, x: .5, y: .5 });
  });

  it("直式、橫式截圖拉右下角等比例縮小，左上角固定", () => {
    for (const [width, height] of [[600, 800], [1200, 400]]) {
      const start = { scale: .8, x: .5, y: .5 }, before = backgroundImagePlacementRect(start, width, height);
      const resized = resizeCapturePlacement(start, width, height, -before.width * .25 / 1600, -before.height * .25 / 1200);
      const after = backgroundImagePlacementRect(resized, width, height);
      expect(resized.scale).toBeCloseTo(.6);
      expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
      expect(after.width / after.height).toBeCloseTo(width / height);
      expect(after.width).toBeCloseTo(before.width * .75);
    }
  });

  it("拖出預覽或縮至零仍維持既有資料庫允許的大小與位置", () => {
    const start = normalizeCapturePlacement();
    expect(resizeCapturePlacement(start, 800, 400, -10, -10).scale).toBe(.1);
    expect(resizeCapturePlacement(start, 800, 400, 10, 10).scale).toBe(1.5);
    expect(normalizeCapturePlacement({ scale: NaN, x: Infinity, y: -3 })).toEqual({ scale: 1, x: .5, y: 0 });
  });

  it("預覽與學生底圖、匯出共用相同版面計算，保留小數比例", () => {
    const placement = { scale: .5375, x: .321, y: .41 };
    const background = { type: "rtdb-capture", classId: "class-1", assetId: "page_PREVIEW", ...placement };
    const preview = backgroundImagePlacementRect(placement, 1300, 600);
    expect(backgroundImageDrawRect(background, 1300, 600)).toEqual(preview);
    const thumbnail = backgroundImagePlacementRect(placement, 1300, 600, 400, 300);
    for (const key of ["x", "y", "width", "height"]) expect(thumbnail[key]).toBeCloseTo(preview[key] / 4);
  });
});
