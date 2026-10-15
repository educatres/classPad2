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

import { addStudents, bindStudent } from "../src/firebase/studentRepository.js";

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
