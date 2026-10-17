const MIN_WIDTH = 0.14;
const MIN_HEIGHT = 0.12;
const round = (value) => +value.toFixed(4);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const STICKY_COLORS = ["yellow", "blue", "pink", "green"];
export const STICKY_COLOR_LABELS = { yellow: "淡黃", blue: "淡藍", pink: "粉紅", green: "淡綠" };
export const STICKY_COLOR_VALUES = { yellow: "#fff2a8", blue: "#cfeeff", pink: "#ffd5e5", green: "#d9f5cf" };

export function stickyNoteValues(value) {
  return (Array.isArray(value) ? value : Object.values(value || {})).filter((note) => note && typeof note === "object");
}

export function hasStickyNotes(value) { return stickyNoteValues(value).length > 0; }

function wrapStickyText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text || "").replaceAll("\r\n", "\n").split("\n")) {
    if (!paragraph) { lines.push(""); continue; }
    let line = "";
    for (const character of Array.from(paragraph)) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) { lines.push(line); line = character; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export function drawStickyNotes(context, value, width = 1600, height = 1200) {
  const scale = width / 1600, fontSize = 26 * scale, lineHeight = 36 * scale, padding = 22 * scale;
  for (const note of stickyNoteValues(value)) {
    const x = clamp(Number(note.x) || 0, 0, 1) * width, y = clamp(Number(note.y) || 0, 0, 1) * height;
    const noteWidth = clamp(Number(note.width) || MIN_WIDTH, MIN_WIDTH, 1) * width;
    const noteHeight = clamp(Number(note.height) || MIN_HEIGHT, MIN_HEIGHT, 1) * height;
    context.save();
    context.fillStyle = STICKY_COLOR_VALUES[note.color] || STICKY_COLOR_VALUES.yellow;
    context.strokeStyle = "rgba(75, 63, 33, 0.22)";
    context.lineWidth = Math.max(1, 2 * scale);
    context.fillRect(x, y, noteWidth, noteHeight);
    context.strokeRect(x, y, noteWidth, noteHeight);
    context.beginPath();
    context.rect(x, y, noteWidth, noteHeight);
    context.clip();
    context.fillStyle = "#493f28";
    context.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif`;
    context.textBaseline = "top";
    const lines = wrapStickyText(context, note.text, Math.max(1, noteWidth - padding * 2));
    let textY = y + padding;
    for (const line of lines) {
      if (textY + lineHeight > y + noteHeight - padding) break;
      context.fillText(line, x + padding, textY);
      textY += lineHeight;
    }
    context.restore();
  }
}

export function moveStickyNote(note, deltaX, deltaY) {
  return {
    x: round(clamp(note.x + deltaX, 0, 1 - note.width)),
    y: round(clamp(note.y + deltaY, 0, 1 - note.height)),
  };
}

export function resizeStickyNote(note, deltaX, deltaY) {
  return {
    width: round(clamp(note.width + deltaX, MIN_WIDTH, 1 - note.x)),
    height: round(clamp(note.height + deltaY, MIN_HEIGHT, 1 - note.y)),
  };
}

export class StickyNotesLayer {
  constructor({ container, editable = false, onChange, onDelete, onError }) {
    this.container = container;
    this.editable = editable;
    this.onChange = onChange;
    this.onDelete = onDelete;
    this.onError = onError;
    this.notes = new Map();
    this.elements = new Map();
    this.timers = new Map();
    this.pendingText = new Map();
    this.pendingFocus = null;
    container.classList.toggle("editable", editable);
  }

  setViewport({ scale = 1, panX = 0, panY = 0, baseScale = 0, originX = 0, originY = 0, worldWidth = 1600, worldHeight = 1200 } = {}) {
    const fitScale = Number(baseScale) > 0 ? Number(baseScale) : 1;
    const inverse = 1 / fitScale;
    const px = (value) => `${value * inverse}px`;
    this.container.style.inset = "auto";
    this.container.style.left = "0px";
    this.container.style.top = "0px";
    this.container.style.right = "auto";
    this.container.style.bottom = "auto";
    this.container.style.width = `${Number(worldWidth) > 0 ? Number(worldWidth) : 1600}px`;
    this.container.style.height = `${Number(worldHeight) > 0 ? Number(worldHeight) : 1200}px`;
    this.container.style.setProperty("--sticky-head-height", px(28));
    this.container.style.setProperty("--sticky-head-padding", px(2.88));
    this.container.style.setProperty("--sticky-head-padding-x", px(4));
    this.container.style.setProperty("--sticky-head-gap", px(4));
    this.container.style.setProperty("--sticky-head-font-size", px(11.52));
    this.container.style.setProperty("--sticky-select-width", px(58));
    this.container.style.setProperty("--sticky-select-padding", px(1.92));
    this.container.style.setProperty("--sticky-select-font-size", px(10.4));
    this.container.style.setProperty("--sticky-delete-size", px(24));
    this.container.style.setProperty("--sticky-delete-font-size", px(16));
    this.container.style.setProperty("--sticky-input-padding", px(7.2));
    this.container.style.setProperty("--sticky-input-font-size", px(16));
    this.container.style.setProperty("--sticky-text-padding", px(8.8));
    this.container.style.setProperty("--sticky-text-font-size", px(16));
    this.container.style.setProperty("--sticky-resize-size", px(24));
    this.container.style.transform = `translate(${Number(originX) + Number(panX)}px, ${Number(originY) + Number(panY)}px) scale(${fitScale * (Number(scale) || 1)})`;
  }

  upsert(id, value) {
    const note = { ...value, id };
    this.notes.set(id, note);
    let element = this.elements.get(id);
    if (!element) {
      element = this.createElement(note);
      this.elements.set(id, element);
      this.container.append(element);
    }
    this.applyNote(element, note);
    if (this.pendingFocus === id) {
      this.pendingFocus = null;
      element.querySelector("textarea")?.focus();
    }
  }

  remove(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.pendingText.delete(id);
    this.notes.delete(id);
    this.elements.get(id)?.remove();
    this.elements.delete(id);
  }

  focus(id) {
    const textarea = this.elements.get(id)?.querySelector("textarea");
    if (textarea) textarea.focus();
    else this.pendingFocus = id;
  }

  createElement(note) {
    const element = document.createElement("article");
    element.className = `sticky-note${this.editable ? "" : " readonly"}`;
    element.dataset.id = note.id;
    if (!this.editable) {
      const text = document.createElement("div");
      text.className = "sticky-note-text";
      element.append(text);
      return element;
    }

    const head = document.createElement("div");
    head.className = "sticky-note-head";
    const drag = document.createElement("span");
    drag.className = "sticky-drag-handle";
    drag.textContent = "⠿ 便條";
    drag.title = "拖曳便條貼";
    const color = document.createElement("select");
    color.className = "sticky-color-select";
    color.setAttribute("aria-label", "便條貼顏色");
    for (const value of STICKY_COLORS) color.add(new Option(STICKY_COLOR_LABELS[value], value));
    const remove = document.createElement("button");
    remove.className = "sticky-delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "刪除便條貼");
    head.append(drag, color, remove);

    const textarea = document.createElement("textarea");
    textarea.className = "sticky-note-input";
    textarea.maxLength = 500;
    textarea.placeholder = "輸入便條內容…";
    textarea.setAttribute("aria-label", "便條貼內容");
    const resize = document.createElement("span");
    resize.className = "sticky-resize-handle";
    resize.textContent = "◢";
    resize.title = "調整便條貼大小";
    element.append(head, textarea, resize);

    for (const control of [head, color, remove, textarea, resize]) control.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.bindPointerTransform(drag, note.id, "move");
    this.bindPointerTransform(resize, note.id, "resize");
    color.onchange = () => this.change(note.id, { color: color.value });
    remove.onclick = () => {
      clearTimeout(this.timers.get(note.id));
      this.timers.delete(note.id);
      this.pendingText.delete(note.id);
      Promise.resolve(this.onDelete?.(note.id)).catch((error) => this.onError?.(error));
    };
    textarea.oninput = () => {
      const current = this.notes.get(note.id);
      if (current) current.text = textarea.value;
      this.pendingText.set(note.id, textarea.value);
      clearTimeout(this.timers.get(note.id));
      this.timers.set(note.id, setTimeout(() => this.flushText(note.id), 350));
    };
    textarea.onblur = () => this.flushText(note.id);
    return element;
  }

  applyNote(element, note) {
    element.dataset.color = STICKY_COLORS.includes(note.color) ? note.color : "yellow";
    element.style.left = `${note.x * 100}%`;
    element.style.top = `${note.y * 100}%`;
    element.style.width = `${note.width * 100}%`;
    element.style.height = `${note.height * 100}%`;
    const color = element.querySelector("select");
    if (color) color.value = element.dataset.color;
    const editor = element.querySelector("textarea");
    if (editor && document.activeElement !== editor) editor.value = note.text || "";
    const text = element.querySelector(".sticky-note-text");
    if (text) text.textContent = note.text || "";
  }

  bindPointerTransform(handle, id, mode) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture?.(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const startNote = { ...this.notes.get(id) };
      const bounds = this.container.getBoundingClientRect();
      const move = (nextEvent) => {
        nextEvent.preventDefault();
        const deltaX = (nextEvent.clientX - startX) / bounds.width;
        const deltaY = (nextEvent.clientY - startY) / bounds.height;
        const patch = mode === "move" ? moveStickyNote(startNote, deltaX, deltaY) : resizeStickyNote(startNote, deltaX, deltaY);
        Object.assign(this.notes.get(id), patch);
        this.applyNote(this.elements.get(id), this.notes.get(id));
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        const current = this.notes.get(id);
        if (!current) return;
        const patch = mode === "move" ? { x: current.x, y: current.y } : { width: current.width, height: current.height };
        this.change(id, patch);
      };
      handle.addEventListener("pointermove", move, { passive: false });
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    }, { passive: false });
  }

  change(id, patch) {
    const note = this.notes.get(id);
    if (!note) return;
    Object.assign(note, patch);
    this.applyNote(this.elements.get(id), note);
    Promise.resolve(this.onChange?.(id, patch)).catch((error) => this.onError?.(error));
  }

  flushText(id) {
    if (!this.pendingText.has(id)) return;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const text = this.pendingText.get(id);
    this.pendingText.delete(id);
    this.change(id, { text });
  }

  destroy() {
    for (const id of [...this.pendingText.keys()]) this.flushText(id);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pendingText.clear();
    this.notes.clear();
    this.elements.clear();
    this.container.replaceChildren();
    this.container.style.transform = "";
  }
}
