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
    stage: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
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
