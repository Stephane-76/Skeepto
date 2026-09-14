//=============================================================================
// SkSpInsertImage — insert SkCellClassImage floating objects (file picker / drop)
//=============================================================================
import React from "react";
import { canApplyAsFloatingObject } from "./CellClass/SkCellClass.js";
import {
  buildFloatingAnchorCellRef,
  DEFAULT_FLOATING_LAYOUT,
  parseFloatingObjectsJson,
  suggestFloatingObjectName,
} from "./SkSpFloatingObject.js";

export const IMAGE_FLOATING_CLASS = "SkCellClassImage";

const IMAGE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/*";

/** Toolbar / menu icon (picture frame). */
export function ImageToolbarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="SkSvg"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="1.5"
        ry="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="8.5" cy="10" r="1.8" fill="currentColor" />
      <polygon
        points="5,17 10,12 13,15 16,11 19,17"
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
  );
}

export function isImageFile(sFile) {
  if (sFile == null || typeof sFile !== "object") {
    return false;
  }
  const wType = String(sFile.type || "").toLowerCase();
  if (wType.startsWith("image/")) {
    return true;
  }
  const wName = String(sFile.name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(wName);
}

function imageMimeType(sFile, sFallback = "image/png") {
  const wType = String(sFile?.type || "").toLowerCase();
  return wType.startsWith("image/") ? wType : sFallback;
}

function readFileAsArrayBuffer(sFile) {
  return new Promise((resolve, reject) => {
    const wReader = new FileReader();
    wReader.onload = () => resolve(wReader.result);
    wReader.onerror = () => reject(wReader.error || new Error("FileReader failed"));
    wReader.readAsArrayBuffer(sFile);
  });
}

function readFileAsDataUrlRaw(sFile) {
  return new Promise((resolve, reject) => {
    const wReader = new FileReader();
    wReader.onload = () => resolve(String(wReader.result || ""));
    wReader.onerror = () => reject(wReader.error || new Error("FileReader failed"));
    wReader.readAsDataURL(sFile);
  });
}

function loadImageElement(sDataUrl) {
  return new Promise((resolve, reject) => {
    const wImg = new Image();
    wImg.onload = () => resolve(wImg);
    wImg.onerror = () => reject(new Error("Image decode failed"));
    wImg.src = sDataUrl;
  });
}

/** Read TIFF IFD Orientation (tag 0x0112) from a JPEG APP1 Exif segment. */
function parseJpegExifOrientation(sBuffer) {
  const wView = new DataView(sBuffer);
  if (wView.byteLength < 4 || wView.getUint16(0, false) !== 0xffd8) {
    return 1;
  }
  let wOffset = 2;
  while (wOffset + 4 < wView.byteLength) {
    if (wView.getUint8(wOffset) !== 0xff) {
      break;
    }
    const wMarker = wView.getUint8(wOffset + 1);
    if (wMarker === 0xe1) {
      const wSegLen = wView.getUint16(wOffset + 2, false);
      const wExifStart = wOffset + 4;
      if (
        wExifStart + 6 <= wView.byteLength &&
        wView.getUint32(wExifStart, false) === 0x45786966 &&
        wView.getUint16(wExifStart + 4, false) === 0x0000
      ) {
        return readTiffOrientationTag(wView, wExifStart + 6);
      }
      wOffset += 2 + wSegLen;
    } else if (wMarker === 0xda) {
      break;
    } else {
      const wSegLen = wView.getUint16(wOffset + 2, false);
      wOffset += 2 + wSegLen;
    }
  }
  return 1;
}

function readTiffOrientationTag(sView, sTiffStart) {
  const wLittleEndian = sView.getUint16(sTiffStart, false) === 0x4949;
  const wGet16 = (o) => sView.getUint16(o, wLittleEndian);
  const wGet32 = (o) => sView.getUint32(o, wLittleEndian);
  const wIfdOffset = sTiffStart + wGet32(sTiffStart + 4);
  if (wIfdOffset + 2 > sView.byteLength) {
    return 1;
  }
  const wCount = wGet16(wIfdOffset);
  for (let wIdx = 0; wIdx < wCount; wIdx++) {
    const wEntry = wIfdOffset + 2 + wIdx * 12;
    if (wEntry + 12 > sView.byteLength) {
      break;
    }
    if (wGet16(wEntry) === 0x0112) {
      const wValue = wGet16(wEntry + 8);
      return wValue >= 1 && wValue <= 8 ? wValue : 1;
    }
  }
  return 1;
}

function drawImageWithExifOrientation(sCtx, sImg, sOrientation, sWidth, sHeight) {
  switch (sOrientation) {
    case 2:
      sCtx.transform(-1, 0, 0, 1, sWidth, 0);
      break;
    case 3:
      sCtx.transform(-1, 0, 0, -1, sWidth, sHeight);
      break;
    case 4:
      sCtx.transform(1, 0, 0, -1, 0, sHeight);
      break;
    case 5:
      sCtx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      sCtx.transform(0, 1, -1, 0, sHeight, 0);
      break;
    case 7:
      sCtx.transform(0, -1, -1, 0, sHeight, sWidth);
      break;
    case 8:
      sCtx.transform(0, -1, 1, 0, 0, sWidth);
      break;
    default:
      break;
  }
  sCtx.drawImage(sImg, 0, 0);
}

function layoutForImageSize(sWidth, sHeight) {
  const wMax = DEFAULT_FLOATING_LAYOUT.width;
  if (!(sWidth > 0) || !(sHeight > 0)) {
    return DEFAULT_FLOATING_LAYOUT;
  }
  const wScale = wMax / Math.max(sWidth, sHeight);
  return {
    diffX: DEFAULT_FLOATING_LAYOUT.diffX,
    diffY: DEFAULT_FLOATING_LAYOUT.diffY,
    width: Math.max(40, Math.round(sWidth * wScale)),
    height: Math.max(40, Math.round(sHeight * wScale)),
    opacity: DEFAULT_FLOATING_LAYOUT.opacity,
  };
}

// Full-resolution data URLs are stored as a cell attribute and round-trip
// through WASM / undo JSON / .sker. Phone photos at native size (several MB)
// fail that path; small icons do not. Cap the stored bitmap like Excel compress.
const MAX_STORED_IMAGE_EDGE_PX = 1920;
const MAX_STORED_DATA_URL_CHARS = 1.5 * 1024 * 1024;
const JPEG_QUALITY_HIGH = 0.82;
const JPEG_QUALITY_MED = 0.7;
const JPEG_QUALITY_LOW = 0.55;

function storedImageSize(sWidth, sHeight) {
  const wWidth = Number(sWidth) || 0;
  const wHeight = Number(sHeight) || 0;
  const wLongest = Math.max(wWidth, wHeight);
  if (!(wLongest > MAX_STORED_IMAGE_EDGE_PX)) {
    return {
      width: Math.max(1, Math.round(wWidth)),
      height: Math.max(1, Math.round(wHeight)),
    };
  }
  const wScale = MAX_STORED_IMAGE_EDGE_PX / wLongest;
  return {
    width: Math.max(1, Math.round(wWidth * wScale)),
    height: Math.max(1, Math.round(wHeight * wScale)),
  };
}

function sourcePrefersPng(sMime) {
  const wMime = String(sMime || "").toLowerCase();
  return wMime.includes("png") || wMime.includes("gif") || wMime.includes("svg");
}

function encodeStoredCanvasDataUrl(sCanvas, sSourceMime) {
  if (sCanvas == null || !(sCanvas.width > 0) || !(sCanvas.height > 0)) {
    return "";
  }
  const wArea = sCanvas.width * sCanvas.height;
  const wTryPng = sourcePrefersPng(sSourceMime) && wArea <= 512 * 512;
  if (wTryPng) {
    const wPng = sCanvas.toDataURL("image/png");
    if (typeof wPng === "string" && wPng.startsWith("data:image/")
        && wPng.length <= MAX_STORED_DATA_URL_CHARS) {
      return wPng;
    }
  }
  const wQualities = [JPEG_QUALITY_HIGH, JPEG_QUALITY_MED, JPEG_QUALITY_LOW];
  let wBest = "";
  for (let wIdx = 0; wIdx < wQualities.length; wIdx++) {
    const wJpeg = sCanvas.toDataURL("image/jpeg", wQualities[wIdx]);
    if (typeof wJpeg !== "string" || !wJpeg.startsWith("data:image/")) {
      continue;
    }
    wBest = wJpeg;
    if (wJpeg.length <= MAX_STORED_DATA_URL_CHARS) {
      return wJpeg;
    }
  }
  return wBest;
}

function canvasFromImageSource(sSource, sSrcW, sSrcH, sOrientation = 1) {
  const wSwap = sOrientation >= 5;
  const wNaturalW = wSwap ? sSrcH : sSrcW;
  const wNaturalH = wSwap ? sSrcW : sSrcH;
  const wSize = storedImageSize(wNaturalW, wNaturalH);
  const wCanvas = document.createElement("canvas");
  wCanvas.width = wSize.width;
  wCanvas.height = wSize.height;
  const wCtx = wCanvas.getContext("2d");
  if (!wCtx) {
    return null;
  }
  wCtx.imageSmoothingEnabled = true;
  wCtx.imageSmoothingQuality = "high";
  if (sOrientation > 1) {
    const wScaleX = wSize.width / wNaturalW;
    const wScaleY = wSize.height / wNaturalH;
    wCtx.save();
    wCtx.scale(wScaleX, wScaleY);
    drawImageWithExifOrientation(wCtx, sSource, sOrientation, wNaturalW, wNaturalH);
    wCtx.restore();
  } else {
    wCtx.drawImage(sSource, 0, 0, wSize.width, wSize.height);
  }
  return wCanvas;
}

/**
 * Decode file, apply EXIF orientation, return upright compressed data URL.
 * Phone JPEGs are often stored sideways with an Orientation tag — raw FileReader
 * data URLs ignore that and appear rotated in <img>. Native-size bitmaps are
 * downscaled so the data URL stays small enough to persist in the workbook.
 */
export async function readImageFileForInsert(sFile) {
  const wMime = imageMimeType(sFile);

  if (typeof createImageBitmap === "function") {
    try {
      const wBitmap = await createImageBitmap(sFile, { imageOrientation: "from-image" });
      const wCanvas = canvasFromImageSource(wBitmap, wBitmap.width, wBitmap.height, 1);
      wBitmap.close?.();
      if (wCanvas) {
        const wDataUrl = encodeStoredCanvasDataUrl(wCanvas, wMime);
        if (wDataUrl) {
          return { dataUrl: wDataUrl, width: wCanvas.width, height: wCanvas.height };
        }
      }
    } catch (_) {
      // Fall back to manual EXIF handling below.
    }
  }

  const wRawUrl = await readFileAsDataUrlRaw(sFile);
  let wOrientation = 1;
  if (wMime.includes("jpeg") || wMime.includes("jpg")) {
    try {
      const wBuffer = await readFileAsArrayBuffer(sFile);
      wOrientation = parseJpegExifOrientation(wBuffer);
    } catch (_) {
      wOrientation = 1;
    }
  }

  const wImg = await loadImageElement(wRawUrl);
  const wCanvas = canvasFromImageSource(
    wImg,
    wImg.naturalWidth,
    wImg.naturalHeight,
    wOrientation,
  );
  if (!wCanvas) {
    return { dataUrl: wRawUrl, width: wImg.naturalWidth, height: wImg.naturalHeight };
  }
  const wDataUrl = encodeStoredCanvasDataUrl(wCanvas, wMime);
  if (!wDataUrl) {
    return { dataUrl: wRawUrl, width: wImg.naturalWidth, height: wImg.naturalHeight };
  }
  return { dataUrl: wDataUrl, width: wCanvas.width, height: wCanvas.height };
}

/** Normalized data URL (EXIF orientation applied). */
export async function readImageFileAsDataUrl(sFile) {
  const wResult = await readImageFileForInsert(sFile);
  return wResult.dataUrl;
}

function resolveAnchorCellRef(spInterface, cellRef) {
  if (typeof cellRef === "string" && cellRef.trim()) {
    return cellRef.trim();
  }
  const wSelect = spInterface?.m_Select;
  if (wSelect && typeof wSelect.cursorStr === "function") {
    return wSelect.cursorStr() || "";
  }
  return "";
}

/**
 * Insert a floating image on the active sheet (anchored on cellRef or current cursor).
 * @returns {Promise<string|null>} floating object name or null on failure
 */
export async function insertImageFloatingObject(
  spInterface,
  { dataUrl, altText, cellRef, width, height } = {},
) {
  if (
    spInterface == null ||
    !canApplyAsFloatingObject(IMAGE_FLOATING_CLASS) ||
    spInterface.m_InsertingImageFloating === true
  ) {
    return null;
  }

  const wDataUrl = dataUrl != null ? String(dataUrl) : "";
  if (!wDataUrl.startsWith("data:image/")) {
    console.warn("SkSpInsertImage: invalid image data URL");
    return null;
  }

  const wCellRef = resolveAnchorCellRef(spInterface, cellRef);
  if (!wCellRef) {
    return null;
  }

  if (typeof spInterface.loadUI === "function") {
    await spInterface.loadUI();
  }

  const wUi = typeof window !== "undefined" ? window.SkUISpreadSheet : null;
  if (
    !wUi ||
    typeof wUi.insertFloatingObject !== "function" ||
    typeof wUi.floatingObjectLayout !== "function"
  ) {
    console.warn("SkSpInsertImage: floating object API unavailable (rebuild wasm?)");
    return null;
  }

  spInterface.m_InsertingImageFloating = true;
  try {
    const wTargetSheet = await spInterface.getActiveSheet();
    if (!wTargetSheet) {
      return null;
    }

    let wExisting = [];
    if (typeof wUi.jsonFloatingObjectsForSheet === "function") {
      const wJson = wUi.jsonFloatingObjectsForSheet(wTargetSheet);
      wExisting = parseFloatingObjectsJson(wJson);
    }

    const wName = suggestFloatingObjectName(IMAGE_FLOATING_CLASS, wExisting);
    const wAnchorRef = buildFloatingAnchorCellRef(wTargetSheet, wCellRef);
    const wLayout = layoutForImageSize(width, height);

    spInterface.setExtraUndo && spInterface.setExtraUndo();

    if (typeof wUi.ensureCell === "function") {
      wUi.ensureCell(wCellRef, wTargetSheet);
    }

    const wInserted = wUi.insertFloatingObject(
      wName,
      IMAGE_FLOATING_CLASS,
      wTargetSheet,
      "",
      wLayout.diffX,
      wLayout.diffY,
      wLayout.width,
      wLayout.height,
      wLayout.opacity,
      wAnchorRef,
    );
    if (!wInserted) {
      console.error("SkSpInsertImage: insertFloatingObject failed", wName);
      return null;
    }

    const wDataOk = await spInterface.commitFloatingObjectAttribute(
      wName,
      "dataUrl",
      wDataUrl,
    );
    if (!wDataOk) {
      console.error("SkSpInsertImage: failed to set dataUrl on", wName);
      return null;
    }

    const wAlt = altText != null ? String(altText).trim() : "";
    if (wAlt) {
      await spInterface.commitFloatingObjectAttribute(wName, "altText", wAlt);
    }

    await spInterface.reloadView();
    spInterface.invalidateAll();
    spInterface.selectFloatingObject(wName);
    if (spInterface.m_SkSpClass != null) {
      spInterface.m_SkSpClass.setState?.({ selectedFloating: wName });
    }
    return wName;
  } catch (err) {
    console.error("SkSpInsertImage: insert failed", err);
    return null;
  } finally {
    spInterface.m_InsertingImageFloating = false;
  }
}

/** Open native file picker and insert the chosen image on the current cell. */
export function openImageFilePicker(spInterface) {
  if (typeof document === "undefined" || spInterface == null) {
    return;
  }
  const wInput = document.createElement("input");
  wInput.type = "file";
  wInput.accept = IMAGE_ACCEPT;
  wInput.style.display = "none";
  wInput.onchange = async () => {
    const wFile = wInput.files?.[0];
    wInput.remove();
    if (!wFile || !isImageFile(wFile)) {
      return;
    }
    try {
      const wImage = await readImageFileForInsert(wFile);
      await insertImageFloatingObject(spInterface, {
        dataUrl: wImage.dataUrl,
        altText: wFile.name || "Image",
        width: wImage.width,
        height: wImage.height,
      });
    } catch (err) {
      console.error("SkSpInsertImage: file picker failed", err);
    }
  };
  document.body.appendChild(wInput);
  wInput.click();
}

/** First image file from a DataTransfer (OS drag-and-drop). */
export function firstImageFileFromDataTransfer(sDataTransfer) {
  const wFiles = sDataTransfer?.files;
  if (wFiles == null || wFiles.length === 0) {
    return null;
  }
  for (let wIdx = 0; wIdx < wFiles.length; wIdx++) {
    const wFile = wFiles[wIdx];
    if (isImageFile(wFile)) {
      return wFile;
    }
  }
  return null;
}

export function dataTransferHasImageFiles(sDataTransfer) {
  return firstImageFileFromDataTransfer(sDataTransfer) != null;
}
