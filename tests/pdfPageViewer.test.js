import { afterEach, describe, expect, it, vi } from "vitest";
import { layoutPdfPages, pdfScrollAnchor, restorePdfAnchor, sidebarWidth, visiblePdfPages } from "../src/pdf/pageLayout.js";
import { PdfPageViewer } from "../src/pdf/PdfPageViewer.js";

afterEach(() => vi.unstubAllGlobals());

describe("PDF 連續閱讀版面", () => {
  const sizes = Array.from({ length: 200 }, (_, index) => index % 3 ? { width: 595, height: 842 } : { width: 842, height: 595 });
  it("保留全部 200 頁位置與橫直頁比例，捲動時最多只繪製五頁", () => {
    const layout = layoutPdfPages(sizes, 360);
    expect(layout).toHaveLength(200);
    for (let index = 0; index < layout.length; index++) {
      const entry = layout[index];
      expect(entry.width / entry.height).toBeCloseTo(sizes[index].width / sizes[index].height);
      if (index) expect(entry.top).toBeGreaterThan(layout[index - 1].bottom);
    }
    for (const top of [0, layout[99].top, layout[199].top]) {
      const visible = visiblePdfPages(layout, top, 1200);
      expect(visible.length).toBeLessThanOrEqual(5);
      expect(visible).toContain(top === 0 ? 1 : top === layout[99].top ? 100 : 200);
    }
  });
  it("面板改寬、PDF 縮放後仍停留在相同頁面的相同比例位置", () => {
    const original = layoutPdfPages(sizes, 350), top = original[120].top + original[120].height * .4;
    const anchor = pdfScrollAnchor(original, top);
    expect(anchor.number).toBe(121);
    for (const changed of [layoutPdfPages(sizes, 700), layoutPdfPages(sizes, 350, 2.5)]) {
      const restored = pdfScrollAnchor(changed, restorePdfAnchor(changed, anchor));
      expect(restored.number).toBe(anchor.number);
      expect(restored.fraction).toBeCloseTo(anchor.fraction, 10);
    }
    expect(restorePdfAnchor([], null)).toBe(0);
  });
  it("側欄寬度限制同時留下白板空間，無效偏好採預設值", () => {
    expect(sidebarWidth(null, 1200)).toBe(420);
    expect(sidebarWidth(-20, 1200)).toBe(280);
    expect(sidebarWidth(3000, 1200)).toBe(720);
    expect(sidebarWidth(800, 900)).toBe(540);
    expect(sidebarWidth("bad", 1200)).toBe(420);
  });
});

function makeViewer(count = 20) {
  const nodes = [];
  vi.stubGlobal("document", { createElement: () => {
    const canvas = { width: 0, height: 0, remove: vi.fn(), getContext: () => ({}), setAttribute: vi.fn() };
    nodes.push(canvas); return canvas;
  } });
  const viewer = Object.assign(Object.create(PdfPageViewer.prototype), {
    entries: Array.from({ length: count }, (_, index) => ({ number: index + 1, key: "360:480", size: { width: 600, height: 800 }, placeholder: {}, sheet: { insertBefore: vi.fn() } })),
    layout: Array.from({ length: count }, () => ({ width: 360 })),
    wanted: [1, 2, 3, 4, 5], generation: 0, visible: true, enabled: true, onError: vi.fn()
  });
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  viewer.pdf = { getPage: vi.fn(async () => ({ getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render, cleanup: vi.fn() })) };
  return { viewer, nodes, render };
}

