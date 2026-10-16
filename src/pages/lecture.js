import { onValue, ref } from "firebase/database";
import { database } from "../firebase/config.js";
import { ensureAnonymousUser } from "../firebase/auth.js";
import { cleanupExpiredClassroom, getClassroom, watchClassroom } from "../firebase/classroomRepository.js";
import { watchConnection } from "../firebase/connection.js";
import { addLecturePage, clearLecturePage, ensureLectureBoard, subscribeLectureStrokes, watchLecturePages, writeLectureStroke } from "../firebase/lectureRepository.js";
import { BoardEngine } from "../canvas/BoardEngine.js";
import { renderToolSelection } from "../canvas/toolbar.js";
import { LectureWriteQueue } from "../whiteboard/LectureWriteQueue.js";
import { isClassroomExpired, watchClassroomExpiry } from "../utils/classroomExpiration.js";
import { confirmAction, explainError, toast } from "../utils/ui.js";
import { param } from "../utils/url.js";
import { PdfSidebar } from "../pdf/PdfSidebar.js";
import { PdfSession } from "../pdf/PdfSession.js";

const $ = (id) => document.getElementById(id), classId = param("class"), histories = new Map();
let user, classroom, engine, pages = [], pageId, pageOff, pagesOff, classOff, expiryOff, expirationRetryTimer, busy = false, stopped = false, online = false, fatal = false;
let pdfPanel, pdfSession, openingPdf = false, requestedPdf = param("pdf") === "1";
const message = $("lectureMessage"), toolbar = $("lectureToolbar"), stage = $("lectureStage"), badge = $("syncBadge");
const queue = new LectureWriteQueue(renderSync);
const drawingSettings = { tool: "pen", color: "#000000" };
const connectionOff = watchConnection($("connectionBadge"));
const onlineOff = onValue(ref(database, ".info/connected"), (snap) => { online = snap.val() === true; renderSync(); });
$("teacherLink").href = `./teacher.html?class=${encodeURIComponent(classId || "")}`;
$("monitorLink").href = `./monitor.html?class=${encodeURIComponent(classId || "")}`;
const pdfSidebar = new PdfSidebar({ workspace: $("lectureWorkspace"), panel: $("lecturePdfPanel"), splitter: $("lecturePdfSplitter"), toggle: $("lecturePdfToggle"), onVisibility: (value) => pdfPanel?.setVisible(value), onResizeStart: finishInput });

async function openPdfPanel() {
  if (openingPdf || stopped || fatal || !user) return;
  if (pdfPanel) { pdfSidebar.setOpen(!pdfSidebar.open); return; }
  openingPdf = true; pdfSidebar.setOpen(true);
  try {
    const { PdfCapturePanel } = await import("../pdf/PdfCapturePanel.js");
    if (stopped || fatal) return;
    pdfPanel = new PdfCapturePanel($("lecturePdfPanel"), {
      classId, uid: user.uid, session: pdfSession, isActive: () => Boolean(!stopped && !fatal && classroom?.admins?.[user.uid] && classroom.status === "active" && !isClassroomExpired(classroom)),
      onHide: () => { pdfSidebar.setOpen(false); $("lecturePdfToggle").focus(); }, onSuccess: ({ classroom: value }) => { classroom = value; }
    });
    pdfPanel.setVisible(pdfSidebar.open);
    await pdfPanel.restore();
  } catch { pdfSidebar.setOpen(false); toast("PDF 工具載入失敗，請再試一次。", "error"); }
  finally { openingPdf = false; }
}
$("lecturePdfToggle").onclick = openPdfPanel;

