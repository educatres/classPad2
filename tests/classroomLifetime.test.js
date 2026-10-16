import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const watchDeadline = vi.hoisted(() => vi.fn());
vi.mock("../src/firebase/classroomRepository.js", () => ({ watchClassroomExpiresAt: watchDeadline }));

import { watchClassroomLifetime } from "../src/firebase/classroomLifetime.js";
import { CLASSROOM_TTL_MS, setServerTimeOffset, watchClassroomExpiry } from "../src/utils/classroomExpiration.js";

describe("課程期限監聽恢復", () => {
  let subscriptions, stops, documentEvents, windowEvents, now;

  beforeEach(() => {
    vi.useFakeTimers();
    now = Date.UTC(2026, 9, 16, 0);
    vi.setSystemTime(now);
    setServerTimeOffset(0);
    subscriptions = [];
    stops = [];
    documentEvents = new EventTarget();
    documentEvents.visibilityState = "visible";
    windowEvents = new EventTarget();
    vi.stubGlobal("document", documentEvents);
    vi.stubGlobal("addEventListener", windowEvents.addEventListener.bind(windowEvents));
    vi.stubGlobal("removeEventListener", windowEvents.removeEventListener.bind(windowEvents));
    watchDeadline.mockReset();
    watchDeadline.mockImplementation((classId, apply, fail) => {
      const off = vi.fn();
      subscriptions.push({ classId, apply, fail, off });
      return off;
    });
  });

  afterEach(() => {
    stops.forEach((stop) => stop());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setServerTimeOffset(0);
  });

  function watch(expiresAt = now + CLASSROOM_TTL_MS) {
    const onExpire = vi.fn(), onError = vi.fn();
    const stop = watchClassroomLifetime("class-1", expiresAt, { onExpire, onError });
    stops.push(stop);
    return { stop, onExpire, onError };
  }

  it("閒置後監聽遭取消不代表到期，並自動重新訂閱", () => {
    const { onExpire, onError } = watch();
    const error = { code: "PERMISSION_DENIED" };
    subscriptions[0].fail(error);
    expect(onExpire).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(subscriptions[0].off).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(subscriptions).toHaveLength(2);
    subscriptions[1].apply(now + CLASSROOM_TTL_MS);
    vi.advanceTimersByTime(60 * 60 * 1_000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(watchDeadline).toHaveBeenLastCalledWith("class-1", expect.any(Function), expect.any(Function));
  });

  it("持續失敗時逐步延長重試間隔，且不重複提示相同中斷", () => {
    const { onExpire, onError } = watch();
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const count = subscriptions.length;
      subscriptions.at(-1).fail(new Error("disconnected"));
      vi.advanceTimersByTime(delay - 1);
      expect(subscriptions).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(subscriptions).toHaveLength(count + 1);
    }
    expect(onError).toHaveBeenCalledOnce();
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("恢復後重新遇到錯誤會再次通知並從短間隔重試", () => {
    const { onExpire, onError } = watch();
    subscriptions[0].fail(new Error("first failure"));
    vi.advanceTimersByTime(1_000);
    subscriptions[1].fail(new Error("still offline"));
    vi.advanceTimersByTime(2_000);
    subscriptions[2].apply(now + CLASSROOM_TTL_MS);
    subscriptions[2].fail(new Error("new interruption"));
    vi.advanceTimersByTime(1_000);
    expect(subscriptions).toHaveLength(4);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("回到前景或恢復網路時立即重試，不建立重複監聽", () => {
    watch();
    subscriptions[0].fail(new Error("idle"));
    documentEvents.visibilityState = "hidden";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(subscriptions).toHaveLength(1);
    documentEvents.visibilityState = "visible";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(subscriptions).toHaveLength(2);
    windowEvents.dispatchEvent(new Event("online"));
    windowEvents.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(1_000);
    expect(subscriptions).toHaveLength(2);
    subscriptions[1].fail(new Error("offline again"));
    windowEvents.dispatchEvent(new Event("online"));
    expect(subscriptions).toHaveLength(3);
  });

  it("無效或暫時缺少期限時保留上一個有效期限", () => {
    const { onExpire } = watch(now + 60_000);
    for (const value of [null, undefined, "", NaN, Infinity, -1, "invalid"]) subscriptions[0].apply(value);
    vi.advanceTimersByTime(59_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(subscriptions[0].off).toHaveBeenCalledOnce();
  });

  it("更新期限後取消舊計時器，並在新期限到達時停止", () => {
    const { onExpire } = watch(now + 60_000);
    subscriptions[0].apply(now + CLASSROOM_TTL_MS);
    vi.advanceTimersByTime(60_000);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CLASSROOM_TTL_MS - 60_000);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("斷線期間真正到期仍會停止，且不再重試", () => {
    const { onExpire } = watch(now + 500);
    subscriptions[0].fail(new Error("network lost"));
    vi.advanceTimersByTime(500);
    expect(onExpire).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    windowEvents.dispatchEvent(new Event("online"));
    expect(subscriptions).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("裝置閒置後返回，仍依實際期限判斷", () => {
    const { onExpire } = watch();
    vi.setSystemTime(now + CLASSROOM_TTL_MS - 1);
    windowEvents.dispatchEvent(new Event("pageshow"));
    expect(onExpire).not.toHaveBeenCalled();
    vi.setSystemTime(now + CLASSROOM_TTL_MS);
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it("停止後移除計時器、恢復事件及舊監聽回呼", () => {
    const { stop, onExpire, onError } = watch();
    subscriptions[0].fail(new Error("offline"));
    stop();
    subscriptions[0].apply(now - 1);
    subscriptions[0].fail(new Error("late callback"));
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    windowEvents.dispatchEvent(new Event("online"));
    windowEvents.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(CLASSROOM_TTL_MS);
    expect(onExpire).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(subscriptions).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("忽略已取消訂閱延遲抵達的期限與錯誤", () => {
    const { onExpire, onError } = watch();
    subscriptions[0].fail(new Error("cancelled"));
    vi.advanceTimersByTime(1_000);
    subscriptions[0].apply(now - 1);
    subscriptions[0].fail(new Error("stale error"));
    expect(onExpire).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    subscriptions[1].apply(now);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it("初次讀到已到期的課程時立即停止，不啟動背景重試", () => {
    const { onExpire } = watch(now);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(watchDeadline).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("訂閱同步回報到期或錯誤時也能清理監聽", () => {
    const off = vi.fn();
    watchDeadline.mockImplementationOnce((_classId, apply) => { apply(now); return off; });
    const { onExpire } = watch();
    expect(onExpire).toHaveBeenCalledOnce();
    expect(off).toHaveBeenCalledOnce();
    const errorOff = vi.fn();
    watchDeadline.mockImplementationOnce((_classId, _apply, fail) => { fail(new Error("cancelled immediately")); return errorOff; });
    const next = watch();
    expect(next.onExpire).not.toHaveBeenCalled();
    expect(errorOff).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(subscriptions).toHaveLength(1);
  });

  it("未知期限不會當作到期，也不會啟動零間隔計時器", () => {
    const { onExpire } = watch(null);
    vi.advanceTimersByTime(CLASSROOM_TTL_MS);
    expect(onExpire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    subscriptions[0].apply(Date.now() + 1_000);
    vi.advanceTimersByTime(1_000);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it("共用計時器不把缺漏或無效日期判斷成到期", () => {
    const onExpire = vi.fn(), onTick = vi.fn();
    for (const expiresAt of [null, undefined, NaN, Infinity, -1]) {
      stops.push(watchClassroomExpiry({ expiresAt }, { onExpire, onTick }));
    }
    windowEvents.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(CLASSROOM_TTL_MS);
    expect(onExpire).not.toHaveBeenCalled();
    expect(onTick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
