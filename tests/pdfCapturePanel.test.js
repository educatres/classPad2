import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createCaptureDispatch: vi.fn(), dispatchCapture: vi.fn(), getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ GlobalWorkerOptions: {}, getDocument: mocks.getDocument }));
vi.mock("../src/firebase/config.js", () => ({ database: {} }));
vi.mock("../src/firebase/materialRepository.js", () => ({ createCaptureDispatch: mocks.createCaptureDispatch, dispatchCapture: mocks.dispatchCapture }));
import { PdfCapturePanel } from "../src/pdf/PdfCapturePanel.js";

function makePanel() {
  const capture = { width: 1600, height: 800 }, placement = { scale: .65, x: .4, y: .5 };
  return Object.assign(Object.create(PdfCapturePanel.prototype), {
    classId: "test-class", uid: "teacher", online: true, visible: true, sequence: 0,
    capture, editor: { value: placement }, isActive: () => true, controls: vi.fn(), message: vi.fn(), setBrowsing: vi.fn(), onSuccess: vi.fn(),
    dialog: { open: true, close: vi.fn(), showModal: vi.fn() }, viewer: { setVisible: vi.fn() },
    clearCapture: vi.fn(function () { this.capture = this.operation = null; })
  });
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.createCaptureDispatch.mockImplementation(() => ({ pageId: "page_STABLE1" }));
  mocks.dispatchCapture.mockResolvedValue({ pageId: "page_STABLE1", classroom: { boardPages: { main: { id: "main", order: 0 }, page_STABLE1: { id: "page_STABLE1", order: 1 } } } });
});

function makeLoadPanel() {
  const panel = makePanel(), elements = new Map();
  panel.capture = null;
  panel.$ = (selector) => { if (!elements.has(selector)) elements.set(selector, {}); return elements.get(selector); };
  panel.session = { save: vi.fn(async () => {}), remember: vi.fn(), clear: vi.fn(async () => {}) };
  panel.viewer = { zoom: 1, setDocument: vi.fn(async () => {}), restoreView: vi.fn(function (view) { this.zoom = view.zoom; }), getView: () => ({ zoom: 1, anchor: null, left: 0 }) };
  panel.destroyPdf = vi.fn(async () => { panel.pdf = panel.loadingTask = null; });
  return panel;
}

describe("PDF 面板跨頁還原", () => {
  const file = new File(["%PDF-source"], "test.pdf", { type: "application/pdf" });
  it("還原已保存 PDF 與縮放位置，不重新寫入檔案；目前開啟狀態會被記住", async () => {
    const panel = makeLoadPanel(), view = { zoom: 1.75, anchor: { number: 8, fraction: .3 }, left: .4 };
    panel.session.state = {}; panel.session.read = vi.fn(async () => ({ file, view }));
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 10 }), destroy: vi.fn(async () => {}) });
    await panel.restore();
    expect(panel.viewer.restoreView).toHaveBeenCalledWith(view); expect(panel.$("[data-zoom]").textContent).toBe("175%");
    expect(panel.session.save).not.toHaveBeenCalled(); expect(panel.session.remember).toHaveBeenCalledWith(expect.objectContaining({ open: true }));
    expect(panel.hasPending).toBe(false); expect(panel.persisted).toBe(true);
  });
  it("損壞或頁數超限的更換檔案不會清除原 PDF 或其暫存", async () => {
    for (const promise of [Promise.reject(new Error("invalid")), Promise.resolve({ numPages: 201 })]) {
      const panel = makeLoadPanel(), original = { numPages: 5 }; panel.pdf = original; panel.persisted = true;
      const destroy = vi.fn(async () => {}); mocks.getDocument.mockReturnValue({ promise, destroy });
      await panel.load(file);
      expect(panel.pdf).toBe(original); expect(panel.destroyPdf).not.toHaveBeenCalled(); expect(panel.session.save).not.toHaveBeenCalled();
      expect(destroy).toHaveBeenCalledOnce();
    }
  });
  it("新文件可以閱讀但暫存失敗時顯示中文提示，並清除舊暫存避免下次還原錯誤文件", async () => {
    const panel = makeLoadPanel(); panel.session.save.mockRejectedValueOnce(new Error("quota"));
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 3 }), destroy: vi.fn(async () => {}) });
    await panel.load(file);
    expect(panel.pdf.numPages).toBe(3); expect(panel.persisted).toBe(false); expect(panel.session.clear).toHaveBeenCalledOnce();
    expect(panel.message).toHaveBeenLastCalledWith(expect.stringContaining("瀏覽器無法暫存此 PDF"));
  });
});

describe("PDF 面板派送狀態", () => {
  it("隱藏保留截圖與擺放位置，背景完成截圖時不強制重開預覽", () => {
    const panel = makePanel(), capture = panel.capture, placement = panel.editor.value;
    panel.setVisible(false); panel.showPreview();
    expect(panel.viewer.setVisible).toHaveBeenCalledWith(false); expect(panel.dialog.close).toHaveBeenCalledOnce();
    expect(panel.dialog.showModal).not.toHaveBeenCalled();
    expect(panel.capture).toBe(capture); expect(panel.editor.value).toBe(placement); expect(panel.hasPending).toBe(true);
    panel.setVisible(true); expect(panel.capture).toBe(capture);
  });
  it("回應遺失後保留相同派送 ID，重試及連點不會建立第二個操作", async () => {
    const panel = makePanel(); mocks.dispatchCapture.mockRejectedValueOnce(new Error("response lost"));
    await panel.dispatch(); const operation = panel.operation;
    expect(operation).toBeTruthy(); expect(panel.hasPending).toBe(true); expect(panel.clearCapture).not.toHaveBeenCalled();
    expect(panel.message).toHaveBeenLastCalledWith(expect.stringContaining("同一截圖重試"));
    await Promise.all([panel.dispatch(), panel.dispatch()]);
    expect(mocks.createCaptureDispatch).toHaveBeenCalledOnce();
    expect(mocks.dispatchCapture.mock.calls.map((call) => call[1])).toEqual([operation, operation]);
    expect(panel.clearCapture).toHaveBeenCalledOnce(); expect(panel.hasPending).toBe(false);
    expect(panel.message).toHaveBeenLastCalledWith(expect.stringContaining("學生第 2 頁"));
  });
  it("離線或失去有效課堂權限時不建立派送操作", async () => {
    const panel = makePanel(); panel.online = false; await panel.dispatch();
    expect(panel.message).toHaveBeenLastCalledWith(expect.stringContaining("離線"));
    panel.online = true; panel.isActive = () => false; panel.refresh = vi.fn(); await panel.dispatch();
    expect(panel.refresh).toHaveBeenCalledOnce(); expect(mocks.createCaptureDispatch).not.toHaveBeenCalled(); expect(mocks.dispatchCapture).not.toHaveBeenCalled();
  });
  it("已離開頁面後收到成功回應，不操作已移除的畫面", async () => {
    const panel = makePanel(); let resolve;
    mocks.dispatchCapture.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const work = panel.dispatch(); panel.destroyed = true; resolve({}); await work;
    expect(panel.clearCapture).not.toHaveBeenCalled(); expect(panel.onSuccess).not.toHaveBeenCalled();
  });
});
