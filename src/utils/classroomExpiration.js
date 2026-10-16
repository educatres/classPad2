export const CLASSROOM_TTL_MS = 10 * 60 * 60 * 1000;
let serverTimeOffset = 0;

export function setServerTimeOffset(value) {
  const next = Number(value);
  serverTimeOffset = Number.isFinite(next) ? next : 0;
}

export function serverNow() { return Date.now() + serverTimeOffset; }

export function classroomExpiresAt(classroom) {
  const explicit = Number(classroom?.expiresAt);
  const createdAt = Number(classroom?.createdAt);
  // createdAt is the shared authority, including classes saved under the old policy.
  if (Number.isFinite(createdAt) && createdAt > 0) return createdAt + CLASSROOM_TTL_MS;
  return Number.isFinite(explicit) && explicit > 0 ? explicit : 0;
}

export function isClassroomExpired(classroom, now = serverNow()) {
  const expiresAt = classroomExpiresAt(classroom);
  return expiresAt > 0 && now >= expiresAt;
}

export function formatClassroomRemaining(classroom, now = serverNow()) {
  const remaining = classroomExpiresAt(classroom) - now;
  if (remaining <= 0) return "已到期";
  if (remaining < 60_000) return "不到 1 分鐘";
  const totalMinutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} 小時 ${minutes} 分鐘`;
}

export function watchClassroomExpiry(classroom, { onTick, onExpire } = {}) {
  let stopped = false, timer;
  const check = () => {
    if (stopped) return;
    const expiresAt = classroomExpiresAt(classroom);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return;
    const now = serverNow();
    onTick?.(formatClassroomRemaining(classroom, now));
    const remaining = expiresAt - now;
    if (remaining <= 0) { stopped = true; onExpire?.(); return; }
    timer = setTimeout(check, Math.min(remaining, 60_000 - (now % 60_000) + 50));
  };
  const recheck = () => { if (!stopped && document.visibilityState !== "hidden") { clearTimeout(timer); check(); } };
  document.addEventListener("visibilitychange", recheck);
  addEventListener("pageshow", recheck);
  addEventListener("online", recheck);
  check();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", recheck);
    removeEventListener("pageshow", recheck);
    removeEventListener("online", recheck);
  };
}
