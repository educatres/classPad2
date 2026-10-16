// Only encrypted PDF bytes go into IndexedDB. The key and reading state live in
// sessionStorage, so ordinary tab closure makes the cached bytes unreadable.
const DATABASE = "classpad-pdf-session";
const STORE = "documents";
const MAX_AGE = 24 * 60 * 60 * 1000;

function openDatabase() {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("PDF 暫存目前無法開啟。")); };
  });
}

async function transact(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("PDF 暫存失敗。"));
    });
  } finally { db.close(); }
}

const cache = {
  read: (id) => transact("readonly", (store) => store.get(id)),
  write: (record) => transact("readwrite", (store) => store.put(record)),
  remove: (id) => transact("readwrite", (store) => store.delete(id)),
  prune: () => transact("readwrite", (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.createdAt < Date.now() - MAX_AGE) cursor.delete();
      cursor.continue();
    };
  })
};

export class PdfSession {
  constructor({ classId, uid, storage, documents = cache, cryptography = globalThis.crypto }) {
    Object.assign(this, { storage, documents, cryptography });
    this.storageKey = `classpad:pdf-session:${uid}:${classId}`;
    try {
      this.storage ||= globalThis.sessionStorage;
      const state = JSON.parse(this.storage.getItem(this.storageKey));
      if (typeof state?.id === "string" && typeof state.revision === "string" && Array.isArray(state.key) && state.key.length === 32) this.state = state;
    } catch { /* Loading PDFs still works if browser storage is disabled. */ }
  }

  async save(file, { view, open }) {
    const keyBytes = this.state?.key || Array.from(this.cryptography.getRandomValues(new Uint8Array(32)));
    const key = await this.cryptography.subtle.importKey("raw", new Uint8Array(keyBytes), "AES-GCM", false, ["encrypt"]);
    const iv = this.cryptography.getRandomValues(new Uint8Array(12));
    const bytes = await this.cryptography.subtle.encrypt({ name: "AES-GCM", iv }, key, await file.arrayBuffer());
    const state = { id: this.state?.id || this.cryptography.randomUUID(), revision: this.cryptography.randomUUID(), key: keyBytes, view, open };
    // Check sessionStorage before writing a potentially large document.
    const previous = this.storage.getItem(this.storageKey);
    this.storage.setItem(this.storageKey, JSON.stringify(state));
    try {
      await this.documents.prune();
      await this.documents.write({ id: state.id, revision: state.revision, bytes, iv, createdAt: Date.now() });
      this.state = state;
    } catch (error) {
      if (previous) this.storage.setItem(this.storageKey, previous);
      else this.storage.removeItem(this.storageKey);
      throw error;
    }
  }

  async read() {
    if (!this.state) return null;
    const record = await this.documents.read(this.state.id);
    if (!record || record.revision !== this.state.revision || record.createdAt < Date.now() - MAX_AGE) {
      await this.clear(); return null;
    }
    const key = await this.cryptography.subtle.importKey("raw", new Uint8Array(this.state.key), "AES-GCM", false, ["decrypt"]);
    const bytes = await this.cryptography.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, key, record.bytes);
    return { file: new File([bytes], "保留的PDF.pdf", { type: "application/pdf" }), view: this.state.view };
  }

  remember(value) {
    if (!this.state) return;
    this.state = { ...this.state, ...value };
    this.storage.setItem(this.storageKey, JSON.stringify(this.state));
  }

  async clear() {
    const id = this.state?.id;
    this.state = null;
    this.storage.removeItem(this.storageKey);
    if (id) await this.documents.remove(id);
  }
}
