import React from 'react';
import { Editor, findParentNode } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { TableCell, Table, TableKit } from '@tiptap/extension-table';

import SkComponent from './component/SkComponent.js';
import SkFontSelector from './component/SkFontSelector.js';
import SkColor from './component/SkColor.js';
import SkLoadingSpinner from './component/SkLoadingSpinner.js';
import { SkVirtualDiskClient } from './SkVirtualDiskClient.js';
import {
  getTextDocumentSession,
  clearTextDocumentSession,
  syncTextDocumentSession,
} from './SkActiveFile.js';
import SkTextEditorRangeInsertModal from './SkTextEditorRangeInsertModal.js';
import {
  beginSpreadsheetEmbedSession,
  endSpreadsheetEmbedSession,
} from './spreadsheet/SkWasmBootstrap.js';
import { registerBeforeLogoutCallback } from './SkSessionLifecycle.js';
import {
  formatSpreadsheetSourceButtonLabel,
  formatSpreadsheetSourceTooltip,
  readSpreadsheetTableSourceFromTableElement,
} from './spreadsheet/SkRangeToHtmlTable.js';
import { mergeSpreadsheetCellHtmlAttributes } from './spreadsheet/SkJsonViewToHtmlTable.js';
import {
  SKER_FORMATS_ATTR,
  SK_STYLE_ATTR,
  buildStandaloneHtmlDocumentFromFragment,
  extractHtmlFragmentFromStoredDocument,
  mergeSpreadsheetFormatIntoInlineStyle,
  parseFormatPoolAttribute,
  resolveSpreadsheetStyleFromCellElement,
} from './spreadsheet/SkeeptoTableFormatPool.js';
import { parseCssColor } from './utility/skCssColorContrast.js';
import { ReactComponent as SvgBold } from './svg/bold.svg';
import { ReactComponent as SvgItalic } from './svg/italic.svg';
import { ReactComponent as SvgUnderline } from './svg/underline.svg';
import { ReactComponent as SvgStrikethrough } from './svg/strikethrough.svg';
import { ReactComponent as SvgUndo } from './svg/undo.svg';
import { ReactComponent as SvgRedo } from './svg/redo.svg';
import { ReactComponent as SvgAlignLeft } from './svg/align-left.svg';
import { ReactComponent as SvgAlignCenter } from './svg/align-center.svg';
import { ReactComponent as SvgAlignRight } from './svg/align-right.svg';
import { ReactComponent as SvgAlignJustify } from './svg/align-justify.svg';
import { ReactComponent as SvgListUl } from './svg/list-ul.svg';
import { ReactComponent as SvgListOl } from './svg/list-ol.svg';
import { ReactComponent as SvgQuoteLeft } from './svg/quote-left.svg';
import { ReactComponent as SvgFileText } from './svg/file-text.svg';
import { ReactComponent as SvgFileAdd } from './svg/file-add.svg';
import { ReactComponent as SvgClose } from './svg/close.svg';
import { ReactComponent as SvgPrint } from './svg/print.svg';
import { ReactComponent as SvgFormatColorFillBucket } from './svg/format_color_fill_bucket.svg';
import { ReactComponent as SvgSpreadsheet } from './svg/spreadsheet.svg';

function spreadsheetVAlignFromInlineStyle(styleText) {
  const raw = String(styleText || '');
  if (!raw) return null;
  const match = raw.match(/vertical-align\s*:\s*(top|middle|bottom)/i);
  if (!match) return null;
  const value = match[1].toLowerCase();
  if (value === 'middle') return 'middle';
  if (value === 'bottom') return 'bottom';
  return 'top';
}

function spreadsheetHAlignFromInlineStyle(styleText) {
  const raw = String(styleText || '');
  if (!raw) return null;
  const match = raw.match(/text-align\s*:\s*(left|center|right)/i);
  if (!match) return null;
  const value = match[1].toLowerCase();
  if (value === 'center') return 'center';
  if (value === 'right') return 'right';
  return 'left';
}

function normalizeTableBlockAlign(value) {
  if (value === 'center' || value === 'right') {
    return value;
  }
  return 'left';
}

function parseCssDeclaration(styleText, propertyName) {
  const raw = String(styleText || '');
  if (!raw) {
    return null;
  }
  const match = raw.match(new RegExp(`(?:^|;)\\s*${propertyName}\\s*:\\s*([^;]+)`, 'i'));
  return match ? match[1].trim() : null;
}

function upsertCssDeclaration(styleText, propertyName, value) {
  const parts = String(styleText || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !new RegExp(`^${propertyName}\\s*:`, 'i').test(part));
  if (value != null && String(value).trim() !== '') {
    parts.push(`${propertyName}:${value}`);
  }
  return parts.length > 0 ? parts.join(';') : null;
}

function normalizeToolbarColor(color, fallback = '#000000') {
  if (!color) {
    return fallback;
  }
  const trimmed = String(color).trim();
  if (!trimmed) {
    return fallback;
  }
  const rgb = parseCssColor(trimmed);
  if (!rgb) {
    return trimmed;
  }
  const toHex = (channel) => channel.toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function parseFontFamilyFromCss(value) {
  if (!value) {
    return undefined;
  }
  return String(value).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}

function parseFontSizeFromCss(value) {
  if (!value) {
    return undefined;
  }
  return String(value).replace(/(px|pt)$/i, '');
}

function parseSpreadsheetCellToolbarFormat(cellAttrs) {
  const style = cellAttrs?.skStyle || '';
  const fontFamily = parseFontFamilyFromCss(parseCssDeclaration(style, 'font-family'));
  const fontSize = parseFontSizeFromCss(parseCssDeclaration(style, 'font-size'));
  const color = parseCssDeclaration(style, 'color');
  const bgFromStyle = parseCssDeclaration(style, 'background-color')
    || parseCssDeclaration(style, 'background');
  const backgroundColor = cellAttrs?.backgroundColor || bgFromStyle;
  return { fontFamily, fontSize, color, backgroundColor };
}

function isSpreadsheetTableNode(tableNode) {
  if (tableNode?.attrs?.spreadsheetKind === 'imported') {
    return true;
  }
  return Boolean(
    tableNode?.attrs?.skerWorkbook
    || tableNode?.attrs?.skerSheet
    || tableNode?.attrs?.skerRange
  );
}

function collectSpreadsheetCellsFromSelection(editor) {
  if (!editor) {
    return null;
  }
  const { selection } = editor.state;

  if (selection instanceof CellSelection) {
    const tableMatch = findParentNode((node) => node.type.name === 'table')(selection);
    if (!tableMatch || !isSpreadsheetTableNode(tableMatch.node)) {
      return null;
    }
    const cells = [];
    selection.forEachCell((cell, pos) => {
      cells.push({ pos, node: cell, attrs: cell.attrs });
    });
    return { tablePos: tableMatch.pos, cells };
  }

  const cellMatch = findParentNode((node) => (
    node.type.name === 'tableCell' || node.type.name === 'tableHeader'
  ))(selection);
  if (!cellMatch) {
    return null;
  }
  const tableMatch = findParentNode((node) => node.type.name === 'table')(selection);
  if (!tableMatch || !isSpreadsheetTableNode(tableMatch.node)) {
    return null;
  }
  return {
    tablePos: tableMatch.pos,
    cells: [{ pos: cellMatch.pos, node: cellMatch.node, attrs: cellMatch.node.attrs }],
  };
}

function applySpreadsheetCellAttrUpdates(editor, mapAttrs) {
  const ctx = collectSpreadsheetCellsFromSelection(editor);
  if (!ctx || ctx.cells.length === 0) {
    return false;
  }

  const { state, view } = editor;
  let tr = state.tr;
  const sorted = [...ctx.cells].sort((a, b) => b.pos - a.pos);
  for (const { pos, node } of sorted) {
    const nextAttrs = mapAttrs(node.attrs);
    if (nextAttrs) {
      tr = tr.setNodeMarkup(pos, undefined, nextAttrs);
    }
  }
  tr = tr.setSelection(state.selection.map(tr.doc, tr.mapping));
  view.dispatch(tr);
  return true;
}

function shouldApplySpreadsheetCellTextFormatting(editor) {
  const { selection } = editor.state;
  if (selection instanceof CellSelection) {
    return true;
  }
  return selection.empty;
}

function countSpreadsheetTableCells(tableNode) {
  let cellCount = 0;
  tableNode.descendants((node) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      cellCount += 1;
    }
  });
  return cellCount;
}

