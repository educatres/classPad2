import { describe, expect, it, vi } from "vitest";
import { LectureWriteQueue } from "../src/whiteboard/LectureWriteQueue.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("講解筆跡保存順序", () => {
  it("等候資料庫確認筆畫後才執行清除，防止延遲寫入復活", async () => {
    let acknowledge;
    const saved = new Promise((resolve) => { acknowledge = resolve; }), clear = vi.fn().mockResolvedValue();
    const queue = new LectureWriteQueue();
    queue.enqueue("stroke_1", () => saved); queue.enqueue("*", clear);
    expect(queue.pending).toBe(2); expect(queue.touches("stroke_2")).toBe(true); expect(clear).not.toHaveBeenCalled();
    acknowledge(); await settle();
    expect(clear).toHaveBeenCalledOnce(); expect(queue.pending).toBe(0);
  });

  it("失敗時保留筆畫與後續操作，重試依原順序完成", async () => {
    const error = new Error("拒絕存取"), write = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(), remove = vi.fn().mockResolvedValue();
    const queue = new LectureWriteQueue(); queue.enqueue("stroke_1", write); queue.enqueue("stroke_1", remove);
    await settle(); expect(queue.error).toBe(error); expect(queue.pending).toBe(2); expect(remove).not.toHaveBeenCalled();
    queue.retry(); await settle();
    expect(write).toHaveBeenCalledTimes(2); expect(remove).toHaveBeenCalledOnce(); expect(queue.pending).toBe(0); expect(queue.error).toBe(null);
  });
});
