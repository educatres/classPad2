import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfSession } from "../src/pdf/PdfSession.js";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

let tab, records, documents;
const view = { zoom: 1.75, anchor: { number: 12, fraction: .4 }, left: .6 };
const file = (text) => new File([text], "private.pdf", { type: "application/pdf" });
const session = (options = {}) => new PdfSession({ classId: "class-A", uid: "teacher-A", storage: tab, documents, cryptography: webcrypto, ...options });

beforeEach(() => {
  tab = storage(); records = new Map();
  documents = {
    read: vi.fn(async (id) => records.get(id)),
    write: vi.fn(async (record) => records.set(record.id, record)),
    remove: vi.fn(async (id) => records.delete(id)), prune: vi.fn(async () => {})
  };
});

describe("分頁專屬 PDF 暫存", () => {
  it("重新建立頁面後可還原檔案、縮放及雙向捲動，暫存不含原始 PDF", async () => {
    const first = session();
    await first.save(file("%PDF-private-source"), { view, open: true });
    first.remember({ open: false });
    const next = session(), saved = await next.read();
    expect(await saved.file.text()).toBe("%PDF-private-source");
    expect(saved.view).toEqual(view); expect(next.state.open).toBe(false);
    const record = [...records.values()][0];
    expect(Buffer.from(record.bytes).toString()).not.toContain("%PDF-private-source");
    expect(record).not.toHaveProperty("key"); expect(record).not.toHaveProperty("name");
  });
  it("不同課堂、老師、新分頁和關閉後的新分頁都無法取得既有 PDF", async () => {
    await session().save(file("original"), { view, open: true });
    for (const options of [{ classId: "class-B" }, { uid: "teacher-B" }, { storage: storage() }]) {
      const other = session(options); expect(other.state).toBeUndefined(); expect(await other.read()).toBeNull();
    }
    expect(documents.read).not.toHaveBeenCalled();
  });
  it("更換 PDF 原子覆寫舊暫存，重設閱讀位置而不累積多份文件", async () => {
    const first = session(); await first.save(file("first"), { view, open: true });
    const id = first.state.id, revision = first.state.revision;
    await first.save(file("replacement"), { view: { zoom: 1, anchor: null, left: 0 }, open: true });
    expect(records.size).toBe(1); expect(first.state.id).toBe(id); expect(first.state.revision).not.toBe(revision);
    const saved = await session().read(); expect(await saved.file.text()).toBe("replacement"); expect(saved.view.zoom).toBe(1);
  });
  it("儲存失敗不會宣告新 PDF 已保存，舊文件與狀態仍一致", async () => {
    const first = session(); await first.save(file("first"), { view, open: true });
    const previous = structuredClone(first.state);
    documents.write.mockRejectedValueOnce(new Error("quota"));
    await expect(first.save(file("replacement"), { view: null, open: true })).rejects.toThrow("quota");
    expect(first.state).toEqual(previous); expect(session().state).toEqual(previous);
    expect(await (await session().read()).file.text()).toBe("first");
  });
  it("瀏覽器封鎖暫存、資料遺失或超過期限時可安全重新選檔", async () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(session({ storage: blocked }).state).toBeUndefined();
    await expect(session({ storage: blocked }).save(file("file"), { view, open: true })).rejects.toThrow("blocked");
    expect(documents.write).not.toHaveBeenCalled();
    const first = session(); await first.save(file("first"), { view, open: true });
    records.get(first.state.id).createdAt = Date.now() - 25 * 3600_000;
    expect(await session().read()).toBeNull(); expect(session().state).toBeUndefined(); expect(records.size).toBe(0);
    await session().save(file("again"), { view, open: true }); records.clear();
    expect(await session().read()).toBeNull(); expect(session().state).toBeUndefined();
  });
  it("錯誤金鑰無法讀取加密暫存，清除時移除檔案及分頁資訊", async () => {
    const first = session(); await first.save(file("first"), { view, open: true });
    const wrong = session(); wrong.state.key[0] ^= 1;
    await expect(wrong.read()).rejects.toThrow();
    await first.clear(); expect(records.size).toBe(0); expect(await session().read()).toBeNull();
  });
});
