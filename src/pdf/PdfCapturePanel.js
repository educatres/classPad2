import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { onValue, ref } from "firebase/database";
import { database } from "../firebase/config.js";
import { createCaptureDispatch, dispatchCapture } from "../firebase/materialRepository.js";
import { normalizeBoardPages } from "../whiteboard/pages.js";
import { PDF_LIMITS } from "./limits.js";
import { compressCapture } from "./capture.js";
import { CapturePlacementEditor } from "./CapturePlacementEditor.js";
import { PdfPageViewer } from "./PdfPageViewer.js";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfCapturePanel {
  constructor(container, { classId, uid, isActive, onHide, onSuccess, session }) {
    Object.assign(this, { container, classId, uid, isActive, onSuccess, session });
    this.sequence = 0; this.visible = true;
    container.innerHTML = `<div class="pdf-panel-tools"><div class="pdf-toolbar" role="group" aria-label="PDF 閱讀與截圖工具，可左右滑動" tabindex="0"><button data-hide type="button" class="pdf-icon-tool" aria-label="隱藏 PDF 面板" title="隱藏 PDF 面板">‹</button><button data-help-toggle type="button" class="pdf-icon-tool" aria-label="PDF 操作說明" title="PDF 操作說明" aria-expanded="false" aria-controls="pdfHelpContent">ⓘ</button><button data-open type="button" class="primary" aria-label="載入 PDF" title="載入 PDF">載入</button><input type="file" accept=".pdf,application/pdf" hidden>
        <div class="pdf-page-controls"><label class="pdf-page-jump"><input data-jump type="number" min="1" value="1" inputmode="numeric" aria-label="跳至 PDF 頁碼" title="輸入 PDF 頁碼，按 Enter 或右箭頭跳頁"><span data-count>／0</span></label><button data-go type="button" class="pdf-icon-tool" aria-label="跳至指定 PDF 頁碼" title="跳至指定 PDF 頁碼">→</button></div>
        <button data-zoom-toggle type="button" aria-label="調整 PDF 縮放，目前 100%" title="調整 PDF 縮放，目前 100%" aria-expanded="false" aria-controls="pdfZoomMenu">100%</button>
        <button data-browse type="button" title="瀏覽 PDF，可上下捲動" aria-pressed="true">瀏覽</button><button data-select type="button" aria-label="框選 PDF 截圖" title="框選 PDF 截圖" aria-pressed="false">框選</button><button data-all type="button" aria-label="截取目前 PDF 整頁" title="截取目前 PDF 整頁">整頁</button></div>
        <div id="pdfHelpContent" class="pdf-help-content" hidden><p>PDF 僅在本機開啟；同一分頁切換功能、隱藏面板或重新整理後保留 PDF 與閱讀位置，關閉分頁後需重新選檔。每課堂最多派送 20 張。</p><p>派送會在學生與老師講解白板末尾各新增一頁，保留目前頁面與既有筆跡。</p><p data-mode>上下滑動閱讀所有頁面；要擷取題目時請切換「框選」。</p><p>窄面板可左右滑動工具列；點縮放比例可放大、縮小或符合寬度。</p></div>
        <div id="pdfZoomMenu" class="pdf-zoom-menu" role="group" aria-label="PDF 縮放設定" hidden><button data-out type="button" class="pdf-icon-tool" aria-label="縮小 PDF" title="縮小 PDF">−</button><output data-zoom aria-label="PDF 縮放比例">100%</output><button data-in type="button" class="pdf-icon-tool" aria-label="放大 PDF" title="放大 PDF">＋</button><button data-fit type="button" aria-label="PDF 符合寬度" title="PDF 符合寬度">符合</button></div></div>
      <div class="pdf-continuous-scroll" tabindex="0" aria-label="PDF 連續頁面，可上下捲動"><p data-empty class="pdf-empty">載入 PDF 後，可上下滑動查看每一頁。</p></div>
      <div class="pdf-panel-footer"><p data-status role="status" aria-live="polite"></p><button data-preview type="button" class="primary" disabled>檢視截圖與派送</button></div>`;
    this.$ = (selector) => container.querySelector(selector);
    this.dialog = document.createElement("dialog"); this.dialog.className = "pdf-dialog pdf-dispatch-dialog";
    this.dialog.setAttribute("aria-labelledby", "pdfPreviewTitle");
    this.dialog.innerHTML = `<div class="dialog-head"><h2 id="pdfPreviewTitle">派送題目預覽</h2><button data-later type="button">稍後派送</button></div><section data-layout class="pdf-layout" hidden></section>
      <p>派送後，在學生與老師講解白板末尾各新增一頁，保留目前頁面與既有內容。</p><p data-size></p><p data-status role="status" aria-live="polite"></p><div class="dialog-actions"><button data-discard type="button">取消截圖</button><button data-dispatch type="button" class="primary" disabled>派送為新白板</button></div>`;
    document.body.append(this.dialog);
    this.$$ = (selector) => this.dialog.querySelector(selector);
    this.editor = new CapturePlacementEditor(this.$$('[data-layout]'), () => { this.clearCapture(); this.setBrowsing(false); this.message("請重新框選題目範圍，或截取目前整頁。"); });
    this.viewer = new PdfPageViewer(this.$(".pdf-continuous-scroll"), {
      onSelect: (selection) => this.prepareCapture(selection), onPageChange: (number) => { this.$("[data-jump]").value = number; }, onError: (text) => this.message(text),
      onViewChange: () => { clearTimeout(this.viewTimer); this.viewTimer = setTimeout(() => this.remember(), 120); }
    });
    this.$("[data-hide]").onclick = onHide;
    this.$("[data-open]").onclick = () => this.$("input[type=file]").click();
    this.$("input[type=file]").onchange = (event) => { const file = event.target.files[0]; event.target.value = ""; if (file) this.load(file); };
    this.$("[data-go]").onclick = () => this.viewer.jump(this.$("[data-jump]").value);
    this.$("[data-jump]").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); this.viewer.jump(event.target.value); } };
    this.$("[data-out]").onclick = () => this.zoom(this.viewer.zoom - .25);
    this.$("[data-in]").onclick = () => this.zoom(this.viewer.zoom + .25);
    this.$("[data-fit]").onclick = () => this.zoom(1);
    this.$("[data-zoom-toggle]").onclick = () => this.setZoomMenu(this.$(".pdf-zoom-menu").hidden);
    this.$("[data-help-toggle]").onclick = () => this.setHelpMenu(this.$(".pdf-help-content").hidden);
    this.$("[data-browse]").onclick = () => this.setBrowsing(true);
    this.$("[data-select]").onclick = () => this.setBrowsing(false);
    this.$("[data-all]").onclick = () => this.viewer.selectAll();
    this.$("[data-preview]").onclick = () => this.showPreview();
    this.$$("[data-later]").onclick = () => this.dialog.close();
    this.$$("[data-discard]").onclick = () => {
      if (this.operation && !confirm("派送結果尚未確認。取消只會清除本機截圖，不會撤回已建立的學生與講解頁面。請先查看兩邊頁面，確定仍要取消？")) return;
      this.clearCapture(); this.message("已取消本機截圖，可繼續閱讀 PDF。");
    };
    this.$$("[data-dispatch]").onclick = () => this.dispatch();
    this.dialog.oncancel = (event) => { event.preventDefault(); this.dialog.close(); };
    this.stopConnection = onValue(ref(database, ".info/connected"), (snapshot) => {
      this.online = snapshot.val() === true;
      if (this.sending && !this.online) this.message("派送結果尚未確認，請保留此頁，等待連線恢復後確認。");
      this.controls();
    });
    this.timer = setInterval(() => this.refresh(), 1000); this.refresh();
    this.visibilityListener = () => { if (document.visibilityState === "hidden") this.remember(); };
    document.addEventListener("visibilitychange", this.visibilityListener);
    this.outsideToolsListener = (event) => {
      if (!this.$(".pdf-zoom-menu").contains(event.target) && !this.$("[data-zoom-toggle]").contains(event.target)) this.setZoomMenu(false);
      if (!this.$(".pdf-help-content").contains(event.target) && !this.$("[data-help-toggle]").contains(event.target)) this.setHelpMenu(false);
    };
    this.toolsKeyListener = (event) => {
      if (event.key !== "Escape") return;
      const zoomOpen = !this.$(".pdf-zoom-menu").hidden, helpOpen = !this.$(".pdf-help-content").hidden;
      if (!zoomOpen && !helpOpen) return;
      event.preventDefault(); event.stopPropagation(); this.setZoomMenu(false); this.setHelpMenu(false);
      this.$(zoomOpen ? "[data-zoom-toggle]" : "[data-help-toggle]").focus();
    };
    document.addEventListener("pointerdown", this.outsideToolsListener);
    container.addEventListener("keydown", this.toolsKeyListener);
  }

  message(text) {
    if (this.destroyed) return;
    this.$("[data-status]").textContent = this.$$("[data-status]").textContent = text;
  }
  refresh() {
    const active = this.isActive();
    if (this.active !== active && !active) this.message("此課堂已結束、到期或權限已變更，無法派送題目。");
    this.active = active; this.controls();
  }
  controls() {
    if (this.destroyed || !this.viewer) return;
    const locked = Boolean(this.busy || this.restoring || this.sending || this.operation), hasPdf = Boolean(this.pdf);
    this.$("[data-open]").disabled = locked;
    for (const name of ["out", "in", "fit", "zoom-toggle", "browse", "select", "all", "go", "jump"]) this.$(`[data-${name}]`).disabled = !hasPdf || this.busy || this.sending || (name === "all" && Boolean(this.capture));
    this.$("[data-preview]").disabled = !this.capture || this.busy;
    this.$$("[data-dispatch]").disabled = !this.capture || this.busy || this.sending || !this.online || !this.isActive();
    this.$$("[data-dispatch]").textContent = this.sending ? "正在派送…" : this.operation ? "以同一截圖重試派送" : "派送為新白板";
    this.$$("[data-discard]").disabled = Boolean(this.sending);
    this.editor.backButton.disabled = Boolean(this.sending || this.operation);
    this.editor.setEnabled(!locked && this.isActive());
    this.viewer.setEnabled(!locked && !this.capture);
  }
  setBrowsing(value) {
    this.viewer.setBrowsing(value);
    this.$("[data-browse]").setAttribute("aria-pressed", String(value)); this.$("[data-select]").setAttribute("aria-pressed", String(!value));
    this.$("[data-mode]").textContent = value ? "上下滑動閱讀所有頁面；要擷取題目時請切換「框選」。" : "在單一頁面拖曳框選；如需上下滑動，請切回「瀏覽」。";
  }
  renderZoom() {
    const value = `${Math.round(this.viewer.zoom * 100)}%`, label = `調整 PDF 縮放，目前 ${value}`;
    this.$("[data-zoom]").textContent = this.$("[data-zoom-toggle]").textContent = value;
    this.$("[data-zoom-toggle]").setAttribute("aria-label", label); this.$("[data-zoom-toggle]").title = label;
  }
  zoom(value) { this.viewer.setZoom(value); this.renderZoom(); }
  setZoomMenu(value) {
    this.$(".pdf-zoom-menu").hidden = !value;
    this.$("[data-zoom-toggle]").setAttribute("aria-expanded", String(value));
    if (value) this.setHelpMenu(false);
  }
  setHelpMenu(value) {
    this.$(".pdf-help-content").hidden = !value;
    this.$("[data-help-toggle]").setAttribute("aria-expanded", String(value));
    if (value) this.setZoomMenu(false);
  }
  setVisible(value) {
    this.visible = value; this.viewer.setVisible(value); this.remember();
    if (!value) { this.setZoomMenu(false); this.setHelpMenu(false); if (this.dialog.open) this.dialog.close(); }
  }
  get hasPending() { return Boolean(this.busy || this.restoring || this.capture || this.sending || this.operation); }

  remember() {
    if (!this.persisted || this.busy || !this.pdf || this.destroyed) return;
    try { this.session?.remember({ view: this.viewer.getView(), open: this.visible }); }
    catch { this.message("無法保存 PDF 閱讀位置；請檢查瀏覽器是否允許本機暫存。"); }
  }

  async restore() {
    if (!this.session?.state) return;
    this.restoring = true; this.controls(); this.message("正在還原 PDF 與閱讀位置…");
    try {
      const saved = await this.session.read();
      if (this.destroyed) return;
      this.restoring = false;
      if (saved) await this.load(saved.file, { restoring: true, view: saved.view });
      else this.message("PDF 暫存已被瀏覽器清除，請重新載入 PDF。");
    } catch {
      await this.session.clear().catch(() => {});
      this.message("無法還原 PDF 暫存，請重新載入 PDF。");
    } finally { this.restoring = false; this.controls(); }
  }

  async load(file, { restoring = false, view } = {}) {
    if (this.busy || this.restoring || this.sending || this.operation) return;
    if (file.size > PDF_LIMITS.fileBytes) { this.message("PDF 超過 30 MiB，請先縮小檔案。"); return; }
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { this.message("此檔案不是可讀取的 PDF，請重新選擇。"); return; }
    if (this.capture && !confirm("更換 PDF 會清除尚未派送的截圖，確定更換？")) return;
    this.clearCapture(); this.busy = true; this.controls(); this.message("正在載入 PDF 頁面…");
    const job = ++this.sequence;
    let nextTask, passwordRequired = false;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      if (this.destroyed || job !== this.sequence) return;
      const assets = `${import.meta.env.BASE_URL}pdf-assets/`;
      this.pendingTask = nextTask = pdfjs.getDocument({ data, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`, isEvalSupported: false, enableXfa: false, useSystemFonts: true });
      // Reject encrypted input without leaving a password request or worker alive.
      nextTask.onPassword = () => { passwordRequired = true; nextTask.destroy(); };
      const nextPdf = await nextTask.promise;
      if (this.destroyed || job !== this.sequence) return;
      if (nextPdf.numPages > PDF_LIMITS.pages) { this.message("PDF 超過 200 頁，請先拆分文件。"); return; }
      // Keep the existing document and its cache if the replacement is invalid.
      await this.destroyPdf();
      if (this.destroyed || job !== this.sequence) return;
      this.loadingTask = nextTask; this.pdf = nextPdf; this.persisted = false;
      await this.viewer.setDocument(this.pdf);
      if (this.destroyed || job !== this.sequence) return;
      this.$("[data-count]").textContent = `／${this.pdf.numPages}`; this.$("[data-jump]").max = this.pdf.numPages; this.$("[data-jump]").value = 1;
      this.$("[data-open]").textContent = "更換"; this.$("[data-open]").setAttribute("aria-label", "更換 PDF"); this.$("[data-open]").title = "更換 PDF"; this.$("[data-empty]").hidden = true;
      if (restoring) this.viewer.restoreView(view);
      this.renderZoom();
      this.setBrowsing(true);
      let warning = "";
      if (this.session) {
        try {
          if (!restoring) await this.session.save(file, { view: this.viewer.getView(), open: this.visible });
          this.persisted = true;
        } catch {
          await this.session.clear().catch(() => {});
          warning = " 瀏覽器無法暫存此 PDF，切換功能後需重新選檔；請確認本機儲存空間與瀏覽器設定。";
        }
      }
      this.message(`${restoring ? "已還原" : "已載入"} ${this.pdf.numPages} 頁，可上下滑動閱讀。${warning}`);
    } catch (error) {
      if (!this.destroyed && job === this.sequence) {
        if (this.loadingTask === nextTask) await this.destroyPdf();
        this.message(passwordRequired || error.name === "PasswordException" ? "此 PDF 需要密碼，目前不支援，請先解除加密。" : "此檔案不是可讀取的 PDF，請重新選擇。");
      }
    } finally {
      if (nextTask !== this.loadingTask) await nextTask?.destroy().catch(() => {});
      if (this.pendingTask === nextTask) this.pendingTask = null;
      if (job === this.sequence && !this.destroyed) { this.busy = false; this.remember(); this.controls(); }
    }
  }

  async prepareCapture({ number, region }) {
    if (this.busy || this.capture || this.sending || !this.pdf) return;
    const job = ++this.sequence, output = document.createElement("canvas");
    this.busy = true; this.controls(); this.message("正在從原始 PDF 建立截圖…");
    let page;
    try {
      page = await this.pdf.getPage(number);
      if (this.destroyed || job !== this.sequence) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, PDF_LIMITS.captureEdge / Math.max(base.width * region.width, base.height * region.height));
      const viewport = page.getViewport({ scale });
      output.width = Math.max(1, Math.floor(viewport.width * region.width)); output.height = Math.max(1, Math.floor(viewport.height * region.height));
      this.cropTask = page.render({ canvas: output, canvasContext: output.getContext("2d"), viewport, transform: [1, 0, 0, 1, -region.x * viewport.width, -region.y * viewport.height], background: "white" });
      await this.cropTask.promise;
      const capture = await compressCapture(output);
      if (this.destroyed || job !== this.sequence) return;
      this.capture = capture; this.previewUrl = URL.createObjectURL(capture.blob);
      this.showPreview(); this.editor.setCapture(capture, this.previewUrl);
      this.$$("[data-size]").textContent = `PDF 第 ${number} 頁・${capture.width} × ${capture.height} 像素・${(capture.byteLength / 1024).toFixed(1)} KiB（上限 256 KiB）`;
      this.message("請調整題目在學生白板上的大小與位置，確認後再派送。也可稍後派送，繼續閱讀 PDF。");
    } catch (error) { if (!this.destroyed && error.name !== "RenderingCancelledException") this.message("截圖產生失敗，請重新框選或縮小選取範圍。"); }
    finally { output.width = output.height = 0; page?.cleanup(); this.cropTask = null; if (job === this.sequence && !this.destroyed) { this.busy = false; this.controls(); } }
  }
  showPreview() { if (this.visible && this.capture && !this.dialog.open) this.dialog.showModal(); }
  clearCapture() {
    this.capture = this.operation = null; this.editor.clear(); this.viewer.clearSelection();
    if (this.dialog.open) this.dialog.close();
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl); this.previewUrl = null;
    this.controls();
  }
  async dispatch() {
    if (this.sending || this.busy || !this.capture) return;
    if (!this.online) { this.message("目前離線，請恢復連線後再派送。"); return; }
    if (!this.isActive()) { this.refresh(); return; }
    this.operation ||= createCaptureDispatch(this.capture, this.uid, this.editor.value);
    this.sending = true; this.controls(); this.message("正在派送，等待確認…");
    try {
      const result = await dispatchCapture(this.classId, this.operation, this.uid);
      if (this.destroyed) return;
      const number = normalizeBoardPages(result.classroom.boardPages).findIndex((page) => page.id === result.pageId) + 1;
      this.clearCapture(); this.setBrowsing(true);
      this.message(`已新增學生第 ${number} 頁、老師講解第 ${result.lecturePageNumber} 頁，可翻頁開啟題目。${result.reconciliationError ? "名單同步尚未完成，請重新開啟課堂設定以補齊新加入學生的頁面。" : ""}`);
      this.onSuccess?.(result);
    } catch (error) {
      const known = typeof error.message === "string" && /[\u3400-\u9fff]/.test(error.message);
      this.message(/permission[_ -]denied/i.test(error.code || "") ? "派送未完成，請確認管理權限後，以同一截圖重試。" : known ? error.message : "派送結果尚未確認，請恢復連線後以同一截圖重試。");
    } finally { this.sending = false; this.controls(); }
  }
  async destroyPdf() {
    this.viewer.reset(); this.cropTask?.cancel(); await this.cropTask?.promise.catch(() => {});
    await this.loadingTask?.destroy().catch(() => {}); this.loadingTask = this.pdf = null; this.passwordRequired = false;
    this.$("[data-empty]").hidden = false; this.$("[data-count]").textContent = "／0";
  }
  destroy() {
    if (this.destroyed) return;
    this.remember(); clearTimeout(this.viewTimer); document.removeEventListener("visibilitychange", this.visibilityListener);
    document.removeEventListener("pointerdown", this.outsideToolsListener); this.container.removeEventListener("keydown", this.toolsKeyListener);
    this.destroyed = true; this.sequence++; clearInterval(this.timer); this.stopConnection(); this.viewer.destroy();
    this.pendingTask?.destroy().catch(() => {});
    this.editor.clear(); this.dialog.close(); this.dialog.remove();
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    return this.destroyPdf();
  }
}
