import { get, onValue, ref, set, update } from "firebase/database";
import { database } from "./config.js";
import { randomId, teacherAccessKey } from "../utils/random.js";
import { CLASSROOM_TTL_MS, classroomExpiresAt, isClassroomExpired, serverNow } from "../utils/classroomExpiration.js";
import { isProtectedClassroom } from "../utils/protectedClassrooms.js";

export async function createClassroom(uid, values) {
  const classId = randomId(10);
  const now = serverNow();
  const classroom = { title: values.title.trim(), className: values.className?.trim() || "", activityName: values.activityName?.trim() || "", createdAt: now, expiresAt: now + CLASSROOM_TTL_MS, updatedAt: now, status: "active", allowStudentWriting: true, allowStudentClear: false, showTeacherAnnotations: true, studentCount: 0, admins: { [uid]: true }, studentOrder: {}, boardPages: { main: { id: "main", order: 0, createdAt: now, createdBy: uid } } };
  await update(ref(database), { [`classes/${classId}`]: classroom, [`userClasses/${uid}/${classId}`]: true });
  await set(ref(database, `teacherKeys/${classId}`), teacherAccessKey());
  return classId;
}
export async function listMyClasses(uid) {
  const index = (await get(ref(database, `userClasses/${uid}`))).val() || {};
  const entries = await Promise.all(Object.keys(index).map(async (classId) => [classId, (await get(ref(database, `classes/${classId}`))).val()]));
  return entries.filter(([, value]) => value).map(([id, value]) => ({ id, ...value })).sort((a,b) => b.updatedAt-a.updatedAt);
}
export async function listAllClasses() {
  const value = (await get(ref(database, "publicClasses"))).val() || {};
  return Object.entries(value).map(([id, classroom]) => ({ id, ...classroom })).sort((a,b) => b.updatedAt-a.updatedAt);
}
export async function listPublicClassDebugRows() {
  const value = (await get(ref(database, "publicClasses"))).val() || {};
  return Object.entries(value).map(([key, classroom]) => ({ key, title: String(classroom?.title || "") })).sort((a,b) => a.key.localeCompare(b.key));
}
export function publicClassroom(classroom) {
  const createdAt = Number(classroom.createdAt);
  return { title: classroom.title, className: classroom.className || "", createdAt, expiresAt: classroomExpiresAt(classroom), updatedAt: classroom.updatedAt, status: classroom.status, studentCount: classroom.studentCount || 0 };
}
export async function syncClassroomDirectory(classId, classroom) {
  const directory = publicClassroom(classroom);
  if (Number(classroom.expiresAt) !== directory.expiresAt) {
    // Normalize old deadlines and the public index together; never rewrite boards.
    await update(ref(database), {
      [`classes/${classId}/expiresAt`]: directory.expiresAt,
      [`publicClasses/${classId}`]: directory
    });
  } else {
    await set(ref(database, `publicClasses/${classId}`), directory);
  }
}
export async function syncClassroomDirectories(classrooms = []) {
  await Promise.all(classrooms.map((classroom) => syncClassroomDirectory(classroom.id, classroom)));
}
export async function getClassroom(classId) { return (await get(ref(database, `classes/${classId}`))).val(); }
export async function getClassroomExpiresAt(classId) {
  const [expirationSnapshot, createdSnapshot] = await Promise.all([get(ref(database, `classes/${classId}/expiresAt`)), get(ref(database, `classes/${classId}/createdAt`))]);
  return classroomExpiresAt({ expiresAt: expirationSnapshot.val(), createdAt: createdSnapshot.val() }) || null;
}
export function watchClassroom(classId, callback, onError) { return onValue(ref(database, `classes/${classId}`), (snap) => callback(snap.val()), onError); }
export function watchClassroomExpiresAt(classId, callback, onError) {
  let expiresAt, createdAt, expirationLoaded = false, createdLoaded = false;
  const emit = () => {
    if (!expirationLoaded || !createdLoaded) return;
    callback(classroomExpiresAt({ createdAt, expiresAt }) || null);
  };
  const stopExpiration = onValue(ref(database, `classes/${classId}/expiresAt`), (snap) => { expiresAt = snap.val(); expirationLoaded = true; emit(); }, onError);
  const stopCreated = onValue(ref(database, `classes/${classId}/createdAt`), (snap) => { createdAt = snap.val(); createdLoaded = true; emit(); }, onError);
  return () => { stopExpiration(); stopCreated(); };
}
export async function saveClassroom(classId, values) { await update(ref(database, `classes/${classId}`), { ...values, updatedAt: Date.now() }); }
export async function closeClassroom(classId, closed) { await update(ref(database, `classes/${classId}`), { status: closed ? "closed" : "active", allowStudentWriting: !closed, updatedAt: Date.now() }); }
export async function setStudentPinned(classId, studentId, pinned) { await set(ref(database, `classes/${classId}/pinnedStudents/${studentId}`), pinned ? true : null); }
async function readValue(path) { return (await get(ref(database, path))).val(); }
export async function deleteClassroom(classId, uid, classroom, students) {
  if (isProtectedClassroom(classId)) throw new Error("此展示用課程受到保護，無法刪除。");
  const inviteTokens = Object.keys(classroom.teacherInviteTokens || {}), displayToken = classroom.displayToken || null;
  const [invites, display, lookups] = await Promise.all([
    Promise.all(inviteTokens.map((token) => readValue(`teacherInvites/${token}`))),
    displayToken ? readValue(`displays/${displayToken}`) : null,
    Promise.all(students.map((student) => readValue(`boardLookup/${student.boardToken}`)))
  ]);
  const changes = { [`classes/${classId}`]: null, [`publicClasses/${classId}`]: null, [`presence/${classId}`]: null, [`teacherSlots/${classId}`]: null, [`teacherKeys/${classId}`]: null, [`teacherKeyClaims/${classId}`]: null, [`teacherClaims/${classId}`]: null };
  for (const adminUid of Object.keys(classroom.admins || { [uid]: true })) changes[`userClasses/${adminUid}/${classId}`] = null;
  inviteTokens.forEach((token, index) => { if (invites[index]?.classId === classId) changes[`teacherInvites/${token}`] = null; });
  if (displayToken && display?.classId === classId) changes[`displays/${displayToken}`] = null;
  students.forEach((student, index) => {
    changes[`students/${student.id}`] = null;
    if (lookups[index]?.classId !== classId) return;
    changes[`boardLookup/${student.boardToken}`] = null;
    changes[`boards/${student.boardToken}`] = null;
    changes[`boardPages/${student.boardToken}`] = null;
    changes[`activeStrokes/${student.boardToken}`] = null;
  });
  changes[`classMaterials/${classId}`] = null;
  changes[`classMaterialSessions/${classId}`] = null;
  await update(ref(database), changes);
}
export async function cleanupExpiredClassroom(classId, uid, classroom, knownStudents) {
  if (isProtectedClassroom(classId)) return false;
  if (!isClassroomExpired(classroom)) return false;
  const students = knownStudents || (await Promise.all(Object.keys(classroom.studentOrder || {}).map(async (id) => {
    const value = (await get(ref(database, `students/${id}`))).val();
    return value ? { id, ...value } : null;
  }))).filter(Boolean);
  await deleteClassroom(classId, uid, classroom, students);
  return true;
}
