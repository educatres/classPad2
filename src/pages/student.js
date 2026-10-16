import { ensureAnonymousUser } from "../firebase/auth.js";
import { bindStudent, resolveBoard, watchStudent } from "../firebase/studentRepository.js";
import { clearActive, markBoardActivity, publishActive, removeStroke, saveStroke, saveStudentText, subscribeLayer, subscribeStickyNotes, subscribeStudentText } from "../firebase/boardRepository.js";
import { setDrawing, setPresencePage, startPresence } from "../firebase/presenceRepository.js";
import { watchBoardPages } from "../firebase/pageRepository.js";
import { watchConnection } from "../firebase/connection.js";
import { getClassroomExpiresAt, watchClassroomExpiresAt } from "../firebase/classroomRepository.js";
import { BoardEngine } from "../canvas/BoardEngine.js";
import { StickyNotesLayer } from "../notes/StickyNotesLayer.js";
import { StudentTextLayer } from "../text/StudentTextLayer.js";
import { normalizeBoardPages } from "../whiteboard/pages.js";
import { clearBackgroundImage, setBackgroundViewport, showBackgroundImage } from "../whiteboard/backgroundImage.js";
import { materialCache } from "../whiteboard/materialCache.js";
import { setMaterialSession } from "../firebase/materialRepository.js";
import { param } from "../utils/url.js";
import { isClassroomExpired, watchClassroomExpiry } from "../utils/classroomExpiration.js";
import { explainError, toast } from "../utils/ui.js";

const token = param("board");
const message = document.querySelector("#boardMessage");
const stage = document.querySelector("#boardStage");
const toolbar = document.querySelector("#studentToolbar");
const smoothingButton = document.querySelector("#studentSmoothing");
const sync = document.querySelector("#syncBadge");
let user, student, engine, stickyNotes, textLayer, presenceStop, expirationOff, expirationTimerOff, expired = false;
let pages = normalizeBoardPages();
let currentPageId = pages[0].id;
let pageOffs = [], lifecycleOffs = [];
let activeTimer;
let presenceDrawing = false;
let lastActivityAt = 0, lastActivityPageId = "";
const drawingSettings = { tool: "pen", color: "#000000", width: 5, smoothing: loadStudentSmoothing() };
let activeMode = "pen";

function loadStudentSmoothing() {
  try { return localStorage.getItem("classpad-student-smoothing") !== "false"; }
  catch { return true; }
}

function renderSmoothingButton() {
  const enabled = drawingSettings.smoothing;
  smoothingButton.classList.toggle("active", enabled);
  smoothingButton.setAttribute("aria-pressed", String(enabled));
  smoothingButton.setAttribute("aria-label", enabled ? "關閉手寫平滑" : "開啟手寫平滑");
  smoothingButton.querySelector("span").textContent = `平滑：${enabled ? "開" : "關"}`;
}

watchConnection(document.querySelector("#connectionBadge"));
document.querySelector("#studentBackgroundImage").addEventListener("error", () => toast("題目底圖載入失敗，請確認網路連線，或通知老師協助處理。", "error"));

function setMessage(text) {
  stopPage();
  lifecycleOffs.forEach((off) => off?.()); lifecycleOffs = [];
  presenceStop?.(); presenceStop = null;
  document.querySelector("#newMaterialNotice").hidden = true;
  clearBackgroundImage(document.querySelector("#studentBackgroundImage"));
  materialCache.clear(student?.classId);
  message.textContent = text;
  message.hidden = false;
  stage.hidden = true;
  toolbar.hidden = true;
}

function setSync(text, type = "") {
  sync.textContent = text;
  sync.className = `badge ${type}`;
}

function renderPageControls() {
  const index = Math.max(0, pages.findIndex((page) => page.id === currentPageId));
  document.querySelector("#studentPageLabel").textContent = `第 ${index + 1} / ${pages.length} 頁`;
  document.querySelector("#studentPrevPage").disabled = index <= 0;
  document.querySelector("#studentNextPage").disabled = index >= pages.length - 1;
}

