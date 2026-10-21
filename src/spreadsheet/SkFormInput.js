//=============================================================================
// SkFormInput
// Form mode: keyboard and pointer stay on SkCellClass widgets.
//=============================================================================
import { layoutToScreenScale } from "../utility/SkViewZoom.js";

const FORM_FOCUS_CLASS = "SkSpCellClass--formFocus";
const FORM_TEXT_KINDS = new Set([
  "SkCellClassTextBox",
  "SkCellClassString",
]);
const FORM_OPEN_KINDS = new Set([
  "SkCellClassComboBox",
  "SkCellClassCalendar",
  "SkCellClassNumber",
]);

/** DOM hooks shared by every in-cell widget the form walker can focus. */
export function formWidgetDomProps(sRow, sCol, sKind) {
  return {
    "data-cell-row": sRow,
    "data-cell-col": sCol,
    "data-sk-form-kind": sKind,
  };
}

function sheetPoint(sp, sRow, sCol, sSheet) {
  const wRow = Number(sRow) || 1;
  const wCol = Number(sCol) || 1;
  const wSheet = sSheet || sp?.m_UIView?.sheet || "";
  if (typeof sp?._anchorSheetPxSync === "function") {
    const wAnchor = sp._anchorSheetPxSync(wRow, wCol, wSheet);
    if (wAnchor != null) {
      return {
        left: Number(wAnchor.anchorX) || 0,
        top: Number(wAnchor.anchorY) || 0,
      };
    }
  }
  return { left: 0, top: 0 };
}

/** A floating object of the same class already represents this anchor. */
function floatCoversCell(sp, sRow, sCol, sKind) {
  const wObjects = sp?.m_FloatingObjects;
  if (!Array.isArray(wObjects) || !sKind) {
    return false;
  }
  for (const wEntry of wObjects) {
    if ((Number(wEntry?.ar) || 1) !== sRow || (Number(wEntry?.ac) || 1) !== sCol) {
      continue;
    }
    if (!wEntry?.n || wEntry.c !== sKind) {
      continue;
    }
    return true;
  }
  return false;
}

function cellIsFormWidget(sCell) {
  if (!sCell || sCell.c_t !== "c" || sCell.c__l === true || sCell.c__r === true) {
    return false;
  }
  const wValue = sCell.c_v;
  if (!wValue || typeof wValue !== "object" || !Object.prototype.hasOwnProperty.call(wValue, "co")) {
    return false;
  }
  return Number.isFinite(Number(sCell.c_r)) && Number.isFinite(Number(sCell.c_c));
}

function upsertFormStop(sp, sStop) {
  if (!sp.m_FormCatalog) {
    sp.m_FormCatalog = new Map();
  }
  const wPrev = sp.m_FormCatalog.get(sStop.key);
  if (wPrev) {
    wPrev.row = sStop.row;
    wPrev.col = sStop.col;
    wPrev.left = sStop.left;
    wPrev.top = sStop.top;
    if (sStop.name) {
      wPrev.name = sStop.name;
    }
    if (sStop.kind) {
      wPrev.kind = sStop.kind;
    }
    return;
  }
  sp.m_FormCatalog.set(sStop.key, sStop);
}

function harvestUiFormStops(sp, sUi) {
  const wRows = sUi?.rows;
  if (!Array.isArray(wRows)) {
    return;
  }
  const wSheet = sUi.sheet || sp?.m_UIView?.sheet || "";
  for (const wRow of wRows) {
    const wCells = wRow?.cells;
    if (!Array.isArray(wCells)) {
      continue;
    }
    for (const wCell of wCells) {
      if (!cellIsFormWidget(wCell)) {
        continue;
      }
      const wRowN = Number(wCell.c_r);
      const wColN = Number(wCell.c_c);
      const wKind = typeof wCell.c_v?.n === "string" ? wCell.c_v.n : "";
      if (floatCoversCell(sp, wRowN, wColN, wKind)) {
        continue;
      }
      const wPt = sheetPoint(sp, wRowN, wColN, wSheet);
      upsertFormStop(sp, {
        key: `c:${wRowN}:${wColN}`,
        row: wRowN,
        col: wColN,
        name: "",
        kind: wKind,
        left: wPt.left,
        top: wPt.top,
      });
    }
  }
}

/**
 * Remember every form zone the view has shown. Scrolling unmounts the ones
 * that leave the window; Tab still has to reach them.
 */
