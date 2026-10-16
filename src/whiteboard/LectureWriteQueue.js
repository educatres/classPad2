// Failed operations remain in order for an explicit retry. A delayed stroke must
// be acknowledged before a later erase/clear, so it cannot revive cleared work.
export class LectureWriteQueue {
  constructor(onChange = () => {}) { this.items = []; this.running = false; this.error = null; this.onChange = onChange; }
  get pending() { return this.items.length; }
  touches(id) { return this.items.some((item) => item.id === id || item.id === "*"); }
  enqueue(id, write) { this.items.push({ id, write }); this.onChange(this); this.drain(); }
  async drain() {
    if (this.running || this.error) return;
    this.running = true;
    while (this.items.length) {
      try { await this.items[0].write(); this.items.shift(); }
      catch (error) { this.error = error; break; }
      this.onChange(this);
    }
    this.running = false; this.onChange(this);
  }
  retry() { this.error = null; this.onChange(this); this.drain(); }
}
