import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ subscribeLayer: vi.fn(), subscribeStickyNotes: vi.fn(), subscribeStudentText: vi.fn(), clearBackgroundImage: vi.fn(), showBackgroundImage: vi.fn() }));
vi.mock("../src/firebase/boardRepository.js", () => mocks);
vi.mock("../src/whiteboard/backgroundImage.js", () => mocks);
import { ThumbnailBoard, thumbnailDimensions } from "../src/monitor/ThumbnailBoard.js";

describe("總覽縮圖", () => {
  let offs, observer, callbacks;
  beforeEach(() => {
    vi.clearAllMocks(); offs = []; callbacks = [];
    for (const name of ["subscribeLayer", "subscribeStickyNotes", "subscribeStudentText"]) mocks[name].mockImplementation(() => { const off = vi.fn(); offs.push(off); return off; });
    observer = { observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal("ResizeObserver", class { constructor() { return observer; } });
    vi.stubGlobal("requestAnimationFrame", vi.fn((fn) => { callbacks.push(fn); return callbacks.length; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Retina 縮圖也限制在 480 × 360 像素內", () => {
    expect(thumbnailDimensions(400, 3)).toEqual({ width: 480, height: 360 });
    expect(thumbnailDimensions(100, 2)).toEqual({ width: 200, height: 150 });
  });
  it("同一影格合併大量筆跡更新，全部圖層就緒前顯示載入提示，銷毀後不再重畫", () => {
    const loading = { hidden: false }, canvas = { width: 480, height: 360 }, image = { addEventListener: vi.fn() };
    const container = { dataset: {}, setAttribute: vi.fn(), classList: { toggle: vi.fn() }, querySelector: (selector) => selector === "canvas" ? canvas : selector === "img" ? image : loading };
    const onAnswer = vi.fn(), thumbnail = new ThumbnailBoard({ container, token: "token", pageId: "page_current", onAnswer });
    thumbnail.draw = vi.fn();
    const studentHandlers = mocks.subscribeLayer.mock.calls[0][2], teacherHandlers = mocks.subscribeLayer.mock.calls[1][2], noteHandlers = mocks.subscribeStickyNotes.mock.calls[0][1];
    for (let index = 0; index < 100; index++) studentHandlers.add(`stroke_${index}`, { points: [] });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
    studentHandlers.ready(); teacherHandlers.ready(); noteHandlers.ready();
    expect(loading.hidden).toBe(false);
    mocks.subscribeStudentText.mock.calls[0][1](null);
    expect(loading.hidden).toBe(true); expect(container.dataset.loaded).toBe("true");
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    callbacks[0](); expect(thumbnail.draw).toHaveBeenCalledOnce();
    studentHandlers.remove("stroke_1"); thumbnail.destroy(); callbacks.at(-1)();
    expect(thumbnail.draw).toHaveBeenCalledOnce(); expect(offs.every((off) => off.mock.calls.length === 1)).toBe(true);
    expect(observer.disconnect).toHaveBeenCalledOnce(); expect(canvas.width).toBe(0); expect(mocks.clearBackgroundImage).toHaveBeenCalledWith(image);
  });
});
