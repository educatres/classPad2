import { ensureAnonymousUser } from "../firebase/auth.js";
import { cleanupExpiredClassroom, setStudentPinned, syncClassroomDirectory, watchClassroom } from "../firebase/classroomRepository.js";
import { getStudents, requestStudentPage, updateStudent, watchStudent } from "../firebase/studentRepository.js";
import { clearLayer, createStickyNote, markBoardActivity, removeStickyNote, removeStroke, saveStroke, subscribeLayer, subscribeStickyNotes, subscribeStudentText, updateStickyNote, watchBoardMeta } from "../firebase/boardRepository.js";
import { insertClassBoardPage } from "../firebase/pageRepository.js";
import { watchPresence } from "../firebase/presenceRepository.js";
import { watchConnection } from "../firebase/connection.js";
import { claimTeacherInvite } from "../firebase/teacherAccessRepository.js";
import { ensureClassDisplay, projectDisplay, stopDisplay, updateProjectedPage, watchDisplay } from "../firebase/displayRepository.js";
import { BoardEngine } from "../canvas/BoardEngine.js";
import { renderToolSelection } from "../canvas/toolbar.js";
import { initToolbarIcons, renderSmoothingControl, renderToolbarState } from "../canvas/toolbarIcons.js";
import { StickyNotesLayer } from "../notes/StickyNotesLayer.js";
import { StudentTextLayer } from "../text/StudentTextLayer.js";
import { normalizeGridSize, paginateStudents, prioritizePinned } from "../monitor/studentView.js";
import { boardPagesMap, normalizeBoardPages, selectMonitoredPage } from "../whiteboard/pages.js";
import { clearBackgroundImage, setBackgroundViewport, showBackgroundImage } from "../whiteboard/backgroundImage.js";
import { param } from "../utils/url.js";
import { isClassroomExpired, watchClassroomExpiry } from "../utils/classroomExpiration.js";
import { confirmAction, explainError, toast } from "../utils/ui.js";

import { PreviewRegistry } from "../monitor/PreviewRegistry.js";
import { ThumbnailBoard } from "../monitor/ThumbnailBoard.js";
import { materialCache } from "../whiteboard/materialCache.js";
import { downloadBlob, renderPagePng } from "../teacher/classroomExporter.js";

const classId = param("class"), inviteToken = param("invite");
const grid = document.querySelector("#monitorGrid"), state = document.querySelector("#monitorState"), dialog = document.querySelector("#reviewDialog");
const monitorToolbar = document.querySelector("#monitorToolbar"), showMonitorToolbar = document.querySelector("#showMonitorToolbar"), smoothingButton = document.querySelector("#toggleSmoothing");
initToolbarIcons(dialog);
let user, classroom, students = [], presence = {}, page = 0, gridSize = loadGridSize(), teacherSmoothing = loadTeacherSmoothing();
const previews = new PreviewRegistry(), metaSubscriptions = new Map(), rosterSubscriptions = new Map();
const drawingSettings = { tool: "pen", color: "#000000" };
let reviewScroll = 0, studentLoadVersion = 0, unavailable = false;
let reviewOffs = [], reviewEngine, reviewStickyNotes, reviewTextLayer, reviewText, currentStudent, currentReviewPageId;
let boardMetaOffs = [], boardMetaRenderFrame, lastTeacherActivityAt = 0, lastTeacherActivityPageId = "";
let rotateTimer, expirationRetryTimer, classOff, expiryOff, presenceOff, presenceRenderKey = "", cleanupStarted = false;
let displayOff, watchedDisplayToken, displayState, followingPageUpdate = false, directorySignature = "";

const connectionOff = watchConnection(document.querySelector("#connectionBadge"));
document.querySelector("#reviewBackgroundImage").addEventListener("error", () => toast("題目底圖載入失敗，請確認網路連線後重試。", "error"));
document.querySelector("#lectureLink").href = `./lecture.html?class=${encodeURIComponent(classId || "")}`;
document.querySelector("#teacherLink").href = `./teacher.html?class=${encodeURIComponent(classId || "")}`;

