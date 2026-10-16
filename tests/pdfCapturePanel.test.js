import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createCaptureDispatch: vi.fn(), dispatchCapture: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ GlobalWorkerOptions: {} }));
vi.mock("../src/firebase/config.js", () => ({ database: {} }));
vi.mock("../src/firebase/materialRepository.js", () => mocks);
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
