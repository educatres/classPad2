import { drawStrokeOnCanvas } from "../canvas/BoardEngine.js";
import { getBoardPageLayers } from "../firebase/boardRepository.js";
import { normalizeBoardPages } from "../whiteboard/pages.js";
import { createStoredZip } from "../utils/zip.js";
import { drawStudentText, hasStudentText } from "../text/StudentTextLayer.js";
import { backgroundImageDrawRect, googleDriveCanvasImageUrl, normalizeBackgroundImage } from "../whiteboard/backgroundImage.js";
import { drawStickyNotes, hasStickyNotes, stickyNoteValues } from "../notes/StickyNotesLayer.js";
import { loadCachedCanvasImage } from "./backgroundImageCache.js";
import { materialCache } from "../whiteboard/materialCache.js";

export const MAX_EXPORT_BYTES = 250 * 1024 * 1024;

export function sanitizeFilename(value, fallback = "未命名") {
  const cleaned = String(value ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[.\s]+$/g, "").trim();
  return (cleaned || fallback).slice(0, 80);
}

function layerValues(value) {
  return Array.isArray(value) ? value : Object.values(value || {});
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("無法產生 PNG 圖檔。")), "image/png"));
}

export function loadCanvasImage(url) {
  return loadCachedCanvasImage(url);
}

export async function drawPageBackground(context, value, width = 1600, height = 1200, loadImage = loadCanvasImage) {
  const background = normalizeBackgroundImage(value);
  if (!background) return false;
  if (background.type === "rtdb-capture") {
    const resource = await materialCache.acquire(background);
    try {
      const rect = backgroundImageDrawRect(background, resource.image.naturalWidth, resource.image.naturalHeight, width, height);
      if (!rect) throw new Error("無法計算教材匯出尺寸。");
      context.drawImage(resource.image, rect.x, rect.y, rect.width, rect.height);
      return true;
    } finally { resource.release(); }
  }
  const imageUrl = googleDriveCanvasImageUrl(background);
  const image = await loadImage(imageUrl);
  const rect = backgroundImageDrawRect(background, image.naturalWidth || image.width, image.naturalHeight || image.height, width, height);
  if (!rect) throw new Error("無法計算底圖匯出尺寸。");
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  return true;
}

export async function renderPagePng({ classroom, student, page, pageNumber, studentStrokes, studentText, teacherStrokes, stickyNotes, exportedAt, loadImage = loadCanvasImage }) {
  const canvas = document.createElement("canvas"), width = 1600, drawingHeight = 1200;
  canvas.width = width;
  canvas.height = 1280;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("此瀏覽器無法建立匯出圖片。");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#173f5f";
  context.font = "bold 30px sans-serif";
  context.fillText(`${student.seatNumber || ""} ${student.displayName || ""}　第 ${pageNumber} 頁　${exportedAt.toLocaleString("zh-TW")}　${classroom.title || ""}`, 30, 48);
  context.save();
  context.translate(0, 80);
  await drawPageBackground(context, page?.backgroundImage, width, drawingHeight, loadImage);
  for (const stroke of studentStrokes) drawStrokeOnCanvas(context, stroke, width, drawingHeight);
  drawStudentText(context, studentText, width, drawingHeight);
  for (const stroke of teacherStrokes) drawStrokeOnCanvas(context, stroke, width, drawingHeight);
  drawStickyNotes(context, stickyNotes, width, drawingHeight);
  context.restore();
  return canvasToBlob(canvas);
}

function studentLabel(student) {
  return [student.seatNumber, student.displayName].filter(Boolean).join(" ") || "未命名學生";
}

function uniqueFolder(student, used) {
  const base = sanitizeFilename([student.seatNumber, student.displayName].filter(Boolean).join("-"), "未命名學生");
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const suffix = sanitizeFilename(student.id || student.boardToken || "重複", "重複").slice(-12);
  let candidate = `${base}-${suffix}`, count = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix}-${count++}`;
  used.add(candidate);
  return candidate;
}

export async function exportClassroomZip({
  classroom,
  students,
  loadPageLayers = getBoardPageLayers,
  renderPage = renderPagePng,
  zipBuilder = createStoredZip,
  onProgress = () => {},
  maxBytes = MAX_EXPORT_BYTES,
  exportedAt = new Date()
}) {
  const pages = normalizeBoardPages(classroom?.boardPages), files = [], emptyStudents = [], usedFolders = new Set();
  let totalBytes = 0, pageCount = 0, exportedStudents = 0;

  for (let studentIndex = 0; studentIndex < students.length; studentIndex++) {
    const student = students[studentIndex], folder = uniqueFolder(student, usedFolders);
    let studentPageCount = 0;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const layers = await loadPageLayers(student.boardToken, pages[pageIndex].id);
      const studentStrokes = layerValues(layers?.studentStrokes), studentText = layers?.studentText, teacherStrokes = layerValues(layers?.teacherStrokes), stickyNotes = stickyNoteValues(layers?.stickyNotes);
      if (!studentStrokes.length && !teacherStrokes.length && !hasStudentText(studentText) && !hasStickyNotes(stickyNotes)) continue;
      const blob = await renderPage({ classroom, student, page: pages[pageIndex], pageNumber: pageIndex + 1, studentStrokes, studentText, teacherStrokes, stickyNotes, exportedAt });
      totalBytes += blob.size;
      if (totalBytes > maxBytes) throw new Error("匯出的 PNG 總大小超過 250 MB，請分批下載學生作品。");
      files.push({ name: `${folder}/第${String(pageIndex + 1).padStart(2, "0")}頁.png`, data: blob });
      studentPageCount++;
      pageCount++;
    }
    if (studentPageCount) exportedStudents++;
    else emptyStudents.push(student);
    onProgress({ completedStudents: studentIndex + 1, totalStudents: students.length, student });
  }

  const emptyList = emptyStudents.length
    ? ["以下學生沒有任何文字、便條貼、學生筆跡或老師筆跡：", "", ...emptyStudents.map(studentLabel)].join("\n")
    : "所有學生皆有筆記。";
  files.push({ name: "無筆記學生.txt", data: `\uFEFF${emptyList}\n` });
  const blob = await zipBuilder(files, exportedAt);
  return {
    blob,
    filename: `${sanitizeFilename(classroom?.title, "課堂")}-全班作品.zip`,
    exportedStudents,
    emptyStudents,
    pageCount
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
