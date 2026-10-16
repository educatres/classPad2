import { describe, expect, it } from "vitest";
import { CLASSROOM_TTL_MS, classroomExpiresAt, formatClassroomRemaining, isClassroomExpired } from "../src/utils/classroomExpiration.js";

describe("課程 10 小時到期", () => {
  it("固定為十小時，並在到期邊界停止使用", () => {
    expect(CLASSROOM_TTL_MS).toBe(36_000_000);
    const classroom = { createdAt: 1_000 };
    expect(isClassroomExpired(classroom, 1_000 + CLASSROOM_TTL_MS - 1)).toBe(false);
    expect(isClassroomExpired(classroom, 1_000 + CLASSROOM_TTL_MS)).toBe(true);
  });
  it("從建立時間推算舊課程到期時間", () => {
    expect(classroomExpiresAt({ createdAt: 1_000 })).toBe(1_000 + CLASSROOM_TTL_MS);
  });

  it("缺少建立時間時仍能讀取既有 expiresAt", () => {
    expect(classroomExpiresAt({ expiresAt: 2_000 })).toBe(2_000);
    expect(isClassroomExpired({ expiresAt: 2_000 }, 2_000)).toBe(true);
  });

  it("既有三小時期限改為從原建立時間起算十小時", () => {
    const createdAt = 1_000, classroom = { createdAt, expiresAt: createdAt + 3 * 60 * 60 * 1000 };
    expect(classroomExpiresAt(classroom)).toBe(createdAt + CLASSROOM_TTL_MS);
    expect(isClassroomExpired(classroom, createdAt + 4 * 60 * 60 * 1000)).toBe(false);
    expect(isClassroomExpired(classroom, createdAt + CLASSROOM_TTL_MS)).toBe(true);
  });

  it("既有較長或不一致 expiresAt 也使用建立後十小時", () => {
    expect(classroomExpiresAt({ createdAt: 1_000, expiresAt: 1_000 + 48 * 60 * 60 * 1000 })).toBe(1_000 + CLASSROOM_TTL_MS);
    expect(classroomExpiresAt({ createdAt: 1_000, expiresAt: 2_000 })).toBe(1_000 + CLASSROOM_TTL_MS);
  });

  it("以小時與分鐘顯示剩餘時間", () => {
    expect(formatClassroomRemaining({ expiresAt: 3_661_000 }, 1_000)).toBe("1 小時 1 分鐘");
    expect(formatClassroomRemaining({ expiresAt: 50_000 }, 1_000)).toBe("不到 1 分鐘");
    expect(formatClassroomRemaining({ expiresAt: 1_000 }, 1_000)).toBe("已到期");
  });
});