/** Block-align mode: whole table selected (Grid / node select / all cells). */
function getSpreadsheetTableAlignContext(editor) {
  if (!editor) {
    return null;
  }
  const { selection } = editor.state;

  if (selection instanceof NodeSelection && selection.node?.type?.name === 'table') {
    return {
      tablePos: selection.from,
      tableAlign: normalizeTableBlockAlign(selection.node.attrs?.tableAlign),
    };
  }

  if (selection instanceof CellSelection) {
    const tableMatch = findParentNode((node) => node.type.name === 'table')(selection);
    if (!tableMatch) {
      return null;
    }
    const cellCount = countSpreadsheetTableCells(tableMatch.node);
    if (cellCount > 0 && selection.ranges.length >= cellCount) {
      return {
        tablePos: tableMatch.pos,
        tableAlign: normalizeTableBlockAlign(tableMatch.node.attrs?.tableAlign),
      };
    }
  }

  return null;
}

function applySpreadsheetTableBlockAlign(editor, alignment, tablePosOverride = null) {
  if (!editor) {
    return false;
  }
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') {
    return false;
  }
  let tablePos = tablePosOverride;
  if (tablePos == null) {
    tablePos = getSpreadsheetTableAlignContext(editor)?.tablePos ?? null;
  }
  if (tablePos == null) {
    return false;
  }
  const { state, view } = editor;
  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== 'table') {
    return false;
  }
  const nextAlign = normalizeTableBlockAlign(alignment);
  const nextAttrs = {
    ...tableNode.attrs,
    tableAlign: nextAlign,
  };
  let tr = state.tr.setNodeMarkup(tablePos, undefined, nextAttrs);
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'table') {
    tr = tr.setSelection(NodeSelection.create(tr.doc, tablePos));
  } else if (sel instanceof CellSelection) {
    tr = tr.setSelection(sel.map(tr.doc, tr.mapping));
  } else {
    tr = tr.setSelection(NodeSelection.create(tr.doc, tablePos));
  }
  view.dispatch(tr);
  return true;
}

function getEditorHtmlForStandaloneExport(editor, options = {}) {
  if (!editor) {
    return '';
  }
  const title = options.title || 'Document';
  return buildStandaloneHtmlDocumentFromFragment(editor.getHTML(), { title });
}

function normalizeStoredEditorContent(rawContent) {
  return extractHtmlFragmentFromStoredDocument(rawContent);
}

const SpreadsheetTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableAlign: {
        default: 'left',
        parseHTML: (element) => (
          element.getAttribute('data-table-align')
          || element.closest?.('.SkTextEditor-spreadsheetTableWrap')?.getAttribute('data-table-align')
          || 'left'
        ),
        renderHTML: (attributes) => ({
          'data-table-align': attributes.tableAlign || 'left',
        }),
      },
      skerWorkbook: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sker-workbook') || null,
        renderHTML: (attributes) => {
          if (!attributes.skerWorkbook) {
            return {};
          }
          return { 'data-sker-workbook': attributes.skerWorkbook };
        },
      },
      skerSheet: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sker-sheet') || null,
        renderHTML: (attributes) => {
          if (!attributes.skerSheet) {
            return {};
          }
          return { 'data-sker-sheet': attributes.skerSheet };
        },
      },
      skerRange: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sker-range') || null,
        renderHTML: (attributes) => {
          if (!attributes.skerRange) {
            return {};
          }
          return { 'data-sker-range': attributes.skerRange };
        },
      },
      spreadsheetKind: {
        default: null,
        parseHTML: (element) => {
          if (element.classList.contains('SkTextEditor-spreadsheetTable--imported')) {
            return 'imported';
          }
          if (
            element.getAttribute('data-sker-workbook')
            || element.getAttribute('data-sker-sheet')
            || element.getAttribute('data-sker-range')
          ) {
            return 'imported';
          }
          return null;
        },
        renderHTML: (attributes) => {
          if (attributes.spreadsheetKind === 'imported') {
            return { class: 'SkTextEditor-spreadsheetTable SkTextEditor-spreadsheetTable--imported' };
          }
          return { class: 'SkTextEditor-spreadsheetTable' };
        },
      },
      formatPool: {
        default: null,
        parseHTML: (element) => {
          const pool = parseFormatPoolAttribute(element.getAttribute(SKER_FORMATS_ATTR));
          return pool.length > 0 ? pool : null;
        },
        renderHTML: (attributes) => {
          if (!Array.isArray(attributes.formatPool) || attributes.formatPool.length === 0) {
            return {};
          }
          return {
            [SKER_FORMATS_ATTR]: JSON.stringify(attributes.formatPool),
          };
        },
      },
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setTableAlign:
        (alignment) =>
        ({ editor }) => applySpreadsheetTableBlockAlign(editor, alignment),
    };
  },
});

// Preserve JsonView cell attrs through TipTap parse/render cycles.
const SpreadsheetTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element) => (
          element.style?.backgroundColor
          || element.style?.background
          || element.getAttribute('data-bg')
          || null
        ),
      },
      rowHeight: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-row-h');
          if (raw) {
            const n = parseInt(raw, 10);
            return Number.isFinite(n) && n > 0 ? n : null;
          }
          const h = element.style?.height;
          if (h) {
            const n = parseInt(String(h), 10);
            return Number.isFinite(n) && n > 0 ? n : null;
          }
          return null;
        },
      },
      skStyle: {
        default: null,
        parseHTML: (element) => resolveSpreadsheetStyleFromCellElement(element),
        renderHTML: (attributes) => {
          if (!attributes.skStyle) {
            return {};
          }
          return { [SK_STYLE_ATTR]: attributes.skStyle };
        },
      },
      vAlign: {
        default: 'bottom',
        parseHTML: (element) => (
          element.getAttribute('data-v-align')
          || spreadsheetVAlignFromInlineStyle(element.getAttribute('style'))
          || spreadsheetVAlignFromInlineStyle(element.getAttribute(SK_STYLE_ATTR))
          || spreadsheetVAlignFromInlineStyle(element.getAttribute('data-cell-style'))
          || 'bottom'
        ),
        renderHTML: (attributes) => {
          const key = attributes.vAlign || 'bottom';
          return { 'data-v-align': key };
        },
      },
      hAlign: {
        default: 'left',
        parseHTML: (element) => (
          element.getAttribute('data-h-align')
          || spreadsheetHAlignFromInlineStyle(element.getAttribute('style'))
          || spreadsheetHAlignFromInlineStyle(element.getAttribute(SK_STYLE_ATTR))
          || spreadsheetHAlignFromInlineStyle(element.getAttribute('data-cell-style'))
          || 'left'
        ),
        renderHTML: (attributes) => {
          const key = attributes.hAlign || 'left';
          return { 'data-h-align': key };
        },
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeSpreadsheetCellHtmlAttributes(
      node,
      HTMLAttributes,
      this.options.HTMLAttributes
    );
    return ['td', attrs, 0];
  },
});

/** Set by SkTextEditor while mounted — range image chrome opens edit modal. */
let skTextEditorSpreadsheetHost = null;

function spreadsheetRangeImageHasSource(node) {
  const attrs = node?.attrs || {};
  return Boolean(attrs.skerWorkbook || attrs.skerSheet || attrs.skerRange);
}

function spreadsheetRangeImageSourceFromNode(node) {
  const attrs = node?.attrs || {};
  const zoomRaw = Number(attrs.skerZoomPercent);
  return {
    workbookPath: attrs.skerWorkbook || '',
    sheet: attrs.skerSheet || '',
    range: attrs.skerRange || '',
    zoomPercent: Number.isFinite(zoomRaw) && zoomRaw >= 5 && zoomRaw <= 400
      ? Math.round(zoomRaw)
      : null,
  };
}

function spreadsheetRangeImageSourceFromPos(editor, pos) {
  if (!editor || typeof pos !== 'number') {
    return null;
  }
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'image') {
    return null;
  }
  return spreadsheetRangeImageSourceFromNode(node);
}

function syncSpreadsheetRangeImageElement(imgEl, node) {
  const attrs = node.attrs || {};
  imgEl.src = attrs.src || '';
  imgEl.alt = attrs.alt || '';
  if (attrs.title) {
    imgEl.title = attrs.title;
  } else {
    imgEl.removeAttribute('title');
  }
  if (attrs.width) {
    imgEl.width = Number(attrs.width);
  } else {
    imgEl.removeAttribute('width');
  }
  if (attrs.height) {
    imgEl.height = Number(attrs.height);
  } else {
    imgEl.removeAttribute('height');
  }
  imgEl.className = 'SkTextEditor-spreadsheetRangeImage';
  const pairs = [
    ['data-sker-workbook', attrs.skerWorkbook],
    ['data-sker-sheet', attrs.skerSheet],
    ['data-sker-range', attrs.skerRange],
    ['data-sker-zoom', attrs.skerZoomPercent],
  ];
  for (const [key, value] of pairs) {
    if (value != null && value !== '') {
      imgEl.setAttribute(key, String(value));
    } else {
      imgEl.removeAttribute(key);
    }
  }
}