function renderSync() {
  badge.textContent = queue.error ? "同步失敗，尚未保存" : !online ? "離線" : queue.pending || busy ? "同步中" : engine ? "已同步" : "準備中";
  badge.className = `badge ${queue.error ? "error" : !online ? "offline" : queue.pending || busy ? "" : "online"}`;
  $("retrySync").hidden = !queue.error;
}
function lectureError(error) {
  const detail = explainError(error);
  if (/permission[_ -]denied/i.test(`${error?.code || ""} ${error?.message || ""}`)) return "權限不足，請先至課堂設定輸入六位數老師密鑰。";
  return /[\u3400-\u9fff]/.test(detail) ? detail : "資料讀寫失敗，請確認網路連線後重試。";
}
function fail(error) {
  fatal = true; engine?.setEnabled(false); toolbar.hidden = true; message.hidden = false;
  pdfPanel?.refresh();
  message.textContent = `講解白板無法使用：${lectureError(error)}${queue.pending ? " 仍有未保存內容，請保留此視窗。" : ""}`;
}
function finishInput() { engine?.finishInput(); }
function canChangePage() {
  finishInput();
  if (busy || fatal) return false;
  if (queue.pending) { toast("仍有未保存內容，請等待同步完成或重試保存後再翻頁。", "error"); return false; }
  return true;
}
function renderPages() {
  const index = pages.findIndex((page) => page.id === pageId);
  $("lecturePageLabel").textContent = `第 ${Math.max(0, index) + 1} / ${pages.length} 頁`;
  $("lecturePrevPage").disabled = index <= 0;
  $("lectureNextPage").disabled = index >= pages.length - 1;
}
function openPage(id) {
  if (stopped || fatal || !pages.some((page) => page.id === id)) return;
  if (engine) histories.set(pageId, { undo: engine.undoStack, redo: engine.redoStack });
  pageOff?.(); engine?.destroy(); pageId = id; stage.hidden = false; message.hidden = true; toolbar.hidden = false;
  const current = new BoardEngine({ stage, backgroundCanvas: $("lectureBackground"), studentCanvas: $("lectureStudent"), teacherCanvas: $("lectureTeacher"), editableLayer: "teacherStrokes", uid: user.uid,
    onComplete: (stroke) => queue.enqueue(stroke.id, () => writeLectureStroke(classId, id, stroke.id, { ...stroke, authorUid: user.uid })),
    onRemove: (strokeId) => queue.enqueue(strokeId, () => writeLectureStroke(classId, id, strokeId, null)),
    onViewChange: (view) => { $("lectureZoomScale").textContent = `${Math.round(view.scale * 100)}%`; $("lectureZoomOut").disabled = view.scale <= .25; $("lectureZoomIn").disabled = view.scale >= 4; }
  });
  engine = current;
  current.undoStack = histories.get(id)?.undo || []; current.redoStack = histories.get(id)?.redo || [];
  current.setColor(drawingSettings.color); current.setWidth($("lectureWidth").value);
  current.setTool(drawingSettings.tool);
  renderToolSelection(toolbar, drawingSettings);
  current.setSmoothing($("lectureSmoothing").getAttribute("aria-pressed") === "true");
  pageOff = subscribeLectureStrokes(classId, id, {
    add: (strokeId, stroke) => { if (!queue.touches(strokeId)) current.addStroke("teacherStrokes", strokeId, stroke); },
    remove: (strokeId) => { if (!queue.touches(strokeId)) current.removeStroke("teacherStrokes", strokeId); }
  }, fail);
  renderPages(); renderSync();
  if (requestedPdf) { requestedPdf = false; openPdfPanel(); }
}
async function expire(value) {
  if (fatal) return;
  finishInput(); fatal = true; engine?.setEnabled(false); toolbar.hidden = true; message.hidden = false;
  pdfPanel?.refresh();
  pageOff?.(); pagesOff?.(); expiryOff?.(); classOff?.();
  message.textContent = `課程已到期，正在清除資料。${queue.pending ? " 尚未保存的筆跡無法寫入，請保留畫面。" : ""}`;
  await cleanupExpired(value);
}
async function cleanupExpired(value) {
  if (stopped) return;
  const unsaved = queue.pending ? " 尚有未保存筆跡無法寫入，請保留畫面。" : "";
  try { const removed = await cleanupExpiredClassroom(classId, user.uid, value); message.textContent = (removed ? "課程已到期，資料已清除。" : "課程已到期；此展示用課程受保護，資料已保留。") + unsaved; }
  catch (error) { message.textContent = `課程已到期，清除失敗：${lectureError(error)} 系統將自動重試。${unsaved}`; clearTimeout(expirationRetryTimer); expirationRetryTimer = setTimeout(() => cleanupExpired(value), 15000); }
}
async function init() {
  if (!classId) { message.textContent = "網址缺少課堂編號。"; return; }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(classId)) { message.textContent = "課堂網址格式不正確，請從老師課堂設定重新開啟講解白板。"; return; }
  try {
    user = await ensureAnonymousUser(); classroom = await getClassroom(classId);
    if (!classroom?.admins?.[user.uid]) throw new Error("請先從課堂設定輸入六位數老師密鑰，取得本課堂權限。");
    if (isClassroomExpired(classroom)) { await expire(classroom); return; }
    pdfSession = new PdfSession({ classId, uid: user.uid });
    requestedPdf ||= pdfSession.state?.open === true;
    $("classTitle").textContent = `${classroom.title}｜講解白板`;
    await ensureLectureBoard(classId, user.uid);
    if (stopped) return;
    classOff = watchClassroom(classId, (value) => {
      if (!value?.admins?.[user.uid]) { fail(new Error("課堂已刪除或管理權限已變更。")); return; }
      classroom = value; pdfPanel?.refresh(); expiryOff?.(); expiryOff = watchClassroomExpiry(value, { onExpire: () => expire(value) });
    }, fail);
    pagesOff = watchLecturePages(classId, (value) => {
      pages = value;
      if (!engine && pages.length) openPage(pages[0].id);
      else if (engine && !pages.some((page) => page.id === pageId)) fail(new Error("目前講解頁已被移除，請重新整理。"));
      renderPages();
    }, fail);
  } catch (error) { fail(error); }
}
for (const button of toolbar.querySelectorAll("[data-tool]")) button.onclick = () => {
  finishInput(); drawingSettings.tool = button.dataset.tool;
  if (button.dataset.penColor) drawingSettings.color = button.dataset.penColor;
  engine?.setTool(drawingSettings.tool); engine?.setColor(drawingSettings.color);
  renderToolSelection(toolbar, drawingSettings);
};
$("lectureWidth").onchange = (event) => engine?.setWidth(event.target.value);
$("lectureSmoothing").onclick = (event) => { const enabled = event.currentTarget.getAttribute("aria-pressed") !== "true"; event.currentTarget.setAttribute("aria-pressed", String(enabled)); event.currentTarget.textContent = `平滑：${enabled ? "開" : "關"}`; engine?.setSmoothing(enabled); };
$("lectureUndo").onclick = () => { finishInput(); engine?.undo(); };
$("lectureRedo").onclick = () => { finishInput(); engine?.redo(); };
$("lectureZoomOut").onclick = () => engine?.zoomBy(-.1);
$("lectureZoomIn").onclick = () => engine?.zoomBy(.1);
$("lectureResetZoom").onclick = () => engine?.resetZoom();
$("lecturePrevPage").onclick = () => { if (canChangePage()) openPage(pages[Math.max(0, pages.findIndex((page) => page.id === pageId) - 1)].id); };
$("lectureNextPage").onclick = () => { if (canChangePage()) openPage(pages[Math.min(pages.length - 1, pages.findIndex((page) => page.id === pageId) + 1)].id); };
$("lectureAddPage").onclick = async () => {
  if (!canChangePage()) return;
  if (!online) { toast("離線時無法新增講解頁，請恢復連線後重試。", "error"); return; }
  busy = true; engine?.setEnabled(false); renderSync();
  try { const id = await addLecturePage(classId, user.uid, pages); if (!stopped && !fatal) openPage(id); }
  catch (error) { toast(`新增講解頁失敗：${lectureError(error)}`, "error"); }
  finally { busy = false; engine?.setEnabled(!fatal); renderSync(); }
};
$("lectureClear").onclick = () => {
  if (!canChangePage() || !confirmAction("確定清除本頁所有講解筆跡？所有老師共用的本頁資料都會清除，無法復原。")) return;
  const id = pageId; engine.clearLayerLocal("teacherStrokes"); engine.undoStack = []; engine.redoStack = []; histories.delete(id);
  queue.enqueue("*", () => clearLecturePage(classId, id));
};
$("retrySync").onclick = () => queue.retry();
document.querySelectorAll("a").forEach((link) => link.addEventListener("click", (event) => {
  finishInput(); if ((queue.pending || busy || pdfPanel?.hasPending) && !confirmAction("仍有筆跡尚未保存，或有截圖尚未派送／結果尚未確認。離開將失去本機暫存，確定離開？")) event.preventDefault();
}));
addEventListener("beforeunload", (event) => { finishInput(); if (queue.pending || busy || pdfPanel?.hasPending) { event.preventDefault(); event.returnValue = "仍有講解內容或 PDF 派送尚未確認。"; } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") finishInput(); });
addEventListener("pagehide", () => { finishInput(); stopped = true; clearTimeout(expirationRetryTimer); pageOff?.(); pagesOff?.(); classOff?.(); expiryOff?.(); onlineOff(); connectionOff(); engine?.destroy(); pdfSidebar.destroy(); pdfPanel?.destroy(); });
addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
init();
