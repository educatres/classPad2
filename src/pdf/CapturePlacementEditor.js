import { backgroundImagePlacementRect } from "../whiteboard/backgroundImage.js";
import { moveCapturePlacement, normalizeCapturePlacement, resizeCapturePlacement } from "./placement.js";

export class CapturePlacementEditor {
  constructor(container, onBack) {
    this.container = container;
    container.innerHTML = `<div class="pdf-layout-heading"><h3>調整白板版面</h3><button data-layout-back type="button">返回 PDF 重新框選</button></div>
      <p class="muted">拖曳圖片調整位置，拉動右下角調整大小。白板外的部分不會顯示；學生將看到相同版面。</p>
      <div class="pdf-layout-content"><div class="pdf-layout-board" aria-label="學生白板版面預覽，比例 4 比 3">
        <div class="pdf-layout-frame" tabindex="0" role="group" aria-label="截圖位置，可用方向鍵移動">
          <img data-preview alt="截圖白板版面預覽" draggable="false">
          <button data-layout-resize type="button" aria-label="拖曳調整截圖大小，或使用方向鍵">↘</button>
        </div></div>
        <div class="pdf-layout-controls"><label>圖片大小 <output data-layout-scale>100%</output>
          <input data-layout-range type="range" min="10" max="150" step="1" value="100" aria-label="截圖縮放比例"></label>
          <button data-layout-reset type="button">置中並符合白板</button>
          <p class="muted">也可用方向鍵移動圖片；按住 Shift 可加大移動幅度。</p></div></div>`;
    this.board = container.querySelector(".pdf-layout-board");
    this.frame = container.querySelector(".pdf-layout-frame");
    this.image = container.querySelector("[data-preview]");
    this.range = container.querySelector("[data-layout-range]");
    this.output = container.querySelector("[data-layout-scale]");
    this.resetButton = container.querySelector("[data-layout-reset]");
    this.backButton = container.querySelector("[data-layout-back]");
    this.handle = container.querySelector("[data-layout-resize]");
    this.placement = normalizeCapturePlacement();
    this.enabled = false;
    this.backButton.onclick = onBack;
    this.range.oninput = () => { if (this.enabled) this.update({ ...this.placement, scale: Number(this.range.value) / 100 }); };
    this.resetButton.onclick = () => { if (this.enabled) this.update(normalizeCapturePlacement()); };
    this.frame.onpointerdown = (event) => {
      if (!this.enabled || this.gesture || event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      this.frame.setPointerCapture(event.pointerId);
      this.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, bounds: this.board.getBoundingClientRect(), placement: { ...this.placement }, resizing: this.handle.contains(event.target) };
    };
    this.frame.onpointermove = (event) => this.move(event);
    this.frame.onpointerup = (event) => { if (this.gesture?.id === event.pointerId) { this.move(event); this.endGesture(); } };
    this.frame.onpointercancel = (event) => { if (this.gesture?.id === event.pointerId) { this.update(this.gesture.placement); this.endGesture(); } };
    this.frame.onlostpointercapture = () => { this.gesture = null; };
    this.frame.onkeydown = (event) => {
      if (!this.enabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? .05 : .01;
      if (event.target === this.handle) this.update({ ...this.placement, scale: this.placement.scale + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -step : step) });
      else this.update(moveCapturePlacement(this.placement, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
    };
  }

  get value() { return { ...this.placement }; }

  setCapture(capture, url) {
    this.capture = capture;
    this.image.src = url;
    this.container.hidden = false;
    this.update(normalizeCapturePlacement());
    this.container.scrollIntoView({ block: "nearest" });
  }

  update(value) {
    this.placement = normalizeCapturePlacement(value);
    if (!this.capture) return;
    const rect = backgroundImagePlacementRect(this.placement, this.capture.width, this.capture.height);
    Object.assign(this.frame.style, { left: `${rect.x / 1600 * 100}%`, top: `${rect.y / 1200 * 100}%`, width: `${rect.width / 1600 * 100}%`, height: `${rect.height / 1200 * 100}%` });
    this.range.value = String(this.placement.scale * 100);
    this.output.value = `${Math.round(this.placement.scale * 100)}%`;
  }

  move(event) {
    const gesture = this.gesture;
    if (!this.enabled || !gesture || gesture.id !== event.pointerId) return;
    event.preventDefault();
    const dx = (event.clientX - gesture.x) / gesture.bounds.width, dy = (event.clientY - gesture.y) / gesture.bounds.height;
    this.update(gesture.resizing ? resizeCapturePlacement(gesture.placement, this.capture.width, this.capture.height, dx, dy) : moveCapturePlacement(gesture.placement, dx, dy));
  }

  endGesture() {
    const id = this.gesture?.id;
    this.gesture = null;
    if (id !== undefined && this.frame.hasPointerCapture(id)) this.frame.releasePointerCapture(id);
  }

  setEnabled(enabled) {
    this.enabled = enabled && Boolean(this.capture);
    if (!this.enabled) this.endGesture();
    for (const control of [this.range, this.resetButton, this.handle]) control.disabled = !this.enabled;
    this.frame.setAttribute("aria-disabled", String(!this.enabled));
    this.frame.tabIndex = this.enabled ? 0 : -1;
  }

  clear() {
    this.endGesture();
    this.capture = null;
    this.image.removeAttribute("src");
    this.container.hidden = true;
    this.setEnabled(false);
  }
}
