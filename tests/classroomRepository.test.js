import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  get: vi.fn(), onValue: vi.fn(), ref: vi.fn((_database, path = "") => path), remove: vi.fn(), set: vi.fn(), update: vi.fn()
}));

vi.mock("firebase/database", () => databaseMocks);
vi.mock("../src/firebase/config.js", () => ({ database: {} }));
vi.mock("../src/utils/random.js", () => ({ randomId: () => "class-1", teacherAccessKey: () => "123456" }));

import { cleanupExpiredClassroom, createClassroom, deleteClassroom, getClassroomExpiresAt, listAllClasses, listPublicClassDebugRows, syncClassroomDirectory } from "../src/firebase/classroomRepository.js";
import { CLASSROOM_TTL_MS, setServerTimeOffset } from "../src/utils/classroomExpiration.js";

describe("課程建立與到期清理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setServerTimeOffset(0);
    databaseMocks.set.mockResolvedValue();
    databaseMocks.update.mockResolvedValue();
    databaseMocks.get.mockResolvedValue({ val: () => 0 });
  });

  it("建立時寫入 3 小時後的固定到期時間", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await createClassroom("teacher", { title: "數學課" });
    const classroom = databaseMocks.update.mock.calls[0][1]["classes/class-1"];
    expect(classroom.expiresAt).toBe(1_000_000 + CLASSROOM_TTL_MS);
    expect(databaseMocks.get).not.toHaveBeenCalled();
    expect(databaseMocks.set).toHaveBeenCalledTimes(1);
    expect(databaseMocks.set).toHaveBeenCalledWith("teacherKeys/class-1", "123456");
    vi.restoreAllMocks();
  });

  it("舊課程沒有 expiresAt 時從 createdAt 推算", async () => {
    databaseMocks.get.mockResolvedValueOnce({ val: () => null }).mockResolvedValueOnce({ val: () => 5_000 });
    await expect(getClassroomExpiresAt("class-1")).resolves.toBe(5_000 + CLASSROOM_TTL_MS);
  });

  it("讀取並依更新時間排序系統課程目錄", async () => {
    databaseMocks.get.mockResolvedValueOnce({ val: () => ({ older: { title: "舊課程", updatedAt: 10 }, newer: { title: "新課程", updatedAt: 20 } }) });
    await expect(listAllClasses()).resolves.toEqual([
      { id: "newer", title: "新課程", updatedAt: 20 },
      { id: "older", title: "舊課程", updatedAt: 10 }
    ]);
    expect(databaseMocks.get).toHaveBeenCalledWith("publicClasses");
  });

  it("只列出 publicClasses 第一層 Key 與 title", async () => {
    databaseMocks.get.mockResolvedValueOnce({ val: () => ({ "class-b": { title: "乙班", className: "六乙" }, "class-a": { title: "甲班", className: "六甲" } }) });
    await expect(listPublicClassDebugRows()).resolves.toEqual([{ key: "class-a", title: "甲班" }, { key: "class-b", title: "乙班" }]);
    expect(databaseMocks.get).toHaveBeenCalledWith("publicClasses");
  });

  it("只同步公開課程欄位", async () => {
    const classroom = { title: "數學課", className: "六甲", activityName: "不可公開", createdAt: 1, expiresAt: 2, updatedAt: 3, status: "active", studentCount: 4, admins: { teacher: true } };
    await syncClassroomDirectory("class-1", classroom);
    expect(databaseMocks.set).toHaveBeenCalledWith("publicClasses/class-1", { title: "數學課", className: "六甲", createdAt: 1, expiresAt: 2, updatedAt: 3, status: "active", studentCount: 4 });
  });

  it("既有較長 expiresAt 仍套用 3 小時上限", async () => {
    databaseMocks.get.mockResolvedValueOnce({ val: () => 5_000 + 48 * 60 * 60 * 1000 }).mockResolvedValueOnce({ val: () => 5_000 });
    await expect(getClassroomExpiresAt("class-1")).resolves.toBe(5_000 + CLASSROOM_TTL_MS);
  });

  it("到期後清除課程與所有主要關聯資料", async () => {
    const classroom = { expiresAt: 1, admins: { teacher: true }, displayToken: "display-token", teacherInviteTokens: { "invite-token": true }, studentOrder: { student: 0 } };
    const students = [{ id: "student", boardToken: "board-token" }];
    databaseMocks.get.mockImplementation(async (path) => ({ val: () => path.startsWith("teacherInvites/") || path.startsWith("displays/") || path.startsWith("boardLookup/") ? { classId: "class-1" } : null }));
    await expect(cleanupExpiredClassroom("class-1", "teacher", classroom, students)).resolves.toBe(true);
    const changes = databaseMocks.update.mock.calls[0][1];
    expect(changes).toMatchObject({
      "classes/class-1": null,
      "publicClasses/class-1": null,
      "students/student": null,
      "boards/board-token": null,
      "boardPages/board-token": null,
      "teacherClaims/class-1": null,
      "teacherInvites/invite-token": null,
      "displays/display-token": null
    });
    expect(databaseMocks.update).toHaveBeenCalledOnce();
  });

  it("刪除課堂時略過不存在或不屬於該課堂的關聯路徑", async () => {
    const classroom = { admins: { teacher: true }, displayToken: "stale-display", teacherInviteTokens: { "stale-invite": true } };
    const students = [{ id: "student", boardToken: "stale-board" }];
    databaseMocks.get.mockImplementation(async (path) => ({ val: () => path.startsWith("displays/") ? { classId: "other-class" } : null }));

    await expect(deleteClassroom("class-1", "teacher", classroom, students)).resolves.toBeUndefined();
    const changes = databaseMocks.update.mock.calls[0][1];
    expect(changes).toMatchObject({ "classes/class-1": null, "publicClasses/class-1": null, "students/student": null, "userClasses/teacher/class-1": null });
    expect(changes).not.toHaveProperty("teacherInvites/stale-invite");
    expect(changes).not.toHaveProperty("displays/stale-display");
    expect(changes).not.toHaveProperty("boardLookup/stale-board");
    expect(changes).not.toHaveProperty("boards/stale-board");
  });

  it("展示用課程不得手動或到期自動刪除", async () => {
    const classroom = { expiresAt: 1, admins: { teacher: true } };
    await expect(deleteClassroom("NWZvyxywKc", "teacher", classroom, [])).rejects.toThrow("受到保護");
    await expect(cleanupExpiredClassroom("NWZvyxywKc", "teacher", classroom, [])).resolves.toBe(false);
    expect(databaseMocks.update).not.toHaveBeenCalled();
  });

  it("未到期時不執行清理", async () => {
    await expect(cleanupExpiredClassroom("class-1", "teacher", { expiresAt: Date.now() + 60_000 })).resolves.toBe(false);
    expect(databaseMocks.update).not.toHaveBeenCalled();
  });
});
