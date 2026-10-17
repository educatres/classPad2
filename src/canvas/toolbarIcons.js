// Local SVG paths keep the whiteboard controls consistent across devices.
const paths = {
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  pan: '<path d="M8 13V5a2 2 0 0 1 4 0v6-2a2 2 0 0 1 4 0v2-1a2 2 0 0 1 4 0v5c0 4-2 7-6 7h-1c-2 0-3-1-4-2l-5-6a2 2 0 0 1 3-3l1 2"/>',
  eraser: '<path d="m15 3 6 6a2 2 0 0 1 0 3l-8 8H7l-5-5a2 2 0 0 1 0-3l10-9a2 2 0 0 1 3 0ZM7 8l9 9M13 20h9"/>',
  text: '<path d="M4 6V3h16v3M12 3v18M8 21h8"/>',
  width: '<path d="M4 5h16M4 12h16"/><path d="M4 20h16" stroke-width="4"/>',
  smoothing: '<path d="M3 17c4-16 6 10 10-3s6-7 8-7"/><path d="m17 3 1-2M21 12l2 1"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H10a7 7 0 0 0 0 14"/>',
  clear: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  reset: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  prev: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  addPage: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 15h8M12 11v8"/>',
  project: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5M8 21h8m-6-14 5 3-5 3z"/>',
  stopProject: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5M8 21h8M9 7l6 5M15 7l-6 5"/>',
  note: '<path d="M14 21H4V3h16v12zM14 21v-6h6M8 8h8M8 12h4"/>',
  lock: '<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v3"/>',
  unlock: '<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 7-3M12 15v3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  followPage: '<rect x="3" y="3" width="13" height="17" rx="2"/><path d="M10 10h11m-4-4 4 4-4 4"/>'
};

function setIcon(element, name) {
  if (!paths[name]) return;
  element.dataset.icon = name;
  element.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

export function initToolbarIcons(root) {
  for (const element of root.querySelectorAll("[data-icon]")) {
    if (element.matches("button")) {
      const label = element.getAttribute("aria-label") || element.textContent.trim();
      element.setAttribute("aria-label", label);
      element.title ||= label;
    }
    setIcon(element, element.dataset.icon);
  }
}

export function renderToolbarState(button, { label, pressed, icon }) {
  button.setAttribute("aria-label", label);
  button.title = label;
  button.setAttribute("aria-pressed", String(pressed));
  button.classList.toggle("active", pressed);
  if (icon && button.dataset.icon !== icon) setIcon(button, icon);
}

export function renderSmoothingControl(button, enabled) {
  renderToolbarState(button, { label: enabled ? "關閉手寫平滑" : "開啟手寫平滑", pressed: enabled });
}
