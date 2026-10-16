import { ensureAnonymousUser } from "../firebase/auth.js";
import { subscribeLayer, subscribeStickyNotes, subscribeStudentText } from "../firebase/boardRepository.js";
import { clearDisplaySession, setDisplaySession, watchDisplay } from "../firebase/displayRepository.js";
import { getClassroomExpiresAt, watchClassroomExpiresAt } from "../firebase/classroomRepository.js";
import { watchServerTimeOffset } from "../firebase/connection.js";
import { watchBoardPages } from "../firebase/pageRepository.js";
import { BoardEngine } from "../canvas/BoardEngine.js";
import { StickyNotesLayer } from "../notes/StickyNotesLayer.js";
import { StudentTextLayer } from "../text/StudentTextLayer.js";
import { clearBackgroundImage, setBackgroundViewport, showBackgroundImage } from "../whiteboard/backgroundImage.js";
import { materialCache } from "../whiteboard/materialCache.js";
import { normalizeBoardPages } from "../whiteboard/pages.js";
import { param } from "../utils/url.js";
import { isClassroomExpired, watchClassroomExpiry } from "../utils/classroomExpiration.js";
import { explainError, toast } from "../utils/ui.js";

const token = param("display"), black = document.querySelector("#displayBlack"), stage = document.querySelector("#displayStage"), message = document.querySelector("#displayMessage"), clock = document.querySelector("#displayClock");
let user, displayOff, expirationOff, expirationTimerOff, expirationClassId, engine, stickyNotes, textLayer, clockTimer, projectionOffs = [], signature = "", expired = false;
let projectionSequence = 0;
const stopServerTime = watchServerTimeOffset();

function updateClock() {
  const now = new Date();
  clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  clock.dateTime = clock.textContent;
  clockTimer = setTimeout(updateClock, 60_050 - (Date.now() % 60_000));
}

function showBlack(text = "") {
  stopProjection();
  message.textContent = text;
  message.hidden = !text;
  black.hidden = false;
  stage.hidden = true;
}

function stopProjection(clearSession = true) {
  projectionSequence++;
  clearBackgroundImage(document.querySelector("#displayBackgroundImage"));
  materialCache.clear(expirationClassId);
  projectionOffs.forEach((off) => off?.());
  projectionOffs = [];
  stickyNotes?.destroy(); stickyNotes = null;
  textLayer?.destroy(); textLayer = null;
  engine?.destroy(); engine = null;
  if (clearSession && user) clearDisplaySession(user.uid).catch(() => {});
}

async function showProjection(state) {
  const nextSignature = `${state.boardToken}:${state.pageId}`;
  if (signature === nextSignature && engine) { document.querySelector("#displayLabel").textContent = state.label || ""; return; }
  signature = nextSignature;
  stopProjection(false);
  const job = projectionSequence;
  await setDisplaySession(user.uid, token, state.boardToken);
  if (job !== projectionSequence || expired) return;
  black.hidden = true; stage.hidden = false;
  document.querySelector("#displayLabel").textContent = state.label || "";
  stickyNotes = new StickyNotesLayer({ container: document.querySelector("#displayStickyLayer") });
  textLayer = new StudentTextLayer({ container: document.querySelector("#displayTextLayer") });
  const activeStickyNotes = stickyNotes;
  const activeTextLayer = textLayer;
  engine = new BoardEngine({
    stage,
    backgroundCanvas: document.querySelector("#displayBackground"),
    studentCanvas: document.querySelector("#displayStudent"),
    teacherCanvas: document.querySelector("#displayTeacher"),
    onViewChange: (view) => { activeStickyNotes.setViewport(view); activeTextLayer.setViewport(view); setBackgroundViewport(document.querySelector("#displayBackgroundLayer"), view); }
  });
  const activeEngine = engine, pageId = state.pageId, board = state.boardToken;
  projectionOffs.push(
    subscribeLayer(board, "studentStrokes", { add: (id, stroke) => activeEngine.addStroke("studentStrokes", id, stroke), remove: (id) => activeEngine.removeStroke("studentStrokes", id) }, pageId),
    subscribeLayer(board, "teacherStrokes", { add: (id, stroke) => activeEngine.addStroke("teacherStrokes", id, stroke), remove: (id) => activeEngine.removeStroke("teacherStrokes", id) }, pageId),
    subscribeStickyNotes(board, { add: (id, note) => activeStickyNotes.upsert(id, note), change: (id, note) => activeStickyNotes.upsert(id, note), remove: (id) => activeStickyNotes.remove(id) }, pageId),
    subscribeStudentText(board, (value) => activeTextLayer.setValue(value), pageId),
    watchBoardPages(board, (value) => {
      const page = normalizeBoardPages(value).find((item) => item.id === pageId);
      showBackgroundImage(document.querySelector("#displayBackgroundImage"), page?.backgroundImage);
    }, () => showBlack("展示權限已變更，請等待老師重新投影。"))
  );
}

function expireDisplay() {
  if (expired) return;
  expired = true; expirationTimerOff?.(); displayOff?.(); showBlack("此課程已滿 3 小時並停止使用，資料將由老師端自動清除。");
}

async function connectExpiration(classId) {
  if (expirationClassId === classId) return !expired;
  expirationClassId = classId; expirationOff?.(); expirationTimerOff?.();
  const apply = (value) => {
    if (!value) return;
    expirationTimerOff?.();
    const expiration = { expiresAt: Number(value) };
    if (isClassroomExpired(expiration)) { expireDisplay(); return; }
    expirationTimerOff = watchClassroomExpiry(expiration, { onExpire: expireDisplay });
  };
  apply(await getClassroomExpiresAt(classId));
  if (expired) return false;
  expirationOff = watchClassroomExpiresAt(classId, apply, expireDisplay);
  return true;
}

async function init() {
  if (!token) return showBlack("展示網址無效。");
  try {
    user = await ensureAnonymousUser();
    displayOff = watchDisplay(token, async (state) => {
      try {
        if (!state) return showBlack("展示網址不存在，請向老師索取新連結。");
        if (!await connectExpiration(state.classId)) return;
        if (!state.active) { signature = ""; return showBlack(); }
        showProjection(state).catch((error) => { showBlack("無法載入投影畫面。"); toast(explainError(error), "error"); });
      } catch (error) { showBlack(explainError(error)); }
    });
  } catch (error) { showBlack(explainError(error)); }
}

document.querySelector("#displayBackgroundImage").addEventListener("error", () => toast("題目底圖載入失敗，請確認網路連線，或通知老師協助處理。", "error"));
addEventListener("pagehide", () => { clearTimeout(clockTimer); stopServerTime(); expirationOff?.(); expirationTimerOff?.(); displayOff?.(); stopProjection(); });
updateClock();
init();