function updateSpreadsheetRangeImageSourceButton(sourceBtn, node) {
  const source = spreadsheetRangeImageSourceFromNode(node);
  sourceBtn.textContent = formatSpreadsheetSourceButtonLabel(source);
  sourceBtn.title = formatSpreadsheetSourceTooltip(source);
}

function replaceSpreadsheetRangeImageAtPos(editor, pos, payload) {
  if (!editor || typeof pos !== 'number' || !payload?.dataUrl) {
    return false;
  }
  const { dataUrl, width, height, source, zoomPercent } = payload;
  const altParts = [source?.sheet, source?.range].filter(Boolean);
  const zoomAttr = Number.isFinite(Number(zoomPercent))
    ? Math.max(5, Math.min(400, Math.round(Number(zoomPercent))))
    : null;
  return editor
    .chain()
    .focus()
    .setNodeSelection(pos)
    .updateAttributes('image', {
      src: dataUrl,
      alt: altParts.join(' ') || 'Spreadsheet range',
      title: [source?.workbookPath, source?.sheet, source?.range].filter(Boolean).join(' · '),
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
      skerWorkbook: source?.workbookPath || null,
      skerSheet: source?.sheet || null,
      skerRange: source?.range || null,
      skerZoomPercent: zoomAttr,
    })
    .run();
}

/** Spreadsheet range snapshot — PNG data URL + sker source attrs for round-trip. */
const SpreadsheetRangeImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      skerWorkbook: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sker-workbook') || null,
        renderHTML: (attributes) => {
          if (!attributes.skerWorkbook) {
            return {};
          }
          return { 'data-sker-workbook': attributes.skerWorkbook };
        },
      },
      skerSheet: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sker-sheet') || null,
        renderHTML: (attributes) => {
          if (!attributes.skerSheet) {
            return {};
          }
          return { 'data-sker-sheet': attributes.skerSheet };
        },
      },
      skerRange: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sker-range') || null,
        renderHTML: (attributes) => {
          if (!attributes.skerRange) {
            return {};
          }
          return { 'data-sker-range': attributes.skerRange };
        },
      },
      skerZoomPercent: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-sker-zoom');
          if (raw == null || raw === '') {
            return null;
          }
          const n = Number(raw);
          return Number.isFinite(n) && n >= 5 && n <= 400 ? Math.round(n) : null;
        },
        renderHTML: (attributes) => {
          if (attributes.skerZoomPercent == null) {
            return {};
          }
          return { 'data-sker-zoom': String(attributes.skerZoomPercent) };
        },
      },
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const stopChromeEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      if (!spreadsheetRangeImageHasSource(node)) {
        const img = document.createElement('img');
        syncSpreadsheetRangeImageElement(img, node);
        return {
          dom: img,
          update(updatedNode) {
            if (updatedNode.type.name !== 'image') {
              return false;
            }
            syncSpreadsheetRangeImageElement(img, updatedNode);
            return true;
          },
        };
      }

      const dom = document.createElement('div');
      dom.className = 'SkTextEditor-spreadsheetRangeWrap';

      const chrome = document.createElement('div');
      chrome.className = 'SkTextEditor-tableChrome';

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'SkTextEditor-tableSelectHandle';
      selectBtn.title = 'Select snapshot';
      selectBtn.textContent = 'Grid';

      const sourceBtn = document.createElement('button');
      sourceBtn.type = 'button';
      sourceBtn.className = 'SkTextEditor-tableSourceHandle';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'SkTextEditor-tableRemoveHandle';
      removeBtn.title = 'Remove snapshot';
      removeBtn.textContent = '×';

      const img = document.createElement('img');
      syncSpreadsheetRangeImageElement(img, node);
      updateSpreadsheetRangeImageSourceButton(sourceBtn, node);

      chrome.appendChild(selectBtn);
      chrome.appendChild(sourceBtn);
      chrome.appendChild(removeBtn);
      dom.appendChild(chrome);
      dom.appendChild(img);

      const refreshChromeVisibility = () => {
        chrome.style.display = editor.isEditable ? '' : 'none';
      };
      refreshChromeVisibility();

      for (const btn of [selectBtn, sourceBtn, removeBtn]) {
        btn.addEventListener('mousedown', stopChromeEvent);
      }

      selectBtn.addEventListener('click', (event) => {
        stopChromeEvent(event);
        const pos = getPos();
        if (typeof pos !== 'number') {
          return;
        }
        editor.chain().focus().setNodeSelection(pos).run();
      });

      removeBtn.addEventListener('click', (event) => {
        stopChromeEvent(event);
        if (!editor.isEditable) {
          return;
        }
        const pos = getPos();
        if (typeof pos !== 'number') {
          return;
        }
        editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
      });

      sourceBtn.addEventListener('click', (event) => {
        stopChromeEvent(event);
        if (!editor.isEditable) {
          return;
        }
        const pos = getPos();
        const host = skTextEditorSpreadsheetHost;
        if (typeof pos !== 'number' || !host) {
          return;
        }
        host.openRangeEditModalForImage(
          pos,
          spreadsheetRangeImageSourceFromPos(editor, pos),
        );
      });

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'image') {
            return false;
          }
          syncSpreadsheetRangeImageElement(img, updatedNode);
          updateSpreadsheetRangeImageSourceButton(sourceBtn, updatedNode);
          refreshChromeVisibility();
          return true;
        },
        selectNode() {
          dom.classList.add('ProseMirror-selectednode');
        },
        deselectNode() {
          dom.classList.remove('ProseMirror-selectednode');
        },
      };
    };
  },
});

function tablePosFromResolvedPos($pos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'table') {
      return $pos.before(depth);
    }
  }
  return null;
}

function tablePosFromDom(editor, domEl) {
  if (!editor?.view || !domEl) {
    return null;
  }
  try {
    const rawPos = editor.view.posAtDOM(domEl, 0);
    return tablePosFromResolvedPos(editor.state.doc.resolve(rawPos));
  } catch (error) {
    return null;
  }
}

function resolveSpreadsheetTablePos(editor, wrapperEl = null) {
  if (!editor?.view) {
    return null;
  }
  if (wrapperEl) {
    const fromWrapper = tablePosFromDom(editor, wrapperEl);
    if (fromWrapper != null) {
      return fromWrapper;
    }
    const fromCell = tablePosFromDom(
      editor,
      wrapperEl.querySelector('td, th')
    );
    if (fromCell != null) {
      return fromCell;
    }
  }
  const tableMatch = findParentNode((node) => node.type.name === 'table')(editor.state.selection);
  return tableMatch?.pos ?? null;
}

function spreadsheetTableAlignFromWrapper(editor, wrapperEl) {
  const tablePos = resolveSpreadsheetTablePos(editor, wrapperEl);
  if (tablePos == null) {
    return 'left';
  }
  const node = editor.state.doc.nodeAt(tablePos);
  return normalizeTableBlockAlign(node?.attrs?.tableAlign);
}

function buildSpreadsheetTableCellSelection(editor, tablePos) {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') {
    return null;
  }
  const tableContentStart = tablePos + 1;
  let anchorCell = null;
  let headCell = null;
  table.descendants((node, pos) => {
    if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader') {
      return;
    }
    const cellPos = tableContentStart + pos;
    if (anchorCell === null) {
      anchorCell = cellPos;
    }
    headCell = cellPos;
  });
  if (anchorCell === null || headCell === null) {
    return null;
  }
  return { anchorCell, headCell };
}

function selectSpreadsheetTable(editor, wrapperEl = null) {
  const tablePos = resolveSpreadsheetTablePos(editor, wrapperEl);
  if (tablePos == null) {
    return false;
  }
  const { state, view } = editor;
  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== 'table') {
    return false;
  }
  try {
    const tr = state.tr.setSelection(NodeSelection.create(state.doc, tablePos));
    view.dispatch(tr);
    view.focus();
    return true;
  } catch (error) {
    const range = buildSpreadsheetTableCellSelection(editor, tablePos);
    if (!range) {
      return false;
    }
    return editor.chain().focus().setCellSelection(range).run();
  }
}

function deleteSpreadsheetTable(editor, wrapperEl = null) {
  const tablePos = resolveSpreadsheetTablePos(editor, wrapperEl);
  if (tablePos == null) {
    return false;
  }
  if (editor.chain().focus().setNodeSelection(tablePos).deleteTable().run()) {
    return true;
  }
  const range = buildSpreadsheetTableCellSelection(editor, tablePos);
  if (!range) {
    return false;
  }
  return editor.chain().focus().setCellSelection(range).deleteTable().run();
}

function readSpreadsheetTableSourceFromWrapper(editor, wrapper) {
  const tablePos = resolveSpreadsheetTablePos(editor, wrapper);
  if (tablePos != null) {
    const node = editor?.state?.doc?.nodeAt(tablePos);
    if (node?.attrs?.skerWorkbook || node?.attrs?.skerSheet || node?.attrs?.skerRange) {
      return {
        workbookPath: node.attrs.skerWorkbook || '',
        sheet: node.attrs.skerSheet || '',
        range: node.attrs.skerRange || '',
      };
    }
  }
  const table = wrapper?.querySelector?.('.SkTextEditor-spreadsheetTable');
  return readSpreadsheetTableSourceFromTableElement(table);
}