function harvestDomFormStops(sp) {
  const wNodes = document.querySelectorAll(".SkSpCellClass");
  for (const wEl of wNodes) {
    const wRowN = Number(wEl.getAttribute("data-cell-row"));
    const wColN = Number(wEl.getAttribute("data-cell-col"));
    if (!Number.isFinite(wRowN) || !Number.isFinite(wColN)) {
      continue;
    }
    const wName = wEl.getAttribute("data-sk-float-name") || "";
    const wKind = wEl.getAttribute("data-sk-form-kind") || "";
    if (!wName && floatCoversCell(sp, wRowN, wColN, wKind)) {
      continue;
    }
    const wEntry = wName && typeof sp.findFloatingObjectEntry === "function"
      ? sp.findFloatingObjectEntry(wName)
      : null;
    const wPt = sheetPoint(sp, wRowN, wColN, wEntry?.t || "");
    upsertFormStop(sp, {
      key: wName ? `f:${wName}` : `c:${wRowN}:${wColN}`,
      row: wName ? (Number(wEntry?.ar) || wRowN) : wRowN,
      col: wName ? (Number(wEntry?.ac) || wColN) : wColN,
      name: wName,
      kind: wKind || (typeof wEntry?.c === "string" ? wEntry.c : ""),
      left: wPt.left + (Number(wEntry?.dx) || 0),
      top: wPt.top + (Number(wEntry?.dy) || 0),
    });
  }
}

export function rememberFormStops(sp) {
  if (!sp) {
    return;
  }
  const wSheet = sp.m_UIView?.sheet || "";
  if (wSheet && sp.m_FormCatalogSheet && sp.m_FormCatalogSheet !== wSheet) {
    sp.m_FormCatalog = new Map();
  }
  if (wSheet) {
    sp.m_FormCatalogSheet = wSheet;
  }
  harvestDomFormStops(sp);
  harvestUiFormStops(sp, sp.m_UIView);
  harvestUiFormStops(sp, sp.m_UIViewFrozen);
  harvestUiFormStops(sp, sp.m_UIViewFrozenLeft);
  harvestUiFormStops(sp, sp.m_UIViewFrozenCorner);
  const wObjects = sp.m_FloatingObjects;
  if (Array.isArray(wObjects)) {
    for (const wEntry of wObjects) {
      if (wSheet && wEntry?.t && wEntry.t !== wSheet) {
        continue;
      }
      const wName = typeof wEntry?.n === "string" ? wEntry.n : "";
      if (!wName) {
        continue;
      }
      const wRowN = Number(wEntry.ar) || 1;
      const wColN = Number(wEntry.ac) || 1;
      const wPt = sheetPoint(sp, wRowN, wColN, wEntry.t || wSheet);
      upsertFormStop(sp, {
        key: `f:${wName}`,
        row: wRowN,
        col: wColN,
        name: wName,
        kind: typeof wEntry.c === "string" ? wEntry.c : "",
        left: wPt.left + (Number(wEntry.dx) || 0),
        top: wPt.top + (Number(wEntry.dy) || 0),
      });
    }
  }
}

function formStops(sp) {
  rememberFormStops(sp);
  const wList = Array.from(sp?.m_FormCatalog?.values?.() || []);
  wList.sort((a, b) => {
    if (Math.abs(a.top - b.top) > 4) {
      return a.top - b.top;
    }
    return a.left - b.left;
  });
  return wList;
}

function currentStopKey(sp) {
  const wName = sp?.m_FormFocusName || "";
  if (wName) {
    return `f:${wName}`;
  }
  const wRow = sp?.m_FormFocusRow;
  const wCol = sp?.m_FormFocusCol;
  if (wRow == null || wCol == null) {
    return "";
  }
  return `c:${wRow}:${wCol}`;
}

