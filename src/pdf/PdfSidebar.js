import { sidebarWidth } from "./pageLayout.js";

const WIDTH_KEY = "classpad:pdf-sidebar-width";

export class PdfSidebar {
  constructor({ workspace, panel, splitter, toggle, onVisibility, onResizeStart }) {
    Object.assign(this, { workspace, panel, splitter, toggle, onVisibility, onResizeStart });
    try { this.width = Number(localStorage.getItem(WIDTH_KEY)) || null; } catch { /* Private browsing can disable preferences. */ }
    this.resizeListener = () => this.applyWidth();
    addEventListener("resize", this.resizeListener);
    splitter.onpointerdown = (event) => {
      if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault(); onResizeStart(); splitter.setPointerCapture(event.pointerId); this.pointer = event.pointerId;
    };
    splitter.onpointermove = (event) => {
      if (this.pointer !== event.pointerId) return;
      this.width = event.clientX - workspace.getBoundingClientRect().left; this.applyWidth();
    };
    const finish = (event) => {
      if (this.pointer !== event.pointerId) return;
      this.pointer = null; if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId); this.remember();
    };
    splitter.onpointerup = splitter.onpointercancel = finish;
    splitter.onlostpointercapture = () => { this.pointer = null; };
    splitter.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); onResizeStart();
      this.width = event.key === "Home" ? 280 : event.key === "End" ? workspace.clientWidth : this.actualWidth + (event.key === "ArrowLeft" ? -24 : 24);
      this.applyWidth(); this.remember();
    };
    this.keyListener = (event) => {
      if (event.key === "Escape" && this.open && !document.querySelector("dialog[open]")) { event.preventDefault(); this.setOpen(false); toggle.focus(); }
    };
    workspace.addEventListener("keydown", this.keyListener);
    this.applyWidth();
  }
  applyWidth() {
    this.actualWidth = sidebarWidth(this.width, this.workspace.clientWidth);
    this.workspace.style.setProperty("--pdf-panel-width", `${this.actualWidth}px`);
    this.splitter.setAttribute("aria-valuemin", "280");
    this.splitter.setAttribute("aria-valuemax", String(sidebarWidth(Infinity, this.workspace.clientWidth)));
    this.splitter.setAttribute("aria-valuenow", String(this.actualWidth));
    this.splitter.setAttribute("aria-valuetext", `PDF 面板寬 ${this.actualWidth} 像素`);
  }
  remember() { this.width = this.actualWidth; try { localStorage.setItem(WIDTH_KEY, String(this.actualWidth)); } catch { /* Preference is optional. */ } }
  setOpen(value) {
    this.open = value; this.onResizeStart();
    // Save viewer state before display:none and resume only after the panel is visible.
    if (!value) this.onVisibility(false);
    this.panel.hidden = this.splitter.hidden = !value;
    this.workspace.classList.toggle("pdf-open", value);
    this.toggle.setAttribute("aria-expanded", String(value)); this.toggle.classList.toggle("active", value);
    if (value) { this.applyWidth(); this.onVisibility(true); }
  }
  destroy() { removeEventListener("resize", this.resizeListener); this.workspace.removeEventListener("keydown", this.keyListener); }
}
