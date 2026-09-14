/**
 * Helpers for listing conditional-format rules from JsonConditionalFormat().
 */

import { parseCssCellFormat } from './SkConditionalFormatStyle';

const TYPE_LABELS = {
  HighlightCellsRules: 'Highlight cells',
  DataBars: 'Data bars',
  ColorScales: 'Color scale',
  IconSets: 'Icon set',
  CustomFormulas: 'Formula',
};

const CF_KEY_SUFFIX_TO_TYPE = {
  HC: 'HighlightCellsRules',
  CF: 'CustomFormulas',
  DB: 'DataBars',
  CS: 'ColorScales',
  IS: 'IconSets',
};

function stripCfKeySuffix(key) {
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return { ref: key, typeFromSuffix: '' };
  const suffix = key.slice(dot + 1);
  if (CF_KEY_SUFFIX_TO_TYPE[suffix]) {
    return { ref: key.slice(0, dot), typeFromSuffix: CF_KEY_SUFFIX_TO_TYPE[suffix] };
  }
  return { ref: key, typeFromSuffix: '' };
}

export function getRuleType(rule) {
  if (!rule) return '';
  const wExplicit =
    rule.conditionalformattype || rule.cft || rule.type || '';
  if (wExplicit) return wExplicit;
  const wKey = String(rule.key || rule.rf || '');
  return stripCfKeySuffix(wKey).typeFromSuffix;
}

export function getRuleRange(rule) {
  let key = String(rule?.key || rule?.rf || '').trim();
  const bang = key.indexOf('!');
  if (bang >= 0) key = key.slice(bang + 1);
  return stripCfKeySuffix(key).ref;
}

/** Single-cell refs may be stored as G2 or G2:G2 — try both for delete. */
function cfRefVariants(ref) {
  const r = String(ref || '').trim();
  if (!r) return [];
  const variants = [r];
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(r);
  if (m) {
    const expanded = `${r}:${r}`;
    if (!variants.includes(expanded)) variants.push(expanded);
  }
  return variants;
}

export function cfRuleIdentityChanged(oldRule, newType, newRef) {
  if (!oldRule) return true;
  const wOldType = getRuleType(oldRule);
  const wOldRef = getRuleRange(oldRule);
  const wNewType = String(newType || '').trim();
  const wNewRef = String(newRef || '').trim();
  return wOldType !== wNewType || wOldRef !== wNewRef;
}

function parseHighlightParam1(param1) {
  let p1 = String(param1 || '').trim();
  if (!p1) {
    return { highlightType: 'greaterThan', highlightValue: '' };
  }
  if (p1.startsWith('%')) {
    p1 = p1.slice(1);
  }
  if (p1.startsWith('>=')) {
    return { highlightType: 'between', highlightValue: p1.slice(2) };
  }
  if (p1.startsWith('<=')) {
    return { highlightType: 'lessThan', highlightValue: p1.slice(2) };
  }
  if (p1.startsWith('>')) {
    return { highlightType: 'greaterThan', highlightValue: p1.slice(1) };
  }
  if (p1.startsWith('<')) {
    return { highlightType: 'lessThan', highlightValue: p1.slice(1) };
  }
  if (p1.startsWith('=')) {
    return { highlightType: 'equalTo', highlightValue: p1.slice(1) };
  }
  const betweenMatch = /^BETWEEN\((.+)\)$/i.exec(p1);
  if (betweenMatch) {
    return { highlightType: 'between', highlightValue: betweenMatch[1] };
  }
  const containsMatch = /^CONTAINS\("(.+)"\)$/i.exec(p1);
  if (containsMatch) {
    return { highlightType: 'containsText', highlightValue: containsMatch[1] };
  }
  return { highlightType: 'greaterThan', highlightValue: p1 };
}

export function getRuleListTitle(rule) {
  const type = getRuleType(rule);
  switch (type) {
    case 'HighlightCellsRules': {
      const { highlightType, highlightValue } = parseHighlightParam1(rule.param1);
      switch (highlightType) {
        case 'greaterThan':
          return `Greater than ${highlightValue}`;
        case 'lessThan':
          return `Less than ${highlightValue}`;
        case 'equalTo':
          return `Equal to ${highlightValue}`;
        case 'between':
          return `Between ${highlightValue}`;
        case 'containsText':
          return `Text contains "${highlightValue}"`;
        default:
          return 'Highlight cells';
      }
    }
    case 'CustomFormulas':
      return rule.param1 ? `Formula: ${rule.param1}` : 'Custom formula';
    case 'DataBars':
      return 'Data bars';
    case 'ColorScales':
      return rule.param5 === '3-color' ? '3-color scale' : 'Color scale';
    case 'IconSets':
      return `Icon set (${rule.iconsettype || rule.ist || 'Arrows'})`;
    default:
      return TYPE_LABELS[type] || type || 'Rule';
  }
}

