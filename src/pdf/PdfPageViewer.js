import { boundedScale, pointerPosition, selectionPixels, selectionRect } from "./geometry.js";
import { layoutPdfPages, PAGE_LABEL_HEIGHT, PAGE_PADDING, pdfScrollAnchor, restorePdfAnchor, visiblePdfPages } from "./pageLayout.js";

// All pages have stable placeholders. Only a bounded set of nearby pages has a bitmap.
export class PdfPageViewer {
  constructor(scroller, { onSelect, onPageChange, onError, onViewChange }) {
    Object.assign(this, { scroller, onSelect, onPageChange, onError, onViewChange });
    this.list = document.createElement("div"); this.list.className = "pdf-pages";
    scroller.append(this.list);
    this.entries = []; this.layout = []; this.wanted = []; this.zoom = 1; this.current = 1;
    this.visible = true; this.enabled = true; this.generation = 0;
    this.scrollListener = () => { this.schedule(); if (this.visible) this.onViewChange?.(); };
    scroller.addEventListener("scroll", this.scrollListener, { passive: true });
    this.observer = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.resize(), 100);
    });
    this.observer.observe(scroller);
    this.setBrowsing(true);
  }

  async setDocument(pdf) {
    this.reset(); this.pdf = pdf;
    const generation = this.generation;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      if (this.destroyed || generation !== this.generation) return;
      const { width, height } = page.getViewport({ scale: 1 });
      const element = document.createElement("article"); element.className = "pdf-page-entry";
      element.setAttribute("aria-label", `PDF 第 ${number} 頁`);
      element.innerHTML = `<div class="pdf-page-label">第 ${number} 頁</div><div class="pdf-sheet"><span class="pdf-page-placeholder">等待顯示…</span><div class="pdf-selection" hidden></div></div>`;
      const entry = { number, element, sheet: element.querySelector(".pdf-sheet"), box: element.querySelector(".pdf-selection"), placeholder: element.querySelector(".pdf-page-placeholder"), size: { width, height } };
      this.entries.push(entry); this.list.append(element); this.bindSelection(entry); page.cleanup();
    }
    if (generation === this.generation && !this.destroyed) this.resize(false);
  }

  resize(preserve = true) {
    if (!this.visible || !this.pdf || !this.scroller.clientWidth || this.destroyed) return;
    const view = this.savedView || (preserve ? this.getView() : null);
    const width = this.scroller.clientWidth;
    this.layout = layoutPdfPages(this.entries.map((entry) => entry.size), width, this.zoom);
    const contentWidth = Math.max(width, ...this.layout.map((entry) => entry.width + PAGE_PADDING * 2));
    this.list.style.width = `${contentWidth}px`;
    this.list.style.height = `${(this.layout.at(-1)?.bottom || 0) + PAGE_PADDING}px`;
    for (const item of this.layout) {
      const entry = this.entries[item.number - 1];
      Object.assign(entry.element.style, { top: `${item.top}px`, left: `${(contentWidth - item.width) / 2}px`, width: `${item.width}px` });
      entry.element.style.height = `${item.height + PAGE_LABEL_HEIGHT}px`;
      Object.assign(entry.sheet.style, { width: `${item.width}px`, height: `${item.height}px` });
      // Rounded dimensions avoid needless re-rendering for subpixel ResizeObserver changes.
      const key = `${Math.round(item.width)}:${Math.round(item.height)}`;
      if (entry.key !== key) { entry.key = key; entry.task?.cancel(); if (!entry.task) this.release(entry); entry.failedKey = null; }
    }
    this.scroller.scrollTop = restorePdfAnchor(this.layout, view?.anchor);
    this.scroller.scrollLeft = (view?.left || 0) * Math.max(0, this.scroller.scrollWidth - this.scroller.clientWidth);
    this.savedView = null;
    this.schedule();
    this.onViewChange?.();
  }

  schedule() {
    if (this.frame || this.destroyed || !this.visible) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.update(); });
  }

  update() {
    if (this.destroyed || !this.visible) return;
    const { scrollTop, clientHeight } = this.scroller;
    this.wanted = visiblePdfPages(this.layout, scrollTop, clientHeight);
    const current = this.layout.find((item) => item.bottom > scrollTop + Math.min(120, clientHeight / 3));
    if (current && current.number !== this.current) { this.current = current.number; this.onPageChange(this.current); }
    for (const entry of this.entries) if (!this.wanted.includes(entry.number)) {
      entry.task?.cancel(); if (!entry.task) this.release(entry);
    }
    this.pump();
  }

  async pump() {
    if (this.pumping || this.destroyed) return;
    this.pumping = true;
    try {
      while (this.visible && !this.destroyed) {
        const entry = this.wanted.map((number) => this.entries[number - 1]).find((item) => item && item.renderedKey !== item.key && item.failedKey !== item.key);
        if (!entry) break;
        const generation = this.generation, key = entry.key, pdf = this.pdf;
        let page;
        try {
          page = await pdf.getPage(entry.number);
          if (!this.isWanted(entry, generation, key)) continue;
          this.release(entry);
          const requested = this.layout[entry.number - 1].width / entry.size.width * Math.min(globalThis.devicePixelRatio || 1, 2);
          // Preview pixels are independent of the full-resolution capture renderer.
          const scale = Math.min(boundedScale(entry.size.width, entry.size.height, requested), Math.sqrt(1_500_000 / (entry.size.width * entry.size.height)));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
          canvas.setAttribute("aria-label", `PDF 第 ${entry.number} 頁`);
          entry.canvas = canvas; entry.sheet.insertBefore(canvas, entry.box); entry.placeholder.textContent = "正在顯示…";
          entry.task = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, background: "white" });
          await entry.task.promise;
          if (this.isWanted(entry, generation, key)) { entry.renderedKey = key; entry.placeholder.hidden = true; }
        } catch (error) {
          if (error.name !== "RenderingCancelledException" && this.isWanted(entry, generation, key)) {
            entry.failedKey = key; this.onError(`第 ${entry.number} 頁顯示失敗，請按該頁重試。`);
            entry.placeholder.textContent = "顯示失敗，點此重試";
            entry.placeholder.onclick = () => { entry.failedKey = null; this.schedule(); };
          }
        } finally {
          entry.task = null; page?.cleanup();
          if (entry.renderedKey !== key || !this.isWanted(entry, generation, key)) this.release(entry, Boolean(entry.failedKey));
        }
      }
    } finally { this.pumping = false; }
  }

  isWanted(entry, generation, key) {
    return !this.destroyed && this.visible && generation === this.generation && key === entry.key && this.wanted.includes(entry.number);
  }

  release(entry, preserveError = false) {
    if (entry.canvas) { entry.canvas.width = entry.canvas.height = 0; entry.canvas.remove(); entry.canvas = null; }
    entry.renderedKey = null; entry.placeholder.hidden = false;
    if (!preserveError) { entry.failedKey = null; entry.placeholder.textContent = "等待顯示…"; entry.placeholder.onclick = null; }
  }

  setZoom(zoom) { this.zoom = Math.max(.5, Math.min(3, zoom)); this.resize(); }
  jump(number) {
    const item = this.layout[Math.max(1, Math.min(this.entries.length, Number(number) || 1)) - 1];
    if (item) { this.scroller.scrollTop = item.top - PAGE_PADDING; this.current = item.number; this.onPageChange(this.current); this.schedule(); }
  }
  setBrowsing(value) { this.browsing = value; this.scroller.classList.toggle("selecting", !value); this.cancelDrag(); }
  setEnabled(value) { this.enabled = value; if (!value) this.cancelDrag(); }
  getView() {
    return this.savedView || { zoom: this.zoom, anchor: pdfScrollAnchor(this.layout, this.scroller.scrollTop), left: this.scroller.scrollLeft / Math.max(1, this.scroller.scrollWidth - this.scroller.clientWidth) || 0 };
  }
  restoreView(view) {
    if (!view) return;
    const zoom = Number.isFinite(view.zoom) ? Math.max(.5, Math.min(3, view.zoom)) : 1;
    const anchor = Number.isInteger(view.anchor?.number) && Number.isFinite(view.anchor?.fraction) ? view.anchor : null;
    this.zoom = zoom;
    this.savedView = { zoom, anchor, left: Number.isFinite(view.left) ? Math.max(0, Math.min(1, view.left)) : 0 };
    this.resize();
  }
  setVisible(value) {
    if (!value && this.visible) this.savedView = this.getView();
    this.visible = value;
    if (value) this.resize();
    else { this.cancelDrag(); this.entries.forEach((entry) => entry.task?.cancel()); }
  }
  drawSelection() {
    for (const entry of this.entries) {
      const region = this.selection?.number === entry.number && this.selection.region;
      entry.box.hidden = !region;
      if (region) Object.assign(entry.box.style, { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` });
    }
  }
  clearSelection() { this.cancelDrag(); this.selection = null; this.drawSelection(); }
  selectAll() {
    if (!this.enabled || !this.entries.length) return;
    this.selection = { number: this.current, region: { x: 0, y: 0, width: 1, height: 1 } }; this.drawSelection(); this.onSelect(this.selection);
  }
  cancelDrag() {
    const drag = this.drag; this.drag = null;
    if (drag?.sheet.hasPointerCapture(drag.id)) drag.sheet.releasePointerCapture(drag.id);
  }
  bindSelection(entry) {
    const sheet = entry.sheet;
    sheet.onpointerdown = (event) => {
      if (this.browsing || !this.enabled || !entry.renderedKey || this.drag || event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault(); this.clearSelection(); sheet.setPointerCapture(event.pointerId);
      this.drag = { id: event.pointerId, sheet, number: entry.number, start: pointerPosition(event, sheet.getBoundingClientRect()) };
    };
    const move = (event) => {
      if (this.drag?.id !== event.pointerId || this.drag.sheet !== sheet) return false;
      event.preventDefault();
      this.selection = { number: entry.number, region: selectionRect(this.drag.start, pointerPosition(event, sheet.getBoundingClientRect())) }; this.drawSelection(); return true;
    };
    sheet.onpointermove = move;
    sheet.onpointerup = (event) => {
      if (!move(event)) return;
      this.cancelDrag();
      if (selectionPixels(this.selection.region, entry.size.width, entry.size.height)) this.onSelect(this.selection);
      else { this.clearSelection(); this.onError("選取範圍太小，請重新框選。"); }
    };
    sheet.onpointercancel = () => this.clearSelection();
    sheet.onlostpointercapture = () => { this.drag = null; };
  }
  reset() {
    this.generation++; this.cancelDrag(); this.selection = null; this.wanted = [];
    for (const entry of this.entries) { entry.task?.cancel(); if (!entry.task) this.release(entry); }
    this.entries = []; this.layout = []; this.pdf = null; this.savedView = null; this.zoom = 1; this.current = 1;
    this.list.replaceChildren(); this.list.style.height = "0px"; this.scroller.scrollTop = this.scroller.scrollLeft = 0;
  }
  destroy() {
    this.destroyed = true; this.reset(); cancelAnimationFrame(this.frame); clearTimeout(this.resizeTimer);
    this.observer.disconnect(); this.scroller.removeEventListener("scroll", this.scrollListener);
  }
}
