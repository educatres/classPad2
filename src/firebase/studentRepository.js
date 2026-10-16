import { get, onValue, ref, runTransaction, update } from "firebase/database";
import { database } from "./config.js";
import { boardToken, randomId } from "../utils/random.js";
import { canonicalBoardPagesMap as boardPagesMap } from "../whiteboard/pages.js";
import { reconcileClassBoardPages } from "./pageRepository.js";

export const MAX_STUDENTS = 80;

export async function addStudents(classId, classroom, input) {
  if ((classroom.studentCount || 0) + input.length > MAX_STUDENTS) throw new Error(`每班最多 ${MAX_STUDENTS} 位學生。`);
  const now = Date.now(); const changes = {}, lookupChanges = {}, lookupCleanup = {};
  const pages = boardPagesMap(classroom.boardPages, { createdAt: classroom.createdAt || now, createdBy: Object.keys(classroom.admins || {})[0] || "system" });
  input.forEach((row, offset) => {
    const studentId = randomId(14); const token = boardToken(); const order = (classroom.studentCount || 0) + offset;
    changes[`students/${studentId}`] = { classId, boardToken: token, seatNumber: row.seatNumber, displayName: row.displayName, studentUid: null, enabled: true, locked: false, createdAt: now, updatedAt: now };
    changes[`classes/${classId}/studentOrder/${studentId}`] = order;
    lookupChanges[`boardLookup/${token}`] = { studentId, classId };
    lookupCleanup[`boardLookup/${token}`] = null;
    changes[`boards/${token}/meta`] = { classId, studentId, revision: 0, updatedAt: now };
    changes[`boardPages/${token}`] = pages;
  });
  changes[`classes/${classId}/studentCount`] = (classroom.studentCount || 0) + input.length;
  changes[`classes/${classId}/updatedAt`] = now;
  await update(ref(database), lookupChanges);
  try { await update(ref(database), changes); }
  catch (error) { await update(ref(database), lookupCleanup).catch(() => {}); throw error; }
  await reconcileClassBoardPages(classId);
}
export async function getStudents(classroom) {
  const order = classroom?.studentOrder || {};
  const rows = await Promise.all(Object.keys(order).map(async (id) => ({ id, ...(await get(ref(database, `students/${id}`))).val() })));
  return rows.filter((row) => row.classId).sort((a,b) => order[a.id]-order[b.id]);
}
export function watchStudent(studentId, callback, onError) { return onValue(ref(database, `students/${studentId}`), (snap) => callback(snap.val() ? { id: studentId, ...snap.val() } : null), onError); }
export async function resolveBoard(token) {
  const lookup = (await get(ref(database, `boardLookup/${token}`))).val();
  if (!lookup) return null;
  const student = (await get(ref(database, `students/${lookup.studentId}`))).val();
  return student ? { id: lookup.studentId, ...student } : null;
}
export async function bindStudent(studentId, uid) {
  const studentRef = ref(database, `students/${studentId}`);
  let unsubscribe;
  const ready = new Promise((resolve, reject) => {
    // Keep the listener active until the transaction finishes so its first
    // update callback receives the server-backed student instead of null.
    unsubscribe = onValue(studentRef, resolve, reject);
  });
  try {
    await ready;
    const result = await runTransaction(studentRef, (student) => {
      if (!student || (student.studentUid && student.studentUid !== uid)) return;
      return { ...student, studentUid: uid, updatedAt: Date.now() };
    }, { applyLocally: false });
    return result.committed;
  } finally {
    unsubscribe?.();
  }
}
export async function updateStudent(studentId, values) { await update(ref(database, `students/${studentId}`), { ...values, updatedAt: Date.now() }); }
export async function requestStudentPage(student, pageId) {
  if (!student?.id || !student.boardToken || !/^(main|page_[A-Za-z0-9_-]{6,48})$/.test(pageId)) throw new Error("無法切換學生頁面，請重新開啟批注模式。");
  await updateStudent(student.id, { pageRequest: { id: randomId(14), boardToken: student.boardToken, pageId } });
}
export async function resetBinding(studentId) { await updateStudent(studentId, { studentUid: null }); }
export async function regenerateBoard(classId, student) {
  const token = boardToken(); const now = Date.now();
  const classroom = (await get(ref(database, `classes/${classId}`))).val() || {};
  const pages = boardPagesMap(classroom.boardPages, { createdAt: classroom.createdAt || now, createdBy: Object.keys(classroom.admins || {})[0] || "system" });
  await update(ref(database), { [`boardLookup/${token}`]: { studentId: student.id, classId } });
  try {
    await update(ref(database), { [`students/${student.id}/boardToken`]: token, [`students/${student.id}/studentUid`]: null, [`students/${student.id}/pageRequest`]: null, [`students/${student.id}/updatedAt`]: now, [`boardLookup/${student.boardToken}`]: null, [`boards/${student.boardToken}`]: null, [`boardPages/${student.boardToken}`]: null, [`activeStrokes/${student.boardToken}`]: null, [`boards/${token}/meta`]: { classId, studentId: student.id, revision: 0, updatedAt: now }, [`boardPages/${token}`]: pages });
  } catch (error) { await update(ref(database), { [`boardLookup/${token}`]: null }).catch(() => {}); throw error; }
  await reconcileClassBoardPages(classId);
  return token;
}
export async function deleteStudent(classId, classroom, student) {
  await update(ref(database), { [`students/${student.id}`]: null, [`classes/${classId}/studentOrder/${student.id}`]: null, [`classes/${classId}/pinnedStudents/${student.id}`]: null, [`classes/${classId}/studentCount`]: Math.max(0,(classroom.studentCount||1)-1), [`classes/${classId}/updatedAt`]: Date.now(), [`boardLookup/${student.boardToken}`]: null, [`boards/${student.boardToken}`]: null, [`boardPages/${student.boardToken}`]: null, [`activeStrokes/${student.boardToken}`]: null, [`presence/${classId}/${student.id}`]: null });
}
