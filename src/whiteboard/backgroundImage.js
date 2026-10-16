import { CAPTURE_ID } from "../pdf/limits.js";
export function normalizeBackgroundScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) ? Math.max(.1, Math.min(1.5, scale)) : 1;
}

export function normalizeBackgroundPosition(value) {
  const position = Number(value);
  return Number.isFinite(position) ? Math.max(0, Math.min(1, position)) : .5;
}

export function normalizeBackgroundImage(value) {
  if (value?.type !== "rtdb-capture" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.classId || "") || !CAPTURE_ID.test(value.assetId || "")) return null;
  return { type: "rtdb-capture", classId: value.classId, assetId: value.assetId, scale: normalizeBackgroundScale(value.scale), x: normalizeBackgroundPosition(value.x), y: normalizeBackgroundPosition(value.y), updatedAt: Number(value.updatedAt) || 0, updatedBy: typeof value.updatedBy === "string" ? value.updatedBy : "" };
}

export function backgroundImageDrawRect(value, imageWidth, imageHeight, width = 1600, height = 1200) {
  const background = normalizeBackgroundImage(value);
  return background ? backgroundImagePlacementRect(background, imageWidth, imageHeight, width, height) : null;
}

export function backgroundImagePlacementRect(value, imageWidth, imageHeight, width = 1600, height = 1200) {
  const naturalWidth = Number(imageWidth), naturalHeight = Number(imageHeight);
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return null;
  const scale = normalizeBackgroundScale(value?.scale);
  const boxWidth = width * scale, boxHeight = height * scale;
  const imageScale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const drawWidth = naturalWidth * imageScale, drawHeight = naturalHeight * imageScale;
  return {
    x: normalizeBackgroundPosition(value?.x) * width - drawWidth / 2,
    y: normalizeBackgroundPosition(value?.y) * height - drawHeight / 2,
    width: drawWidth,
    height: drawHeight
  };
}

const backgroundJobs = new WeakMap();
export function clearBackgroundImage(element) {
  const job = backgroundJobs.get(element);
  job?.release?.(); job?.status?.remove(); backgroundJobs.delete(element);
  element.hidden = true; element.removeAttribute("src");
}

export function showBackgroundImage(element, value) {
  const background = normalizeBackgroundImage(value);
  if (!background) {
    clearBackgroundImage(element);
    element.style.removeProperty("--background-size");
    element.style.removeProperty("--background-x");
    element.style.removeProperty("--background-y");
    return;
  }
  const key = `${background.classId}/${background.assetId}`;
  if (backgroundJobs.get(element)?.key !== key) {
    clearBackgroundImage(element);
    const job = { key }, status = document.createElement("button");
    job.status = status; status.type = "button"; status.className = "material-status"; status.textContent = "教材載入中…"; status.disabled = true;
    status.onpointerdown = (event) => event.stopPropagation();
    element.parentElement.append(status); backgroundJobs.set(element, job);
    import("./materialCache.js").then(({ materialCache }) => materialCache.acquire(background)).then((resource) => {
      if (backgroundJobs.get(element) !== job) { resource.release(); return; }
      job.release = resource.release; element.src = resource.url; element.hidden = false; status.remove();
    }).catch(() => {
      if (backgroundJobs.get(element) !== job) return;
      element.hidden = true; status.textContent = "教材載入失敗，請重試。"; status.disabled = false;
      status.onclick = () => { clearBackgroundImage(element); showBackgroundImage(element, background); };
    });
  }
  element.style.setProperty("--background-size", `${background.scale * 100}%`);
  element.style.setProperty("--background-x", `${background.x * 100}%`);
  element.style.setProperty("--background-y", `${background.y * 100}%`);
}

export function setBackgroundViewport(layer, view) {
  layer.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`;
}