describe("PDF 頁面繪製生命週期", () => {
  it("隱藏造成 DOM 捲軸歸零時，重新顯示後使用保存的頁內位置及水平比例", () => {
    const { viewer } = makeViewer(3);
    viewer.entries.forEach((entry) => { entry.element = { style: {} }; entry.sheet.style = {}; });
    viewer.layout = layoutPdfPages(viewer.entries.map((entry) => entry.size), 360, 2);
    viewer.zoom = 2; viewer.list = { style: {} }; viewer.schedule = vi.fn();
    const top = viewer.layout[1].top + 200;
    viewer.scroller = { scrollTop: top, scrollLeft: 120, scrollWidth: 720, clientWidth: 360 };
    const original = viewer.getView(); viewer.setVisible(false);
    viewer.scroller.scrollTop = viewer.scroller.scrollLeft = 0;
    expect(viewer.getView()).toEqual(original);
    viewer.setVisible(true);
    expect(viewer.scroller.scrollTop).toBeCloseTo(top); expect(viewer.scroller.scrollLeft).toBeCloseTo(120);
    expect(viewer.zoom).toBe(2);
  });
  it("文件重載後延後到容器可見才還原縮放及頁面位置，重設時清除舊位置", () => {
    const { viewer } = makeViewer(3);
    viewer.entries.forEach((entry) => { entry.element = { style: {} }; entry.sheet.style = {}; });
    viewer.list = { style: {}, replaceChildren: vi.fn() }; viewer.schedule = vi.fn();
    viewer.scroller = { scrollTop: 0, scrollLeft: 0, scrollWidth: 720, clientWidth: 0 };
    const restored = { zoom: 2, anchor: { number: 3, fraction: .35 }, left: .5 };
    viewer.restoreView(restored); expect(viewer.getView()).toEqual(restored);
    viewer.scroller.clientWidth = 360; viewer.resize();
    const anchor = pdfScrollAnchor(viewer.layout, viewer.scroller.scrollTop);
    expect(anchor.number).toBe(3); expect(anchor.fraction).toBeCloseTo(.35);
    expect(viewer.scroller.scrollLeft).toBe(180);
    viewer.reset(); expect(viewer.getView().zoom).toBe(1); expect(viewer.getView().anchor).toBeNull();
  });
  it("捲離頁面時釋放 Canvas，持續捲動不累積全部頁面的像素", async () => {
    const { viewer, nodes } = makeViewer();
    await viewer.pump();
    expect(nodes.filter((node) => node.width > 0)).toHaveLength(5);
    for (let start = 6; start <= 16; start += 5) {
      viewer.wanted = Array.from({ length: 5 }, (_, i) => start + i);
      for (const entry of viewer.entries) if (!viewer.wanted.includes(entry.number)) viewer.release(entry);
      await viewer.pump();
      expect(nodes.filter((node) => node.width > 0)).toHaveLength(5);
      for (const node of nodes) expect(node.width * node.height).toBeLessThanOrEqual(1_500_000);
    }
    expect(nodes[0].width).toBe(0); expect(nodes[0].remove).toHaveBeenCalledOnce();
  });
  it("隱藏期間取消正在繪製的工作，保留選取狀態與閱讀位置", async () => {
    const { viewer } = makeViewer(); let reject;
    const cancel = vi.fn(() => reject(Object.assign(new Error("cancel"), { name: "RenderingCancelledException" })));
    viewer.pdf.getPage = async () => ({ getViewport: () => ({ width: 600, height: 800 }), cleanup: vi.fn(), render: () => ({ promise: new Promise((_resolve, fail) => { reject = fail; }), cancel }) });
    viewer.selection = { number: 2, region: { x: .1, y: .2, width: .5, height: .3 } };
    viewer.scroller = { scrollTop: 500 }; const selection = viewer.selection;
    const work = viewer.pump(); await Promise.resolve(); viewer.setVisible(false); await work;
    expect(cancel).toHaveBeenCalledOnce(); expect(viewer.onError).not.toHaveBeenCalled();
    expect(viewer.entries[0].canvas).toBeNull(); expect(viewer.selection).toBe(selection); expect(viewer.scroller.scrollTop).toBe(500);
  });
  it("取得頁面期間文件已切換時，不建立過期 Canvas", async () => {
    const { viewer, nodes } = makeViewer(); let resolve;
    viewer.pdf.getPage = () => new Promise((done) => { resolve = done; });
    const work = viewer.pump(); viewer.generation++; viewer.wanted = [];
    const cleanup = vi.fn(); resolve({ cleanup }); await work;
    expect(nodes).toHaveLength(0); expect(cleanup).toHaveBeenCalledOnce();
  });
  it("單頁失敗可點擊重試，不阻斷其他頁面", async () => {
    const { viewer } = makeViewer(); const original = viewer.pdf.getPage;
    viewer.pdf.getPage = vi.fn().mockRejectedValueOnce(new Error("broken")).mockImplementation(original);
    await viewer.pump(); expect(viewer.onError).toHaveBeenCalledOnce(); expect(viewer.entries[1].renderedKey).toBeTruthy();
    viewer.schedule = vi.fn(); viewer.entries[0].placeholder.onclick(); await viewer.pump();
    expect(viewer.entries[0].renderedKey).toBe("360:480");
  });
});
