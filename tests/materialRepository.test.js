import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ get: vi.fn(), ref: vi.fn((_db, path) => path), set: vi.fn(), update: vi.fn(), runTransaction: vi.fn(), onValue: vi.fn() }));
vi.mock("firebase/database", () => mock);
vi.mock("../src/firebase/config.js", () => ({ database: {} }));
import { buildCaptureDispatch, createCaptureDispatch, dispatchCapture } from "../src/firebase/materialRepository.js";
import { reconcileClassBoardPages } from "../src/firebase/pageRepository.js";

const uid = "teacher", classId = "class-1", capture = { mimeType: "image/jpeg", base64: "YWJj", width: 3, height: 2, byteLength: 3 };
let data, classroom;
beforeEach(() => {
  vi.clearAllMocks();
  classroom = { createdAt: Date.now(), expiresAt: Date.now() + 10800000, status: "active", admins: { teacher: true }, studentOrder: {}, boardPages: { main: { id: "main", order: 0, createdAt: 1, createdBy: uid }, page_OLDOLD: { id: "page_OLDOLD", order: 8, createdAt: 2, createdBy: uid } } };
  data = { ".info/connected": true, [`classes/${classId}`]: classroom };
  mock.get.mockImplementation(async (path) => ({ val: () => path.startsWith(`classes/${classId}/boardPages/`) ? classroom.boardPages[path.split("/").at(-1)] || null : data[path] || null }));
  mock.onValue.mockImplementation((path, callback) => { callback({ val: () => data[path] }); return () => {}; });
  mock.update.mockImplementation(async (_root, changes) => { for (const [path, value] of Object.entries(changes)) { data[path] = value; if (path.startsWith(`classes/${classId}/boardPages/`)) classroom.boardPages[path.split("/").at(-1)] = value; } });
});
describe("教材派送", () => {
  it("80 人只存一份圖片，新增頁面葉節點，既有內容不變", () => {
    const operation = createCaptureDispatch(capture, uid), students = Array.from({ length: 80 }, (_, i) => ({ boardToken: `token${i}` }));
    const changes = buildCaptureDispatch(classId, classroom, students, operation);
    expect(Object.keys(changes)).toHaveLength(83);
    expect(JSON.stringify(changes).split('"base64"')).toHaveLength(2);
    expect(changes[`classes/${classId}/boardPages/${operation.pageId}`].order).toBe(9);
    expect(Object.keys(changes).some((path) => path.includes("Strokes") || path.endsWith("/main"))).toBe(false);
  });
  it("零學生可派送；同時連點與已提交操作重試不產生第二頁", async () => {
    const operation = createCaptureDispatch(capture, uid);
    const a = dispatchCapture(classId, operation, uid), b = dispatchCapture(classId, operation, uid);
    expect(a).toBe(b); await a;
    await dispatchCapture(classId, operation, uid);
    expect(mock.update).toHaveBeenCalledOnce();
    expect(classroom.boardPages[operation.pageId].backgroundImage.assetId).toBe(operation.pageId);
  });
  it("派送前鎖定版面，課堂及每位學生頁面使用同一大小位置，不改動 JPEG", async () => {
    const placement = { scale: .5375, x: .32, y: .41 }, operation = createCaptureDispatch(capture, uid, placement);
    placement.scale = 1; placement.x = .5;
    classroom.studentOrder = { s1: 0 };
    data["students/s1"] = { classId, enabled: true, boardToken: "student-token" };
    await dispatchCapture(classId, operation, uid);
    const pagePath = `classes/${classId}/boardPages/${operation.pageId}`, studentPath = `boardPages/student-token/${operation.pageId}`;
    expect(data[pagePath].backgroundImage).toMatchObject({ scale: .5375, x: .32, y: .41 });
    expect(data[studentPath]).toEqual(data[pagePath]);
    expect(data[`classMaterials/${classId}/${operation.pageId}`].base64).toBe(capture.base64);
  });
  it("寫入回應遺失時讀回同 ID，避免重寫 immutable 資產", async () => {
    const persist = mock.update.getMockImplementation();
    mock.update.mockImplementationOnce(async (...args) => { await persist(...args); throw new Error("response lost"); });
    const operation = createCaptureDispatch(capture, uid, { scale: .63, x: .35, y: .42 });
    await expect(dispatchCapture(classId, operation, uid)).resolves.toMatchObject({ pageId: operation.pageId });
    expect(mock.update).toHaveBeenCalledOnce();
    expect(classroom.boardPages[operation.pageId].backgroundImage).toMatchObject({ scale: .63, x: .35, y: .42 });
  });
  it("離線、課堂關閉與滿 20 張時拒絕派送", async () => {
    const operation = createCaptureDispatch(capture, uid); data[".info/connected"] = false;
    await expect(dispatchCapture(classId, operation, uid)).rejects.toThrow("離線"); data[".info/connected"] = true;
    classroom.status = "closed"; await expect(dispatchCapture(classId, operation, uid)).rejects.toThrow("已結束"); classroom.status = "active";
    for (let i = 0; i < 20; i++) classroom.boardPages[`page_${i}`] = { backgroundImage: { type: "rtdb-capture" } };
    await expect(dispatchCapture(classId, operation, uid)).rejects.toThrow("最多派送 20"); expect(mock.update).not.toHaveBeenCalled();
  });
  it("晚加入與重設網址只補上缺頁，保留 canonical order 與既有作答", async () => {
    classroom.studentOrder = { s1: 0 }; data["students/s1"] = { classId, enabled: true, boardToken: "new-token" };
    data["boardPages/new-token"] = { main: classroom.boardPages.main };
    mock.runTransaction.mockImplementation(async (_path, fn) => ({ committed: true, snapshot: fn(null) }));
    await reconcileClassBoardPages(classId);
    expect(mock.runTransaction).toHaveBeenCalledWith("boardPages/new-token/page_OLDOLD", expect.any(Function), { applyLocally: false });
    const transform = mock.runTransaction.mock.calls[0][1];
    expect(transform(null).order).toBe(8); const existing = { id: "existing" }; expect(transform(existing)).toBe(existing);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("名單換 token 或其他老師追加時，以同 ID 重取順序並重試", async () => {
    classroom.studentOrder = { s1: 0 };
    data["students/s1"] = { classId, enabled: true, boardToken: "old-token" };
    const persist = mock.update.getMockImplementation(), operation = createCaptureDispatch(capture, uid);
    mock.update.mockImplementationOnce(async () => {
      classroom.boardPages.page_PEER12 = { id: "page_PEER12", order: 9, createdAt: 3, createdBy: uid };
      data["students/s1"].boardToken = "new-token";
      data["boardPages/new-token"] = classroom.boardPages;
      throw new Error("PERMISSION_DENIED");
    }).mockImplementationOnce(persist);
    await dispatchCapture(classId, operation, uid);
    expect(mock.update).toHaveBeenCalledTimes(2);
    const first = mock.update.mock.calls[0][1], retry = mock.update.mock.calls[1][1], path = `classes/${classId}/boardPages/${operation.pageId}`;
    expect(first[path].order).toBe(9); expect(retry[path].order).toBe(10);
    expect(retry[`boardPages/new-token/${operation.pageId}`]).toBeDefined(); expect(retry[`boardPages/old-token/${operation.pageId}`]).toBeUndefined();
    expect(retry[`classMaterials/${classId}/${operation.pageId}`]).toEqual(first[`classMaterials/${classId}/${operation.pageId}`]);
  });
});
