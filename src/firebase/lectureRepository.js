import { onChildAdded, onChildChanged, onChildRemoved, onValue, ref, runTransaction, serverTimestamp, update } from "firebase/database";
import { database } from "./config.js";
import { randomId } from "../utils/random.js";

export const FIRST_LECTURE_PAGE = "page_initial";
export const lecturePages = (value) => Object.values(value || {}).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export async function ensureLectureBoard(classId, uid) {
  // Stable first-page ID and create-only transactions make reopening idempotent.
  const base = `lectureBoards/${classId}`;
  await runTransaction(ref(database, `${base}/meta`), (value) => value || { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { applyLocally: false });
  await runTransaction(ref(database, `${base}/pageIndex/${FIRST_LECTURE_PAGE}`), (value) => value || { id: FIRST_LECTURE_PAGE, order: 0, createdAt: serverTimestamp(), createdBy: uid }, { applyLocally: false });
}

export function watchLecturePages(classId, callback, onError) {
  return onValue(ref(database, `lectureBoards/${classId}/pageIndex`), (snapshot) => callback(lecturePages(snapshot.val())), onError);
}

export async function addLecturePage(classId, uid, pages) {
  const id = `page_${randomId(14)}`;
  await update(ref(database, `lectureBoards/${classId}`), {
    [`pageIndex/${id}`]: { id, order: Math.max(0, ...pages.map((page) => page.order)) + 1, createdAt: serverTimestamp(), createdBy: uid },
    "meta/updatedAt": serverTimestamp()
  });
  return id;
}

export function subscribeLectureStrokes(classId, pageId, handlers, onError) {
  const target = ref(database, `lectureBoards/${classId}/pages/${pageId}/teacherStrokes`);
  const offs = [
    onChildAdded(target, (s) => handlers.add(s.key, s.val()), onError),
    onChildChanged(target, (s) => handlers.add(s.key, s.val()), onError),
    onChildRemoved(target, (s) => handlers.remove(s.key), onError)
  ];
  return () => offs.forEach((off) => off());
}

export function writeLectureStroke(classId, pageId, id, stroke) {
  return update(ref(database, `lectureBoards/${classId}`), {
    [`pages/${pageId}/teacherStrokes/${id}`]: stroke,
    "meta/updatedAt": serverTimestamp()
  });
}

export function clearLecturePage(classId, pageId) {
  return update(ref(database, `lectureBoards/${classId}`), {
    [`pages/${pageId}/teacherStrokes`]: null,
    "meta/updatedAt": serverTimestamp()
  });
}
