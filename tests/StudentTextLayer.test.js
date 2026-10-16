import { describe, expect, it, vi } from "vitest";
import { drawStudentText, hasStudentText, normalizeStudentText, StudentTextLayer, wrapStudentText } from "../src/text/StudentTextLayer.js";

describe("學生文字圖層", () => {
  it("老師強制切頁前保存輸入法組字中的文字，平常同步仍等待組字完成", async () => {
    const layer = Object.assign(Object.create(StudentTextLayer.prototype), {
      editable: true, composing: true, dirty: true,
      editor: { value: "正在輸入的答案", scrollTop: 12 },
      lastSubmitted: { text: "", scrollTop: 0 }, onChange: vi.fn(), onError: vi.fn()
    });
    await layer.flush();
    expect(layer.onChange).not.toHaveBeenCalled();
    await layer.flush({ finishComposition: true });
    expect(layer.onChange).toHaveBeenCalledWith({ text: "正在輸入的答案", scrollTop: 12, layoutVersion: 1 });
    expect(layer.dirty).toBe(false);
  });
  it("正規化純文字資料並忽略純空白作答", () => {
    expect(normalizeStudentText(null)).toEqual({ text: "", scrollTop: 0, layoutVersion: 1 });
    expect(normalizeStudentText({ text: "作答", scrollTop: 18 })).toEqual({ text: "作答", scrollTop: 18, layoutVersion: 1 });
    expect(hasStudentText({ text: "  \n" })).toBe(false);
    expect(hasStudentText({ text: "  答案 " })).toBe(true);
  });

  it("依固定寬度換行並保留學生手動換行", () => {
    const context = { measureText: (value) => ({ width: Array.from(value).length * 10 }) };
    expect(wrapStudentText(context, "甲乙丙丁\n戊", 25)).toEqual(["甲乙", "丙丁", "戊"]);
  });

  it("匯出時依學生的捲動位置繪製文字", () => {
    const context = {
      save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), scale: vi.fn(),
      restore: vi.fn(), fillText: vi.fn(), measureText: (value) => ({ width: Array.from(value).length * 20 })
    };
    drawStudentText(context, { text: "第一行\n第二行", scrollTop: 58 });
    expect(context.fillText).toHaveBeenNthCalledWith(1, "第一行", 64, 6);
    expect(context.fillText).toHaveBeenNthCalledWith(2, "第二行", 64, 64);
  });
});
