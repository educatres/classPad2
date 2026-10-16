// Reconcile by student and current page. Presence changes update only the header.
export class PreviewRegistry {
  constructor() { this.entries = new Map(); }
  reconcile(items, keyOf, create, update) {
    const wanted = new Set(items.map((item) => item.id));
    for (const [id, entry] of this.entries) if (!wanted.has(id)) { entry.dispose(); this.entries.delete(id); }
    items.forEach((item, index) => {
      const key = keyOf(item);
      let entry = this.entries.get(item.id);
      if (entry && entry.key !== key) { entry.dispose(); this.entries.delete(item.id); entry = null; }
      if (!entry) { entry = { ...create(item), key }; this.entries.set(item.id, entry); }
      update(entry, item, index);
    });
  }
  clear() { this.entries.forEach((entry) => entry.dispose()); this.entries.clear(); }
}