export function describeConditionalFormatRule(rule) {
  return getRuleListTitle(rule);
}

export function ruleToFormState(rule) {
  if (!rule) return null;
  const type = getRuleType(rule);
  const base = {
    activeTab: type === 'ColorScales' ? 'ColorScales' : type,
    draftRef: getRuleRange(rule),
  };

  switch (type) {
    case 'HighlightCellsRules': {
      const { highlightType, highlightValue } = parseHighlightParam1(rule.param1);
      const highlightFormat = parseCssCellFormat(rule.param2);
      return {
        ...base,
        highlightType,
        highlightValue,
        highlightFormatColor: highlightFormat.color,
        highlightFormat,
      };
    }
    case 'CustomFormulas': {
      const customFormat = parseCssCellFormat(rule.param2);
      return {
        ...base,
        activeTab: 'CustomFormulas',
        customFormula: rule.param1 || '',
        customFormatColor: customFormat.color,
        customFormat,
      };
    }
    case 'DataBars':
      return {
        ...base,
        activeTab: 'DataBars',
        dataBarColor: rule.param1 || '#0066FF',
        dataBarColorNegative: rule.param2 || '#FF3333',
        dataBarStyle: rule.param3 || 'gradient',
        dataBarMinValue: rule.param4 || '0',
        dataBarMaxValue: rule.param5 || '100',
      };
    case 'ColorScales': {
      const p6 = String(rule.param6 ?? '').trim();
      const p7 = String(rule.param7 ?? '').trim();
      return {
        ...base,
        activeTab: 'ColorScales',
        colorScaleType: rule.param5 === '3-color' ? '3-color' : '2-color',
        colorScaleMinColor: rule.param1 || '#ED7D31',
        colorScaleMaxColor: rule.param2 || '#FFF2CC',
        colorScaleMidColor: rule.param3 || '#FFCC00',
        colorScaleMinType: p6 === '' ? 'lowest' : 'number',
        colorScaleMaxType: p7 === '' ? 'highest' : 'number',
        colorScaleMinValue: p6 === '' ? 0 : p6,
        colorScaleMaxValue: p7 === '' ? 100 : p7,
      };
    }
    case 'IconSets':
      return {
        ...base,
        activeTab: 'IconSets',
        iconSetType: rule.iconsettype || rule.ist || 'Arrows',
      };
    default:
      return base;
  }
}

export function getRulePreviewColor(rule) {
  const type = getRuleType(rule);
  if (type === 'HighlightCellsRules' || type === 'CustomFormulas') {
    const css = rule.param2 || '';
    const match = css.match(/background-color:\s*([^;]+)/i);
    return match ? match[1].trim() : '#FF0000';
  }
  if (type === 'DataBars') {
    return rule.param1 || '#0066FF';
  }
  if (type === 'ColorScales') {
    return rule.param1 || '#ED7D31';
  }
  return null;
}

export async function fetchConditionalFormatRules(sheet = '') {
  if (!window.SkUISpreadSheet?.jsonConditionalFormat) {
    return [];
  }
  const json = window.SkUISpreadSheet.jsonConditionalFormat(sheet);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('SkConditionalFormatRules::fetch parse error', error);
    return [];
  }
}

export async function deleteConditionalFormatRule(rule, sheet = '') {
  const type = getRuleType(rule);
  const ref = getRuleRange(rule);
  const ui = window.SkUISpreadSheet;
  if (!type || !ref || typeof ui?.deleteConditionalFormat !== 'function') {
    return false;
  }
  for (const wRef of cfRefVariants(ref)) {
    try {
      if (ui.deleteConditionalFormat(type, wRef, sheet)) {
        return true;
      }
    } catch (error) {
      console.error('SkConditionalFormatRules::delete error', error);
    }
  }
  return false;
}
