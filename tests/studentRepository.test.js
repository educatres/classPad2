import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  get: vi.fn(),
  onValue: vi.fn(),
  ref: vi.fn((_database, path) => path),
  runTransaction: vi.fn(),
  update: vi.fn()
}));

vi.mock("firebase/database", () => databaseMocks);
vi.mock("../src/firebase/config.js", () => ({ database: {} }));

import { addStudents, bindStudent, regenerateBoard, requestStudentPage } from "../src/firebase/studentRepository.js";

describe("bindStudent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("waits for server-backed student data before starting the transaction", async () => {
    const unsubscribe = vi.fn();
    let emitStudent;
    databaseMocks.onValue.mockImplementation((_target, onValue) => {
      emitStudent = onValue;
      return unsubscribe;
    });
    databaseMocks.runTransaction.mockImplementation(async (_target, updateStudent) => {
      expect(unsubscribe).not.toHaveBeenCalled();
      const next = updateStudent({
        classId: "class-1",
        boardToken: "board-token",
        displayName: "Student",
        seatNumber: "1",
        enabled: true,
        locked: false,
        createdAt: 1,
        updatedAt: 1
      });
      expect(next.studentUid).toBe("student-uid");
      return { committed: true };
    });

    const binding = bindStudent("student-1", "student-uid");
    await Promise.resolve();
    expect(databaseMocks.runTransaction).not.toHaveBeenCalled();

    emitStudent();

    await expect(binding).resolves.toBe(true);
    expect(databaseMocks.runTransaction).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("指定學生切頁", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.update.mockResolvedValue();
    databaseMocks.get.mockResolvedValue({ val: () => null });
  });

  it("只更新指定學生，每次指定相同頁面也產生新的指令", async () => {
    const student = { id: "student-1", boardToken: "current-board-token" };
    await requestStudentPage(student, "page_ABCDEF");
    await requestStudentPage(student, "page_ABCDEF");
    const first = databaseMocks.update.mock.calls[0], second = databaseMocks.update.mock.calls[1];
    expect(first).toEqual(["students/student-1", {
      pageRequest: { id: expect.stringMatching(/^[A-Za-z0-9_-]{14}$/), boardToken: student.boardToken, pageId: "page_ABCDEF" },
      updatedAt: expect.any(Number)
    }]);
    expect(first[1].pageRequest.id).not.toBe(second[1].pageRequest.id);
  });

  it("拒絕不完整的學生資料或非法頁面路徑", async () => {
    await expect(requestStudentPage(null, "main")).rejects.toThrow("無法切換學生頁面");
    await expect(requestStudentPage({ id: "student-1", boardToken: "token" }, "page_ABCDEF/studentStrokes")).rejects.toThrow("無法切換學生頁面");
    expect(databaseMocks.update).not.toHaveBeenCalled();
  });

  it("重新產生連結時與舊白板資料一起清除舊切頁指令", async () => {
    await regenerateBoard("class-1", { id: "student-1", boardToken: "old-token" });
    expect(databaseMocks.update.mock.calls[1][1]).toMatchObject({
      "students/student-1/pageRequest": null, "students/student-1/studentUid": null,
      "boardLookup/old-token": null, "boards/old-token": null, "boardPages/old-token": null
    });
  });
});

describe("addStudents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.update.mockResolvedValue();
    databaseMocks.get.mockResolvedValue({ val: () => null });
  });

  it("允許每班加入 80 位學生", async () => {
    const students = Array.from({ length: 80 }, (_, index) => ({ seatNumber: String(index + 1), displayName: `學生 ${index + 1}` }));
    await addStudents("class-1", { studentCount: 0 }, students);

    const lookups = databaseMocks.update.mock.calls[0][1];
    const changes = databaseMocks.update.mock.calls[1][1];
    expect(Object.keys(lookups).filter((path) => path.startsWith("boardLookup/"))).toHaveLength(80);
    expect(changes["classes/class-1/studentCount"]).toBe(80);
    expect(Object.keys(changes).filter((path) => path.startsWith("students/"))).toHaveLength(80);
    expect(Object.keys(changes).filter((path) => path.startsWith("boardPages/"))).toHaveLength(80);
  });

  it("新增資料失敗時清除預先建立的白板索引", async () => {
    databaseMocks.update.mockResolvedValueOnce().mockRejectedValueOnce(new Error("PERMISSION_DENIED")).mockResolvedValueOnce();

    await expect(addStudents("class-1", { studentCount: 0 }, [{ seatNumber: "1", displayName: "學生" }])).rejects.toThrow("PERMISSION_DENIED");

    const lookupPath = Object.keys(databaseMocks.update.mock.calls[0][1])[0];
    expect(databaseMocks.update.mock.calls[2][1]).toEqual({ [lookupPath]: null });
  });

  it("拒絕第 81 位學生", async () => {
    await expect(addStudents("class-1", { studentCount: 80 }, [{ seatNumber: "81", displayName: "超過上限" }])).rejects.toThrow("每班最多 80 位學生");
    expect(databaseMocks.update).not.toHaveBeenCalled();
  });
});