function loadGridSize() { try { return normalizeGridSize(localStorage.getItem(`classpad-grid-size:${classId}`)); } catch { return 4; } }
function loadTeacherSmoothing() { try { return localStorage.getItem("classpad-teacher-smoothing") !== "false"; } catch { return true; } }
function classPages() { return normalizeBoardPages(classroom?.boardPages); }
function pageNumber(pageId) { const index = classPages().findIndex((item) => item.id === pageId); return index < 0 ? 1 : index + 1; }
function monitoredPage(student) {
  const id = selectMonitoredPage(presence[student.id], classroom?.boardPages, student.boardMeta);
  if (student.answerPageId !== id) { student.answerPageId = id; student.hasAnswer = undefined; }
  return id;
}
function renderSmoothingButton() { renderSmoothingControl(smoothingButton, teacherSmoothing); }
function renderLockButton() {
  const locked = Boolean(currentStudent?.locked);
  renderToolbarState(document.querySelector("#toggleLock"), { label: locked ? "解鎖白板" : "鎖定白板", pressed: locked, icon: locked ? "lock" : "unlock" });
}
function renderProjectionControls() {
  const active = Boolean(displayState?.active);
  document.querySelector("#stopProjection").disabled = !active;
  document.querySelector("#stopReviewProjection").disabled = !active;
  const projecting = Boolean(active && displayState.studentId === currentStudent?.id && displayState.followStudent);
  renderToolbarState(document.querySelector("#projectReview"), { label: projecting ? "投影中（最近書寫頁）" : "投影最近書寫頁", pressed: projecting });
}
function connectDisplay(token) {
  if (!token || token === watchedDisplayToken) return;
  displayOff?.(); watchedDisplayToken = token;
  displayOff = watchDisplay(token, (value) => { displayState = value; renderProjectionControls(); render(); });
}
async function projectStudent(student, pageId, followStudent) {
  const token = classroom.displayToken || await ensureClassDisplay(classId, user.uid);
  classroom.displayToken = token; connectDisplay(token);
  displayState = await projectDisplay(token, classId, student, pageId, user.uid, followStudent);
  renderProjectionControls(); render();
  toast(`已投影 ${student.seatNumber} ${student.displayName}${followStudent ? " 的最近作答頁，並同步顯示文字、老師與學生筆跡。" : " 的目前頁面。"}`);
}
async function stopCurrentProjection() {
  if (!classroom?.displayToken) return;
  await stopDisplay(classroom.displayToken, classId, user.uid);
  displayState = { classId, active: false };
  renderProjectionControls(); render();
  toast("已解除投影，展示畫面已變成黑色。");
}
function syncFollowedProjection() {
  if (!displayState?.active || !displayState.followStudent || followingPageUpdate) return;
  const student = students.find((item) => item.id === displayState.studentId);
  if (!student) return;
  const pageId = monitoredPage(student);
  if (pageId === displayState.pageId) return;
  followingPageUpdate = true;
  updateProjectedPage(classroom.displayToken, pageId, user.uid).catch(() => {}).finally(() => { followingPageUpdate = false; });
}
function setToolbarHidden(hidden) { monitorToolbar.hidden = hidden; showMonitorToolbar.hidden = !hidden; document.body.classList.toggle("toolbar-hidden", hidden); try { localStorage.setItem("classpad-monitor-toolbar-hidden", String(hidden)); } catch {} }
document.querySelector("#hideMonitorToolbar").onclick = () => setToolbarHidden(true);
showMonitorToolbar.onclick = () => setToolbarHidden(false);
try { setToolbarHidden(localStorage.getItem("classpad-monitor-toolbar-hidden") === "true"); } catch { setToolbarHidden(false); }

function filtered() {
  const q = document.querySelector("#searchInput").value.trim().toLowerCase();
  const matches = students.filter((student) => { monitoredPage(student); return (!q || `${student.seatNumber} ${student.displayName}`.toLowerCase().includes(q))
    && (!document.querySelector("#onlineOnly").checked || presence[student.id]?.online)
    && (!document.querySelector("#answeredOnly").checked || student.hasAnswer !== false); });
  return prioritizePinned(matches, classroom?.pinnedStudents);
}

