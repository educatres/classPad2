import { watchClassroomExpiresAt } from "./classroomRepository.js";
import { isClassroomExpired, watchClassroomExpiry } from "../utils/classroomExpiration.js";

// A cancelled database listener is not evidence that the classroom has expired.
// Keep the last valid deadline running while restoring the subscription.
export function watchClassroomLifetime(classId, initialExpiresAt, { onExpire, onError } = {}) {
  let stopped = false, generation = 0, subscriptionOff, timerOff, retryTimer;
  let retryDelay = 1_000, reportedError = false;

  function stop() {
    if (stopped) return;
    stopped = true;
    generation++;
    clearTimeout(retryTimer);
    subscriptionOff?.();
    timerOff?.();
    document.removeEventListener("visibilitychange", resume);
    removeEventListener("pageshow", resume);
    removeEventListener("online", resume);
  }

  function expire() {
    if (stopped) return;
    stop();
    onExpire?.();
  }

  function apply(value) {
    if (stopped) return;
    const expiresAt = Number(value);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return;
    retryDelay = 1_000;
    reportedError = false;
    timerOff?.();
    const expiration = { expiresAt };
    if (isClassroomExpired(expiration)) { expire(); return; }
    timerOff = watchClassroomExpiry(expiration, { onExpire: expire });
  }

  function subscribe() {
    if (stopped) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    subscriptionOff?.();
    subscriptionOff = undefined;
    const current = ++generation;
    const fail = (error) => {
      if (stopped || current !== generation) return;
      generation++;
      subscriptionOff?.();
      subscriptionOff = undefined;
      retryTimer = setTimeout(subscribe, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
      if (!reportedError) { reportedError = true; onError?.(error); }
    };
    try {
      const off = watchClassroomExpiresAt(classId, (value) => {
        if (current === generation) apply(value);
      }, fail);
      if (stopped || current !== generation) off?.();
      else subscriptionOff = off;
    } catch (error) { fail(error); }
  }

  function resume() {
    if (!stopped && retryTimer !== undefined && document.visibilityState !== "hidden") subscribe();
  }

  document.addEventListener("visibilitychange", resume);
  addEventListener("pageshow", resume);
  addEventListener("online", resume);
  apply(initialExpiresAt);
  subscribe();
  return stop;
}
