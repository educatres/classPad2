// CSS page labels and gaps use these same dimensions in PdfPageViewer.
export const PAGE_LABEL_HEIGHT = 28;
export const PAGE_GAP = 16;
export const PAGE_PADDING = 12;
export const PREVIEW_PAGE_LIMIT = 5;

export function layoutPdfPages(sizes, availableWidth, zoom = 1) {
  let top = PAGE_PADDING;
  return sizes.map(({ width, height }, index) => {
    const scale = Math.max(1, availableWidth - PAGE_PADDING * 2) / width * zoom;
    const entry = { number: index + 1, width: width * scale, height: height * scale, top };
    entry.bottom = top + PAGE_LABEL_HEIGHT + entry.height;
    top = entry.bottom + PAGE_GAP;
    return entry;
  });
}

export function pdfScrollAnchor(layout, scrollTop) {
  const entry = layout.find((item) => item.bottom > scrollTop) || layout.at(-1);
  return entry ? { number: entry.number, fraction: (scrollTop - entry.top) / (entry.bottom - entry.top) } : null;
}

export function restorePdfAnchor(layout, anchor) {
  const entry = anchor && layout[anchor.number - 1];
  return entry ? Math.max(0, entry.top + anchor.fraction * (entry.bottom - entry.top)) : 0;
}

export function visiblePdfPages(layout, scrollTop, height, limit = PREVIEW_PAGE_LIMIT) {
  const center = scrollTop + height / 2;
  return layout.filter((entry) => entry.bottom >= scrollTop - height / 2 && entry.top <= scrollTop + height * 1.5)
    .sort((a, b) => Math.abs((a.top + a.bottom) / 2 - center) - Math.abs((b.top + b.bottom) / 2 - center))
    .slice(0, limit).map((entry) => entry.number);
}

export function sidebarWidth(value, availableWidth) {
  const max = Math.max(280, Math.min(availableWidth * .6, availableWidth - 320));
  return Math.round(Math.max(280, Math.min(Number(value) || availableWidth * .35, max)));
}