function clearPreviews() { previews.clear(); }

function loseAccess(text) {
  unavailable = true; studentLoadVersion++; cancelAnimationFrame(boardMetaRenderFrame);
  clearPreviews(); stopReviewPage(); if (dialog.open) dialog.close();
  metaSubscriptions.forEach((off) => off()); metaSubscriptions.clear(); boardMetaOffs = [];
  rosterSubscriptions.forEach((off) => off()); rosterSubscriptions.clear();
  presenceOff?.(); displayOff?.(); expiryOff?.(); materialCache.clear(classId);
  grid.hidden = true; state.hidden = false; state.textContent = text;
}

function render() {
  if (unavailable || cleanupStarted) return;
  renderProjectionControls();
  if (dialog.open) { renderReviewPageControls(); return; }
  const list = filtered(), view = paginateStudents(list, page, gridSize), visible = view.students, pinned = classroom?.pinnedStudents || {};
  page = view.page; grid.dataset.size = String(gridSize);
  document.querySelectorAll("[data-grid-size]").forEach((button) => button.setAttribute("aria-pressed", String(normalizeGridSize(button.dataset.gridSize) === gridSize)));
  document.querySelector("#pageLabel").textContent = gridSize === "all" ? "全班總覽" : `第 ${page + 1} / ${view.pages} 頁`;
  document.querySelector(".pagination").hidden = gridSize === "all";
  document.querySelector("#prevPage").disabled = page === 0; document.querySelector("#nextPage").disabled = page >= view.pages - 1;
  document.querySelector("#autoRotate").disabled = gridSize === "all";
  document.querySelector("#studentSummary").textContent = `目前顯示 ${visible.length}／全班 ${students.length} 人${list.length < students.length ? "（已篩選）" : ""}`;
  state.hidden = visible.length > 0; state.textContent = students.length ? "沒有符合條件的學生。" : "尚未加入學生，可先開啟講解白板。"; grid.hidden = !visible.length;
  previews.reconcile(visible,
    (student) => JSON.stringify([student.boardToken, monitoredPage(student), classPages().find((item) => item.id === monitoredPage(student))?.backgroundImage]),
    (student) => {
      const card = document.createElement("article"); card.className = "preview-card"; card.dataset.id = student.id;
      card.innerHTML = '<div class="preview-head"></div><div class="preview-board"></div><button class="project-display">投影</button><button class="enlarge primary">放大批注</button>';
      grid.append(card);
      const currentPage = monitoredPage(student);
      const thumbnail = new ThumbnailBoard({ container: card.querySelector(".preview-board"), token: student.boardToken, pageId: currentPage,
        background: classPages().find((item) => item.id === currentPage)?.backgroundImage,
        onAnswer: (hasAnswer) => { if (student.hasAnswer !== hasAnswer) { student.hasAnswer = hasAnswer; if (document.querySelector("#answeredOnly").checked) scheduleBoardMetaRender(); } },
        onError: () => { card.dataset.error = "true"; card.title = "白板讀取失敗，請確認連線或返回課堂設定。"; }
      });
      card.onclick = async (event) => {
        const current = students.find((item) => item.id === student.id); if (!current) return;
        const button = event.target.closest("button"); if (!button) return;
        try {
          if (button.classList.contains("enlarge")) openReview(current, monitoredPage(current));
          else if (button.classList.contains("project-display")) await projectStudent(current, monitoredPage(current), true);
          else if (button.classList.contains("pin-button")) await setStudentPinned(classId, current.id, !classroom.pinnedStudents?.[current.id]);
        } catch (error) { toast(explainError(error), "error"); }
      };
      return { card, thumbnail, dispose: () => { thumbnail.destroy(); card.remove(); } };
    },
    ({ card }, student, index) => {
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
      const status = presence[student.id]?.online ? (presence[student.id]?.drawing ? "書寫中" : "在線") : "離線";
      const header = `<strong>${escapeHtml(student.seatNumber)} ${escapeHtml(student.displayName)}</strong><span class="preview-actions"><span class="badge">第 ${pageNumber(monitoredPage(student))} 頁</span><button class="pin-button" aria-label="${pinned[student.id] ? "取消釘選" : "釘選"} ${escapeHtml(student.displayName)}" aria-pressed="${Boolean(pinned[student.id])}">${pinned[student.id] ? "📌 已釘選" : "📌 釘選"}</button><span class="badge ${presence[student.id]?.online ? "online" : "offline"}">${status}</span>${student.locked ? '<span class="badge error">鎖定</span>' : ""}</span>`;
      const head = card.querySelector(".preview-head"); if (head.innerHTML !== header) head.innerHTML = header;
      const projecting = displayState?.active && displayState.studentId === student.id;
      const project = card.querySelector(".project-display"); project.textContent = projecting ? "投影中" : "投影"; project.classList.toggle("active", Boolean(projecting));
    }
  );
}

