import { get, onValue, ref, runTransaction, update } from "firebase/database";
import { database } from "./config.js";
import { randomId } from "../utils/random.js";
import { boardPagesMap, canonicalBoardPagesMap, insertBoardPage, normalizeBoardPages } from "../whiteboard/pages.js";
import { normalizeBackgroundPosition, normalizeBackgroundScale, normalizeGoogleDriveImageUrl } from "../whiteboard/backgroundImage.js";

export function watchBoardPages(token, callback, onError) {
  return onValue(ref(database, `boardPages/${token}`), (snapshot) => callback(normalizeBoardPages(snapshot.val())), onError);
}

// Repair only missing leaves. Concurrent imports/dispatches may finish in either order.
export async function reconcileClassBoardPages(classId) {
  for (let pass = 0; pass < 3; pass++) {
    const classroom = (await get(ref(database, `classes/${classId}`))).val();
    if (!classroom) return;
    const signature = JSON.stringify([classroom.boardPages, classroom.studentOrder]);
    const canonical = canonicalBoardPagesMap(classroom.boardPages, { createdAt: classroom.createdAt, createdBy: Object.keys(classroom.admins || {})[0] });
    for (const studentId of Object.keys(classroom.studentOrder || {})) {
      const student = (await get(ref(database, `students/${studentId}`))).val();
      if (!student?.enabled || student.classId !== classId) continue;
      const token = student.boardToken;
      const existing = (await get(ref(database, `boardPages/${token}`))).val() || {};
      for (const [id, page] of Object.entries(canonical)) {
        if (existing[id]) continue;
        // Rules also check the current token so a reset cannot revive an old board.
        await runTransaction(ref(database, `boardPages/${token}/${id}`), (value) => value || page, { applyLocally: false });
      }
    }
    const latest = (await get(ref(database, `classes/${classId}`))).val();
    if (signature === JSON.stringify([latest?.boardPages, latest?.studentOrder])) return;
  }
  throw new Error("名單或頁面持續變更，教材頁面補齊尚未確認，請重試。");
}

export async function insertClassBoardPage(classId, classroom, students, uid, position) {
  classroom = (await get(ref(database, `classes/${classId}`))).val();
  if (!classroom) throw new Error("課堂不存在。");
  students = (await Promise.all(Object.keys(classroom.studentOrder || {}).map(async (id) => ({ id, ...(await get(ref(database, `students/${id}`))).val() })))).filter((s) => s.classId === classId && s.enabled);
  const pageId = `page_${randomId(14)}`;
  const now = Date.now();
  const pages = insertBoardPage(classroom?.boardPages, position, pageId, uid, now);
  const pageMap = boardPagesMap(pages, { createdAt: classroom?.createdAt || now, createdBy: uid });
  const changes = {
    [`classes/${classId}/updatedAt`]: now
  };
  for (const page of Object.values(pageMap)) {
    const leaf = classroom.boardPages?.[page.id] ? `${page.id}/order` : page.id;
    const value = classroom.boardPages?.[page.id] ? page.order : page;
    changes[`classes/${classId}/boardPages/${leaf}`] = value;
    for (const student of students) changes[`boardPages/${student.boardToken}/${leaf}`] = value;
  }
  await update(ref(database), changes);
  await reconcileClassBoardPages(classId);
  return { pageId, pages };
}

export async function setClassPageBackground(classId, classroom, students, uid, pageId, sourceUrl, scale = 1, position = null) {
  const now = Date.now();
  const pages = normalizeBoardPages(classroom?.boardPages);
  const page = pages.find((item) => item.id === pageId);
  if (!page) throw new Error("找不到要設定底圖的白板頁面。");
  if (page.backgroundImage?.type === "rtdb-capture") {
    if (sourceUrl !== page.backgroundImage.assetId) throw new Error("截圖教材僅可調整比例及位置。");
    page.backgroundImage = { ...page.backgroundImage, scale: normalizeBackgroundScale(scale), x: normalizeBackgroundPosition(position?.x ?? page.backgroundImage.x), y: normalizeBackgroundPosition(position?.y ?? page.backgroundImage.y), updatedAt: now, updatedBy: uid };
  } else if (sourceUrl) {
    const urls = normalizeGoogleDriveImageUrl(sourceUrl);
    page.backgroundImage = {
      ...urls,
      scale: normalizeBackgroundScale(scale),
      x: normalizeBackgroundPosition(position?.x ?? page.backgroundImage?.x),
      y: normalizeBackgroundPosition(position?.y ?? page.backgroundImage?.y),
      updatedAt: now,
      updatedBy: uid
    };
  } else {
    delete page.backgroundImage;
  }
  const changes = {
    [`classes/${classId}/boardPages/${pageId}/backgroundImage`]: page.backgroundImage || null,
    [`classes/${classId}/updatedAt`]: now
  };
  for (const student of students) changes[`boardPages/${student.boardToken}/${pageId}/backgroundImage`] = page.backgroundImage || null;
  await update(ref(database), changes);
  return pages;
}
