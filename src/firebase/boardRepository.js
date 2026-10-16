import { get, onChildAdded, onChildChanged, onChildRemoved, onValue, push, ref, remove, serverTimestamp, set, update } from "firebase/database";
import { database } from "./config.js";
import { MAIN_PAGE_ID } from "../whiteboard/pages.js";
import { hasStudentText, MAX_STUDENT_TEXT_LENGTH } from "../text/StudentTextLayer.js";

export function boardLayerPath(pageId, layer) {
  return !pageId || pageId === MAIN_PAGE_ID ? layer : `pages/${pageId}/${layer}`;
}

export function subscribeLayer(token, layer, handlers, pageId = MAIN_PAGE_ID) {
  const target = ref(database, `boards/${token}/${boardLayerPath(pageId, layer)}`);
  const offs = [onChildAdded(target, (s) => handlers.add(s.key, s.val()), handlers.error), onChildRemoved(target, (s) => handlers.remove(s.key), handlers.error)];
  if (handlers.change) offs.push(onChildChanged(target, (s) => handlers.change(s.key, s.val()), handlers.error));
  if (handlers.ready) offs.push(onValue(target, () => handlers.ready(), handlers.error, { onlyOnce: true }));
  return () => offs.forEach((off) => off());
}
export function watchBoardMeta(token, callback) { return onValue(ref(database, `boards/${token}/meta`), (snap) => callback(snap.val() || {})); }
export async function markBoardActivity(token, layer, pageId = MAIN_PAGE_ID) {
  const timestamp = serverTimestamp();
  await update(ref(database, `boards/${token}/meta`), { lastWrittenPageId: pageId, lastWrittenAt: timestamp, lastWrittenLayer: layer, updatedAt: timestamp, revision: timestamp });
}
export async function saveStroke(token, layer, stroke, pageId = MAIN_PAGE_ID) {
  await set(ref(database, `boards/${token}/${boardLayerPath(pageId, layer)}/${stroke.id}`), stroke);
  await markBoardActivity(token, layer, pageId);
}
export async function removeStroke(token, layer, id, pageId = MAIN_PAGE_ID) { await remove(ref(database, `boards/${token}/${boardLayerPath(pageId, layer)}/${id}`)); }
export async function clearLayer(token, layer, pageId = MAIN_PAGE_ID) { await remove(ref(database, `boards/${token}/${boardLayerPath(pageId, layer)}`)); }
export async function publishActive(token, layer, uid, stroke) { await set(ref(database, `activeStrokes/${token}/${layer}/${uid}`), stroke); }
export async function clearActive(token, layer, uid) { await remove(ref(database, `activeStrokes/${token}/${layer}/${uid}`)); }
export function watchActive(token, layer, callback) { return onValue(ref(database, `activeStrokes/${token}/${layer}`), (snap) => callback(snap.val() || {})); }
export async function saveStudentText(token, value, uid, pageId = MAIN_PAGE_ID) {
  const target = ref(database, `boards/${token}/${boardLayerPath(pageId, "studentText")}`);
  const text = String(value?.text || "").slice(0, MAX_STUDENT_TEXT_LENGTH);
  if (text) await set(target, { text, scrollTop: Math.max(0, Math.round(Number(value?.scrollTop) || 0)), layoutVersion: 1, updatedAt: serverTimestamp(), authorUid: uid });
  else await remove(target);
  await markBoardActivity(token, "studentText", pageId);
}
export function subscribeStudentText(token, callback, pageId = MAIN_PAGE_ID, onError) {
  return onValue(ref(database, `boards/${token}/${boardLayerPath(pageId, "studentText")}`), (snapshot) => callback(snapshot.val()), onError);
}
export async function hasAnswers(token, pageId = MAIN_PAGE_ID) {
  const [strokes, text] = await Promise.all([
    get(ref(database, `boards/${token}/${boardLayerPath(pageId, "studentStrokes")}`)),
    get(ref(database, `boards/${token}/${boardLayerPath(pageId, "studentText")}`))
  ]);
  return strokes.exists() || hasStudentText(text.val());
}
export async function hasAnyAnswers(token, pageIds = [MAIN_PAGE_ID]) {
  const results = await Promise.all(pageIds.map((pageId) => hasAnswers(token, pageId)));
  return results.some(Boolean);
}
export async function getBoardPageLayers(token, pageId = MAIN_PAGE_ID) {
  const [studentSnapshot, teacherSnapshot, textSnapshot, stickySnapshot] = await Promise.all([
    get(ref(database, `boards/${token}/${boardLayerPath(pageId, "studentStrokes")}`)),
    get(ref(database, `boards/${token}/${boardLayerPath(pageId, "teacherStrokes")}`)),
    get(ref(database, `boards/${token}/${boardLayerPath(pageId, "studentText")}`)),
    get(ref(database, `boards/${token}/${boardLayerPath(pageId, "stickyNotes")}`))
  ]);
  return {
    studentStrokes: Object.values(studentSnapshot.val() || {}),
    teacherStrokes: Object.values(teacherSnapshot.val() || {}),
    studentText: textSnapshot.val(),
    stickyNotes: Object.values(stickySnapshot.val() || {})
  };
}
export async function createStickyNote(token, note, pageId = MAIN_PAGE_ID) {
  const target = push(ref(database, `boards/${token}/${boardLayerPath(pageId, "stickyNotes")}`));
  const now = Date.now();
  await set(target, { ...note, id: target.key, text: note.text || "", createdAt: now, updatedAt: now });
  return target.key;
}
export async function updateStickyNote(token, id, patch, pageId = MAIN_PAGE_ID) { await update(ref(database, `boards/${token}/${boardLayerPath(pageId, "stickyNotes")}/${id}`), { ...patch, updatedAt: Date.now() }); }
export async function removeStickyNote(token, id, pageId = MAIN_PAGE_ID) { await remove(ref(database, `boards/${token}/${boardLayerPath(pageId, "stickyNotes")}/${id}`)); }
export function subscribeStickyNotes(token, handlers, pageId = MAIN_PAGE_ID) { return subscribeLayer(token, "stickyNotes", handlers, pageId); }