function renderBackground() {
  if (!message.hidden) return;
  const page = pages.find((item) => item.id === currentPageId);
  showBackgroundImage(document.querySelector("#studentBackgroundImage"), page?.backgroundImage);
}

function stopPage() {
  clearTimeout(activeTimer);
  clearBackgroundImage(document.querySelector("#studentBackgroundImage"));
  pageOffs.forEach((off) => off?.());
  pageOffs = [];
  stickyNotes?.destroy();
  stickyNotes = null;
  textLayer?.destroy();
  textLayer = null;
  engine?.destroy();
  engine = null;
}

function canStudentEdit() { return Boolean(student && !student.locked && student.enabled); }

function applyInputMode({ focus = false } = {}) {
  const enabled = canStudentEdit();
  engine?.setEnabled(enabled && activeMode !== "text");
  textLayer?.setEnabled(enabled);
  textLayer?.setEditing(activeMode === "text");
  toolbar.querySelectorAll("button[data-tool], button[data-mode]").forEach((button) => button.classList.toggle("active", (button.dataset.tool || button.dataset.mode) === activeMode));
  document.querySelector("#undoBtn").disabled = activeMode === "text";
  document.querySelector("#redoBtn").disabled = activeMode === "text";
  if (focus && activeMode === "text" && enabled) textLayer?.editor.focus({ preventScroll: true });
}

function expireStudent() {
  if (expired) return;
  expired = true; expirationTimerOff?.(); stopPage(); lifecycleOffs.forEach((off) => off?.()); lifecycleOffs = []; presenceStop?.();
  if (user && student) clearActive(token, "student", user.uid).catch(() => {});
  setMessage("此課程已滿 3 小時並停止使用，資料將由老師端自動清除。");
  setSync("課程已到期", "error");
}

function startExpirationWatch(classId, expiresAt) {
  const apply = (value) => {
    if (!value) return;
    expirationTimerOff?.();
    const expiration = { expiresAt: Number(value) };
    if (isClassroomExpired(expiration)) { expireStudent(); return; }
    expirationTimerOff = watchClassroomExpiry(expiration, { onExpire: expireStudent });
  };
  apply(expiresAt);
  expirationOff = watchClassroomExpiresAt(classId, apply, () => expireStudent());
}