function queryFormStop(sStop) {
  if (!sStop) {
    return null;
  }
  if (sStop.name) {
    const wEsc = String(sStop.name).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const wByName = document.querySelector(
      `.SkSpCellClass[data-sk-float-name="${wEsc}"]`
    );
    if (wByName) {
      return wByName;
    }
  }
  // A floating object can share the anchor. A cell stop must land on the in-cell widget.
  const wNodes = document.querySelectorAll(
    `.SkSpCellClass[data-cell-row="${sStop.row}"][data-cell-col="${sStop.col}"]`
  );
  for (const wEl of wNodes) {
    if (!wEl.getAttribute("data-sk-float-name")) {
      return wEl;
    }
  }
  return null;
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** selectCellAt reloads the grid asynchronously; the widget mounts on the next paint. */
async function waitForFormStop(sStop, sTries = 10) {
  for (let wTry = 0; wTry < sTries; wTry += 1) {
    const wEl = queryFormStop(sStop);
    if (wEl) {
      return wEl;
    }
    await nextFrame();
  }
  return null;
}

async function focusFormStop(sp, sStop) {
  if (typeof sp.selectCellAt === "function") {
    await sp.selectCellAt(sStop.row, sStop.col);
  }
  let wEl = await waitForFormStop(sStop);
  if (!wEl) {
    return null;
  }
  setFormFocus(sp, wEl);
  await scrollFormWidgetIntoView(sp, wEl);
  const wAfter = (await waitForFormStop(sStop, 4)) || queryFormStop(sStop);
  if (wAfter) {
    setFormFocus(sp, wAfter);
    wEl = wAfter;
  }
  if (typeof sp.focusGridCanvas === "function") {
    sp.focusGridCanvas();
  }
  return wEl;
}

/** Visible sheet window in screen pixels (zoom overflow is clipped by the row). */
function formVisibleScreenRect() {
  const wSheet = document.querySelector(".SkSpreadSheet");
  if (!wSheet) {
    return null;
  }
  const wClip = wSheet.parentElement || wSheet;
  const wA = wSheet.getBoundingClientRect();
  const wB = wClip.getBoundingClientRect();
  const wLeft = Math.max(wA.left, wB.left, 0);
  const wTop = Math.max(wA.top, wB.top, 0);
  const wRight = Math.min(wA.right, wB.right, window.innerWidth);
  const wBottom = Math.min(wA.bottom, wB.bottom, window.innerHeight);
  if (wRight - wLeft < 2 || wBottom - wTop < 2) {
    return null;
  }
  return { left: wLeft, top: wTop, right: wRight, bottom: wBottom };
}

/** Scroll so this widget's full box meets the zoomed window, not only its sliver. */
async function scrollFormWidgetIntoView(sp, el) {
  if (!sp || !el || typeof sp.scrollViewByWheelDelta !== "function") {
    return;
  }
  const wVis = formVisibleScreenRect();
  if (!wVis) {
    return;
  }
  const wBox = el.getBoundingClientRect();
  const wScale = layoutToScreenScale(el);
  const wPad = 12;
  const wVisW = wVis.right - wVis.left;
  const wVisH = wVis.bottom - wVis.top;
  let wDx = 0;
  let wDy = 0;
  if (wBox.width >= wVisW - wPad * 2) {
    wDx = wBox.left - (wVis.left + wPad);
  } else if (wBox.left < wVis.left + wPad) {
    wDx = wBox.left - (wVis.left + wPad);
  } else if (wBox.right > wVis.right - wPad) {
    wDx = wBox.right - (wVis.right - wPad);
  }
  if (wBox.height >= wVisH - wPad * 2) {
    wDy = wBox.top - (wVis.top + wPad);
  } else if (wBox.top < wVis.top + wPad) {
    wDy = wBox.top - (wVis.top + wPad);
  } else if (wBox.bottom > wVis.bottom - wPad) {
    wDy = wBox.bottom - (wVis.bottom - wPad);
  }
  const wLayoutX = wDx / (wScale.x || 1);
  const wLayoutY = wDy / (wScale.y || 1);
  if (Math.abs(wLayoutX) < 1 && Math.abs(wLayoutY) < 1) {
    return;
  }
  await sp.scrollViewByWheelDelta(wLayoutX, wLayoutY);
}

function formKind(el) {
  if (!el) {
    return "";
  }
  return el.getAttribute("data-sk-form-kind") || "";
}

export function clearFormFocus(sp) {
  document.querySelectorAll("." + FORM_FOCUS_CLASS).forEach((el) => {
    el.classList.remove(FORM_FOCUS_CLASS);
  });
  if (sp) {
    sp.m_FormFocusEl = null;
    sp.m_FormFocusRow = null;
    sp.m_FormFocusCol = null;
    sp.m_FormFocusName = "";
  }
}

function formShellArea(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return 0;
  }
  const wBox = el.getBoundingClientRect();
  if (!(wBox.width >= 8 && wBox.height >= 8)) {
    return 0;
  }
  return wBox.width * wBox.height;
}

