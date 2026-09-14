/**
 * Apply a conditional-format payload from SkConditionalFormat to the current selection.
 * Shared by toolbar popup and right-panel embedded UI.
 */

import { buildCssCellFormat } from './SkConditionalFormatStyle';

/** SkSpreadSheet CF grammar requires "%" as current-cell prefix (see SkLemonSpreadSheet.y). */
function buildHighlightCellsParam1(highlightType, value) {
  const v = String(value ?? '').trim();
  switch (highlightType) {
    case 'greaterThan':
      return `%>${v}`;
    case 'lessThan':
      return `%<${v}`;
    case 'equalTo':
      return `%=${v}`;
    case 'between': {
      const low = v.split(',')[0]?.trim() || v || '0';
      return `%>=${low}`;
    }
    case 'containsText':
      return `CONTAINS("${v}")`;
    default:
      return `%>${v || '0'}`;
  }
}

/** Formula string sent to the engine for the current CF payload (if any). */
function formulaPayloadForFormat(format) {
  if (!format?.type) return '';
  if (format.type === 'CustomFormulas') {
    return String(format.formula ?? '').trim();
  }
  if (format.type === 'HighlightCellsRules') {
    return buildHighlightCellsParam1(format.highlightType, format.highlightValue);
  }
  return '';
}

/** Ignore stale Lemon diagnostics left over from another cell / named formula. */
function compileDiagnosticMatchesSource(diag, sourceText) {
  const src = String(sourceText ?? '').trim();
  const wDetail = String(diag?.detail ?? '').trim();
  const wSummary = String(diag?.summary ?? '').trim();
  const wBlob = `${wDetail}\n${wSummary}`.trim();
  if (!wBlob) return false;
  if (!src) return false;
  if (wBlob.includes(src)) return true;
  const wHead = src.length > 32 ? src.slice(0, 32) : src;
  return wHead.length >= 3 && wBlob.includes(wHead);
}

/** User-facing message after a failed conditionalFormat() — filters unrelated compile noise. */
export async function resolveConditionalFormatApplyError(
  spInterface,
  format,
  fallback = 'Could not save the rule.'
) {
  const wPayload = formulaPayloadForFormat(format);
  const wReadDiag =
    spInterface && typeof spInterface.readWasmCompileDiagnostics === 'function'
      ? spInterface.readWasmCompileDiagnostics.bind(spInterface)
      : null;
  const wBuildMsg =
    spInterface && typeof spInterface.buildWasmErrorMessage === 'function'
      ? spInterface.buildWasmErrorMessage.bind(spInterface)
      : null;

  if (!wReadDiag || !wBuildMsg) {
    return fallback;
  }

  const diag = await wReadDiag();
  if (!wPayload) {
    return fallback;
  }
  if (!compileDiagnosticMatchesSource(diag, wPayload)) {
    return 'Could not save the rule. Check the formula syntax.';
  }
  return wBuildMsg(fallback);
}

export async function applyConditionalFormatFromUi(spInterface, format, refOverride = '', sheetOverride = '') {
  if (!format || !format.type || !spInterface) return false;

  spInterface.clearFormulaBarCompileError?.();
  spInterface.setExtraUndo();
  const selection = (refOverride || '').trim() || spInterface.selectstr();
  if (!selection) return false;

  const sheet = sheetOverride || spInterface?.m_UIView?.sheet || '';
  let ok = false;

  switch (format.type) {
    case 'HighlightCellsRules': {
      const value = format.highlightValue || '0';
      const formula = buildHighlightCellsParam1(format.highlightType, value);

      const formatString = buildCssCellFormat(format.highlightFormat);

      ok = window.SkUISpreadSheet.conditionalFormat(
        'HighlightCellsRules',
        selection,
        formula,
        formatString,
        '',
        '', '', '', '', '', '', '',
        sheet
      );
      break;
    }

    case 'DataBars':
      ok = window.SkUISpreadSheet.conditionalFormat(
        'DataBars',
        selection,
        format.color || '#4A90E2',
        format.colorNegative || '#E24A4A',
        format.style || 'gradient',
        format.minValue?.toString() || '0',
        format.maxValue?.toString() || '100',
        '', '', '', '', '',
        sheet
      );
      break;

    case 'ColorScales': {
      const minValue =
        format.minValue === '' || format.minValue === null || format.minValue === undefined
          ? ''
          : String(format.minValue);
      const maxValue =
        format.maxValue === '' || format.maxValue === null || format.maxValue === undefined
          ? ''
          : String(format.maxValue);
      ok = window.SkUISpreadSheet.conditionalFormat(
        'ColorScales',
        selection,
        format.minColor || '#FF0000',
        format.maxColor || '#00FF00',
        format.midColor || '',
        format.colorScaleType || '2-color',
        minValue,
        maxValue,
        '', '', '', '',
        sheet
      );
      break;
    }

    case 'IconSets': {
      const iconMap = {
        Arrows: ['↓', '→', '↑'],
        Shapes: ['●', '▲', '■'],
        Indicators: ['✗', '!', '✓'],
        Ratings: ['☆', '★', '★'],
        Flags: ['🚩', '🏁', '🏳️'],
      };
      const icons = iconMap[format.iconType] || iconMap.Arrows;

      ok = window.SkUISpreadSheet.conditionalFormat(
        'IconSets',
        selection,
        icons[0] || '',
        icons[1] || '',
        icons[2] || '',
        '',
        '',
        '',
        '',
        '',
        '',
        format.iconType || 'Arrows',
        sheet
      );
      break;
    }

    case 'CustomFormulas': {
      const customFormatString = buildCssCellFormat(format.customFormat);

      ok = window.SkUISpreadSheet.conditionalFormat(
        'CustomFormulas',
        selection,
        format.formula || '',
        customFormatString,
        '',
        '', '', '', '', '', '', '',
        sheet
      );
      break;
    }

    default:
      console.warn('Unknown conditional format type:', format.type);
      return false;
  }

  if (!ok) {
    return false;
  }

  await spInterface.reloadView();
  return true;
}
