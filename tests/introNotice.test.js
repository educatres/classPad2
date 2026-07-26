import { describe, expect, it, vi } from "vitest";
import { forgetHiddenIntroNotice, rememberHiddenIntroNotice, shouldHideIntroNotice } from "../src/home/introNotice.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;

function createStorage(value = null) {
  let current = value;
  return {
    getItem: vi.fn(() => current),
    setItem: vi.fn((key, value) => { current = value; }),
    removeItem: vi.fn(() => { current = null; })
  };
}

describe("首頁說明隱藏狀態", () => {
  it("隱藏後七天內持續隱藏", () => {
    const storage = createStorage();
    rememberHiddenIntroNotice(1_000, storage);
    expect(shouldHideIntroNotice(1_000 + WEEK - 1, storage)).toBe(true);
  });

  it("超過七天未開啟時重新顯示", () => {
    const storage = createStorage("1000");
    expect(shouldHideIntroNotice(1_000 + WEEK, storage)).toBe(false);
  });

  it("可清除已儲存的隱藏狀態", () => {
    const storage = createStorage("1000");
    forgetHiddenIntroNotice(storage);
    expect(shouldHideIntroNotice(1_001, storage)).toBe(false);
  });
});
