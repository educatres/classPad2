import { CAPTURE_ID } from "../pdf/limits.js";
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

export function googleDriveFileId(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com") return null;
  const pathMatch = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  const id = pathMatch?.[1] || url.searchParams.get("id");
  return DRIVE_FILE_ID_PATTERN.test(id || "") ? id : null;
}

export function normalizeGoogleDriveImageUrl(value) {
  const sourceUrl = String(value || "").trim();
  const id = googleDriveFileId(sourceUrl);
  if (!id) throw new Error("請貼上有效的 Google Drive 圖片分享網址。");
  return {
    sourceUrl,
    imageUrl: `https://drive.google.com/thumbnail?id=${id}&sz=w2000`
  };
}

export function normalizeBackgroundScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) ? Math.max(.1, Math.min(1.5, scale)) : 1;
}

export function normalizeBackgroundPosition(value) {
  const position = Number(value);
  return Number.isFinite(position) ? Math.max(0, Math.min(1, position)) : .5;
}

export function normalizeBackgroundImage(value) {
  if (value?.type === "rtdb-capture") {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value.classId || "") || !CAPTURE_ID.test(value.assetId || "")) return null;
    return { type: "rtdb-capture", classId: value.classId, assetId: value.assetId, scale: normalizeBackgroundScale(value.scale), x: normalizeBackgroundPosition(value.x), y: normalizeBackgroundPosition(value.y), updatedAt: Number(value.updatedAt) || 0, updatedBy: typeof value.updatedBy === "string" ? value.updatedBy : "" };
  }
  if (value?.type) return null;
  if (!value || typeof value.sourceUrl !== "string" || typeof value.imageUrl !== "string") return null;
  if (!googleDriveFileId(value.sourceUrl) || !/^https:\/\/drive[.]google[.]com\/thumbnail[?]id=[A-Za-z0-9_-]+&sz=w2000$/.test(value.imageUrl)) return null;
  return {
    sourceUrl: value.sourceUrl,
    imageUrl: value.imageUrl,
    scale: normalizeBackgroundScale(value.scale),
    x: normalizeBackgroundPosition(value.x),
    y: normalizeBackgroundPosition(value.y),
    updatedAt: Number(value.updatedAt) || 0,
    updatedBy: typeof value.updatedBy === "string" ? value.updatedBy : ""
  };
}

export function googleDriveCanvasImageUrl(value) {
  const background = normalizeBackgroundImage(value);
  const id = googleDriveFileId(background?.sourceUrl);
  return id ? `https://lh3.googleusercontent.com/d/${id}=w2000` : null;
}

export function backgroundImageDrawRect(value, imageWidth, imageHeight, width = 1600, height = 1200) {
  const background = normalizeBackgroundImage(value);
  const naturalWidth = Number(imageWidth), naturalHeight = Number(imageHeight);
  if (!background || !(naturalWidth > 0) || !(naturalHeight > 0)) return null;
  const boxWidth = width * background.scale, boxHeight = height * background.scale;
  const imageScale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const drawWidth = naturalWidth * imageScale, drawHeight = naturalHeight * imageScale;
  return {
    x: background.x * width - drawWidth / 2,
    y: background.y * height - drawHeight / 2,
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
    element.hidden = true;
    element.removeAttribute("src");
    element.style.removeProperty("--background-size");
    element.style.removeProperty("--background-x");
    element.style.removeProperty("--background-y");
    return;
  }
  if (background.type === "rtdb-capture") {
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
  } else {
    if (backgroundJobs.has(element)) clearBackgroundImage(element);
    if (element.getAttribute("src") !== background.imageUrl) element.src = background.imageUrl;
    element.hidden = false;
  }
  element.style.setProperty("--background-size", `${Math.round(background.scale * 100)}%`);
  element.style.setProperty("--background-x", `${background.x * 100}%`);
  element.style.setProperty("--background-y", `${background.y * 100}%`);
}

export function setBackgroundViewport(layer, view) {
  layer.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`;
}
