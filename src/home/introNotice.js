const STORAGE_KEY = "classpad-home-intro-notice-hidden";
const HIDE_DURATION = 7 * 24 * 60 * 60 * 1000;

function storage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function shouldHideIntroNotice(now = Date.now(), localStorage = storage()) {
  try {
    const hiddenAt = Number(localStorage?.getItem(STORAGE_KEY));
    return Number.isFinite(hiddenAt) && hiddenAt > 0 && now - hiddenAt >= 0 && now - hiddenAt < HIDE_DURATION;
  } catch { return false; }
}

export function rememberHiddenIntroNotice(now = Date.now(), localStorage = storage()) {
  try { localStorage?.setItem(STORAGE_KEY, String(now)); } catch {}
}

export function forgetHiddenIntroNotice(localStorage = storage()) {
  try { localStorage?.removeItem(STORAGE_KEY); } catch {}
}