function replaceSpreadsheetTableHtml(editor, wrapper, html) {
  const tablePos = resolveSpreadsheetTablePos(editor, wrapper);
  if (tablePos == null || !html) {
    return false;
  }
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== 'table') {
    return false;
  }
  const tableAlign = normalizeTableBlockAlign(tableNode.attrs?.tableAlign);
  const from = tablePos;
  const to = tablePos + tableNode.nodeSize;
  editor.chain().focus().insertContentAt({ from, to }, html).run();
  applySpreadsheetTableBlockAlign(editor, tableAlign, tablePos);
  selectSpreadsheetTable(editor, wrapper);
  return true;
}

function bindSpreadsheetTableChrome(wrapper, editorHost) {
  const selectBtn = wrapper.querySelector('.SkTextEditor-tableSelectHandle');
  const removeBtn = wrapper.querySelector('.SkTextEditor-tableRemoveHandle');
  if (!selectBtn || !removeBtn || selectBtn.dataset.bound === '1') {
    return;
  }
  selectBtn.dataset.bound = '1';
  removeBtn.dataset.bound = '1';

  const stopChromeEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  selectBtn.addEventListener('mousedown', stopChromeEvent);
  removeBtn.addEventListener('mousedown', stopChromeEvent);
  selectBtn.addEventListener('click', (event) => {
    stopChromeEvent(event);
    if (editorHost.state.readOnly || !editorHost.editor) {
      return;
    }
    selectSpreadsheetTable(editorHost.editor, wrapper);
  });
  removeBtn.addEventListener('click', (event) => {
    stopChromeEvent(event);
    if (editorHost.state.readOnly || !editorHost.editor) {
      return;
    }
    deleteSpreadsheetTable(editorHost.editor, wrapper);
  });
}

function isSpreadsheetSourceTable(editor, wrapper) {
  const table = wrapper?.querySelector?.('.SkTextEditor-spreadsheetTable');
  if (!table) {
    return false;
  }
  const tablePos = resolveSpreadsheetTablePos(editor, wrapper);
  if (tablePos != null) {
    const node = editor?.state?.doc?.nodeAt(tablePos);
    if (node?.attrs?.spreadsheetKind === 'imported') {
      return true;
    }
  }
  if (table.classList.contains('SkTextEditor-spreadsheetTable--imported')) {
    return true;
  }
  // Legacy imported tables without persisted metadata still get the source button.
  return true;
}

function updateSpreadsheetTableSourceButton(wrapper, editorHost) {
  const chrome = wrapper.querySelector('.SkTextEditor-tableChrome');
  const table = wrapper.querySelector('.SkTextEditor-spreadsheetTable');
  if (!chrome || !table || !isSpreadsheetSourceTable(editorHost.editor, wrapper)) {
    wrapper.querySelector('.SkTextEditor-tableSourceHandle')?.remove();
    return;
  }
  if (editorHost.state.readOnly) {
    wrapper.querySelector('.SkTextEditor-tableSourceHandle')?.remove();
    return;
  }

  let sourceBtn = wrapper.querySelector('.SkTextEditor-tableSourceHandle');
  if (!sourceBtn) {
    sourceBtn = document.createElement('button');
    sourceBtn.type = 'button';
    sourceBtn.className = 'SkTextEditor-tableSourceHandle';
    const removeBtn = wrapper.querySelector('.SkTextEditor-tableRemoveHandle');
    if (removeBtn) {
      chrome.insertBefore(sourceBtn, removeBtn);
    } else {
      chrome.appendChild(sourceBtn);
    }
  }

  const source = readSpreadsheetTableSourceFromWrapper(editorHost.editor, wrapper);
  sourceBtn.textContent = formatSpreadsheetSourceButtonLabel(source || {});
  sourceBtn.title = formatSpreadsheetSourceTooltip(source || {});

  if (sourceBtn.dataset.bound === '1') {
    return;
  }
  sourceBtn.dataset.bound = '1';

  const stopChromeEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  sourceBtn.addEventListener('mousedown', stopChromeEvent);
  sourceBtn.addEventListener('click', (event) => {
    stopChromeEvent(event);
    if (editorHost.state.readOnly || !editorHost.editor) {
      return;
    }
    editorHost.openRangeEditModal(wrapper, source);
  });
}

const DEFAULT_CONTENT = '';

function draftStorageKey() {
  const email = String(sessionStorage.getItem('email') || 'anonymous').trim().toLowerCase();
  return `SkTextEditorDraft:${email}`;
}

function normalizeFontSize(fontSize) {
  const raw = String(fontSize || '').trim();
  if (!raw) {
    return '';
  }
  if (/^\d+$/.test(raw)) {
    return `${raw}pt`;
  }
  return raw;
}

function parseFontSizeForSelector(fontSize) {
  if (!fontSize) {
    return undefined;
  }
  return String(fontSize).replace(/(px|pt)$/i, '');
}

