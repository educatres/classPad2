import { normalizeBackgroundImage } from "./backgroundImage.js";

export const MAIN_PAGE_ID = "main";

const PAGE_ID_PATTERN = /^(main|page_[A-Za-z0-9_-]{6,48})$/;

export function normalizeBoardPages(value) {
  const source = Array.isArray(value) ? value : Object.values(value || {});
  const pages = source
    .filter((page) => page && PAGE_ID_PATTERN.test(page.id || ""))
    .map((page) => {
      const backgroundImage = normalizeBackgroundImage(page.backgroundImage);
      return {
        id: page.id,
        order: Number.isFinite(Number(page.order)) ? Number(page.order) : Number.MAX_SAFE_INTEGER,
        createdAt: Number(page.createdAt) || 0,
        createdBy: typeof page.createdBy === "string" ? page.createdBy : "",
        ...(backgroundImage ? { backgroundImage } : {})
      };
    })
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  if (!pages.some((page) => page.id === MAIN_PAGE_ID)) {
    pages.unshift({ id: MAIN_PAGE_ID, order: -1, createdAt: 0, createdBy: "" });
  }

  return pages.map((page, order) => ({ ...page, order }));
}

export function insertBoardPage(value, position, pageId, createdBy, createdAt = Date.now()) {
  const pages = normalizeBoardPages(value);
  if (!PAGE_ID_PATTERN.test(pageId) || pageId === MAIN_PAGE_ID || pages.some((page) => page.id === pageId)) {
    throw new Error("無效或重複的白板頁面識別碼。");
  }
  const index = Math.max(0, Math.min(Number(position) - 1 || 0, pages.length));
  pages.splice(index, 0, { id: pageId, order: index, createdAt, createdBy });
  return pages.map((page, order) => ({
    ...page,
    order,
    createdAt: page.createdAt || createdAt,
    createdBy: page.createdBy || createdBy
  }));
}

export function boardPagesMap(value, fallback = {}) {
  return Object.fromEntries(normalizeBoardPages(value).map((page) => [page.id, {
    id: page.id,
    order: page.order,
    createdAt: page.createdAt || fallback.createdAt || Date.now(),
    createdBy: page.createdBy || fallback.createdBy || "system",
    ...(page.backgroundImage ? { backgroundImage: page.backgroundImage } : {})
  }]));
}

export function canonicalBoardPagesMap(value, fallback = {}) {
  const pages = boardPagesMap(value, fallback);
  for (const page of Object.values(value || {})) if (pages[page.id] && Number.isFinite(page.order)) pages[page.id].order = page.order;
  return pages;
}

export function selectMonitoredPage(studentPresence, pagesValue, boardActivity) {
  const pages = normalizeBoardPages(pagesValue);
  const available = new Set(pages.map((page) => page.id));
  const activityPage = available.has(boardActivity?.lastWrittenPageId) ? boardActivity.lastWrittenPageId : null;
  const studentPage = available.has(studentPresence?.drawing ? studentPresence.currentPageId : studentPresence?.lastWrittenPageId)
    ? (studentPresence.drawing ? studentPresence.currentPageId : studentPresence.lastWrittenPageId)
    : null;
  if (activityPage && studentPage) return Number(studentPresence?.lastWrittenAt) > Number(boardActivity?.lastWrittenAt) ? studentPage : activityPage;
  if (activityPage) return activityPage;
  const candidates = studentPresence?.drawing
    ? [studentPresence.currentPageId, studentPresence.lastWrittenPageId]
    : [studentPresence?.lastWrittenPageId, studentPresence?.currentPageId];
  return candidates.find((id) => available.has(id)) || pages[0].id;
}
