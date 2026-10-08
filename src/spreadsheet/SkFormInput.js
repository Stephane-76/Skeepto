//=============================================================================
// SkFormInput
// Form mode: keyboard and pointer stay on SkCellClass widgets.
//=============================================================================

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

function formWidgetElements() {
  const wList = Array.from(document.querySelectorAll(".SkSpCellClass"));
  wList.sort((a, b) => {
    const wA = a.getBoundingClientRect();
    const wB = b.getBoundingClientRect();
    if (Math.abs(wA.top - wB.top) > 4) {
      return wA.top - wB.top;
    }
    return wA.left - wB.left;
  });
  return wList.filter((el) => {
    const wRect = el.getBoundingClientRect();
    return wRect.width > 1 && wRect.height > 1;
  });
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
  }
}

export function setFormFocus(sp, el) {
  if (!sp || !el) {
    return;
  }
  if (sp.m_FormFocusEl && sp.m_FormFocusEl !== el) {
    sp.m_FormFocusEl.classList.remove(FORM_FOCUS_CLASS);
  }
  el.classList.add(FORM_FOCUS_CLASS);
  sp.m_FormFocusEl = el;
  const wRow = Number(el.getAttribute("data-cell-row"));
  const wCol = Number(el.getAttribute("data-cell-col"));
  sp.m_FormFocusRow = Number.isFinite(wRow) ? wRow : null;
  sp.m_FormFocusCol = Number.isFinite(wCol) ? wCol : null;
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
  return document.querySelector(
    `.SkSpCellClass[data-cell-row="${wRow}"][data-cell-col="${wCol}"]`
  );
}

/** Place the form cursor on the first widget in reading order. */
export async function focusFirstFormWidget(sp) {
  if (!sp?.isForm?.()) {
    return;
  }
  const wList = formWidgetElements();
  if (wList.length === 0) {
    return;
  }
  const wEl = wList[0];
  setFormFocus(sp, wEl);
  const wRow = Number(wEl.getAttribute("data-cell-row"));
  const wCol = Number(wEl.getAttribute("data-cell-col"));
  if (
    Number.isFinite(wRow) &&
    Number.isFinite(wCol) &&
    typeof sp.selectCellAt === "function"
  ) {
    await sp.selectCellAt(wRow, wCol);
  }
  if (typeof sp.focusGridCanvas === "function") {
    sp.focusGridCanvas();
  }
}

export async function moveFormFocus(sp, delta) {
  const wList = formWidgetElements();
  if (wList.length === 0) {
    return;
  }
  const wCurrent = currentFormEl(sp);
  let wIndex = wCurrent ? wList.indexOf(wCurrent) : -1;
  if (wIndex < 0) {
    wIndex = delta < 0 ? 0 : -1;
  }
  const wNext = (wIndex + delta + wList.length) % wList.length;
  const wEl = wList[wNext];
  setFormFocus(sp, wEl);
  const wRow = Number(wEl.getAttribute("data-cell-row"));
  const wCol = Number(wEl.getAttribute("data-cell-col"));
  if (
    Number.isFinite(wRow) &&
    Number.isFinite(wCol) &&
    typeof sp.selectCellAt === "function"
  ) {
    await sp.selectCellAt(wRow, wCol);
  }
  // selectCellAt can reload the grid and drop the node setFormFocus just marked.
  const wLive = document.querySelector(
    `.SkSpCellClass[data-cell-row="${wRow}"][data-cell-col="${wCol}"]`
  );
  if (wLive) {
    setFormFocus(sp, wLive);
  }
  if (typeof sp.focusGridCanvas === "function") {
    sp.focusGridCanvas();
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
      wOpener.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      if (typeof wOpener.focus === "function") {
        wOpener.focus();
      }
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
  if (wKey === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    if (FORM_TEXT_KINDS.has(wKind)) {
      await typeIntoFormTextBox(sp, wEl, "");
    } else {
      activateFormWidget(wEl);
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