function parseFontFamilyForSelector(fontFamily) {
  if (!fontFamily) {
    return undefined;
  }
  return String(fontFamily).replace(/^['"]|['"]$/g, '');
}

class SkTextEditor extends SkComponent {
  constructor(props) {
    super(props);
    this.editorRef = React.createRef();
    this.fontSelectorRef = React.createRef();
    this.client = new SkVirtualDiskClient();
    this.editor = null;
    this.saveTimer = null;
    this.holdsDocumentLock = false;
    this.activeSpreadsheetTableWrapper = null;
    this.rangeEditWrapper = null;
    this.rangeEditImagePos = null;
    this.rangeModalInitialSelection = null;
    const pendingDocument = getTextDocumentSession();
    this.state = {
      statusMessage: '',
      loading: Boolean(pendingDocument?.path),
      fileName: pendingDocument?.name || '',
      documentPath: '',
      readOnly: false,
      textColor: '#000000',
      backgroundColor: '#ffffff',
      menuPopUpTextColor: false,
      menuPopUpBackgroundColor: false,
      recentColors: ['#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'],
      rangeInsertModalOpen: false,
      rangeModalMode: 'insert',
    };
  }

  isEditorOverlayOpen = () => {
    const {
      rangeInsertModalOpen,
      menuPopUpTextColor,
      menuPopUpBackgroundColor,
    } = this.state;
    if (rangeInsertModalOpen || menuPopUpTextColor || menuPopUpBackgroundColor) {
      return true;
    }
    return Boolean(document.querySelector('.SkTextEditor .SkModal-overlay'));
  };

  handleEscapeKeyDown = (event) => {
    if (event.key !== 'Escape') {
      return false;
    }

    const {
      rangeInsertModalOpen,
      menuPopUpTextColor,
      menuPopUpBackgroundColor,
    } = this.state;

    if (menuPopUpTextColor || menuPopUpBackgroundColor) {
      event.preventDefault();
      event.stopPropagation();
      this.setState({
        menuPopUpTextColor: false,
        menuPopUpBackgroundColor: false,
      });
      return true;
    }

    if (rangeInsertModalOpen || document.querySelector('.SkTextEditor .SkModal-overlay')) {
      event.preventDefault();
      event.stopPropagation();
      this.closeRangeInsertModal();
      return true;
    }

    // TipTap may preventDefault on Escape (clear selection) — do not exit the editor for that.
    if (event.defaultPrevented) {
      return true;
    }

    return false;
  };

  async componentDidMount() {
    this.handleDocumentKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (this.handleEscapeKeyDown(event)) {
          event.stopImmediatePropagation();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.leaveEditor();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'p' &&
        event.target?.closest?.('.SkTextEditor')
      ) {
        event.preventDefault();
        this.printDocument();
      }
    };
    // Capture phase so open modals close before TipTap/ProseMirror handles Escape.
    document.addEventListener('keydown', this.handleDocumentKeyDown, true);
    this.handleToolbarClickOutside = (event) => {
      if (event.target?.closest?.('.SkTextEditor-colorTool')) {
        return;
      }
      if (this.state.menuPopUpTextColor || this.state.menuPopUpBackgroundColor) {
        this.setState({
          menuPopUpTextColor: false,
          menuPopUpBackgroundColor: false,
        });
      }
    };
    document.addEventListener('mousedown', this.handleToolbarClickOutside, true);
    this.unregisterBeforeLogout = registerBeforeLogoutCallback(async () => {
      await this.flushEditorBeforeClose();
      await endSpreadsheetEmbedSession();
    });
    await beginSpreadsheetEmbedSession();
    await this.bootstrapEditor();
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.handleToolbarClickOutside, true);
    document.removeEventListener('keydown', this.handleDocumentKeyDown, true);
    document.body.classList.remove('SkTextEditor-print');
    if (this.unregisterBeforeLogout) {
      this.unregisterBeforeLogout();
      this.unregisterBeforeLogout = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void (async () => {
      await this.flushEditorBeforeClose();
      await endSpreadsheetEmbedSession();
    })();
    this.editor?.destroy();
    this.editor = null;
    skTextEditorSpreadsheetHost = null;
  }

  flushEditorBeforeClose = async () => {
    if (!this.editor || this.state.readOnly || !this.holdsDocumentLock) {
      return;
    }
    if (!sessionStorage.getItem('jwt')) {
      return;
    }
    try {
      await this.saveDocument({ navigateAfter: false });
      await this.releaseEditorLock();
    } catch (error) {
      console.warn('SkTextEditor: flushEditorBeforeClose failed', error);
    }
  };

  getSession() {
    return getTextDocumentSession();
  }

  async bootstrapEditor() {
    const session = this.getSession();
    let content = DEFAULT_CONTENT;
    let fileName = '';
    let documentPath = '';
    let readOnly = false;
    let statusMessage = '';
    let holdsDocumentLock = false;

    if (session?.path) {
      documentPath = session.path;
      fileName = session.name || session.path.split('/').pop() || '';
      readOnly = session.canWrite === false;

      if (!readOnly) {
        try {
          await this.client.acquireDocumentLock(session.path);
          holdsDocumentLock = true;
        } catch (lockError) {
          if (lockError?.status === 409) {
            readOnly = true;
            const lockedBy = lockError.lock?.lockedBy || 'another user';
            statusMessage = `Locked by ${lockedBy}`;
            syncTextDocumentSession({
              ...session,
              canWrite: false,
              timestamp: Date.now(),
            });
          } else {
            console.error('SkTextEditor: lock failed', lockError);
            statusMessage = 'Unable to lock the document';
            readOnly = true;
          }
        }
      }

      try {
        const file = await this.client.readFileContent(session.path);
        if (typeof file?.content === 'string' && file.content.length > 0) {
          content = normalizeStoredEditorContent(file.content);
        }
        if (!fileName && file?.name) {
          fileName = file.name;
        }
      } catch (error) {
        console.error('SkTextEditor: unable to load document', error);
        statusMessage = statusMessage || 'Unable to load the document';
        content = normalizeStoredEditorContent(this.loadLocalDraft()) || DEFAULT_CONTENT;
      }
    } else {
      content = normalizeStoredEditorContent(this.loadLocalDraft()) || DEFAULT_CONTENT;
    }

    this.holdsDocumentLock = holdsDocumentLock;
    this.initEditor(content, readOnly);
    this.setState({
      loading: false,
      fileName,
      documentPath,
      readOnly,
      statusMessage,
    });
  }

  initEditor(content, readOnly) {
    this.editor = new Editor({
      element: this.editorRef.current,
      extensions: [
        StarterKit,
        TableKit.configure({
          table: false,
          tableCell: false,
        }),
        SpreadsheetTable.configure({
          HTMLAttributes: {},
          resizable: false,
          allowTableNodeSelection: true,
        }),
        SpreadsheetTableCell.configure({
          HTMLAttributes: {
            class: 'SkSpCell',
          },
        }),
        TextAlign.configure({
          types: ['heading', 'paragraph'],
        }),
        SpreadsheetRangeImage.configure({
          allowBase64: true,
          HTMLAttributes: {
            class: 'SkTextEditor-spreadsheetRangeImage',
          },
        }),
        TextStyleKit.configure({
          lineHeight: false,
        }),
      ],
      content,
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: 'SkTextEditor-content',
        },
        handlePaste: this.handleEditorPaste,
        handleDrop: this.handleEditorDrop,
        handleClick: this.handleSpreadsheetTableChromeClick,
        handleKeyDown: (_view, event) => {
          if (event.key !== 'Escape') {
            return false;
          }
          if (this.isEditorOverlayOpen()) {
            return this.handleEscapeKeyDown(event);
          }
          return false;
        },
      },
      onUpdate: () => {
        this.scheduleSave();
        this.syncSpreadsheetTableHandles();
      },
      onSelectionUpdate: ({ editor }) => {
        this.syncToolbarFromEditor(editor);
        this.syncSpreadsheetTableHandles();
        const alignCtx = getSpreadsheetTableAlignContext(editor);
        if (alignCtx) {
          const wrapper = this.editorRef.current?.querySelector(
            `.tableWrapper.ProseMirror-selectednode, .SkTextEditor-spreadsheetTableWrap.ProseMirror-selectednode`
          );
          if (wrapper) {
            this.activeSpreadsheetTableWrapper = wrapper;
          }
        } else if (!this.activeSpreadsheetTableWrapper) {
          this.activeSpreadsheetTableWrapper = null;
        } else {
          const stillInside = resolveSpreadsheetTablePos(
            editor,
            this.activeSpreadsheetTableWrapper
          );
          const sel = editor.state.selection;
          const inActiveTable = stillInside != null && (
            sel instanceof NodeSelection
            || sel instanceof CellSelection
            || findParentNode((node) => node.type.name === 'table')(sel)?.pos === stillInside
          );
          if (!inActiveTable) {
            this.activeSpreadsheetTableWrapper = null;
          }
        }
        this.forceUpdate();
      },
      onTransaction: () => this.forceUpdate(),
    });
    skTextEditorSpreadsheetHost = this;
    this.syncToolbarFromEditor(this.editor);
    this.syncSpreadsheetTableHandles();
  }

  syncSpreadsheetTableHandles = () => {
    const root = this.editorRef.current;
    if (!root) {
      return;
    }
    root.querySelectorAll('.tableWrapper').forEach((wrapper) => {
      const table = wrapper.querySelector('.SkTextEditor-spreadsheetTable');
      if (!table) {
        wrapper.classList.remove('SkTextEditor-spreadsheetTableWrap');
        wrapper.querySelector('.SkTextEditor-tableChrome')?.remove();
        return;
      }
      wrapper.classList.add('SkTextEditor-spreadsheetTableWrap');
      if (!wrapper.querySelector('.SkTextEditor-tableChrome')) {
        const chrome = document.createElement('div');
        chrome.className = 'SkTextEditor-tableChrome';
        chrome.innerHTML = [
          '<button type="button" class="SkTextEditor-tableSelectHandle" title="Select grid">Grid</button>',
          '<button type="button" class="SkTextEditor-tableRemoveHandle" title="Remove grid">×</button>',
        ].join('');
        wrapper.insertBefore(chrome, table);
      }
      bindSpreadsheetTableChrome(wrapper, this);
      updateSpreadsheetTableSourceButton(wrapper, this);
      const tableAlign = spreadsheetTableAlignFromWrapper(this.editor, wrapper);
      wrapper.setAttribute('data-table-align', tableAlign);
      table.setAttribute('data-table-align', tableAlign);
    });
  };

  syncToolbarFromEditor(editor = this.editor) {
    if (!editor) {
      return;
    }
    const textAttrs = editor.getAttributes('textStyle') || {};
    const cellCtx = collectSpreadsheetCellsFromSelection(editor);
    const partialText = cellCtx
      && !editor.state.selection.empty
      && !(editor.state.selection instanceof CellSelection);

    let fontFamily = parseFontFamilyForSelector(textAttrs.fontFamily);
    let fontSize = parseFontSizeForSelector(textAttrs.fontSize);
    let textColor = textAttrs.color ? normalizeToolbarColor(textAttrs.color) : null;
    let backgroundColor = textAttrs.backgroundColor
      ? normalizeToolbarColor(textAttrs.backgroundColor, '#ffffff')
      : null;

    if (cellCtx) {
      const cellFmt = parseSpreadsheetCellToolbarFormat(cellCtx.cells[0]?.attrs);
      if (!partialText || !fontFamily) {
        fontFamily = fontFamily || cellFmt.fontFamily;
      }
      if (!partialText || !fontSize) {
        fontSize = fontSize || cellFmt.fontSize;
      }
      if (!partialText || !textColor) {
        textColor = textColor || normalizeToolbarColor(cellFmt.color, '#000000');
      }
      backgroundColor = normalizeToolbarColor(cellFmt.backgroundColor, '#ffffff');
    }

    textColor = textColor || '#000000';
    backgroundColor = backgroundColor || '#ffffff';

    const selector = this.fontSelectorRef.current;
    if (selector?.syncFont) {
      selector.syncFont(
        fontFamily || undefined,
        fontSize || undefined
      );
    }
    this.setState((prev) => {
      if (prev.textColor === textColor && prev.backgroundColor === backgroundColor) {
        return null;
      }
      return { textColor, backgroundColor };
    });
  }

  openTextColorPicker = () => {
    if (this.state.readOnly) {
      return;
    }
    this.setState({
      menuPopUpBackgroundColor: false,
      menuPopUpTextColor: true,
    });
  };

  openBackgroundColorPicker = () => {
    if (this.state.readOnly) {
      return;
    }
    this.setState({
      menuPopUpTextColor: false,
      menuPopUpBackgroundColor: true,
    });
  };

  applyTextColor = (color, options = {}) => {
    if (!this.editor || this.state.readOnly || !color) {
      return;
    }
    const { closePopup = true } = options;
    const normalized = normalizeToolbarColor(color, '#000000');
    this.setState((prev) => ({
      textColor: normalized,
      recentColors: [normalized, ...prev.recentColors.filter((entry) => entry !== normalized)].slice(0, 10),
      ...(closePopup ? { menuPopUpTextColor: false } : {}),
    }));
    if (shouldApplySpreadsheetCellTextFormatting(this.editor)) {
      applySpreadsheetCellAttrUpdates(this.editor, (attrs) => ({
        ...attrs,
        skStyle: upsertCssDeclaration(attrs.skStyle, 'color', normalized),
      }));
      this.editor.view.focus();
      return;
    }
    this.editor.chain().focus().setColor(normalized).run();
  };

  applyBackgroundColor = (color, options = {}) => {
    if (!this.editor || this.state.readOnly || !color) {
      return;
    }
    const { closePopup = true } = options;
    const normalized = normalizeToolbarColor(color, '#ffffff');
    this.setState((prev) => ({
      backgroundColor: normalized,
      recentColors: [normalized, ...prev.recentColors.filter((entry) => entry !== normalized)].slice(0, 10),
      ...(closePopup ? { menuPopUpBackgroundColor: false } : {}),
    }));
    if (collectSpreadsheetCellsFromSelection(this.editor)) {
      applySpreadsheetCellAttrUpdates(this.editor, (attrs) => ({
        ...attrs,
        backgroundColor: normalized,
        skStyle: upsertCssDeclaration(attrs.skStyle, 'background-color', null),
      }));
      this.editor.view.focus();
      return;
    }
    this.editor.chain().focus().setBackgroundColor(normalized).run();
  };

  applyFontFamily = (_event, fontName, fontSize) => {
    if (!this.editor || this.state.readOnly) {
      return;
    }
    const normalizedSize = normalizeFontSize(fontSize);
    if (shouldApplySpreadsheetCellTextFormatting(this.editor)) {
      applySpreadsheetCellAttrUpdates(this.editor, (attrs) => {
        let style = attrs.skStyle || '';
        if (fontName) {
          const escaped = String(fontName).replace(/"/g, '\\"');
          style = upsertCssDeclaration(style, 'font-family', `"${escaped}"`);
        }
        if (normalizedSize) {
          style = upsertCssDeclaration(style, 'font-size', normalizedSize);
        }
        return { ...attrs, skStyle: style };
      });
      this.editor.view.focus();
      this.syncToolbarFromEditor();
      return;
    }
    const chain = this.editor.chain().focus();
    if (fontName) {
      chain.setFontFamily(fontName);
    }
    if (normalizedSize) {
      chain.setFontSize(normalizedSize);
    }
    chain.run();
  };

  applyFontSize = (_event, _fontName, fontSize) => {
    if (!this.editor || this.state.readOnly) {
      return;
    }
    const normalizedSize = normalizeFontSize(fontSize);
    if (!normalizedSize) {
      return;
    }
    if (shouldApplySpreadsheetCellTextFormatting(this.editor)) {
      applySpreadsheetCellAttrUpdates(this.editor, (attrs) => ({
        ...attrs,
        skStyle: upsertCssDeclaration(attrs.skStyle, 'font-size', normalizedSize),
      }));
      this.editor.view.focus();
      this.syncToolbarFromEditor();
      return;
    }
    this.editor.chain().focus().setFontSize(normalizedSize).run();
  };

  insertImageFromFile(file) {
    if (!this.editor || this.state.readOnly || !file?.type?.startsWith('image/')) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : '';
      if (!src) {
        return;
      }
      this.editor.chain().focus().setImage({ src }).run();
    };
    reader.onerror = () => {
      console.warn('SkTextEditor: unable to read image file');
      this.setState({ statusMessage: 'Unreadable image' });
    };
    reader.readAsDataURL(file);
  }

  handleEditorPaste = (_view, event) => {
    if (this.state.readOnly || !this.editor) {
      return false;
    }
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) {
      return false;
    }
    const file = imageItem.getAsFile();
    if (!file) {
      return false;
    }
    event.preventDefault();
    this.insertImageFromFile(file);
    return true;
  };

  handleEditorDrop = (_view, event) => {
    if (this.state.readOnly || !this.editor) {
      return false;
    }
    const imageFile = Array.from(event.dataTransfer?.files || []).find((file) =>
      file.type.startsWith('image/')
    );
    if (!imageFile) {
      return false;
    }
    event.preventDefault();
    this.insertImageFromFile(imageFile);
    return true;
  };

  handleSpreadsheetTableChromeClick = (_view, _pos, event) => {
    if (this.state.readOnly || !this.editor) {
      return false;
    }
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') {
      return false;
    }
    const wrapper = target.closest('.SkTextEditor-spreadsheetTableWrap, .tableWrapper');
    const removeHandle = target.closest('.SkTextEditor-tableRemoveHandle');
    if (removeHandle) {
      event.preventDefault();
      event.stopPropagation();
      this.deleteActiveSpreadsheetTable(wrapper);
      return true;
    }
    const selectHandle = target.closest('.SkTextEditor-tableSelectHandle');
    if (selectHandle) {
      event.preventDefault();
      event.stopPropagation();
      this.selectEntireSpreadsheetTable(wrapper);
      return true;
    }
    return false;
  };

  selectEntireSpreadsheetTable = (wrapperEl = null) => {
    if (!this.editor || this.state.readOnly) {
      return;
    }
    if (wrapperEl) {
      this.activeSpreadsheetTableWrapper = wrapperEl;
    }
    selectSpreadsheetTable(this.editor, wrapperEl);
    this.forceUpdate();
  };

  deleteActiveSpreadsheetTable = (wrapperEl = null) => {
    if (!this.editor || this.state.readOnly) {
      return;
    }
    deleteSpreadsheetTable(this.editor, wrapperEl);
  };

  loadLocalDraft() {
    try {
      const raw = window.localStorage.getItem(draftStorageKey()) || '';
      return normalizeStoredEditorContent(raw);
    } catch (error) {
      console.warn('SkTextEditor: unable to read draft', error);
      return '';
    }
  }

  saveLocalDraft() {
    if (!this.editor) return;
    try {
      const title = this.state.fileName || 'Document';
      window.localStorage.setItem(
        draftStorageKey(),
        getEditorHtmlForStandaloneExport(this.editor, { title })
      );
    } catch (error) {
      console.warn('SkTextEditor: unable to save draft', error);
    }
  }

  formatSaveError(error) {
    if (error?.status === 409) {
      const lockedBy = error.lock?.lockedBy;
      if (lockedBy) {
        return `Document locked by ${lockedBy}`;
      }
      return error.message || 'Document locked or lock expired';
    }
    return 'Unable to save';
  }

  navigateToVirtualDisk(filePath) {
    if (filePath) {
      try {
        sessionStorage.setItem(
          'SkVirtualDiskSelection',
          JSON.stringify({ path: filePath, timestamp: Date.now() })
        );
      } catch (error) {
        console.warn('SkTextEditor: unable to persist disk selection', error);
      }
    }
    if (typeof window.__skerNavigate === 'function') {
      window.__skerNavigate('/virtualdisk', { replace: true });
    }
  }

  async releaseEditorLock() {
    const path = this.state.documentPath;
    if (!this.holdsDocumentLock || !path) {
      return;
    }
    await this.client.releaseDocumentLock(path);
    this.holdsDocumentLock = false;
  }

  async leaveEditor() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const path = this.state.documentPath;
    await this.releaseEditorLock();
    this.navigateToVirtualDisk(path);
  }

  removeSpreadsheetTableChromeForPrint = () => {
    const root = this.editorRef.current;
    if (!root) {
      return;
    }
    root.querySelectorAll('.SkTextEditor-tableChrome').forEach((chrome) => {
      chrome.remove();
    });
  };

  /** Merge data-cell-style / data-bg onto inline style so PDF print keeps Excel colors. */
  prepareSpreadsheetCellsForPrint = () => {
    const root = this.editorRef.current;
    if (!root) {
      return;
    }
    root.querySelectorAll(
      '.SkTextEditor-spreadsheetTable--imported td, .SkTextEditor-spreadsheetTable--imported th'
    ).forEach((cell) => {
      const dataStyle = resolveSpreadsheetStyleFromCellElement(cell) || '';
      const merged = mergeSpreadsheetFormatIntoInlineStyle(
        cell.getAttribute('style') || '',
        dataStyle,
        cell.getAttribute('data-bg')
      );
      if (merged) {
        cell.setAttribute('style', merged);
      }
    });
  };

  printDocument() {
    if (!this.editor) {
      return;
    }
    let cleanedUp = false;
    let fallbackTimer = null;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      if (fallbackTimer != null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      document.body.classList.remove('SkTextEditor-print');
      window.removeEventListener('afterprint', cleanup);
      this.syncSpreadsheetTableHandles();
    };

    document.body.classList.add('SkTextEditor-print');
    this.removeSpreadsheetTableChromeForPrint();
    this.prepareSpreadsheetCellsForPrint();
    window.addEventListener('afterprint', cleanup);
    // Fallback when afterprint never fires (some Safari / cancel paths).
    fallbackTimer = window.setTimeout(cleanup, 10000);
    window.print();
  }

  async saveDocument(options = {}) {
    const { navigateAfter = false } = options;
    if (!this.editor || this.state.readOnly) return false;

    const session = this.getSession();
    const title = this.state.fileName || session?.name || 'Document';
    const html = getEditorHtmlForStandaloneExport(this.editor, { title });
    const targetPath = session?.path || this.state.documentPath || '';

    if (targetPath && session?.canWrite !== false && this.holdsDocumentLock) {
      try {
        await this.client.writeFileContent(targetPath, html);
        if (navigateAfter) {
          if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
          }
          await this.releaseEditorLock();
          this.navigateToVirtualDisk(targetPath);
          return true;
        }
        const fileLabel = targetPath.split('/').pop() || targetPath;
        this.setState({ statusMessage: `Saved (${fileLabel})` });
        return true;
      } catch (error) {
        console.error('SkTextEditor: unable to save document', error);
        if (error?.status === 409) {
          this.editor.setEditable(false);
          this.holdsDocumentLock = false;
          this.setState({
            readOnly: true,
            statusMessage: this.formatSaveError(error),
          });
        } else {
          this.setState({ statusMessage: this.formatSaveError(error) });
        }
        return false;
      }
    }

    this.saveLocalDraft();
    this.setState({ statusMessage: 'Draft saved' });
    return true;
  }

  scheduleSave() {
    if (this.state.readOnly) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveDocument({ navigateAfter: false });
      this.saveTimer = null;
    }, 800);
  }

  runCommand(runner) {
    if (!this.editor || this.state.readOnly) return;
    runner(this.editor.chain().focus()).run();
  }

  isActive(name, attrs) {
    return this.editor?.isActive(name, attrs) ?? false;
  }

  startLocalDraft() {
    const path = this.state.documentPath;
    if (this.holdsDocumentLock && path) {
      this.client.releaseDocumentLock(path);
      this.holdsDocumentLock = false;
    }
    clearTextDocumentSession();
    if (this.editor) {
      this.editor.commands.setContent(DEFAULT_CONTENT);
      this.editor.setEditable(true);
    }
    this.setState({
      fileName: '',
      documentPath: '',
      readOnly: false,
      statusMessage: 'New local draft',
    });
    this.saveLocalDraft();
  }

  isTextAlignActive(alignment) {
    return this.editor?.isActive({ textAlign: alignment }) ?? false;
  }

  getSpreadsheetTableAlignContextForToolbar() {
    const ctx = getSpreadsheetTableAlignContext(this.editor);
    if (ctx) {
      return ctx;
    }
    if (this.activeSpreadsheetTableWrapper) {
      const tablePos = resolveSpreadsheetTablePos(
        this.editor,
        this.activeSpreadsheetTableWrapper
      );
      if (tablePos == null) {
        return null;
      }
      const node = this.editor.state.doc.nodeAt(tablePos);
      if (!node || node.type.name !== 'table') {
        return null;
      }
      return {
        tablePos,
        tableAlign: normalizeTableBlockAlign(node.attrs?.tableAlign),
      };
    }
    return null;
  }

  isSpreadsheetTableBlockSelected() {
    return getSpreadsheetTableAlignContext(this.editor) != null
      || this.getSpreadsheetTableAlignContextForToolbar() != null;
  }

  getSpreadsheetTableBlockAlign() {
    return this.getSpreadsheetTableAlignContextForToolbar()?.tableAlign ?? null;
  }

  isBlockOrTextAlignActive(alignment) {
    const ctx = this.getSpreadsheetTableAlignContextForToolbar();
    if (ctx) {
      if (alignment === 'justify') {
        return false;
      }
      return ctx.tableAlign === normalizeTableBlockAlign(alignment);
    }
    return this.isTextAlignActive(alignment);
  }

  applyBlockOrTextAlign(alignment) {
    if (!this.editor || this.state.readOnly) {
      return;
    }
    const blockCtx = this.getSpreadsheetTableAlignContextForToolbar();
    if (blockCtx) {
      if (alignment === 'left' || alignment === 'center' || alignment === 'right') {
        applySpreadsheetTableBlockAlign(this.editor, alignment, blockCtx.tablePos);
        this.syncSpreadsheetTableHandles();
        this.editor.view.focus();
        this.forceUpdate();
      }
      return;
    }
    this.editor.chain().focus().setTextAlign(alignment).run();
  }

  openRangeInsertModal = () => {
    if (!this.editor || this.state.readOnly) {
      return;
    }
    this.rangeEditWrapper = null;
    this.rangeModalInitialSelection = null;
    this.setState({ rangeInsertModalOpen: true, rangeModalMode: 'insert' });
  };

  openRangeEditModal = (wrapper, source = null) => {
    if (!this.editor || this.state.readOnly || !wrapper) {
      return;
    }
    this.rangeEditImagePos = null;
    this.rangeEditWrapper = wrapper;
    this.rangeModalInitialSelection = source || readSpreadsheetTableSourceFromWrapper(
      this.editor,
      wrapper
    ) || {
      workbookPath: '',
      sheet: '',
      range: 'A1:C3',
    };
    this.setState({ rangeInsertModalOpen: true, rangeModalMode: 'edit' });
  };

  openRangeEditModalForImage = (imagePos, source = null) => {
    if (!this.editor || this.state.readOnly || typeof imagePos !== 'number') {
      return;
    }
    this.rangeEditWrapper = null;
    this.rangeEditImagePos = imagePos;
    this.rangeModalInitialSelection = source || {
      workbookPath: '',
      sheet: '',
      range: 'A1:C3',
    };
    this.setState({ rangeInsertModalOpen: true, rangeModalMode: 'editImage' });
  };

  closeRangeInsertModal = () => {
    this.rangeEditWrapper = null;
    this.rangeEditImagePos = null;
    this.rangeModalInitialSelection = null;
    this.setState({ rangeInsertModalOpen: false, rangeModalMode: 'insert' });
  };

  handleRangeInsert = (payload) => {
    if (!this.editor || !payload) {
      return;
    }
    const { rangeModalMode } = this.state;

    if (payload.format === 'image') {
      const { dataUrl, width, height, source, zoomPercent } = payload;
      if (!dataUrl) {
        return;
      }
      const zoomAttr = Number.isFinite(Number(zoomPercent))
        ? Math.max(5, Math.min(400, Math.round(Number(zoomPercent))))
        : null;
      if (rangeModalMode === 'editImage' && typeof this.rangeEditImagePos === 'number') {
        const ok = replaceSpreadsheetRangeImageAtPos(this.editor, this.rangeEditImagePos, payload);
        this.setState({
          statusMessage: ok ? 'Spreadsheet snapshot updated' : 'Unable to update snapshot',
          rangeInsertModalOpen: false,
          rangeModalMode: 'insert',
        });
        this.rangeEditImagePos = null;
        this.rangeModalInitialSelection = null;
        return;
      }
      const altParts = [source?.sheet, source?.range].filter(Boolean);
      this.editor
        .chain()
        .focus()
        .setImage({
          src: dataUrl,
          alt: altParts.join(' ') || 'Spreadsheet range',
          title: [source?.workbookPath, source?.sheet, source?.range].filter(Boolean).join(' · '),
          width: width > 0 ? width : undefined,
          height: height > 0 ? height : undefined,
          skerWorkbook: source?.workbookPath || null,
          skerSheet: source?.sheet || null,
          skerRange: source?.range || null,
          skerZoomPercent: zoomAttr,
        })
        .run();
      this.setState({ statusMessage: 'Spreadsheet range inserted as image' });
      return;
    }

    const html = payload.html || (typeof payload === 'string' ? payload : '');
    if (!html) {
      return;
    }
    if (rangeModalMode === 'edit' && this.rangeEditWrapper) {
      const ok = replaceSpreadsheetTableHtml(this.editor, this.rangeEditWrapper, html);
      this.activeSpreadsheetTableWrapper = this.rangeEditWrapper;
      this.syncSpreadsheetTableHandles();
      this.forceUpdate();
      this.setState({
        statusMessage: ok ? 'Spreadsheet range updated' : 'Unable to update',
        rangeInsertModalOpen: false,
        rangeModalMode: 'insert',
      });
      this.rangeEditWrapper = null;
      this.rangeModalInitialSelection = null;
      return;
    }
    this.editor.chain().focus().insertContent(html).run();
    this.syncSpreadsheetTableHandles();
    this.setState({ statusMessage: 'Spreadsheet range inserted' });
  };

  insertSpreadsheetRangeTable = () => {
    this.openRangeInsertModal();
  };

  renderToolbarItem(title, onClick, isActive, Icon, options = {}) {
    const { readOnly } = this.state;
    const { extraDisabled = false, alwaysEnabled = false } = options;
    const disabled = !alwaysEnabled && (readOnly || extraDisabled);
    const className = `${isActive ? 'active' : ''}${disabled ? ' disabled' : ''}`.trim();
    return (
      <div
        title={title}
        className={className || undefined}
        onMouseDown={disabled ? undefined : (event) => event.preventDefault()}
        onClick={disabled ? undefined : onClick}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={title}
        aria-disabled={disabled}
      >
        <Icon className="SkSvg" />
      </div>
    );
  }

  renderToolbar() {
    const { documentPath, readOnly, textColor, backgroundColor, menuPopUpTextColor, menuPopUpBackgroundColor, recentColors } = this.state;

    return (
      <div className="SkSpTopCommand SkTextEditor-toolbar">
        <div className="SkSpTopTool">
          {this.renderToolbarItem(
            'Redo',
            () => this.runCommand((chain) => chain.redo()),
            false,
            SvgRedo
          )}
          {this.renderToolbarItem(
            'Undo',
            () => this.runCommand((chain) => chain.undo()),
            false,
            SvgUndo
          )}
        </div>

        <div className="SkSeparator_Svg" />

        <div className="SkSpTopTool">
          {this.renderToolbarItem(
            'Bold',
            () => this.runCommand((chain) => chain.toggleBold()),
            this.isActive('bold'),
            SvgBold
          )}
          {this.renderToolbarItem(
            'Italic',
            () => this.runCommand((chain) => chain.toggleItalic()),
            this.isActive('italic'),
            SvgItalic
          )}
          {this.renderToolbarItem(
            'Underline',
            () => this.runCommand((chain) => chain.toggleUnderline()),
            this.isActive('underline'),
            SvgUnderline
          )}
          {this.renderToolbarItem(
            'Strikethrough',
            () => this.runCommand((chain) => chain.toggleStrike()),
            this.isActive('strike'),
            SvgStrikethrough
          )}
        </div>

        <div className="SkSeparator_Svg" />

        <div className={`SkSpTopTool SkTextEditor-fontTool${readOnly ? ' SkTextEditor-fontTool--disabled' : ''}`}>
          <SkFontSelector
            ref={this.fontSelectorRef}
            SelectFont={this.applyFontFamily}
            SelectFontSize={this.applyFontSize}
          />
        </div>

        <div className="SkSeparator_Svg" />

        <div className={`SkSpTopTool SkTextEditor-colorTool${readOnly ? ' SkTextEditor-fontTool--disabled' : ''}`}>
          <div style={{ position: 'relative' }} title="Text color">
            <div className="SkTextColorButton" onClick={this.openTextColorPicker}>
              <span
                className="SkTextColorLetter"
                style={{ color: textColor || 'var(--sk-color-tool)' }}
              >
                A
              </span>
            </div>
            {menuPopUpTextColor ? (
              <div className="SkSpTopCommand-popup">
                <SkColor
                  defaultColor={textColor || '#000000'}
                  onColorChange={this.applyTextColor}
                  size="medium"
                  title="Text color"
                  inline
                  recentColors={recentColors}
                />
              </div>
            ) : null}
          </div>

          <div style={{ position: 'relative' }} title="Fill color">
            <div className="SkBackgroundColorButton" onClick={this.openBackgroundColorPicker}>
              <span className="SkBackgroundColorFill">
                <SvgFormatColorFillBucket className="SkBackgroundColorFill-bucket" aria-hidden="true" />
                <span
                  className="SkBackgroundColorFill-bar"
                  style={{ backgroundColor: backgroundColor || '#ffffff' }}
                />
              </span>
            </div>
            {menuPopUpBackgroundColor ? (
              <div className="SkSpTopCommand-popup">
                <SkColor
                  defaultColor={backgroundColor || '#ffffff'}
                  onColorChange={this.applyBackgroundColor}
                  size="medium"
                  title="Fill color"
                  inline
                  recentColors={recentColors}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="SkSeparator_Svg" />

        <div className="SkSpTopTool">
          {this.renderToolbarItem(
            'Align left',
            () => this.applyBlockOrTextAlign('left'),
            this.isBlockOrTextAlignActive('left'),
            SvgAlignLeft
          )}
          {this.renderToolbarItem(
            'Center',
            () => this.applyBlockOrTextAlign('center'),
            this.isBlockOrTextAlignActive('center'),
            SvgAlignCenter
          )}
          {this.renderToolbarItem(
            'Align right',
            () => this.applyBlockOrTextAlign('right'),
            this.isBlockOrTextAlignActive('right'),
            SvgAlignRight
          )}
          {this.renderToolbarItem(
            'Justify',
            () => this.applyBlockOrTextAlign('justify'),
            this.isBlockOrTextAlignActive('justify'),
            SvgAlignJustify
          )}
        </div>

        <div className="SkSeparator_Svg" />

        <div className="SkSpTopTool">
          {this.renderToolbarItem(
            'Bulleted list',
            () => this.runCommand((chain) => chain.toggleBulletList()),
            this.isActive('bulletList'),
            SvgListUl
          )}
          {this.renderToolbarItem(
            'Numbered list',
            () => this.runCommand((chain) => chain.toggleOrderedList()),
            this.isActive('orderedList'),
            SvgListOl
          )}
          {this.renderToolbarItem(
            'Quote',
            () => this.runCommand((chain) => chain.toggleBlockquote()),
            this.isActive('blockquote'),
            SvgQuoteLeft
          )}
        </div>

        <div className="SkSeparator_Svg" />

        <div className="SkSpTopTool">
          {this.renderToolbarItem(
            'Insert spreadsheet range (image or table)',
            () => this.insertSpreadsheetRangeTable(),
            false,
            SvgSpreadsheet
          )}
        </div>

        <div className="SkSeparator_Svg" />

        <div className="SkSpTopTool">
          {this.renderToolbarItem(
            'Save',
            () => {
              void this.saveDocument({ navigateAfter: true });
            },
            false,
            SvgFileText
          )}
          {this.renderToolbarItem(
            'Print / PDF',
            () => this.printDocument(),
            false,
            SvgPrint,
            { alwaysEnabled: true }
          )}
          {this.renderToolbarItem(
            'Exit (Esc)',
            () => {
              void this.leaveEditor();
            },
            false,
            SvgClose,
            { alwaysEnabled: true }
          )}
          {!documentPath
            ? this.renderToolbarItem(
                'New draft',
                () => this.startLocalDraft(),
                false,
                SvgFileAdd
              )
            : null}
        </div>
      </div>
    );
  }

  render() {
    const { statusMessage, loading, fileName, documentPath, readOnly, rangeInsertModalOpen } = this.state;
    const title = fileName || 'HTML editor';
    return (
      <div className="SkTextEditor" data-tour="texteditor">
        <div className="SkTextEditor-header">
          <span className="SkTextEditor-title">{title}</span>
          <div className="SkTextEditor-header-actions">
            {readOnly ? (
              <span className="SkTextEditor-status">Read-only</span>
            ) : null}
            {statusMessage ? (
              <span className="SkTextEditor-status">{statusMessage}</span>
            ) : null}
          </div>
        </div>
        {this.renderToolbar()}
        <div className="SkTextEditor-body">
          {loading ? (
            <div className="SkTextEditor-loading">
              <SkLoadingSpinner
                size="large"
                text={`Loading ${fileName || 'Document'}…`}
                showText={true}
              />
            </div>
          ) : null}
          <div className="SkTextEditor-printTitle">{title}</div>
          <div ref={this.editorRef} className="SkTextEditor-mount" />
          {documentPath ? (
            <div className="SkTextEditor-path" title={documentPath}>
              {documentPath}
            </div>
          ) : null}
        </div>
        <SkTextEditorRangeInsertModal
          show={rangeInsertModalOpen}
          mode={this.state.rangeModalMode}
          initialSelection={this.rangeModalInitialSelection}
          documentPath={documentPath}
          onClose={this.closeRangeInsertModal}
          onInsert={this.handleRangeInsert}
        />
      </div>
    );
  }
}

export default SkTextEditor;