function escapeHtml(value) { const element = document.createElement("div"); element.textContent = value; return element.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function scheduleBoardMetaRender() {
  if (boardMetaRenderFrame) return;
  boardMetaRenderFrame = requestAnimationFrame(() => { boardMetaRenderFrame = null; render(); syncFollowedProjection(); });
}
function syncMetaSubscriptions() {
  if (unavailable || cleanupStarted) return;
  const tokens = new Set(students.map((student) => student.boardToken));
  for (const [token, off] of metaSubscriptions) if (!tokens.has(token)) { off(); metaSubscriptions.delete(token); }
  for (const student of students) if (!metaSubscriptions.has(student.boardToken)) {
    metaSubscriptions.set(student.boardToken, watchBoardMeta(student.boardToken, (value) => {
      student.boardMeta = value;
      if (value.lastWrittenLayer === "studentStrokes" || value.lastWrittenLayer === "studentText") student.hasAnswer = true;
      scheduleBoardMetaRender();
    }));
  }
  boardMetaOffs = [...metaSubscriptions.values()];
}
async function loadStudents() {
  const version = ++studentLoadVersion;
  try {
    const loaded = await getStudents(classroom);
    if (version !== studentLoadVersion || cleanupStarted || unavailable) return;
    const previous = new Map(students.map((student) => [student.id, student]));
    students = loaded.map((value) => {
      const old = previous.get(value.id);
      if (old?.boardToken === value.boardToken) { Object.assign(old, value); return old; }
      return value;
    });
    const ids = new Set(students.map((student) => student.id));
    for (const [id, off] of rosterSubscriptions) if (!ids.has(id)) { off(); rosterSubscriptions.delete(id); }
    for (const student of students) if (!rosterSubscriptions.has(student.id)) {
      rosterSubscriptions.set(student.id, watchStudent(student.id, (value) => {
        if (unavailable || cleanupStarted) return;
        const current = students.find((item) => item.id === student.id);
        if (!current) return;
        if (!value) { students = students.filter((item) => item.id !== student.id); if (currentStudent?.id === current.id) closeReview(); syncMetaSubscriptions(); scheduleBoardMetaRender(); return; }
        const regenerated = current.boardToken !== value.boardToken;
        if (regenerated) {
          current.boardMeta = {}; current.hasAnswer = false;
        }
        Object.assign(current, value);
        if (regenerated && currentStudent?.id === current.id) { closeReview(); toast("學生網址已重建，請重新開啟批注。", "error"); }
        syncMetaSubscriptions(); scheduleBoardMetaRender();
      }, () => { state.hidden = false; state.textContent = "學生資料讀取失敗，請確認網路或課堂權限。"; }));
    }
    syncMetaSubscriptions(); render();
  } catch (error) { state.textContent = explainError(error); }
}

async function expireMonitor(value) {
  materialCache.clear(classId);
  if (cleanupStarted) return;
  cleanupStarted = true; expiryOff?.(); classOff?.(); presenceOff?.(); displayOff?.(); clearPreviews(); stopReviewPage();
  boardMetaOffs.forEach((off) => off()); boardMetaOffs = []; metaSubscriptions.clear(); rosterSubscriptions.forEach((off) => off()); rosterSubscriptions.clear(); grid.hidden = true; monitorToolbar.hidden = true; state.hidden = false; state.textContent = "課程已到期，正在自動清除資料…";
  try {
    const deleted = await cleanupExpiredClassroom(classId, user.uid, value);
    state.textContent = deleted ? "課程已到期，資料已自動清除。" : "課程已到期；此展示用課程受保護，資料已保留。";
  }
  catch (error) { cleanupStarted = false; state.textContent = `課程已到期，但自動清除失敗：${explainError(error)} 系統將自動重試。`; clearTimeout(expirationRetryTimer); expirationRetryTimer = setTimeout(() => expireMonitor(value), 15000); }
}

async function init() {
  if (!classId) { state.textContent = "網址缺少課堂編號。"; return; }
  try {
    user = await ensureAnonymousUser();
    if (inviteToken) { state.textContent = "正在授權這台裝置…"; await claimTeacherInvite(classId, inviteToken, user.uid); const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete("invite"); history.replaceState(null, "", cleanUrl); toast("這台裝置已取得老師權限。"); }
    classOff = watchClassroom(classId, (value) => {
      if (!value) { loseAccess("課堂不存在或權限不足。"); return; }
      if (isClassroomExpired(value)) { expireMonitor(value); return; }
      const nextDirectorySignature = JSON.stringify([value.title, value.className, value.createdAt, value.expiresAt, value.updatedAt, value.status, value.studentCount]);
      if (directorySignature !== nextDirectorySignature) syncClassroomDirectory(classId, value).then(() => { directorySignature = nextDirectorySignature; }).catch((error) => toast(`系統課程清單同步失敗：${explainError(error)}`, "error"));
      const previousOrder = JSON.stringify([classroom?.studentOrder, classroom?.updatedAt]); classroom = value; document.querySelector("#classTitle").textContent = value.title; connectDisplay(value.displayToken);
      expiryOff?.(); expiryOff = watchClassroomExpiry(value, { onExpire: () => expireMonitor(value) });
      if (!students.length || previousOrder !== JSON.stringify([value.studentOrder, value.updatedAt])) loadStudents(); else render();
    }, () => loseAccess("課堂管理權限已變更。"));
    presenceOff = watchPresence(classId, (value) => {
      presence = value;
      const nextKey = JSON.stringify(Object.entries(value).map(([studentId, item]) => [studentId, item.online, item.drawing, item.currentPageId, item.lastWrittenPageId, item.lastWrittenAt]));
      if (nextKey !== presenceRenderKey) { presenceRenderKey = nextKey; render(); }
      syncFollowedProjection();
    });
  } catch (error) { state.textContent = explainError(error); }
}

function stopReviewPage() { clearBackgroundImage(document.querySelector("#reviewBackgroundImage")); reviewOffs.forEach((off) => off()); reviewOffs = []; reviewStickyNotes?.destroy(); reviewStickyNotes = null; reviewTextLayer?.destroy(); reviewTextLayer = null; reviewText = null; reviewEngine?.destroy(); reviewEngine = null; }

function renderReviewPageControls() {
  if (!currentStudent) return;
  renderLockButton();
  document.querySelector("#reviewPresence").textContent = presence[currentStudent.id]?.online ? (presence[currentStudent.id]?.drawing ? "書寫中" : "在線") : "離線";
  const pages = classPages(); let index = pages.findIndex((item) => item.id === currentReviewPageId);
  if (index < 0) { index = 0; currentReviewPageId = pages[0].id; }
  document.querySelector("#reviewPageLabel").textContent = `${index + 1} / ${pages.length}`;
  document.querySelector("#reviewPageLabel").setAttribute("aria-label", `第 ${index + 1} 頁，共 ${pages.length} 頁`);
  document.querySelector("#projectStudentPage").title = `讓這位學生跳到老師目前批注的第 ${index + 1} 頁`;
  document.querySelector("#projectStudentPage").setAttribute("aria-label", `幫學生翻到目前批注的第 ${index + 1} 頁`);
  document.querySelector("#reviewPrevPage").disabled = index <= 0; document.querySelector("#reviewNextPage").disabled = index >= pages.length - 1;
  const select = document.querySelector("#insertPagePosition"), selected = Math.min(pages.length + 1, Number(select.value) || index + 2);
  select.innerHTML = Array.from({ length: pages.length + 1 }, (_, optionIndex) => `<option value="${optionIndex + 1}">插入為第 ${optionIndex + 1} 頁</option>`).join("");
  select.value = String(selected);
  renderReviewBackground();
}

function renderReviewBackground() {
  const background = classPages().find((page) => page.id === currentReviewPageId)?.backgroundImage;
  showBackgroundImage(document.querySelector("#reviewBackgroundImage"), background);
}

function openReviewPage(pageId) {
  const pages = classPages(); if (!pages.some((item) => item.id === pageId)) pageId = pages[0].id;
  stopReviewPage(); currentReviewPageId = pageId; const activePageId = pageId;
  reviewStickyNotes = new StickyNotesLayer({
    container: document.querySelector("#reviewStickyLayer"), editable: true,
    onChange: (id, patch) => updateStickyNote(currentStudent.boardToken, id, patch, activePageId),
    onDelete: (id) => confirmAction("確定刪除這張便條貼？") ? removeStickyNote(currentStudent.boardToken, id, activePageId) : undefined,
    onError: (error) => toast(explainError(error), "error")
  });
  reviewTextLayer = new StudentTextLayer({ container: document.querySelector("#reviewTextLayer") });
  const activeEngine = new BoardEngine({
    stage: document.querySelector("#reviewStage"), backgroundCanvas: document.querySelector("#reviewBackground"), studentCanvas: document.querySelector("#reviewStudent"), teacherCanvas: document.querySelector("#reviewTeacher"), editableLayer: "teacherStrokes", uid: user.uid,
    onComplete: (stroke) => saveStroke(currentStudent.boardToken, "teacherStrokes", stroke, activePageId).catch((error) => toast(explainError(error), "error")),
    onRemove: (id) => removeStroke(currentStudent.boardToken, "teacherStrokes", id, activePageId).catch((error) => toast(explainError(error), "error")),
    onActive: (stroke) => { const now = Date.now(); if (stroke && (activePageId !== lastTeacherActivityPageId || now - lastTeacherActivityAt >= 750)) { lastTeacherActivityAt = now; lastTeacherActivityPageId = activePageId; markBoardActivity(currentStudent.boardToken, "teacherStrokes", activePageId).catch(() => {}); } },
    onViewChange: (view) => { reviewStickyNotes?.setViewport(view); reviewTextLayer?.setViewport(view); setBackgroundViewport(document.querySelector("#reviewBackgroundLayer"), view); document.querySelector("#reviewZoomScale").textContent = `${Math.round(view.scale * 100)}%`; document.querySelector("#reviewZoomOut").disabled = view.scale <= .25; document.querySelector("#reviewZoomIn").disabled = view.scale >= 4; }
  });
  reviewEngine = activeEngine; reviewEngine.setSmoothing(teacherSmoothing);
  reviewEngine.setTool(drawingSettings.tool);
  reviewEngine.setColor(drawingSettings.color);
  renderToolSelection(dialog, drawingSettings);
  reviewEngine.setWidth(document.querySelector("#reviewWidth").value);
  reviewOffs = [
    subscribeLayer(currentStudent.boardToken, "studentStrokes", { add: (id, stroke) => activeEngine.addStroke("studentStrokes", id, stroke), remove: (id) => activeEngine.removeStroke("studentStrokes", id) }, activePageId),
    subscribeLayer(currentStudent.boardToken, "teacherStrokes", { add: (id, stroke) => activeEngine.addStroke("teacherStrokes", id, stroke), remove: (id) => activeEngine.removeStroke("teacherStrokes", id) }, activePageId),
    subscribeStickyNotes(currentStudent.boardToken, { add: (id, note) => reviewStickyNotes?.upsert(id, note), change: (id, note) => reviewStickyNotes?.upsert(id, note), remove: (id) => reviewStickyNotes?.remove(id) }, activePageId),
    subscribeStudentText(currentStudent.boardToken, (value) => { reviewText = value; reviewTextLayer?.setValue(value); }, activePageId)
  ];
  renderReviewPageControls();
}

async function openReview(student, pageId) {
  reviewScroll = window.scrollY; currentStudent = student; clearPreviews(); document.querySelector("#reviewName").textContent = `${student.seatNumber} ${student.displayName}`; document.querySelector("#reviewPresence").textContent = presence[student.id]?.online ? "在線" : "離線"; renderLockButton(); renderProjectionControls(); dialog.showModal(); openReviewPage(pageId);
}

function closeReview() { stopReviewPage(); currentStudent = null; currentReviewPageId = null; dialog.close(); render(); requestAnimationFrame(() => window.scrollTo(0, reviewScroll)); }
document.querySelector("#closeReview").onclick = closeReview;
dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeReview(); });
dialog.querySelectorAll("button[data-tool]").forEach((button) => button.onclick = () => {
  reviewEngine?.finishInput(); drawingSettings.tool = button.dataset.tool;
  if (button.dataset.penColor) drawingSettings.color = button.dataset.penColor;
  reviewEngine?.setTool(drawingSettings.tool); reviewEngine?.setColor(drawingSettings.color);
  renderToolSelection(dialog, drawingSettings);
});
document.querySelector("#reviewWidth").onchange = (event) => reviewEngine?.setWidth(event.target.value);
document.querySelector("#reviewUndo").onclick = () => reviewEngine?.undo(); document.querySelector("#reviewRedo").onclick = () => reviewEngine?.redo(); document.querySelector("#reviewResetZoom").onclick = () => reviewEngine?.resetZoom();
document.querySelector("#reviewZoomOut").onclick = () => reviewEngine?.zoomBy(-.1);
document.querySelector("#reviewZoomIn").onclick = () => reviewEngine?.zoomBy(.1);
smoothingButton.onclick = () => { teacherSmoothing = !teacherSmoothing; reviewEngine?.setSmoothing(teacherSmoothing); try { localStorage.setItem("classpad-teacher-smoothing", String(teacherSmoothing)); } catch {} renderSmoothingButton(); };
renderSmoothingButton();
document.querySelector("#reviewPrevPage").onclick = () => { const pages = classPages(), index = pages.findIndex((item) => item.id === currentReviewPageId); openReviewPage(pages[Math.max(0, index - 1)].id); };
document.querySelector("#reviewNextPage").onclick = () => { const pages = classPages(), index = pages.findIndex((item) => item.id === currentReviewPageId); openReviewPage(pages[Math.min(pages.length - 1, index + 1)].id); };
document.querySelector("#projectStudentPage").onclick = async (event) => {
  if (!currentStudent || !currentReviewPageId || !reviewEngine || cleanupStarted) return;
  const button = event.currentTarget, student = currentStudent, pageId = currentReviewPageId, number = pageNumber(pageId);
  button.disabled = true;
  try {
    await requestStudentPage(student, pageId);
    toast(`已請 ${student.seatNumber} ${student.displayName} 翻到老師正在批注的第 ${number} 頁；離線時會於恢復連線後跳轉。`);
  } catch (error) { toast(explainError(error), "error"); }
  finally { button.disabled = false; }
};
document.querySelector("#projectReview").onclick = () => {
  if (!currentStudent) return;
  const pageId = monitoredPage(currentStudent);
  projectStudent(currentStudent, pageId, true).catch((error) => toast(explainError(error), "error"));
};
document.querySelector("#stopProjection").onclick = () => stopCurrentProjection().catch((error) => toast(explainError(error), "error"));
document.querySelector("#stopReviewProjection").onclick = () => stopCurrentProjection().catch((error) => toast(explainError(error), "error"));
document.querySelector("#insertBlankPage").onclick = async (event) => {
  const button = event.currentTarget; button.disabled = true;
  try { const result = await insertClassBoardPage(classId, classroom, students, user.uid, Number(document.querySelector("#insertPagePosition").value)); classroom.boardPages = boardPagesMap(result.pages, { createdAt: classroom.createdAt, createdBy: user.uid }); openReviewPage(result.pageId); toast(`已插入為第 ${pageNumber(result.pageId)} 頁。`); } catch (error) { toast(explainError(error), "error"); } finally { button.disabled = false; }
};
document.querySelector("#addStickyNote").onclick = async () => { if (!currentStudent || !reviewStickyNotes) return; const offset = reviewStickyNotes.notes.size % 6; try { const id = await createStickyNote(currentStudent.boardToken, { text: "", color: document.querySelector("#stickyColor").value, x: +(.08 + offset * .04).toFixed(2), y: +(.08 + offset * .04).toFixed(2), width: .28, height: .22, authorUid: user.uid }, currentReviewPageId); reviewStickyNotes.focus(id); } catch (error) { toast(explainError(error), "error"); } };
document.querySelector("#toggleLock").onclick = async () => {
  const student = currentStudent; if (!student) return;
  const locked = !student.locked;
  try { await updateStudent(student.id, { locked }); student.locked = locked; renderReviewPageControls(); }
  catch (error) { toast(explainError(error), "error"); }
};
document.querySelector("#clearTeacher").onclick = async () => { if (confirmAction("確定清除本頁全部老師批注？")) { await clearLayer(currentStudent.boardToken, "teacherStrokes", currentReviewPageId); reviewEngine?.clearLayerLocal("teacherStrokes"); } };
document.querySelector("#exportPng").onclick = async (event) => {
  if (!reviewEngine || !currentStudent) return;
  const button = event.currentTarget, activeStudent = currentStudent, activePage = classPages().find((p) => p.id === currentReviewPageId);
  const payload = { classroom, student: activeStudent, page: activePage, pageNumber: pageNumber(currentReviewPageId), studentStrokes: [...reviewEngine.strokes.studentStrokes.values()], studentText: reviewText, teacherStrokes: [...reviewEngine.strokes.teacherStrokes.values()], stickyNotes: [...reviewStickyNotes.notes.values()], exportedAt: new Date() };
  button.disabled = true;
  try { const blob = await renderPagePng(payload); downloadBlob(blob, `${activeStudent.seatNumber}-${activeStudent.displayName}-第${payload.pageNumber}頁.png`); }
  catch (error) { toast(explainError(error), "error"); } finally { button.disabled = false; }
};