// The in-cell slice collapses to the viewport corner on scroll. The floating
// copy of the same anchor stays where it is drawn — that is the cursor.
function preferVisibleFormShell(el) {
  const wRow = el.getAttribute("data-cell-row");
  const wCol = el.getAttribute("data-cell-col");
  if (wRow == null || wCol == null || typeof document === "undefined") {
    return el;
  }
  const wNodes = document.querySelectorAll(
    `.SkSpCellClass[data-cell-row="${wRow}"][data-cell-col="${wCol}"]`
  );
  let wBest = el;
  let wBestArea = formShellArea(el);
  for (const wNode of wNodes) {
    const wArea = formShellArea(wNode);
    if (wArea > wBestArea * 1.25) {
      wBest = wNode;
      wBestArea = wArea;
    }
  }
  return wBest;
}

export function setFormFocus(sp, el) {
  if (!sp || !el) {
    return;
  }
  el = preferVisibleFormShell(el);
  if (formShellArea(el) <= 0) {
    return;
  }
  if (typeof document !== "undefined") {
    document.querySelectorAll("." + FORM_FOCUS_CLASS).forEach((node) => {
      if (node !== el) {
        node.classList.remove(FORM_FOCUS_CLASS);
      }
    });
  } else if (sp.m_FormFocusEl && sp.m_FormFocusEl !== el) {
    sp.m_FormFocusEl.classList.remove(FORM_FOCUS_CLASS);
  }
  el.classList.add(FORM_FOCUS_CLASS);
  sp.m_FormFocusEl = el;
  const wRow = Number(el.getAttribute("data-cell-row"));
  const wCol = Number(el.getAttribute("data-cell-col"));
  sp.m_FormFocusRow = Number.isFinite(wRow) ? wRow : null;
  sp.m_FormFocusCol = Number.isFinite(wCol) ? wCol : null;
  sp.m_FormFocusName = el.getAttribute("data-sk-float-name") || "";
}

function currentFormEl(sp) {
  const wEl = sp?.m_FormFocusEl;
  if (wEl && wEl.isConnected) {
    return wEl;
  }
  // The date commit reloads the grid and drops the old shell. The row and
  // column still name the cell the ring was on.
  const wRow = sp?.m_FormFocusRow;
  const wCol = sp?.m_FormFocusCol;
  if (wRow == null || wCol == null) {
    return null;
  }
  const wName = sp?.m_FormFocusName || "";
  if (wName) {
    const wEsc = String(wName).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const wByName = document.querySelector(
      `.SkSpCellClass[data-sk-float-name="${wEsc}"]`
    );
    if (wByName) {
      return wByName;
    }
  }
  const wNodes = document.querySelectorAll(
    `.SkSpCellClass[data-cell-row="${wRow}"][data-cell-col="${wCol}"]`
  );
  for (const wNode of wNodes) {
    if (!wNode.getAttribute("data-sk-float-name")) {
      return wNode;
    }
  }
  return null;
}

/** Place the form cursor on the first widget in reading order. */
export async function focusFirstFormWidget(sp) {
  if (!sp?.isForm?.()) {
    return;
  }
  const wList = formStops(sp);
  for (const wStop of wList) {
    const wEl = await focusFormStop(sp, wStop);
    if (wEl) {
      return;
    }
    sp.m_FormCatalog?.delete(wStop.key);
  }
}

export async function moveFormFocus(sp, delta) {
  if (!sp) {
    return;
  }
  const wStep = delta < 0 ? -1 : 1;
  const wFailed = new Set();
  for (let wHop = 0; wHop < 64; wHop += 1) {
    const wList = formStops(sp).filter((sStop) => !wFailed.has(sStop.key));
    if (wList.length === 0) {
      return;
    }
    const wKey = currentStopKey(sp);
    let wIndex = wList.findIndex((sStop) => sStop.key === wKey);
    if (wIndex < 0) {
      wIndex = wStep < 0 ? 0 : -1;
    }
    const wNext = (wIndex + wStep + wList.length) % wList.length;
    const wStop = wList[wNext];
    const wEl = await focusFormStop(sp, wStop);
    if (wEl) {
      return;
    }
    wFailed.add(wStop.key);
    sp.m_FormCatalog?.delete(wStop.key);
    if (wList.length <= 1) {
      return;
    }
  }
}

