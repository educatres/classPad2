import { describe, expect, it, vi } from "vitest";
import { drawPageBackground, exportClassroomZip, sanitizeFilename } from "../src/teacher/classroomExporter.js";
import { materialCache } from "../src/whiteboard/materialCache.js";

const classroom = {
  title: "自然課",
  boardPages: {
    main: { id: "main", order: 0 },
    page_ABCDEF: { id: "page_ABCDEF", order: 1 },
    page_GHIJKL: { id: "page_GHIJKL", order: 2 }
  }
};

describe("全班作品匯出", () => {
  it("單張及 ZIP 的共用合成路徑包含截圖；載入失敗不得交付空底圖", async () => {
    const background = { type: "rtdb-capture", classId: "class-1", assetId: "page_ABCDEF", scale: .5, x: .25, y: .75 };
    const image = { naturalWidth: 800, naturalHeight: 400 }, release = vi.fn(), context = { drawImage: vi.fn() };
    const acquire = vi.spyOn(materialCache, "acquire").mockResolvedValueOnce({ image, release });
    try {
      await expect(drawPageBackground(context, background)).resolves.toBe(true);
      expect(context.drawImage).toHaveBeenCalledWith(image, 0, 700, 800, 400); expect(release).toHaveBeenCalledOnce();
      acquire.mockRejectedValueOnce(new Error("教材載入失敗"));
      await expect(drawPageBackground(context, background)).rejects.toThrow("教材載入失敗");
    } finally { acquire.mockRestore(); }
  });
  it("只輸出有任一圖層筆跡的頁面，並列出完全空白的學生", async () => {
    const students = [
      { id: "student-1", boardToken: "token-1", seatNumber: "01", displayName: "王小明" },
      { id: "student-2", boardToken: "token-2", seatNumber: "02", displayName: "陳小華" },
      { id: "student-3", boardToken: "token-3", seatNumber: "03", displayName: "林小美" }
    ];
    const layers = {
      "token-1/main": { studentStrokes: [{ id: "s1" }], teacherStrokes: [{ id: "t1" }] },
      "token-1/page_ABCDEF": { studentStrokes: [], teacherStrokes: [] },
      "token-1/page_GHIJKL": { studentStrokes: [{ id: "s2" }], teacherStrokes: [] },
      "token-2/main": { studentStrokes: [], teacherStrokes: [] },
      "token-2/page_ABCDEF": { studentStrokes: [], teacherStrokes: [{ id: "t2" }] },
      "token-2/page_GHIJKL": { studentStrokes: [], teacherStrokes: [] }
    };
    const renderPage = vi.fn(async ({ pageNumber }) => new Blob([`png-${pageNumber}`], { type: "image/png" }));
    let capturedFiles;
    const progress = vi.fn();
    const result = await exportClassroomZip({
      classroom,
      students,
      loadPageLayers: async (token, pageId) => layers[`${token}/${pageId}`] || { studentStrokes: [], teacherStrokes: [] },
      renderPage,
      zipBuilder: async (files) => { capturedFiles = files; return new Blob(["zip"]); },
      onProgress: progress,
      exportedAt: new Date(2026, 6, 19, 12, 0, 0)
    });

    expect(capturedFiles.map((file) => file.name)).toEqual([
      "01-王小明/第01頁.png",
      "01-王小明/第03頁.png",
      "02-陳小華/第02頁.png",
      "無筆記學生.txt"
    ]);
    expect(renderPage).toHaveBeenCalledTimes(3);
    expect(renderPage.mock.calls[0][0].studentStrokes).toEqual([{ id: "s1" }]);
    expect(renderPage.mock.calls[0][0].teacherStrokes).toEqual([{ id: "t1" }]);
    expect(capturedFiles.at(-1).data).toContain("03 林小美");
    expect(result).toMatchObject({ filename: "自然課-全班作品.zip", exportedStudents: 2, pageCount: 3 });
    expect(result.emptyStudents).toEqual([students[2]]);
    expect(progress).toHaveBeenLastCalledWith({ completedStudents: 3, totalStudents: 3, student: students[2] });
  });

  it("處理不合法檔名字元與重複資料夾名稱", async () => {
    const students = [
      { id: "student-one", boardToken: "token-1", seatNumber: "01", displayName: "王/小明" },
      { id: "student-two", boardToken: "token-2", seatNumber: "01", displayName: "王/小明" }
    ];
    let files;
    await exportClassroomZip({
      classroom: { title: "課:堂", boardPages: { main: { id: "main", order: 0 } } },
      students,
      loadPageLayers: async () => ({ studentStrokes: [{ id: "stroke" }], teacherStrokes: [] }),
      renderPage: async () => new Blob(["png"]),
      zipBuilder: async (value) => { files = value; return new Blob(); }
    });

    expect(files[0].name).toBe("01-王-小明/第01頁.png");
    expect(files[1].name).toBe("01-王-小明-student-two/第01頁.png");
    expect(sanitizeFilename("課:堂")).toBe("課-堂");
    expect(files.at(-1).data).toContain("所有學生皆有筆記。");
  });

  it("PNG 總大小超過限制時停止匯出", async () => {
    await expect(exportClassroomZip({
      classroom: { title: "課堂", boardPages: { main: { id: "main", order: 0 } } },
      students: [{ id: "student-1", boardToken: "token-1", seatNumber: "01", displayName: "王小明" }],
      loadPageLayers: async () => ({ studentStrokes: [{ id: "stroke" }], teacherStrokes: [] }),
      renderPage: async () => new Blob([new Uint8Array(4)]),
      zipBuilder: vi.fn(),
      maxBytes: 3
    })).rejects.toThrow("超過 250 MB");
  });

  it("只有文字作答的頁面也會匯出", async () => {
    const renderPage = vi.fn(async () => new Blob(["png"]));
    const result = await exportClassroomZip({
      classroom: { title: "課堂", boardPages: { main: { id: "main", order: 0 } } },
      students: [{ id: "student-1", boardToken: "token-1", seatNumber: "01", displayName: "王小明" }],
      loadPageLayers: async () => ({ studentStrokes: [], studentText: { text: "文字答案", scrollTop: 0 }, teacherStrokes: [] }),
      renderPage,
      zipBuilder: async () => new Blob(["zip"])
    });

    expect(renderPage).toHaveBeenCalledWith(expect.objectContaining({ studentText: { text: "文字答案", scrollTop: 0 } }));
    expect(result).toMatchObject({ exportedStudents: 1, pageCount: 1, emptyStudents: [] });
  });

  it("只有便條貼的頁面也會壓平匯出", async () => {
    const renderPage = vi.fn(async () => new Blob(["png"]));
    const stickyNotes = [{ id: "note-1", text: "老師提醒", color: "yellow", x: .1, y: .1, width: .3, height: .2 }];
    const result = await exportClassroomZip({
      classroom: { title: "課堂", boardPages: { main: { id: "main", order: 0 } } },
      students: [{ id: "student-1", boardToken: "token-1", seatNumber: "01", displayName: "王小明" }],
      loadPageLayers: async () => ({ studentStrokes: [], studentText: null, teacherStrokes: [], stickyNotes }),
      renderPage,
      zipBuilder: async () => new Blob(["zip"])
    });
    expect(renderPage).toHaveBeenCalledWith(expect.objectContaining({ stickyNotes }));
    expect(result).toMatchObject({ exportedStudents: 1, pageCount: 1 });
  });


});
