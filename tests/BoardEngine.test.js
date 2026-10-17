import { describe, expect, it, vi } from "vitest";
import { BoardEngine } from "../src/canvas/BoardEngine.js";

function createEngine() {
  const engine = Object.create(BoardEngine.prototype);
  Object.assign(engine, {
    activeEnabled: true,
    color: "#173f5f",
    current: null,
    drawingPointerId: null,
    editableLayer: "studentStrokes",
    gesture: null,
    onActive: vi.fn(),
    panX: 0,
    panY: 0,
    pointers: new Map(),
    scale: 1,
    smoothing: false,
    stage: { dataset: {}, classList: { toggle: vi.fn() }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
    strokes: { studentStrokes: new Map(), teacherStrokes: new Map() },
    tool: "pen",
    uid: "student-1",
    undoStack: [],
    redoStack: [],
    width: 5,
  });
  engine.renderAll = vi.fn();
  return engine;
}

function pointerEvent(pointerId, pointerType, x, y, timeStamp = 1) {
  return {
    clientX: x,
    clientY: y,
    currentTarget: { setPointerCapture: vi.fn() },
    pointerId,
    pointerType,
    pressure: pointerType === "pen" ? 0.7 : 0.5,
    preventDefault: vi.fn(),
    timeStamp,
  };
}

describe("BoardEngine iPad 指標處理", () => {
  it("長筆畫最多保存 500 個點，抬筆也不超出資料庫限制", () => {
    const engine = createEngine(); engine.onComplete = vi.fn();
    engine.pointerDown(pointerEvent(1, "pen", 0, 10));
    const move = pointerEvent(1, "pen", 100, 10, 600);
    move.getCoalescedEvents = () => Array.from({ length: 500 }, (_, index) => pointerEvent(1, "pen", (index + 1) / 5, 10, index + 2));
    engine.pointerMove(move); engine.pointerUp(pointerEvent(1, "pen", 100, 20, 601));
    expect(engine.onComplete).toHaveBeenCalledOnce();
    expect(engine.onComplete.mock.calls[0][0].points).toHaveLength(500);
  });
  it("Apple Pencil 書寫時忽略後續手掌觸控", () => {
    const engine = createEngine();
    engine.pointerDown(pointerEvent(1, "pen", 10, 10));
    engine.pointerDown(pointerEvent(2, "touch", 80, 80));

    expect([...engine.pointers.keys()]).toEqual([1]);
    expect(engine.current._pointerType).toBe("pen");
    expect(engine.current.points).toHaveLength(1);
  });

  it("手掌先碰到畫布時會改由 Apple Pencil 接管筆畫", () => {
    const engine = createEngine();
    engine.pointerDown(pointerEvent(2, "touch", 80, 80));
    engine.pointerDown(pointerEvent(1, "pen", 10, 10, 2));

    expect([...engine.pointers.keys()]).toEqual([1]);
    expect(engine.drawingPointerId).toBe(1);
    expect(engine.current._pointerType).toBe("pen");
    expect(engine.current.points[0].slice(0, 2)).toEqual([0.1, 0.1]);
  });

  it("會加入 Apple Pencil 的合併取樣點且不儲存內部指標欄位", () => {
    const engine = createEngine();
    engine.pointerDown(pointerEvent(1, "pen", 10, 10));
    const move = pointerEvent(1, "pen", 30, 30, 3);
    move.getCoalescedEvents = () => [
      pointerEvent(1, "pen", 20, 20, 2),
      pointerEvent(1, "pen", 30, 30, 3),
    ];
    engine.pointerMove(move);

    expect(engine.current.points.map((point) => point.slice(0, 2))).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
    ]);
    expect(engine.serialize(engine.current)).not.toHaveProperty("_pointerId");
    expect(engine.serialize(engine.current)).not.toHaveProperty("_pointerType");
  });

  it("可以在書寫中切換平滑並將狀態保存在筆畫", () => {
    const engine = createEngine();
    engine.setSmoothing(true);
    engine.pointerDown(pointerEvent(1, "pen", 10, 10));
    expect(engine.current.smooth).toBe(true);

    engine.setSmoothing(false);
    expect(engine.current.smooth).toBe(false);
    expect(engine.renderAll).toHaveBeenCalled();
  });

  it("平滑筆畫使用貝茲曲線，關閉時維持直線段", () => {
    const engine = createEngine();
    engine.cssWidth = 100;
    engine.cssHeight = 100;
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      bezierCurveTo: vi.fn(),
      fill: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
    };
    const stroke = {
      color: "#173f5f",
      opacity: 1,
      points: [
        [0.1, 0.1, 0.5, 0],
        [0.3, 0.4, 0.5, 1],
        [0.6, 0.2, 0.5, 2],
      ],
      smooth: true,
      width: 5,
    };

    engine.drawStroke(context, stroke);
    expect(context.bezierCurveTo).toHaveBeenCalled();
    expect(context.lineTo).not.toHaveBeenCalled();

    engine.drawStroke(context, { ...stroke, smooth: false });
    expect(context.lineTo).toHaveBeenCalled();
  });

  it("重設縮放時會同步通知便條貼圖層", () => {
    const engine = createEngine();
    engine.scale = 2;
    engine.panX = 20;
    engine.panY = 10;
    engine.onViewChange = vi.fn();

    engine.resetZoom();

    expect(engine.onViewChange).toHaveBeenCalledWith({ scale: 1, panX: 0, panY: 0 });
  });
});