for (const id of ["searchInput", "onlineOnly", "answeredOnly"]) document.querySelector(`#${id}`).addEventListener(id === "searchInput" ? "input" : "change", () => { page = 0; render(); });
document.querySelectorAll("[data-grid-size]").forEach((button) => button.onclick = () => { gridSize = normalizeGridSize(button.dataset.gridSize); page = 0; if (gridSize === "all") { clearInterval(rotateTimer); document.querySelector("#autoRotate").checked = false; } try { localStorage.setItem(`classpad-grid-size:${classId}`, String(gridSize)); } catch {} render(); });
document.querySelector("#prevPage").onclick = () => { page--; render(); }; document.querySelector("#nextPage").onclick = () => { page++; render(); };
document.querySelector("#autoRotate").onchange = (event) => { clearInterval(rotateTimer); if (event.target.checked && gridSize !== "all") rotateTimer = setInterval(() => { const pages = Math.max(1, Math.ceil(filtered().length / gridSize)); if (gridSize !== "all") { page = (page + 1) % pages; render(); } }, 10000); };
document.querySelector("#resetFilters").onclick = () => { document.querySelector("#searchInput").value = ""; document.querySelector("#onlineOnly").checked = false; document.querySelector("#answeredOnly").checked = false; page = 0; render(); };
addEventListener("pagehide", () => { unavailable = true; studentLoadVersion++; cancelAnimationFrame(boardMetaRenderFrame); connectionOff(); rosterSubscriptions.forEach((off) => off()); rosterSubscriptions.clear(); materialCache.clear(classId); clearPreviews(); boardMetaOffs.forEach((off) => off()); metaSubscriptions.clear(); expiryOff?.(); classOff?.(); presenceOff?.(); displayOff?.(); stopReviewPage(); clearInterval(rotateTimer); clearTimeout(expirationRetryTimer); });
addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });

init();
