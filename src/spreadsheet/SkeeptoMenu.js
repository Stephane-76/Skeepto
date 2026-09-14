import React from 'react';
import {
    buildNumberFormatMenuItems,
    buildCurrencyFormatMenuItems,
    buildPercentFormatMenuItems,
    buildScientificFormatMenuItems,
    buildDateTimeFormatMenuItems,
} from './SkNumberFormatMenu.js';
import { getCommonSpreadsheetMenuModel, VIEW_ZOOM_PRESETS, PRINT_ACTION } from './SkMenuModel.js';
import { ReactComponent as SvgNumber } from '../svg/number.svg';
import { ReactComponent as SvgAccounting } from '../svg/accounting-icon.svg';
import { ReactComponent as SvgCalendar } from '../svg/calendar-clock.svg';
import { ReactComponent as SvgPercent } from '../svg/percent.svg';
import { ReactComponent as SvgScientific } from '../svg/science-atom-icon.svg';
import { ReactComponent as SvgBold } from '../svg/bold.svg';
import { ReactComponent as SvgItalic } from '../svg/italic.svg';
import { ReactComponent as SvgUnderline } from '../svg/underline.svg';
import { ReactComponent as SvgStrikethrough } from '../svg/strikethrough.svg';
import { ReactComponent as SvgTextLabel } from '../svg/text-label.svg';

/**
 * Google-Sheets-style top menu when the spreadsheet route is active.
 *
 * The structure comes from the shared, serializable SkMenuModel (single source
 * of truth shared with the Electron native menu). Here we only DECORATE it for
 * the web: React icons, checked toggle states, lazy dynamic format submenus,
 * and Print inserted under Edit (Electron puts Print under File instead).
 *
 * @param {Function} onMenuClick
 * @param {{ gridVisible: boolean, zoomPercent: number }} viewState
 * @param {Record<string, React.ReactNode>} icons — edit/view icons from SkAppMenu
 */
export function buildSpreadsheetMenuItems(onMenuClick, viewState, icons) {
    const { gridVisible, zoomPercent } = viewState;

    // Web-only icons, keyed by menu node id. Only the ids present here get an
    // icon (mirrors the previous hand-written menu exactly).
    const iconById = {
        undo: icons.undo,
        redo: icons.redo,
        cut: icons.cut,
        copy: icons.copy,
        paste: icons.paste,
        'find-text': icons.find,
        'format-number': <SvgNumber className="SkSvg SkMenuWindow-item-svg" />,
        'format-currency': <SvgAccounting className="SkSvg SkMenuWindow-item-svg" />,
        'format-percent': <SvgPercent className="SkSvg SkMenuWindow-item-svg" />,
        'format-scientific': <SvgScientific className="SkSvg SkMenuWindow-item-svg" />,
        'format-date-time': <SvgCalendar className="SkSvg SkMenuWindow-item-svg" />,
        'format-text': <SvgTextLabel className="SkSvg SkMenuWindow-item-svg" />,
        'format-bold': <SvgBold className="SkSvg SkMenuWindow-item-svg" />,
        'format-italic': <SvgItalic className="SkSvg SkMenuWindow-item-svg" />,
        'format-underline': <SvgUnderline className="SkSvg SkMenuWindow-item-svg" />,
        'format-strikethrough': <SvgStrikethrough className="SkSvg SkMenuWindow-item-svg" />,
    };

    // Lazy builders for the dynamic format submenus (filled from the WASM catalog
    // on hover). Keyed by the model node's `dynamic` marker.
    const dynamicBuilder = {
        'format-number': () => buildNumberFormatMenuItems(onMenuClick),
        'format-currency': () => buildCurrencyFormatMenuItems(onMenuClick),
        'format-percent': () => buildPercentFormatMenuItems(onMenuClick),
        'format-scientific': () => buildScientificFormatMenuItems(onMenuClick),
        'format-date-time': () => buildDateTimeFormatMenuItems(onMenuClick),
    };

    const nodeToItem = (node) => {
        if (node.type === 'separator') {
            return { type: 'separator' };
        }
        const item = { id: node.id, label: node.label };
        const icon = iconById[node.id];
        if (icon) {
            item.icon = icon;
        }
        if (node.dynamic === 'zoom') {
            item.items = VIEW_ZOOM_PRESETS.map((percent) => ({
                id: `view-zoom-${percent}`,
                label: `${percent}%`,
                checked: zoomPercent === percent,
                onClick: () => onMenuClick(`view-zoom-${percent}`),
            }));
            return item;
        }
        if (node.dynamic && dynamicBuilder[node.dynamic]) {
            item.getItems = dynamicBuilder[node.dynamic];
            return item;
        }
        if (Array.isArray(node.children)) {
            item.items = node.children.map(nodeToItem);
            return item;
        }
        if (node.checkable === 'grid') {
            item.checked = gridVisible;
        }
        if (node.action) {
            item.onClick = () => onMenuClick(node.action);
        }
        return item;
    };

    // Web places Print… inside Edit, just before "Recalculate all" (Electron
    // puts it under the native File menu instead — the only per-platform diff).
    const editWithPrint = (children) => {
        const wOut = [...children];
        const wIdx = wOut.findIndex((c) => c.id === 'recalculate-all');
        const wPrint = { id: PRINT_ACTION, label: 'Print…', action: PRINT_ACTION };
        if (wIdx >= 0) {
            wOut.splice(wIdx, 0, wPrint, { type: 'separator' });
        } else {
            wOut.push({ type: 'separator' }, wPrint);
        }
        return wOut;
    };

    return getCommonSpreadsheetMenuModel().map((menu) => {
        const children = menu.id === 'edit' ? editWithPrint(menu.children) : menu.children;
        return { id: menu.id, label: menu.label, items: children.map(nodeToItem) };
    });
}
