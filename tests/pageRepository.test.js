import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  get: vi.fn(), onValue: vi.fn(), ref: vi.fn((_database, path) => path),
  runTransaction: vi.fn(), update: vi.fn()
}));
vi.mock("firebase/database", () => databaseMocks);
vi.mock("../src/firebase/config.js", () => ({ database: {} }));

import { updateClassPageCaptureLayout } from "../src/firebase/pageRepository.js";

const capture = { type: "rtdb-capture", classId: "class-1", assetId: "page_CAPTURE", scale: .6, x: .3, y: .4, updatedAt: 1, updatedBy: "teacher" };
const legacy = { sourceUrl: "https://drive.google.com/file/d/1234567890abcdef/view", imageUrl: "https://drive.google.com/thumbnail?id=1234567890abcdef&sz=w2000", scale: 1 };
const classroom = { boardPages: {
  main: { id: "main", order: 0 },
  page_CAPTURE: { id: "page_CAPTURE", order: 1, backgroundImage: capture },
  page_LEGACY: { id: "page_LEGACY", order: 2, backgroundImage: legacy }
} };

describe("已派送 PDF 題目版面", () => {
  beforeEach(() => vi.clearAllMocks());

  it("調整大小位置時保留教材參照，同步全班且不改動圖片或筆跡", async () => {
    const pages = await updateClassPageCaptureLayout("class-1", classroom, [{ boardToken: "token-1" }, { boardToken: "token-2" }], "teacher-2", "page_CAPTURE", .5375, { x: .321, y: .41 });
    const background = pages.find(page => page.id === "page_CAPTURE").backgroundImage;
    expect(background).toMatchObject({ type: "rtdb-capture", classId: "class-1", assetId: "page_CAPTURE", scale: .5375, x: .321, y: .41, updatedBy: "teacher-2" });
    expect(databaseMocks.update).toHaveBeenCalledExactlyOnceWith(undefined, {
      "classes/class-1/boardPages/page_CAPTURE/backgroundImage": background,
      "classes/class-1/updatedAt": background.updatedAt,
      "boardPages/token-1/page_CAPTURE/backgroundImage": background,
      "boardPages/token-2/page_CAPTURE/backgroundImage": background
    });
    expect(classroom.boardPages.page_CAPTURE.backgroundImage).toEqual(capture);
    expect(pages.find(page => page.id === "page_LEGACY").backgroundImage.sourceUrl).toBe(legacy.sourceUrl);

    const resized = await updateClassPageCaptureLayout("class-1", { boardPages: pages }, [], "teacher", "page_CAPTURE", .75);
    expect(resized.find(page => page.id === "page_CAPTURE").backgroundImage).toMatchObject({ scale: .75, x: .321, y: .41, assetId: "page_CAPTURE" });
  });

  it.each(["main", "page_LEGACY", "page_MISSING"])("不在 %s 新增、替換或刪除底圖", async pageId => {
    await expect(updateClassPageCaptureLayout("class-1", classroom, [], "teacher", pageId, .5)).rejects.toThrow();
    expect(databaseMocks.update).not.toHaveBeenCalled();
    expect(classroom.boardPages.page_LEGACY.backgroundImage).toEqual(legacy);
  });
});