describe("BoardEngine 拖動畫板", () => {
  it("寬版顯示視窗仍以 4:3 內部白板換算筆跡座標", () => {
    const engine = createEngine();
    engine.worldWidth = 1600; engine.worldHeight = 1200;
    engine.cssWidth = 1600; engine.cssHeight = 900;
    engine.baseScale = .75; engine.originX = 200; engine.originY = 0;
    engine.scale = 2; engine.panX = -100; engine.panY = 50;
    engine.stage.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1600, height: 900 });
    const point = pointerEvent(1, "mouse", 1310, 970);
    expect(engine.coords(point)).toEqual([.5, .5]);
    engine.onViewChange = vi.fn(); engine.notifyViewChange();
    expect(engine.onViewChange).toHaveBeenCalledWith(expect.objectContaining({ baseScale: .75, originX: 200, worldWidth: 1600, worldHeight: 1200 }));
  });

  it("滑鼠、單指及 Pencil 拖動只改視圖，保留所有圖層與復原歷史", () => {
    for (const type of ["mouse", "touch", "pen"]) {
      const engine = createEngine(); engine.onComplete = vi.fn(); engine.onRemove = vi.fn(); engine.onViewChange = vi.fn();
      const stroke = { id: "existing", points: [[.1, .1], [.2, .2]] };
      engine.strokes.studentStrokes.set(stroke.id, stroke); engine.strokes.teacherStrokes.set(stroke.id, stroke);
      engine.undoStack.push({ type: "add", stroke });
      engine.setTool("pan"); engine.pointerDown(pointerEvent(1, type, 10, 20)); engine.pointerMove(pointerEvent(1, type, 40, 60)); engine.pointerUp(pointerEvent(1, type, 40, 60));
      expect(engine.onViewChange).toHaveBeenLastCalledWith({ scale: 1, panX: 30, panY: 40 });
      expect(engine.strokes.studentStrokes.get(stroke.id)).toBe(stroke); expect(engine.strokes.teacherStrokes.get(stroke.id)).toBe(stroke);
      expect(engine.undoStack).toHaveLength(1); expect(engine.redoStack).toHaveLength(0);
      expect(engine.onComplete).not.toHaveBeenCalled(); expect(engine.onRemove).not.toHaveBeenCalled(); expect(engine.onActive).not.toHaveBeenCalled();
      expect(engine.panDrag).toBeNull(); expect(engine.stage.dataset.tool).toBe("pan");
    }
  });
  it("縮放並拖動後切回畫筆，保存正確的原始白板座標", () => {
    const engine = createEngine(); engine.scale = 2; engine.setTool("pan");
    engine.pointerDown(pointerEvent(1, "mouse", 10, 10)); engine.pointerUp(pointerEvent(1, "mouse", 30, 40)); engine.setTool("pen");
    engine.pointerDown(pointerEvent(2, "mouse", 60, 70)); engine.pointerUp(pointerEvent(2, "mouse", 80, 90));
    expect(engine.undoStack[0].stroke.points.map((point) => point.slice(0, 2))).toEqual([[.2, .2], [.3, .3]]);
    expect([engine.scale, engine.panX, engine.panY]).toEqual([2, 20, 30]);
  });
  it("放開、取消或遺失指標後停止拖動，離開畫板仍可結束", () => {
    for (const cancel of [false, true]) {
      const engine = createEngine(); engine.setTool("pan");
      const start = pointerEvent(1, "mouse", 50, 50); start.currentTarget.hasPointerCapture = () => true; start.currentTarget.releasePointerCapture = vi.fn();
      engine.pointerDown(start); engine.pointerMove(pointerEvent(1, "mouse", 400, 400));
      if (cancel) engine.pointerCancel(pointerEvent(1, "mouse", 0, 0)); else engine.pointerUp(pointerEvent(1, "mouse", 400, 400));
      const view = [engine.panX, engine.panY]; engine.pointerMove(pointerEvent(1, "mouse", -400, -400));
      expect([engine.panX, engine.panY]).toEqual(view); expect(engine.pointers.size).toBe(0); expect(engine.panDrag).toBeNull();
      expect(start.currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);
    }
  });
  it("切換工具完成原有筆畫，舊指標不會繼續寫入或拖動", () => {
    const engine = createEngine(); engine.onComplete = vi.fn();
    engine.pointerDown(pointerEvent(1, "pen", 10, 10)); engine.pointerMove(pointerEvent(1, "pen", 20, 20)); engine.setTool("pan");
    engine.pointerMove(pointerEvent(1, "pen", 60, 60)); engine.pointerUp(pointerEvent(1, "pen", 60, 60));
    expect(engine.onComplete).toHaveBeenCalledOnce(); expect(engine.undoStack[0].stroke.points).toHaveLength(2);
    expect([engine.panX, engine.panY]).toEqual([0, 0]);
  });
  it("單指拖動轉雙指縮放再回到單指時，不跳位或產生筆跡", () => {
    const engine = createEngine(); engine.setTool("pan");
    engine.pointerDown(pointerEvent(1, "touch", 20, 20)); engine.pointerMove(pointerEvent(1, "touch", 30, 30));
    engine.pointerDown(pointerEvent(2, "touch", 70, 30)); engine.pointerMove(pointerEvent(2, "touch", 90, 30));
    expect(engine.scale).toBe(1.5); const before = engine.panX;
    engine.pointerUp(pointerEvent(2, "touch", 90, 30)); engine.pointerMove(pointerEvent(1, "touch", 35, 35));
    expect(engine.panX).toBe(before + 5); expect(engine.current).toBeNull(); expect(engine.undoStack).toHaveLength(0);
  });
  it("鎖定書寫後仍可拖動縮放，畫筆、橡皮擦與復原重做都不改資料", async () => {
    const engine = createEngine(); const stroke = { id: "old", points: [[.1, .1], [.2, .2]] };
    engine.strokes.studentStrokes.set(stroke.id, stroke); engine.undoStack.push({ type: "add", stroke }); engine.redoStack.push({ type: "add", stroke });
    engine.onComplete = vi.fn(); engine.onRemove = vi.fn(); engine.setReadOnly(true);
    for (const tool of ["pen", "eraser"]) { engine.setTool(tool); engine.pointerDown(pointerEvent(1, "mouse", 10, 10)); engine.pointerUp(pointerEvent(1, "mouse", 20, 20)); }
    await engine.undo(); await engine.redo();
    expect(engine.onComplete).not.toHaveBeenCalled(); expect(engine.onRemove).not.toHaveBeenCalled(); expect(engine.strokes.studentStrokes.size).toBe(1);
    engine.setTool("pan"); engine.pointerDown(pointerEvent(1, "mouse", 10, 10)); engine.pointerUp(pointerEvent(1, "mouse", 40, 40));
    expect(engine.panX).toBe(30); engine.zoomBy(.1); expect(engine.scale).toBe(1.1); engine.resetZoom(); expect([engine.scale, engine.panX, engine.panY]).toEqual([1, 0, 0]);
  });
  it("停用互動及重設視圖都釋放拖動，後續指標事件不會恢復舊位置", () => {
    for (const stop of ["disable", "reset"]) {
      const engine = createEngine(); engine.setTool("pan"); engine.pointerDown(pointerEvent(1, "mouse", 10, 10)); engine.pointerMove(pointerEvent(1, "mouse", 30, 30));
      if (stop === "disable") engine.setEnabled(false); else engine.resetZoom();
      const panX = engine.panX; engine.pointerMove(pointerEvent(1, "mouse", 50, 50));
      expect(engine.panX).toBe(panX); expect(engine.panDrag).toBeNull(); expect(engine.pointers.size).toBe(0);
    }
  });
  it("各縮放倍率都保留部分畫板可見，並忽略右鍵及畫板外的書寫起點", () => {
    const engine = createEngine(); engine.setTool("pan");
    engine.pointerDown({ ...pointerEvent(1, "mouse", 20, 20), button: 2 }); expect(engine.panDrag).toBeFalsy();
    for (const scale of [.25, 1, 4]) {
      engine.scale = scale;
      for (const destination of [-10000, 10000]) {
        engine.pointerDown(pointerEvent(2, "mouse", 50, 50)); engine.pointerUp(pointerEvent(2, "mouse", destination, destination));
        expect(engine.panX).toBeLessThan(100); expect(engine.panX + 100 * scale).toBeGreaterThan(0);
      }
    }
    engine.resetZoom(); engine.panX = 50; engine.setTool("pen"); engine.pointerDown(pointerEvent(3, "mouse", 10, 10)); engine.pointerUp(pointerEvent(3, "mouse", 20, 20));
    expect(engine.undoStack).toHaveLength(0);
  });
  it("匯出使用完整 1600 × 1200 白板，不套用本機平移縮放", () => {
    const engine = createEngine(); engine.cssWidth = 100; engine.cssHeight = 75; engine.scale = 3; engine.panX = -20; engine.panY = 15;
    const stroke = { id: "old" }; engine.strokes.studentStrokes.set(stroke.id, stroke); engine.drawStroke = vi.fn();
    const context = { fillRect: vi.fn() }, canvas = { getContext: () => context };
    vi.stubGlobal("document", { createElement: () => canvas });
    try {
      expect(engine.exportCanvas()).toMatchObject({ width: 1600, height: 1200 }); expect(engine.drawStroke).toHaveBeenCalledWith(context, stroke);
      expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200); expect([engine.scale, engine.panX, engine.panY, engine.cssWidth, engine.cssHeight]).toEqual([3, -20, 15, 100, 75]);
    } finally { vi.unstubAllGlobals(); }
  });
});
