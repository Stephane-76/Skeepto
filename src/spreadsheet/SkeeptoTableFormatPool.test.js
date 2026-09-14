import {
  SKER_FORMAT_INDEX_ATTR,
  SKER_FORMATS_ATTR,
  SK_STYLE_ATTR,
  buildStandaloneHtmlDocumentFromFragment,
  compactSpreadsheetTablesInDocumentHtml,
  expandSpreadsheetTablesInDocumentHtml,
  extractHtmlFragmentFromStoredDocument,
  indexFormatStyleInPool,
  resolveSpreadsheetStyleFromCellElement,
  spacingFieldToDeclaration,
} from './SkeeptoTableFormatPool.js';

describe('SkeeptoTableFormatPool', () => {
  test('spacingFieldToDeclaration normalizes bare padding numbers', () => {
    expect(spacingFieldToDeclaration('f_p', 8)).toBe('padding:8px;');
    expect(spacingFieldToDeclaration('f_pt', '12px')).toBe('padding-top:12px;');
  });

  test('indexFormatStyleInPool deduplicates per table pool', () => {
    const pool = [];
    const map = new Map();
    expect(indexFormatStyleInPool(pool, map, 'color:red;')).toBe(0);
    expect(indexFormatStyleInPool(pool, map, 'color:red;')).toBe(0);
    expect(indexFormatStyleInPool(pool, map, 'color:blue;')).toBe(1);
    expect(pool).toEqual(['color:red;', 'color:blue;']);
  });

  test('resolveSpreadsheetStyleFromCellElement reads skstyle attribute', () => {
    document.body.innerHTML = `
      <table class="SkTextEditor-spreadsheetTable--imported">
        <tr><td skstyle="color:green;">x</td></tr>
      </table>
    `;
    const cell = document.querySelector('td');
    expect(resolveSpreadsheetStyleFromCellElement(cell)).toBe('color:green;');
  });

  test('resolveSpreadsheetStyleFromCellElement reads pool index on parent table', () => {
    document.body.innerHTML = `
      <table class="SkTextEditor-spreadsheetTable--imported" ${SKER_FORMATS_ATTR}='["color:red;","color:blue;"]'>
        <tr><td ${SKER_FORMAT_INDEX_ATTR}="1">x</td></tr>
      </table>
    `;
    const cell = document.querySelector('td');
    expect(resolveSpreadsheetStyleFromCellElement(cell)).toBe('color:blue;');
  });

  test('expandSpreadsheetTablesInDocumentHtml restores inline styles from pool', () => {
    const html = `
      <table class="SkTextEditor-spreadsheetTable--imported" ${SKER_FORMATS_ATTR}='["color:red;","color:blue;"]'>
        <tr>
          <td ${SKER_FORMAT_INDEX_ATTR}="0" style="height:11px;min-height:11px">1</td>
          <td ${SKER_FORMAT_INDEX_ATTR}="1" style="height:11px;min-height:11px" data-bg="#52B86E">2</td>
        </tr>
      </table>
    `;
    const out = expandSpreadsheetTablesInDocumentHtml(html);
    expect(out).toContain(`${SK_STYLE_ATTR}="color:red;"`);
    expect(out).toMatch(/style="height:11px;min-height:11px;color:red;?"/);
    expect(out).toMatch(/style="height:11px;min-height:11px;color:blue;background-color:#52B86E"/);
    expect(out).not.toContain(SKER_FORMATS_ATTR);
    expect(out).not.toContain(`${SKER_FORMAT_INDEX_ATTR}=`);
  });

  test('extractHtmlFragmentFromStoredDocument returns body HTML from standalone documents', () => {
    const standalone = buildStandaloneHtmlDocumentFromFragment('<p>Hello</p>', { title: 'Doc' });
    expect(extractHtmlFragmentFromStoredDocument(standalone)).toBe('<p>Hello</p>');
    expect(extractHtmlFragmentFromStoredDocument('<p>Fragment</p>')).toBe('<p>Fragment</p>');
  });

  test('buildStandaloneHtmlDocumentFromFragment wraps expanded HTML', () => {
    const html = `<table class="SkTextEditor-spreadsheetTable--imported" ${SKER_FORMATS_ATTR}='["color:green;"]'><tr><td ${SKER_FORMAT_INDEX_ATTR}="0">x</td></tr></table>`;
    const out = buildStandaloneHtmlDocumentFromFragment(html, { title: 'Rapport' });
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain('<title>Rapport</title>');
    expect(out).toContain(`${SK_STYLE_ATTR}="color:green;"`);
    expect(out).not.toContain(SKER_FORMATS_ATTR);
  });

  test('compactSpreadsheetTablesInDocumentHtml mutualizes styles per table', () => {
    const html = `
      <table class="SkTextEditor-spreadsheetTable--imported" data-sker-workbook="a.sker">
        <tr>
          <td data-cell-style="color:red;" style="color:red;height:11px;min-height:11px">1</td>
          <td data-cell-style="color:red;" style="color:red;height:11px;min-height:11px">2</td>
        </tr>
      </table>
      <table class="SkTextEditor-spreadsheetTable--imported" data-sker-workbook="b.sker">
        <tr><td data-cell-style="color:red;" style="color:red;">3</td></tr>
      </table>
    `;
    const out = compactSpreadsheetTablesInDocumentHtml(html);
    expect(out).toContain(SKER_FORMATS_ATTR);
    expect(out).toContain(`${SKER_FORMAT_INDEX_ATTR}="0"`);
    expect(out).not.toContain('data-cell-style=');
    expect(out).not.toContain('skstyle=');
    expect((out.match(/data-sker-formats/g) || []).length).toBe(2);
  });
});
