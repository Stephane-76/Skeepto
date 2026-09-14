//=============================================================================
// SkMcpToolRegistrar.mjs — register sker tools on an MCP server instance
//=============================================================================

import { z } from 'zod';
import { buildFormatCssFromApplyFormatArgs } from './SkBuildFormatCss.mjs';
import {
  expandRange,
  formatToolText,
  parseRefAndSheet,
} from './SkeeptoToolUtils.mjs';

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('./SkeeptoTools.mjs').SkeeptoTools} tools
 */
export function registerSkMcpTools(server, tools) {
  const wFormat = (value) => ({
    content: [{ type: 'text', text: formatToolText(value) }],
  });

  server.tool(
    'list_files',
    {
      directory: z.string().optional().describe('Virtual disk directory path'),
    },
    async ({ directory }) => wFormat(await tools.listFiles(directory || ''))
  );

  server.tool(
    'open_workbook',
    {
      path: z.string().describe('Virtual disk path, e.g. /share/Bilan.sker'),
    },
    async ({ path }) => wFormat(await tools.ensureWorkbook(path))
  );

  server.tool(
    'list_sheets',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
    },
    async ({ path }) => wFormat(await tools.listSheets(path))
  );

  server.tool(
    'create_sheet',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      name: z.string().describe('New sheet tab name'),
      insertAfter: z
        .string()
        .optional()
        .describe('Optional existing sheet name to insert after'),
    },
    async ({ path, name, insertAfter }) => wFormat(await tools.createSheet(path, name, insertAfter || ''))
  );

  server.tool(
    'read_cell',
    {
      path: z.string(),
      ref: z.string(),
      sheet: z.string().optional(),
    },
    async ({ path, ref, sheet }) => {
      const wParsed = parseRefAndSheet(ref, sheet);
      const wValue = await tools.readCell(path, wParsed.ref, wParsed.sheet);
      return wFormat({ ref: wParsed.ref, sheet: wParsed.sheet, value: wValue });
    }
  );

  server.tool(
    'write_cell',
    {
      path: z.string(),
      ref: z.string(),
      value: z.string(),
      sheet: z.string().optional(),
    },
    async ({ path, ref, value, sheet }) => {
      const wParsed = parseRefAndSheet(ref, sheet);
      const wResult = await tools.writeCell(path, wParsed.ref, value, wParsed.sheet);
      return wFormat({ ...wParsed, value, ...wResult });
    }
  );

  const wClipboardSchema = z
    .union([
      z.string().describe('Sker cp clipboard JSON string'),
      z
        .record(z.unknown())
        .describe('Sker cp object: { select, cells, si?, fi?, f? }'),
    ])
    .describe('Copy/paste payload from read_workbook or a prior copy');

  server.tool(
    'paste_grid',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      range: z
        .string()
        .describe('Destination range covering the full grid, e.g. A1:C101'),
      rows: z
        .array(z.array(z.union([z.string(), z.number()])))
        .describe('2D grid: row 0 = header, following rows = data. Formulas: use strings starting with = (e.g. "=B14*C14").'),
      styles: z
        .object({
          header: z.string().optional(),
          dataOdd: z.string().optional(),
          dataEven: z.string().optional(),
          default: z.string().optional(),
        })
        .optional()
        .describe(
          'Optional row CSS. Prefer create_table + tableStyleName for the look of a data grid — omit styles when you will promote the range to a table. Number format-string belongs in apply_format/format_range, not here.'
        ),
      sheet: z.string().optional(),
    },
    async ({ path, range, rows, styles, sheet }) =>
      wFormat(await tools.pasteGrid(path, range, { rows, styles }, sheet || ''))
  );

  server.tool(
    'write_cells',
    {
      path: z.string(),
      cells: z
        .union([
          z.record(z.union([z.string(), z.number()])),
          z.array(
            z.object({
              ref: z.string(),
              value: z.union([z.string(), z.number()]),
            })
          ),
        ])
        .describe('Map of A1 refs to values, or [{ref,value},…]. One persist for the batch.'),
      sheet: z.string().optional(),
    },
    async ({ path, cells, sheet }) =>
      wFormat(await tools.writeCells(path, cells, sheet || ''))
  );

  server.tool(
    'resize_columns',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      columns: z
        .string()
        .describe('Column or column range, e.g. B or B:D (A=first column)'),
      widthPixels: z
        .number()
        .describe('Width in CSS pixels (sker uses 96 DPI internally)'),
      sheet: z.string().optional(),
    },
    async ({ path, columns, widthPixels, sheet }) =>
      wFormat(await tools.resizeColumns(path, columns, widthPixels, sheet || ''))
  );

  server.tool(
    'resize_rows',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      rows: z
        .string()
        .describe('Row or row range, 1-based, e.g. 2 or 2:10'),
      heightPixels: z
        .number()
        .describe('Height in CSS pixels (sker uses 96 DPI internally)'),
      sheet: z.string().optional(),
    },
    async ({ path, rows, heightPixels, sheet }) =>
      wFormat(await tools.resizeRows(path, rows, heightPixels, sheet || ''))
  );

  server.tool(
    'get_column_width',
    {
      path: z.string(),
      column: z.string().describe('Column letter, e.g. B'),
      sheet: z.string().optional(),
    },
    async ({ path, column, sheet }) =>
      wFormat(await tools.getColumnWidth(path, column, sheet || ''))
  );

  server.tool(
    'get_row_height',
    {
      path: z.string(),
      row: z
        .union([z.string(), z.number()])
        .describe('Row number, 1-based, e.g. 2'),
      sheet: z.string().optional(),
    },
    async ({ path, row, sheet }) =>
      wFormat(await tools.getRowHeight(path, row, sheet || ''))
  );

  server.tool(
    'format_ranges',
    {
      path: z.string(),
      items: z
        .array(
          z.object({
            range: z.string(),
            css: z.string(),
          })
        )
        .describe(
          'Batch format: [{range,css},…]. Put ALL sheet styling here — one persist. Prefer over repeated apply_format/format_range.'
        ),
      sheet: z.string().optional(),
    },
    async ({ path, items, sheet }) =>
      wFormat(await tools.formatRanges(path, items, sheet || ''))
  );

  server.tool(
    'paste_range',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      range: z.string().describe('Destination range in A1 notation, e.g. G2:U7'),
      clipboard: wClipboardSchema,
      sheet: z.string().optional().describe('Destination sheet name'),
    },
    async ({ path, range, clipboard, sheet }) =>
      wFormat(await tools.pasteRange(path, range, clipboard, sheet || ''))
  );

  server.tool(
    'copy_range',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      range: z.string().describe('Source range to copy, e.g. A1:C5'),
      sheet: z.string().optional(),
    },
    async ({ path, range, sheet }) =>
      wFormat(await tools.copyRange(path, range, sheet || ''))
  );

  server.tool(
    'duplicate_range',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      sourceRange: z.string().describe('Source range, e.g. A1:C5'),
      destRange: z.string().describe('Destination top-left range, e.g. E1:G5'),
      sheet: z.string().optional(),
    },
    async ({ path, sourceRange, destRange, sheet }) =>
      wFormat(await tools.duplicateRange(path, sourceRange, destRange, sheet || ''))
  );

  server.tool(
    'apply_format',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      range: z.string().describe('Range in A1 notation, e.g. A1:C1'),
      sheet: z.string().optional().describe('Sheet name'),
      css: z
        .string()
        .optional()
        .describe(
          'Sker CSS string, e.g. background-color:#4472C4;color:white;font-weight:bold;'
        ),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          'JSON-safe CSS lines, e.g. ["background-color:#4472C4","color:white","font-weight:bold"]'
        ),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      backgroundColor: z.string().optional(),
      color: z.string().optional(),
      fontFamily: z.string().optional(),
      fontSizePt: z.number().optional(),
      textAlign: z.enum(['left', 'center', 'right']).optional(),
      border: z.string().optional().describe('e.g. 1px solid #000000'),
    },
    async (args) => {
      const wCss = buildFormatCssFromApplyFormatArgs(args);
      return wFormat(await tools.formatRange(args.path, args.range, wCss, args.sheet || ''));
    }
  );

  server.tool(
    'format_range',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      range: z.string().describe('Range in A1 notation, e.g. A1:C1'),
      css: z
        .string()
        .describe(
          'Sker CSS (must end with ;). Example: background-color:#4472C4; color:white; font-weight:bold;'
        ),
      sheet: z.string().optional().describe('Sheet name'),
    },
    async ({ path, range, css, sheet }) =>
      wFormat(await tools.formatRange(path, range, css, sheet || ''))
  );

  server.tool(
    'merge_cells',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      range: z
        .string()
        .describe('Rectangular A1 range to merge, e.g. H11:J13 (at least two cells)'),
      sheet: z.string().optional().describe('Sheet name'),
    },
    async ({ path, range, sheet }) =>
      wFormat(await tools.mergeCells(path, range, sheet || ''))
  );

  server.tool(
    'read_range',
    {
      path: z.string(),
      range: z.string(),
      sheet: z.string().optional(),
    },
    async ({ path, range, sheet = '' }) => {
      const wCells = expandRange(range);
      const wValues = {};
      for (const ref of wCells) {
        wValues[ref] = await tools.readCell(path, ref, sheet);
      }
      return wFormat({ range, sheet, cells: wValues });
    }
  );

  server.tool(
    'read_workbook',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      sheet: z
        .string()
        .optional()
        .describe('Sheet name — omit for full workbook (internal _$$ sheets excluded)'),
      includeInternalSheets: z
        .boolean()
        .optional()
        .describe('Include internal _$$ host sheets when reading full workbook'),
    },
    async ({ path, sheet, includeInternalSheets }) =>
      wFormat(
        await tools.readWorkbook(path, {
          sheet: sheet || '',
          includeInternalSheets: includeInternalSheets === true,
        })
      )
  );

  server.tool(
    'save_workbook',
    {
      path: z.string(),
    },
    async ({ path }) => wFormat(await tools.persistWorkbook(path))
  );

  server.tool(
    'list_tables',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      sheet: z.string().optional().describe('Filter by sheet name'),
    },
    async ({ path, sheet }) => wFormat(await tools.listTables(path, sheet || ''))
  );

  server.tool(
    'create_table',
    'Promote a pasted range to a real Excel table (sort/filter + tableStyleName). DEFAULT after paste_grid for any new list/catalog/tableau — do not leave tabular data as a plain grid. Range must match paste_grid exactly. Omit name unless the user asks.',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      range: z
        .string()
        .describe(
          'Must match paste_grid range exactly — header + all data rows, e.g. paste_grid H1:J42 then create_table H1:J42 (min 2 rows)'
        ),
      name: z
        .string()
        .optional()
        .describe(
          'Omit unless user explicitly requests a name. Auto Table2, Table3, … Names are workbook-global — reusing deletes the existing table.'
        ),
      sheet: z.string().optional(),
      tableStyleName: z
        .string()
        .optional()
        .describe('Excel table visual style (header/stripes), default TableStyleMedium2. Pass this on create_table — do not paint header/stripes with CSS.'),
    },
    async ({ path, range, name, sheet, tableStyleName }) =>
      wFormat(
        await tools.createTable(path, range, {
          name,
          sheet,
          tableStyleName,
        })
      )
  );

  const wTableFilterSchema = z
    .object({
      op: z
        .enum(['None', 'Equals', 'Contains', 'IsEmpty', 'IsNotEmpty'])
        .optional()
        .describe('Filter operator'),
      value: z.union([z.string(), z.number()]).optional(),
      values: z
        .array(z.union([z.string(), z.number()]))
        .optional()
        .describe('Multi-value Equals filter'),
    })
    .optional();

  server.tool(
    'apply_table_filter_sort',
    {
      path: z.string().describe('Virtual disk path to .sker workbook'),
      tableName: z.string().describe('RangeData table name, e.g. Table1'),
      column: z
        .union([z.string(), z.number()])
        .describe('Column letter (B) or 0-based offset within table'),
      sheet: z.string().optional(),
      sort: z
        .enum(['None', 'Ascending', 'Descending'])
        .optional()
        .describe('Sort order on this column (clears sort on other columns)'),
      filter: wTableFilterSchema.describe(
        'Column filter, e.g. { op: "Contains", value: "Paris" } or { op: "Equals", values: ["A","B"] }'
      ),
    },
    async ({ path, tableName, column, sheet, sort, filter }) =>
      wFormat(
        await tools.applyTableFilterSort(path, tableName, column, {
          sheet,
          sort,
          filter,
        })
      )
  );

  server.tool(
    'spreadsheet_call',
    {
      path: z.string(),
      fn: z.string(),
      params: z.record(z.unknown()).optional(),
      persistAfter: z.boolean().optional(),
    },
    async ({ path, fn, params, persistAfter }) =>
      wFormat(await tools.spreadsheetCall(path, fn, params ?? {}, { persistAfter }))
  );
}
