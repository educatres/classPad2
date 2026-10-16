import { subscribeLayer, subscribeStickyNotes, subscribeStudentText } from "../firebase/boardRepository.js";
import { drawStrokeOnCanvas } from "../canvas/BoardEngine.js";
import { drawStickyNotes } from "../notes/StickyNotesLayer.js";
import { drawStudentText, hasStudentText } from "../text/StudentTextLayer.js";
import { clearBackgroundImage, showBackgroundImage } from "../whiteboard/backgroundImage.js";

export const MAX_THUMBNAIL_WIDTH = 480;
export function thumbnailDimensions(width, dpr = 1) {
  const pixels = Math.max(1, Math.min(MAX_THUMBNAIL_WIDTH, Math.round(width * dpr)));
  return { width: pixels, height: Math.max(1, Math.round(pixels * .75)) };
}

export class ThumbnailBoard {
  constructor({ container, token, pageId, background, onAnswer, onError }) {
    this.container = container; this.student = new Map(); this.teacher = new Map(); this.notes = new Map(); this.text = null; this.stopped = false;
    this.ready = new Set(); container.dataset.loaded = "false"; container.setAttribute("aria-busy", "true");
    container.innerHTML = '<img class="board-background-image" alt="題目底圖" hidden><canvas class="preview-canvas"></canvas><span class="thumbnail-loading" role="status">載入作答中…</span>';
    this.canvas = container.querySelector("canvas"); this.image = container.querySelector("img");
    showBackgroundImage(this.image, background); container.classList.toggle("has-background", Boolean(background));
    this.image.addEventListener("error", () => onError?.(new Error("題目底圖載入失敗，請確認網路連線。")));
    const changed = () => { if (this.ready.has("student") && this.ready.has("text")) onAnswer?.(this.student.size > 0 || hasStudentText(this.text)); this.schedule(); };
    const loaded = (name) => { this.ready.add(name); if (this.ready.size === 4) { container.dataset.loaded = "true"; container.setAttribute("aria-busy", "false"); container.querySelector(".thumbnail-loading").hidden = true; } changed(); };
    const handlers = (map, name) => ({ add: (id, value) => { map.set(id, value); changed(); }, change: (id, value) => { map.set(id, value); changed(); }, remove: (id) => { map.delete(id); changed(); }, ready: () => loaded(name), error: onError });
    this.offs = [subscribeLayer(token, "studentStrokes", handlers(this.student, "student"), pageId), subscribeLayer(token, "teacherStrokes", handlers(this.teacher, "teacher"), pageId), subscribeStickyNotes(token, handlers(this.notes, "notes"), pageId), subscribeStudentText(token, (value) => { this.text = value; loaded("text"); }, pageId, onError)];
    this.observer = new ResizeObserver(() => this.schedule()); this.observer.observe(container); this.schedule();
  }
  schedule() {
    if (this.stopped || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; if (!this.stopped) this.draw(); });
  }
  draw() {
    const size = thumbnailDimensions(this.container.getBoundingClientRect().width, window.devicePixelRatio || 1);
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) { this.canvas.width = size.width; this.canvas.height = size.height; }
    const context = this.canvas.getContext("2d"); context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, size.width, size.height);
    // Draw in the same logical space as exports; only the bitmap is downsampled.
    context.save(); context.scale(size.width / 1600, size.height / 1200);
    for (const stroke of this.student.values()) drawStrokeOnCanvas(context, stroke, 1600, 1200);
    drawStudentText(context, this.text);
    for (const stroke of this.teacher.values()) drawStrokeOnCanvas(context, stroke, 1600, 1200);
    drawStickyNotes(context, [...this.notes.values()]); context.restore();
  }
  destroy() { this.stopped = true; cancelAnimationFrame(this.frame); this.offs.forEach((off) => off()); this.observer.disconnect(); clearBackgroundImage(this.image); this.canvas.width = 0; this.canvas.height = 0; }
}
