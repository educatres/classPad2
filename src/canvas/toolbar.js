export function renderToolSelection(toolbar, { tool, color }) {
  for (const button of toolbar.querySelectorAll("button[data-tool], button[data-mode]")) {
    const active = (button.dataset.tool || button.dataset.mode) === tool && (!button.dataset.penColor || button.dataset.penColor === color);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}