function openPage(pageId, updatePresence = true) {
  if (!pages.some((page) => page.id === pageId)) pageId = pages[0].id;
  if (engine && currentPageId === pageId) { renderPageControls(); renderBackground(); return; }
  if (user && student) clearActive(token, "student", user.uid);
  presenceDrawing = false;
  stopPage();
  currentPageId = pageId;
  const activePageId = pageId;
  stickyNotes = new StickyNotesLayer({ container: document.querySelector("#studentStickyLayer") });
  textLayer = new StudentTextLayer({
    container: document.querySelector("#studentTextLayer"), editable: true,
    onChange: async (value) => {
      setSync("同步中");
      try { await saveStudentText(token, value, user.uid, activePageId); setSync("已同步", "synced"); }
      catch (error) { setSync("同步失敗", "error"); throw error; }
    },
    onError: (error) => toast(explainError(error, "student"), "error")
  });
  const activeTextLayer = textLayer;
  engine = new BoardEngine({
    stage,
    backgroundCanvas: document.querySelector("#backgroundCanvas"),
    studentCanvas: document.querySelector("#studentCanvas"),
    teacherCanvas: document.querySelector("#teacherCanvas"),
    editableLayer: "studentStrokes",
    uid: user.uid,
    onComplete: async (stroke) => {
      setSync("同步中");
      try {
        await saveStroke(token, "studentStrokes", stroke, activePageId);
        setSync("已同步", "synced");
      } catch (error) {
        setSync("同步失敗", "error");
        toast(explainError(error, "student"), "error");
      }
    },
    onRemove: async (id) => {
      setSync("同步中");
      try {
        await removeStroke(token, "studentStrokes", id, activePageId);
        setSync("已同步", "synced");
      } catch (error) {
        setSync("同步失敗", "error");
      }
    },
    onActive: (stroke) => {
      const drawing = Boolean(stroke);
      if (drawing !== presenceDrawing) { presenceDrawing = drawing; setDrawing(student.classId, student.id, drawing, activePageId); }
      const now = Date.now();
      if (stroke && (activePageId !== lastActivityPageId || now - lastActivityAt >= 750)) { lastActivityAt = now; lastActivityPageId = activePageId; markBoardActivity(token, "studentStrokes", activePageId).catch(() => {}); }
      clearTimeout(activeTimer);
      activeTimer = setTimeout(() => stroke
        ? publishActive(token, "student", user.uid, { ...stroke, points: stroke.points.slice(-80), updatedAt: Date.now(), pageId: activePageId })
        : clearActive(token, "student", user.uid), 100);
    },
    onViewChange: (view) => { stickyNotes.setViewport(view); activeTextLayer.setViewport(view); setBackgroundViewport(document.querySelector("#studentBackgroundLayer"), view); document.querySelector("#studentZoomScale").textContent = `${Math.round(view.scale * 100)}%`; document.querySelector("#studentZoomOut").disabled = view.scale <= .25; document.querySelector("#studentZoomIn").disabled = view.scale >= 4; }
  });
  const activeEngine = engine, activeStickyNotes = stickyNotes;
  engine.setSmoothing(drawingSettings.smoothing);
  engine.setTool(drawingSettings.tool);
  engine.setColor(drawingSettings.color);
  engine.setWidth(drawingSettings.width);
  applyInputMode();
  pageOffs.push(
    subscribeLayer(token, "studentStrokes", { add: (id, stroke) => activeEngine.addStroke("studentStrokes", id, stroke), remove: (id) => activeEngine.removeStroke("studentStrokes", id) }, activePageId),
    subscribeLayer(token, "teacherStrokes", { add: (id, stroke) => activeEngine.addStroke("teacherStrokes", id, stroke), remove: (id) => activeEngine.removeStroke("teacherStrokes", id) }, activePageId),
    subscribeStickyNotes(token, { add: (id, note) => activeStickyNotes.upsert(id, note), change: (id, note) => activeStickyNotes.upsert(id, note), remove: (id) => activeStickyNotes.remove(id) }, activePageId),
    subscribeStudentText(token, (value) => activeTextLayer.setValue(value), activePageId)
  );
  renderPageControls();
  renderBackground();
  if (updatePresence) setPresencePage(student.classId, student.id, activePageId).catch(() => {});
}

