import { get, onValue, ref, set, update } from "firebase/database";
import { database } from "./config.js";
import { randomId } from "../utils/random.js";
import { serverNow, isClassroomExpired } from "../utils/classroomExpiration.js";
import { CAPTURE_ID, PDF_LIMITS, validateCapture } from "../pdf/limits.js";
import { reconcileClassBoardPages } from "./pageRepository.js";
import { normalizeCapturePlacement } from "../pdf/placement.js";

let studentSession;

export async function getMaterial(classId, assetId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(classId) || !CAPTURE_ID.test(assetId)) throw new Error("教材識別碼無效。");
  const target = ref(database, `classMaterials/${classId}/${assetId}`);
  let snapshot;
  try { snapshot = await get(target); }
  catch (error) {
    if (studentSession?.classId !== classId) throw error;
    // Another tab with the same UID may have pointed its session at a board
    // that has since been reset. Rebind this tab's still-valid board first.
    const { uid, studentId, boardToken } = studentSession;
    await setMaterialSession(classId, uid, studentId, boardToken);
    snapshot = await get(target);
  }
  const value = snapshot.val();
  if (!value) throw new Error("教材載入失敗，請重試。");
  return validateCapture(value);
}
export function setMaterialSession(classId, uid, studentId, boardToken) {
  studentSession = { classId, uid, studentId, boardToken };
  return set(ref(database, `classMaterialSessions/${classId}/${uid}`), { studentId, boardToken });
}

export function createCaptureDispatch(capture, uid, placement) {
  validateCapture(capture);
  return { pageId: `page_${randomId(22)}`, placement: normalizeCapturePlacement(placement), asset: { version: 1, mimeType: "image/jpeg", base64: capture.base64, width: capture.width, height: capture.height, byteLength: capture.byteLength, createdAt: serverNow(), createdBy: uid } };
}

async function readClass(classId, uid) {
  let value;
  try { value = (await get(ref(database, `classes/${classId}`))).val(); }
  catch { throw new Error("您目前沒有此課堂的管理權限。"); }
  if (!value?.admins?.[uid]) throw new Error("您目前沒有此課堂的管理權限。");
  if (value.status !== "active" || isClassroomExpired(value)) throw new Error("此課堂已結束或到期，無法派送題目。");
  return value;
}

export function buildCaptureDispatch(classId, classroom, students, operation) {
  const { pageId, asset } = operation;
  const order = Math.max(0, ...Object.values(classroom.boardPages || {}).map((page) => Number(page.order) || 0)) + 1;
  const page = { id: pageId, order, createdAt: asset.createdAt, createdBy: asset.createdBy, backgroundImage: { type: "rtdb-capture", classId, assetId: pageId, ...normalizeCapturePlacement(operation.placement), updatedAt: asset.createdAt, updatedBy: asset.createdBy } };
  const changes = { [`classMaterials/${classId}/${pageId}`]: asset, [`classes/${classId}/boardPages/${pageId}`]: page, [`classes/${classId}/updatedAt`]: serverNow() };
  for (const student of students) changes[`boardPages/${student.boardToken}/${pageId}`] = page;
  return changes;
}

async function wasCommitted(classId, operation) {
  const [asset, page] = await Promise.all([get(ref(database, `classMaterials/${classId}/${operation.pageId}`)), get(ref(database, `classes/${classId}/boardPages/${operation.pageId}`))]);
  const saved = asset.val(), savedPage = page.val();
  if (!saved && !savedPage) return false;
  if (!saved || !savedPage || !Object.keys(operation.asset).every((key) => saved[key] === operation.asset[key]) || savedPage.backgroundImage?.assetId !== operation.pageId || savedPage.backgroundImage?.classId !== classId) throw new Error("派送資料不一致，請重新載入課堂確認。");
  return true;
}

async function dispatch(classId, operation, uid) {
  const connected = await new Promise((resolve) => onValue(ref(database, ".info/connected"), (snapshot) => resolve(snapshot.val() === true), () => resolve(false), { onlyOnce: true }));
  if (!connected) throw new Error("目前離線，請恢復連線後再派送。");
  for (let attempt = 0; attempt < 3; attempt++) {
    const classroom = await readClass(classId, uid);
    if (await wasCommitted(classId, operation)) break;
    if (Object.values(classroom.boardPages || {}).filter((page) => page.backgroundImage?.type === "rtdb-capture").length >= PDF_LIMITS.materials) throw new Error("每課堂最多派送 20 張截圖。");
    const students = (await Promise.all(Object.keys(classroom.studentOrder || {}).map(async (id) => ({ id, ...(await get(ref(database, `students/${id}`))).val() })))).filter((s) => s.classId === classId && s.enabled && s.boardToken);
    try { await update(ref(database), buildCaptureDispatch(classId, classroom, students, operation)); break; }
    catch (error) {
      // A rejected/ambiguous response must be read back using the same operation ID.
      if (await wasCommitted(classId, operation)) break;
      if (attempt === 2) throw error;
    }
  }
  let reconciliationError = false;
  try { await reconcileClassBoardPages(classId); } catch { reconciliationError = true; }
  const current = (await get(ref(database, `classes/${classId}`))).val();
  if (!current?.boardPages?.[operation.pageId]) throw new Error("教材已提交，但課堂頁面已變更，請重新載入確認。");
  return { pageId: operation.pageId, classroom: current, reconciliationError };
}

export function dispatchCapture(classId, operation, uid) {
  if (operation.pending) return operation.pending;
  operation.pending = dispatch(classId, operation, uid).finally(() => { operation.pending = null; });
  return operation.pending;
}
