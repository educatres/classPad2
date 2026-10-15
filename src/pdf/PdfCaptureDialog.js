import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { PDF_LIMITS } from "./limits.js";
import { boundedScale, pointerPosition, selectionPixels, selectionRect } from "./geometry.js";
import { compressCapture } from "./capture.js";
import { createCaptureDispatch, dispatchCapture } from "../firebase/materialRepository.js";
import { onValue, ref } from "firebase/database";
import { database } from "../firebase/config.js";
import { normalizeBoardPages } from "../whiteboard/pages.js";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function openPdfCaptureDialog({ classId, uid, isActive, onSuccess }) {
  const dialog = document.createElement("dialog"); dialog.className = "pdf-dialog";
  dialog.innerHTML = `<div class="dialog-head"><h2>PDF 題目派送</h2><button data-close aria-label="關閉">×</button></div>
    <p class="muted">PDF 原檔只在本機開啟；派送的截圖會暫存於課堂資料庫。每課堂最多 20 張，關閉視窗會清除未派送的截圖。</p>
    <div class="pdf-toolbar"><button data-open>開啟 PDF</button><input type="file" accept=".pdf,application/pdf" hidden>
    <button data-prev>上一頁</button><span data-page>尚未開啟 PDF</span><button data-next>下一頁</button>
    <button data-out>縮小</button><span data-zoom>100%</span><button data-in>放大</button></div>
    <div class="pdf-toolbar"><button data-browse aria-pressed="false">瀏覽</button><button data-select aria-pressed="true">框選</button><button data-all>選取整頁</button><button data-reset>重新框選</button></div>
    <div class="pdf-scroll"><div class="pdf-sheet selecting"><canvas></canvas><div class="pdf-selection" hidden></div></div></div>
    <div class="pdf-footer"><img data-preview alt="截圖預覽" hidden><div><p data-size>請開啟 PDF 並框選題目，或選取整頁。</p><p data-status role="status"></p><button data-cancel>取消選取</button><button data-dispatch class="primary" disabled>派送為新白板</button></div></div>`;
  document.body.append(dialog);
  const $ = (selector) => dialog.querySelector(selector), canvas = $("canvas"), sheet = $(".pdf-sheet"), selectionBox = $(".pdf-selection"), preview = $("[data-preview]"), status = $("[data-status]");
  let loadingTask, documentPdf, page, renderTask, cropTask, current = 1, zoom = 1, sequence = 0, cropSequence = 0, closed = false, busy = false, sending = false, online = false, browsing = false;
  let selection, drag, capture, previewUrl, operation;
  const message = (text) => { if (!closed) status.textContent = text; };
  const stopConnection = onValue(ref(database, ".info/connected"), (snapshot) => {
    online = snapshot.val() === true;
    if (sending && !online) message("派送結果尚未確認，正在等待連線恢復後確認是否已建立頁面。請保留此視窗。");
    controls();
  });
  function controls() {
    const active = isActive();
    for (const button of dialog.querySelectorAll("button")) button.disabled = sending;
    $("[data-open]").disabled = sending || busy;
    $("[data-dispatch]").disabled = sending || busy || !capture || !active || !online;
    $("[data-prev]").disabled = sending || busy || !documentPdf || current <= 1;
    $("[data-next]").disabled = sending || busy || !documentPdf || current >= documentPdf.numPages;
    for (const name of ["all", "reset", "out", "in"]) $(`[data-${name}]`).disabled = sending || busy || !page;
    $("[data-dispatch]").textContent = sending ? "正在派送…" : "派送為新白板";
  }
  const validityTimer = setInterval(() => { if (!isActive()) message("此課堂已結束或到期，無法派送題目。"); controls(); }, 1000);
  function clearSelection() {
    cropSequence++; cropTask?.cancel(); cropTask = null; drag = null; selection = null; capture = null; operation = null;
    selectionBox.hidden = true; preview.hidden = true; preview.removeAttribute("src");
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
    $("[data-size]").textContent = "請先框選題目範圍，或選取整頁。"; controls();
  }
  function drawSelection() {
    selectionBox.hidden = !selection;
    if (selection) Object.assign(selectionBox.style, { left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` });
  }
  async function prepareCapture() {
    const pixelRect = selectionPixels(selection, canvas.width, canvas.height);
    if (!pixelRect || !page) { clearSelection(); message("請先框選題目範圍，或選取整頁。"); return; }
    const job = ++cropSequence, activePage = page, region = { ...selection }, output = document.createElement("canvas");
    busy = true; controls(); message("正在建立截圖暫存…");
    try {
      const base = activePage.getViewport({ scale: 1 });
      const scale = Math.min(4, PDF_LIMITS.captureEdge / Math.max(base.width * region.width, base.height * region.height));
      const viewport = activePage.getViewport({ scale });
      output.width = Math.max(1, Math.floor(viewport.width * region.width)); output.height = Math.max(1, Math.floor(viewport.height * region.height));
      cropTask = activePage.render({ canvas: output, canvasContext: output.getContext("2d"), viewport, transform: [1, 0, 0, 1, -region.x * viewport.width, -region.y * viewport.height], background: "white" });
      await cropTask.promise;
      const result = await compressCapture(output);
      if (closed || job !== cropSequence) return;
      capture = result; operation = null; previewUrl = URL.createObjectURL(result.blob); preview.src = previewUrl; preview.hidden = false;
      $("[data-size]").textContent = `${result.width} × ${result.height} 像素・${(result.byteLength / 1024).toFixed(1)} KiB（上限 256 KiB）`;
      message("截圖已暫存在此視窗，確認預覽後即可派送。");
    } catch (error) { if (!closed && job === cropSequence && error.name !== "RenderingCancelledException") message(error.message || "無法產生截圖，請重新框選。"); }
    finally { output.width = output.height = 0; if (job === cropSequence && !closed) { busy = false; controls(); } }
  }
  async function renderPage() {
    const job = ++sequence; clearSelection(); renderTask?.cancel(); busy = true; controls(); message("正在顯示 PDF…");
    try {
      const previousTask = renderTask; if (previousTask) await previousTask.promise.catch(() => {});
      page?.cleanup(); page = await documentPdf.getPage(current);
      if (closed || job !== sequence) return;
      const base = page.getViewport({ scale: 1 }), available = Math.max(240, $(".pdf-scroll").clientWidth - 32);
      const cssScale = available / base.width * zoom, renderScale = boundedScale(base.width, base.height, cssScale * Math.min(devicePixelRatio || 1, 2));
      const viewport = page.getViewport({ scale: renderScale });
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${base.width * cssScale}px`; canvas.style.height = `${base.height * cssScale}px`;
      renderTask = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, background: "white" });
      await renderTask.promise;
      if (closed || job !== sequence) return;
      $("[data-page]").textContent = `第 ${current} / ${documentPdf.numPages} 頁`; $("[data-zoom]").textContent = `${Math.round(zoom * 100)}%`; message("");
    } catch (error) { if (!closed && job === sequence && error.name !== "RenderingCancelledException") message("此檔案不是可讀取的 PDF，請重新選擇。"); }
    finally { if (!closed && job === sequence) { busy = false; controls(); } }
  }
  async function destroyPdf() {
    sequence++; cropSequence++; renderTask?.cancel(); cropTask?.cancel();
    await Promise.allSettled([renderTask?.promise, cropTask?.promise]); renderTask = cropTask = null;
    page?.cleanup(); page = null;
    await loadingTask?.destroy(); loadingTask = documentPdf = null;
    canvas.width = canvas.height = 0;
  }
  $("input").onchange = async (event) => {
    const file = event.target.files[0]; event.target.value = ""; if (!file) return;
    if (file.size > PDF_LIMITS.fileBytes) { message("PDF 超過 30 MiB，請先縮小檔案。"); return; }
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { message("此檔案不是可讀取的 PDF，請重新選擇。"); return; }
    busy = true; controls(); clearSelection();
    try {
      await destroyPdf(); if (closed) return;
      const job = ++sequence, data = new Uint8Array(await file.arrayBuffer());
      if (closed || sequence !== job) return;
      const assets = `${import.meta.env.BASE_URL}pdf-assets/`;
      loadingTask = pdfjs.getDocument({ data, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`, isEvalSupported: false, enableXfa: false, useSystemFonts: true });
      loadingTask.onPassword = () => { message("此 PDF 需要密碼，目前不支援，請先解除加密。"); loadingTask?.destroy(); };
      documentPdf = await loadingTask.promise;
      if (closed || sequence !== job) return;
      if (documentPdf.numPages > PDF_LIMITS.pages) { await destroyPdf(); message("PDF 超過 200 頁，請先拆分文件。"); return; }
      current = 1; zoom = 1; await renderPage();
    } catch (error) { if (!closed) { const password = error.name === "PasswordException" || status.textContent.includes("需要密碼"); await destroyPdf().catch(() => {}); message(password ? "此 PDF 需要密碼，目前不支援，請先解除加密。" : "此檔案不是可讀取的 PDF，請重新選擇。"); } }
    finally { busy = false; controls(); }
  };
  function mode(value) { browsing = value; sheet.classList.toggle("selecting", !value); $("[data-browse]").setAttribute("aria-pressed", String(value)); $("[data-select]").setAttribute("aria-pressed", String(!value)); }
  $("[data-open]").onclick = () => $("input").click();
  $("[data-prev]").onclick = () => { current--; renderPage(); }; $("[data-next]").onclick = () => { current++; renderPage(); };
  $("[data-out]").onclick = () => { zoom = Math.max(.5, zoom - .25); renderPage(); }; $("[data-in]").onclick = () => { zoom = Math.min(3, zoom + .25); renderPage(); };
  $("[data-browse]").onclick = () => mode(true); $("[data-select]").onclick = () => mode(false);
  $("[data-all]").onclick = () => { clearSelection(); selection = { x: 0, y: 0, width: 1, height: 1 }; drawSelection(); prepareCapture(); };
  $("[data-reset]").onclick = $("[data-cancel]").onclick = () => { clearSelection(); busy = false; mode(false); controls(); };
  canvas.onpointerdown = (event) => {
    if (browsing || busy || sending || !page || drag || event.isPrimary === false) return;
    event.preventDefault(); clearSelection(); canvas.setPointerCapture(event.pointerId); drag = { id: event.pointerId, start: pointerPosition(event, canvas.getBoundingClientRect()) };
  };
  canvas.onpointermove = (event) => { if (!drag || event.pointerId !== drag.id) return; event.preventDefault(); selection = selectionRect(drag.start, pointerPosition(event, canvas.getBoundingClientRect())); drawSelection(); };
  canvas.onpointerup = (event) => { if (!drag || event.pointerId !== drag.id) return; selection = selectionRect(drag.start, pointerPosition(event, canvas.getBoundingClientRect())); drag = null; canvas.releasePointerCapture?.(event.pointerId); drawSelection(); prepareCapture(); };
  canvas.onpointercancel = () => { clearSelection(); busy = false; controls(); };
  $("[data-dispatch]").onclick = async () => {
    if (sending || !capture || busy) return;
    if (!online) { message("目前離線，請恢復連線後再派送。"); return; }
    if (!isActive()) { message("此課堂已結束或到期，無法派送題目。"); return; }
    operation ||= createCaptureDispatch(capture, uid); sending = true; controls(); message("正在派送…");
    try {
      const result = await dispatchCapture(classId, operation, uid);
      const number = normalizeBoardPages(result.classroom.boardPages).findIndex((p) => p.id === result.pageId) + 1;
      clearSelection(); message(`已新增第 ${number} 頁，學生可開啟作答。${result.reconciliationError ? "名單同步尚未完成，請重新開啟管理頁以補齊新加入學生的頁面。" : ""}`); onSuccess?.(result);
    } catch (error) {
      const known = typeof error.message === "string" && /[\u3400-\u9fff]/.test(error.message);
      message(error.code === "PERMISSION_DENIED" ? "派送未完成，請確認課堂管理權限後，以同一截圖重試。" : known ? error.message : "派送結果尚未確認，請恢復連線後以同一截圖重試。");
    }
    finally { sending = false; controls(); }
  };
  async function close() {
    if (sending) { message("正在等待派送確認，請保留此視窗。"); return; }
    if (closed) return; closed = true; clearInterval(validityTimer); stopConnection(); clearSelection(); dialog.close(); await destroyPdf().catch(() => {}); dialog.remove();
  }
  $("[data-close]").onclick = close; dialog.oncancel = (event) => { event.preventDefault(); close(); };
  const onHide = () => { sending = false; close(); }; addEventListener("pagehide", onHide, { once: true });
  dialog.addEventListener("close", () => removeEventListener("pagehide", onHide), { once: true });
  dialog.showModal(); controls();
  return { close };
}
