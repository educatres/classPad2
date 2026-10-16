import { describe, expect, it } from "vitest";
import { normalizeGridSize, paginateStudents, prioritizePinned } from "../src/monitor/studentView.js";

const students = Array.from({ length: 10 }, (_, index) => ({ id: `student-${index + 1}` }));

describe("多格監看排序", () => {
  it("全班總覽完整列出 80 人，儲存模式後仍可還原", () => {
    const all = Array.from({ length: 80 }, (_, index) => ({ id: String(index) }));
    expect(normalizeGridSize("all")).toBe("all");
    expect(paginateStudents(all, 5, "all")).toEqual({ page: 0, pages: 1, students: all });
  });
  it("支援 4、6、8、12 格並拒絕其他數量", () => {
    expect([4, 6, 8, 12].map(normalizeGridSize)).toEqual([4, 6, 8, 12]);
    expect(normalizeGridSize(5)).toBe(4);
  });

  it("釘選學生會保持原順序並排到最前面", () => {
    expect(prioritizePinned(students, { "student-5": true, "student-2": true }).map((student) => student.id)).toEqual([
      "student-2", "student-5", "student-1", "student-3", "student-4", "student-6", "student-7", "student-8", "student-9", "student-10"
    ]);
  });

  it("依選擇的格數分頁", () => {
    expect(paginateStudents(students, 1, 6).students.map((student) => student.id)).toEqual(["student-7", "student-8", "student-9", "student-10"]);
    expect(paginateStudents(students, 0, 8).pages).toBe(2);
  });
});
