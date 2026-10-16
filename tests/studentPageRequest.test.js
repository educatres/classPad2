import { describe, expect, it, vi } from "vitest";
import { createStudentPageRequestHandler } from "../src/whiteboard/studentPageRequest.js";

const token = "board-token";
const pages = [{ id: "main" }, { id: "page_ABCDEF" }];
const request = (id = "request-1", pageId = "page_ABCDEF", boardToken = token) => ({ id, pageId, boardToken });

describe("老師指定學生頁面", () => {
  it("頁面清單晚於指令到達時，等待該頁就緒才切換", () => {
    const open = vi.fn(), apply = createStudentPageRequestHandler(token, open);
    expect(apply(request(), [{ id: "main" }])).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(apply(request(), pages)).toBe(true);
    expect(open).toHaveBeenCalledWith("page_ABCDEF");
  });

  it("同一指令只切換一次，之後的名單或頁面更新不干擾學生自行翻頁", () => {
    const open = vi.fn(), apply = createStudentPageRequestHandler(token, open);
    apply(request(), pages);
    expect(apply(request(), [...pages, { id: "page_GHIJKL" }])).toBe(false);
    expect(open).toHaveBeenCalledOnce();
  });

  it("老師再次指定相同頁面仍會執行，重連可套用最新指令", () => {
    const open = vi.fn(), apply = createStudentPageRequestHandler(token, open);
    apply(request(), pages);
    apply(request("request-2"), pages);
    apply(request("latest-after-reconnect", "main"), pages);
    expect(open.mock.calls).toEqual([["page_ABCDEF"], ["page_ABCDEF"], ["main"]]);
  });

  it("忽略無效指令、舊白板 Token 與不存在的頁面", () => {
    const open = vi.fn(), apply = createStudentPageRequestHandler(token, open);
    for (const value of [null, {}, request(""), request("wrong-token", "main", "old-token"), request("unknown-page", "page_NOTFOUND")]) {
      expect(apply(value, pages)).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });
});
