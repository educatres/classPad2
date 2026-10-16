import { describe, expect, it, vi } from "vitest";
import { PreviewRegistry } from "../src/monitor/PreviewRegistry.js";

describe("監看訂閱生命週期", () => {
  it("80 人狀態更新不重建訂閱，換頁與重建網址只更新對應學生", () => {
    const registry = new PreviewRegistry(), dispose = vi.fn(), create = vi.fn(() => ({ dispose })), update = vi.fn();
    const students = Array.from({ length: 80 }, (_, index) => ({ id: String(index), token: `token-${index}`, pageId: "main" }));
    const render = () => registry.reconcile(students, (student) => `${student.token}:${student.pageId}`, create, update);
    render(); expect(create).toHaveBeenCalledTimes(80);
    students[0].online = true; render(); expect(create).toHaveBeenCalledTimes(80); expect(dispose).not.toHaveBeenCalled();
    students[1].pageId = "page_second"; render(); expect(create).toHaveBeenCalledTimes(81); expect(dispose).toHaveBeenCalledTimes(1);
    students[2].token = "replacement"; render(); expect(create).toHaveBeenCalledTimes(82); expect(dispose).toHaveBeenCalledTimes(2);
    students.pop(); render(); expect(dispose).toHaveBeenCalledTimes(3);
    registry.clear(); expect(dispose).toHaveBeenCalledTimes(82); expect(registry.entries.size).toBe(0);
  });
  it("進出批注反覆釋放所有圖層，回來重新訂閱目前資料", () => {
    const registry = new PreviewRegistry(), dispose = vi.fn(), create = vi.fn(() => ({ dispose }));
    for (let i = 0; i < 20; i++) { registry.reconcile([{ id: "s" }], () => "main", create, () => {}); registry.clear(); }
    expect(create).toHaveBeenCalledTimes(20); expect(dispose).toHaveBeenCalledTimes(20);
  });
});