async function init() {
  if (!token) return setMessage("無效連結：缺少白板識別碼。");
  try {
    user = await ensureAnonymousUser();
    student = await resolveBoard(token);
    if (!student) return setMessage("白板不存在，請向老師索取新的連結。");
    const expiresAt = await getClassroomExpiresAt(student.classId);
    if (expiresAt && isClassroomExpired({ expiresAt })) return expireStudent();
    startExpirationWatch(student.classId, expiresAt);
    if (!student.enabled) return setMessage("此白板已停用，請聯絡老師。");
    if (student.studentUid && student.studentUid !== user.uid) return setMessage("此白板已綁定其他裝置，請聯絡老師解除裝置綁定。");
    if (!student.studentUid) {
      const bound = await bindStudent(student.id, user.uid);
      if (!bound) return setMessage("白板剛被其他裝置綁定，請聯絡老師。");
      student.studentUid = user.uid;
    }
    await setMaterialSession(student.classId, user.uid, student.id, token);

    document.querySelector("#studentName").textContent = student.displayName;
    document.querySelector("#seatNumber").textContent = ` ${student.seatNumber}`;
    message.hidden = true;
    stage.hidden = false;
    toolbar.hidden = false;
    bindToolbar();
    openPage(currentPageId, false);
    try { presenceStop = await startPresence(student.classId, student.id, user.uid, currentPageId); }
    catch (error) { toast("白板已開啟，但在線狀態暫時無法同步。", "error"); console.error(error); }
    let pagesLoaded = false;
    lifecycleOffs.push(watchBoardPages(token, (value) => {
      const previous = new Set(pages.map((page) => page.id));
      pages = normalizeBoardPages(value);
      const added = pages.filter((page) => !previous.has(page.id) && page.backgroundImage?.type === "rtdb-capture");
      if (pagesLoaded && added.length) {
        const latest = added.at(-1), notice = document.querySelector("#newMaterialNotice");
        notice.hidden = false; notice.querySelector("span").textContent = `老師已新增題目，第 ${pages.findIndex((p) => p.id === latest.id) + 1} 頁`;
        notice.querySelector("button").onclick = () => { notice.hidden = true; openPage(latest.id); };
      }
      pagesLoaded = true;
      if (!pages.some((page) => page.id === currentPageId)) openPage(pages[0].id);
      else { renderPageControls(); renderBackground(); }
    }, () => { stopPage(); setMessage("白板權限已變更，請向老師確認連結。"); }));
    lifecycleOffs.push(watchStudent(student.id, (value) => {
      if (!value) { stopPage(); return setMessage("白板已被老師刪除。"); }
      student = value;
      const locked = value.locked || !value.enabled;
      applyInputMode();
      document.querySelector("#lockBadge").hidden = !locked;
      if (value.studentUid !== user.uid || value.boardToken !== token || !value.enabled) { stopPage(); setMessage("此白板的裝置綁定或連結已變更，請聯絡老師。"); }
    }, () => { stopPage(); setMessage("白板權限已變更，請向老師確認連結。"); }));
    setSync("已同步", "synced");
  } catch (error) {
    setMessage(explainError(error, "student"));
    setSync("開啟失敗", "error");
  }
}

function bindToolbar() {
  smoothingButton.onclick = () => {
    drawingSettings.smoothing = !drawingSettings.smoothing;
    engine?.setSmoothing(drawingSettings.smoothing);
    try { localStorage.setItem("classpad-student-smoothing", String(drawingSettings.smoothing)); } catch {}
    renderSmoothingButton();
  };
  renderSmoothingButton();
  toolbar.querySelectorAll("button[data-tool]").forEach((button) => button.onclick = () => {
    activeMode = button.dataset.tool;
    drawingSettings.tool = activeMode;
    engine?.setTool(drawingSettings.tool);
    applyInputMode();
  });
  document.querySelector("#textToolBtn").onclick = () => { activeMode = "text"; applyInputMode({ focus: true }); };
  document.querySelector("#colorInput").onchange = (event) => { drawingSettings.color = event.target.value; engine?.setColor(drawingSettings.color); };
  document.querySelector("#widthInput").onchange = (event) => { drawingSettings.width = event.target.value; engine?.setWidth(drawingSettings.width); };
  document.querySelector("#undoBtn").onclick = () => engine?.undo();
  document.querySelector("#redoBtn").onclick = () => engine?.redo();
  document.querySelector("#resetZoomBtn").onclick = () => engine?.resetZoom();
  document.querySelector("#studentZoomOut").onclick = () => engine?.zoomBy(-.1);
  document.querySelector("#studentZoomIn").onclick = () => engine?.zoomBy(.1);
  document.querySelector("#studentPrevPage").onclick = () => openPage(pages[Math.max(0, pages.findIndex((page) => page.id === currentPageId) - 1)].id);
  document.querySelector("#studentNextPage").onclick = () => openPage(pages[Math.min(pages.length - 1, pages.findIndex((page) => page.id === currentPageId) + 1)].id);
}

addEventListener("pagehide", () => {
  clearTimeout(activeTimer);
  expirationOff?.(); expirationTimerOff?.();
  stopPage();
  materialCache.clear(student?.classId);
  lifecycleOffs.forEach((off) => off?.());
  presenceStop?.();
  if (user && student) clearActive(token, "student", user.uid);
});

init();
