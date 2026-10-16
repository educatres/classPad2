export const TEXT_LOGICAL_WIDTH = 1600;
export const TEXT_LOGICAL_HEIGHT = 1200;
export const TEXT_FONT_SIZE = 40;
export const TEXT_LINE_HEIGHT = 58;
export const TEXT_PADDING = 64;
export const MAX_STUDENT_TEXT_LENGTH = 5000;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeStudentText(value) {
  return {
    text: typeof value?.text === "string" ? value.text : "",
    scrollTop: clamp(Number(value?.scrollTop) || 0, 0, 100000),
    layoutVersion: 1,
  };
}

export function hasStudentText(value) {
  return normalizeStudentText(value).text.trim().length > 0;
}

function graphemes(value) {
  if (typeof Intl?.Segmenter === "function") {
    return [...new Intl.Segmenter("zh-Hant", { granularity: "grapheme" }).segment(value)].map((item) => item.segment);
  }
  return Array.from(value);
}

export function wrapStudentText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text || "").replaceAll("\r\n", "\n").split("\n")) {
    if (!paragraph) { lines.push(""); continue; }
    let line = "";
    for (const character of graphemes(paragraph)) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = character;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export function drawStudentText(context, value, width = TEXT_LOGICAL_WIDTH, height = TEXT_LOGICAL_HEIGHT) {
  const document = normalizeStudentText(value);
  if (!document.text) return;
  const scaleX = width / TEXT_LOGICAL_WIDTH, scaleY = height / TEXT_LOGICAL_HEIGHT;
  context.save();
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();
  context.scale(scaleX, scaleY);
  context.fillStyle = "#183042";
  context.font = `${TEXT_FONT_SIZE}px -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif`;
  context.textBaseline = "top";
  const lines = wrapStudentText(context, document.text, TEXT_LOGICAL_WIDTH - TEXT_PADDING * 2);
  let y = TEXT_PADDING - document.scrollTop;
  for (const line of lines) {
    if (y + TEXT_LINE_HEIGHT >= 0 && y <= TEXT_LOGICAL_HEIGHT) context.fillText(line, TEXT_PADDING, y);
    y += TEXT_LINE_HEIGHT;
  }
  context.restore();
}

export class StudentTextLayer {
  constructor({ container, editable = false, onChange, onError }) {
    this.container = container;
    this.editable = editable;
    this.onChange = onChange;
    this.onError = onError;
    this.enabled = editable;
    this.editing = false;
    this.viewport = { scale: 1, panX: 0, panY: 0 };
    this.composing = false;
    this.dirty = false;
    this.lastSubmitted = { text: "", scrollTop: 0 };
    this.editor = document.createElement("textarea");
    this.editor.className = "student-text-editor";
    this.editor.maxLength = MAX_STUDENT_TEXT_LENGTH;
    this.editor.setAttribute("aria-label", editable ? "學生文字作答區" : "學生文字作答");
    this.editor.readOnly = true;
    container.replaceChildren(this.editor);

    this.handleInput = () => {
      this.dirty = true;
      if (!this.composing) this.scheduleFlush(500);
    };
    this.handleScroll = () => {
      if (this.applyingScroll || !this.editable) return;
      this.dirty = true;
      this.scheduleFlush(250);
    };
    this.handleCompositionStart = () => { this.composing = true; };
    this.handleCompositionEnd = () => { this.composing = false; this.dirty = true; this.scheduleFlush(250); };
    this.handleBlur = () => this.flush();
    this.editor.addEventListener("input", this.handleInput);
    this.editor.addEventListener("scroll", this.handleScroll, { passive: true });
    this.editor.addEventListener("compositionstart", this.handleCompositionStart);
    this.editor.addEventListener("compositionend", this.handleCompositionEnd);
    this.editor.addEventListener("blur", this.handleBlur);
    this.resizeObserver = new ResizeObserver(() => this.applyViewport());
    this.resizeObserver.observe(container);
    this.applyState();
    this.applyViewport();
  }

  setValue(value) {
    const next = normalizeStudentText(value);
    if (!this.dirty && this.editor.value !== next.text) this.editor.value = next.text;
    if (!this.dirty || this.editor.value === next.text) {
      this.dirty = false;
      this.lastSubmitted = { text: next.text, scrollTop: next.scrollTop };
      this.applyingScroll = true;
      this.editor.scrollTop = next.scrollTop;
      requestAnimationFrame(() => { this.applyingScroll = false; });
    }
  }

  setViewport(view = {}) {
    this.viewport = { scale: Number(view.scale) || 1, panX: Number(view.panX) || 0, panY: Number(view.panY) || 0 };
    this.applyViewport();
  }

  applyViewport() {
    const width = this.container.getBoundingClientRect().width;
    if (!width) return;
    const baseScale = width / TEXT_LOGICAL_WIDTH;
    const { scale, panX, panY } = this.viewport;
    this.editor.style.transform = `translate(${panX}px, ${panY}px) scale(${baseScale * scale})`;
  }

  setEditing(value) {
    this.editing = Boolean(value && this.editable);
    this.applyState();
    if (this.editing && this.enabled) requestAnimationFrame(() => this.editor.focus({ preventScroll: true }));
  }

  setEnabled(value) { this.enabled = Boolean(value); this.applyState(); }

  applyState() {
    const active = this.editable && this.editing && this.enabled;
    this.container.classList.toggle("editing", active);
    this.editor.readOnly = !active;
    this.editor.tabIndex = active ? 0 : -1;
  }

  scheduleFlush(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  async flush({ finishComposition = false } = {}) {
    clearTimeout(this.timer);
    this.timer = null;
    if (finishComposition) this.composing = false;
    if (!this.editable || this.composing || !this.dirty) return;
    const next = { text: this.editor.value, scrollTop: Math.max(0, Math.round(this.editor.scrollTop)), layoutVersion: 1 };
    if (this.pendingSave && next.text === this.pendingSave.value.text && next.scrollTop === this.pendingSave.value.scrollTop) return this.pendingSave.promise;
    if (!this.pendingSave && next.text === this.lastSubmitted.text && next.scrollTop === this.lastSubmitted.scrollTop) { this.dirty = false; return; }
    const pending = { value: next }; this.pendingSave = pending;
    pending.promise = (async () => {
      try {
        await this.onChange?.(next);
        if (this.pendingSave === pending) {
          this.lastSubmitted = { text: next.text, scrollTop: next.scrollTop };
          if (this.editor.value === next.text && Math.round(this.editor.scrollTop) === next.scrollTop) this.dirty = false;
        }
      } catch (error) {
        if (this.pendingSave === pending) { this.dirty = true; this.onError?.(error); }
      } finally { if (this.pendingSave === pending) this.pendingSave = null; }
    })();
    return pending.promise;
  }

  destroy() {
    this.flush({ finishComposition: true });
    clearTimeout(this.timer);
    this.resizeObserver.disconnect();
    this.editor.removeEventListener("input", this.handleInput);
    this.editor.removeEventListener("scroll", this.handleScroll);
    this.editor.removeEventListener("compositionstart", this.handleCompositionStart);
    this.editor.removeEventListener("compositionend", this.handleCompositionEnd);
    this.editor.removeEventListener("blur", this.handleBlur);
    this.container.replaceChildren();
  }
}