function activateFormWidget(el) {
  if (!el) {
    return;
  }
  const wKind = formKind(el);
  if (FORM_OPEN_KINDS.has(wKind)) {
    const wOpener = el.querySelector(
      "button, input, .SkCellClassComboBox-toggle, .SkCellClassCalendar-toggle"
    );
    if (wOpener) {
      // Do not focus the button. A focused toggle swallows later keys, and the
      // canvas listener (the only grid keyboard path) never sees them.
      wOpener.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return;
    }
  }
  const wSvg = el.querySelector("svg");
  const wTarget = wSvg || el;
  wTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

async function typeIntoFormTextBox(sp, el, key) {
  const wRow = Number(el?.getAttribute("data-cell-row"));
  const wCol = Number(el?.getAttribute("data-cell-col"));
  if (!Number.isFinite(wRow) || !Number.isFinite(wCol)) {
    return;
  }
  if (typeof sp.razAllselect === "function") {
    await sp.razAllselect();
  }
  if (typeof sp.selectCellAt === "function") {
    await sp.selectCellAt(wRow, wCol);
  }
  if (key && typeof sp.setLastChar === "function") {
    sp.setLastChar(key);
  }
  if (typeof sp.beginEdit === "function") {
    await sp.beginEdit();
  }
}

/** Canvas keydown while isForm is on. Returns true when the grid editor must not run. */
export async function handleFormKeyDown(event, sp) {
  if (!sp?.isForm?.()) {
    return false;
  }
  const wKey = event.key;
  if (wKey === "Tab" || wKey === "ArrowDown" || wKey === "ArrowRight") {
    event.preventDefault();
    event.stopPropagation();
    await moveFormFocus(sp, wKey === "Tab" && event.shiftKey ? -1 : 1);
    return true;
  }
  if (wKey === "ArrowUp" || wKey === "ArrowLeft") {
    event.preventDefault();
    event.stopPropagation();
    await moveFormFocus(sp, -1);
    return true;
  }

  const wEl = currentFormEl(sp);
  const wKind = formKind(wEl);
  if (wKey === "F2" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    if (wEl) {
      await typeIntoFormTextBox(sp, wEl, "");
    } else if (typeof sp.beginEdit === "function") {
      await sp.beginEdit();
    }
    return true;
  }
  if (wKey === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    if (FORM_TEXT_KINDS.has(wKind) || FORM_OPEN_KINDS.has(wKind)) {
      if (!sp.getUseEdit?.()) {
        await typeIntoFormTextBox(sp, wEl, "");
      }
      // Widget focus is async. If it misses, settle opens the formula bar
      // instead of leaving the keyboard on document.body.
      sp.m_SkSpGridCanvas?.settleKeyboardAfterEnter?.();
    } else {
      activateFormWidget(wEl);
      if (typeof sp.focusGridCanvas === "function") {
        sp.focusGridCanvas();
      }
    }
    return true;
  }
  if (wKey === " ") {
    event.preventDefault();
    event.stopPropagation();
    if (FORM_TEXT_KINDS.has(wKind)) {
      await typeIntoFormTextBox(sp, wEl, " ");
    } else {
      activateFormWidget(wEl);
    }
    return true;
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey && wKey.length === 1) {
    event.preventDefault();
    event.stopPropagation();
    // TextBox, Calendar and ComboBox open their own field and take the character.
    if (FORM_TEXT_KINDS.has(wKind) || FORM_OPEN_KINDS.has(wKind)) {
      await typeIntoFormTextBox(sp, wEl, wKey);
    }
    return true;
  }
  if (
    wKey === "Backspace" ||
    wKey === "Delete" ||
    event.ctrlKey ||
    event.metaKey
  ) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  return true;
}

/** True when this pointer event landed on a form widget or the grid surface. */
export function formPointerOnSheet(event) {
  const wTarget = event?.target;
  if (!wTarget || typeof wTarget.closest !== "function") {
    return false;
  }
  return Boolean(
    wTarget.closest(
      ".SkSpCellClass, .SkSpGridPanel, .SkSpGridCanvas, .SkSpFloatingLayer, .SkSpFloatingObject"
    )
  );
}
