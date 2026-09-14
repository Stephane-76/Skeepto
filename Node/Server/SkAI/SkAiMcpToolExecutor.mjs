//=============================================================================
// SkAiMcpToolExecutor.mjs — in-process MCP tools → OpenAI function calling for local llama agent
//=============================================================================

import { runWithAiDispatchContext } from './SkAiMessageBus.mjs';
import {
  buildFormatCssFromApplyFormatArgs,
  buildFormatCssFromStructuredArgs,
} from './SkBuildFormatCss.mjs';
import {
  expandRange,
  formatToolText,
  parseRefAndSheet,
} from './SkeeptoToolUtils.mjs';

/**
 * @param {string} col
 * @returns {string}
 */
function incrementColumnLabel(col) {
  const wChars = String(col || 'A')
    .toUpperCase()
    .split('');
  let wCarry = 1;
  for (let wIdx = wChars.length - 1; wIdx >= 0 && wCarry; wIdx--) {
    let wCode = wChars[wIdx].charCodeAt(0) - 64 + wCarry;
    if (wCode > 26) {
      wChars[wIdx] = 'A';
      wCarry = 1;
    } else {
      wChars[wIdx] = String.fromCharCode(64 + wCode);
      wCarry = 0;
    }
  }
  if (wCarry) {
    wChars.unshift('A');
  }
  return wChars.join('');
}

/** OpenAI-compatible tool definitions for llama-server function calling. */
export const SK_MCP_OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_cell',
      description: 'Read a single cell value from the workbook.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Virtual disk path, e.g. /share/file.sker' },
          ref: { type: 'string', description: 'Cell ref A1 notation, e.g. H7' },
          sheet: { type: 'string', description: 'Optional sheet name' },
        },
        required: ['path', 'ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_cell',
      description: 'Write a value or formula to one cell.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          ref: { type: 'string' },
          value: { type: 'string', description: 'Text, number, or formula starting with =' },
          sheet: { type: 'string' },
        },
        required: ['path', 'ref', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_formatted_cell',
      description:
        'Write one cell value AND apply styling (bold, italic, colors, font). Prefer over write_cell + format_range for a single styled cell.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          ref: { type: 'string', description: 'Cell ref e.g. A23' },
          value: { type: 'string' },
          sheet: { type: 'string' },
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          backgroundColor: {
            type: 'string',
            description: 'Hex (#ADD8E6) or US English name (lightblue, lightgreen, lightyellow, lightgray, white)',
          },
          color: { type: 'string', description: 'Text color hex or name' },
          fontFamily: { type: 'string', description: 'e.g. Roboto, Arial' },
          fontSizePt: { type: 'number', description: 'Font size in points, e.g. 14' },
        },
        required: ['path', 'ref', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_range',
      description:
        'Read cell values in an A1 range. Do NOT use this to color or format — use apply_format. Do not dump every cell in the chat reply.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          range: { type: 'string', description: 'e.g. A1:C10' },
          sheet: { type: 'string' },
        },
        required: ['path', 'range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List .sker files on the virtual disk (e.g. /share/…). Use when user asks for fichiers, files, classeurs on disk — NOT sheet tabs.',
      parameters: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: 'Optional virtual directory, e.g. /share (default: user share root)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'paste_file_list',
      description:
        'List .sker files on the virtual disk and paste a two-column table (Fichier, Chemin) into the workbook. Use when user wants files listed in the spreadsheet.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          directory: {
            type: 'string',
            description: 'Optional virtual directory, e.g. /share',
          },
          startCell: {
            type: 'string',
            description: 'Top-left destination cell, default A1',
          },
          sheet: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_sheet',
      description:
        'Create a new sheet tab in the workbook. Call list_sheets first; required before paste_grid/write_cell on a new sheet name.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          name: { type: 'string', description: 'New sheet tab name, e.g. Data' },
          insertAfter: {
            type: 'string',
            description: 'Optional existing sheet name to insert after (left anchor)',
          },
        },
        required: ['path', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sheets',
      description:
        'List sheet tab names INSIDE one open workbook (e.g. Sheet1, Sheet2). NOT the list of .sker files on disk — use list_files for that.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_workbook',
      description: 'Read workbook structure, cells and formats (one sheet or full book).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          sheet: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'paste_grid',
      description:
        'Paste a 2D grid (preferred for new tables). Include styles.header/dataOdd/dataEven in THIS call for look. Do not follow with resize or extra format unless asked.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          range: {
            type: 'string',
            description: 'Destination range covering the full grid, e.g. A1:C101. A single start cell (A1) is expanded from rows.',
          },
          startRef: {
            type: 'string',
            description: 'Optional alias for the top-left cell when range is omitted, e.g. A1',
          },
          rows: {
            type: 'array',
            items: {
              type: 'array',
            },
            description: 'Row 0 = header, then data rows. Numbers as JSON numbers. Formulas as "=…" strings.',
          },
          styles: {
            type: 'object',
            properties: {
              header: {
                type: 'string',
                description: 'Header CSS ending with ; e.g. background-color:#4472C4;color:#fff;font-weight:bold;',
              },
              dataOdd: { type: 'string', description: 'Odd data row CSS e.g. background-color:#D6EAF8;' },
              dataEven: { type: 'string', description: 'Even data row CSS e.g. background-color:#ffffff;' },
              default: { type: 'string' },
            },
            description: 'Visual styles for this paste — use for a colored grid in one call.',
          },
          sheet: { type: 'string' },
        },
        required: ['path', 'rows'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_cells',
      description: 'Batch write multiple cells in one call (map ref → value).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          cells: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Map of A1 refs to values, e.g. { "H7": "Allez", "H8": "100" }',
          },
          sheet: { type: 'string' },
        },
        required: ['path', 'cells'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_range',
      description: 'Copy a range → native cp JSON clipboard (use with paste_range).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          range: { type: 'string' },
          sheet: { type: 'string' },
        },
        required: ['path', 'range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'paste_range',
      description: 'Paste native cp JSON from copy_range into a destination range.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          range: { type: 'string', description: 'Destination range e.g. G2:U7' },
          clipboard: {
            type: 'object',
            description: 'cp object from copy_range (select, cells, si, fi, f)',
          },
          sheet: { type: 'string' },
        },
        required: ['path', 'range', 'clipboard'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'duplicate_range',
      description: 'Clone a formatted block to another range.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          sourceRange: { type: 'string' },
          destRange: { type: 'string' },
          sheet: { type: 'string' },
        },
        required: ['path', 'sourceRange', 'destRange'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_format',
      description:
        'Color or format an existing range. Prefer this over read_range when the user asks to color a table. Use properties[] or flags. Sker CSS: background-color, color, font-weight, text-align, format-string.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          range: { type: 'string', description: 'A1 range e.g. A1:C1 or H7' },
          sheet: { type: 'string' },
          css: {
            type: 'string',
            description: 'Sker CSS string, e.g. background-color:#4472C4;color:white;font-weight:bold;',
          },
          properties: {
            type: 'array',
            items: { type: 'string' },
            description:
              'JSON-safe CSS lines without semicolons, e.g. ["background-color:#4472C4","color:white","font-weight:bold"]',
          },
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          underline: { type: 'boolean' },
          backgroundColor: {
            type: 'string',
            description: 'Hex (#4472C4) or name (lightblue, white, red)',
          },
          color: { type: 'string', description: 'Text color hex or name' },
          fontFamily: { type: 'string' },
          fontSizePt: { type: 'number' },
          textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
          border: { type: 'string', description: 'e.g. 1px solid #000000' },
        },
        required: ['path', 'range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'format_ranges',
      description: 'Batch format many ranges (all sheet styling) in ONE persist. Prefer this over multiple apply_format/format_range calls.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                range: { type: 'string' },
                css: { type: 'string' },
              },
              required: ['range', 'css'],
            },
          },
          sheet: { type: 'string' },
        },
        required: ['path', 'items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'format_range',
      description: 'Apply CSS styling to a range (must end with ;).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          range: { type: 'string' },
          css: { type: 'string' },
          sheet: { type: 'string' },
        },
        required: ['path', 'range', 'css'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_cells',
      description: 'Merge a rectangular cell range.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          range: { type: 'string' },
          sheet: { type: 'string' },
        },
        required: ['path', 'range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resize_columns',
      description: 'Set column width(s) in CSS pixels (e.g. columns B:D, widthPixels 140).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          columns: { type: 'string', description: 'Column or range, e.g. B or B:D' },
          widthPixels: { type: 'number', description: 'Width in CSS pixels' },
          sheet: { type: 'string' },
        },
        required: ['path', 'columns', 'widthPixels'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resize_rows',
      description: 'Set row height(s) in CSS pixels (e.g. rows 2:10, heightPixels 28).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          rows: { type: 'string', description: 'Row or range, 1-based, e.g. 2 or 2:10' },
          heightPixels: { type: 'number', description: 'Height in CSS pixels' },
          sheet: { type: 'string' },
        },
        required: ['path', 'rows', 'heightPixels'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_column_width',
      description: 'Read current column width in CSS pixels.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          column: { type: 'string', description: 'Column letter, e.g. B' },
          sheet: { type: 'string' },
        },
        required: ['path', 'column'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_row_height',
      description: 'Read current row height in CSS pixels.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          row: { type: 'string', description: 'Row number, 1-based, e.g. 2' },
          sheet: { type: 'string' },
        },
        required: ['path', 'row'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_table',
      description:
        'Promote a pasted range to an Excel-style RangeData table (sort/filter + visual tableStyleName). Range must match paste_grid EXACTLY. Omit name — server auto-assigns Table2, Table3, … (names are workbook-global; reusing a name deletes the existing table). Call list_tables first if tables may already exist.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          range: {
            type: 'string',
            description: 'Same range as paste_grid, e.g. H1:J42 (NOT H1:J41 — off-by-one drops last row)',
          },
          name: {
            type: 'string',
            description:
              'Optional — omit unless user explicitly requests a name. Auto Table2, Table3, … Reusing a name deletes the existing table (workbook-global).',
          },
          sheet: { type: 'string' },
          tableStyleName: {
            type: 'string',
            description: 'Excel table visual style (header/stripes), default TableStyleMedium2',
          },
        },
        required: ['path', 'range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_table_filter_sort',
      description:
        'Sort or filter one column on a RangeData table. Call list_tables first to verify table name and ref.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          tableName: { type: 'string', description: 'e.g. Table1' },
          column: {
            type: 'string',
            description: 'Column letter (B) or 0-based offset within table',
          },
          sheet: { type: 'string' },
          sort: {
            type: 'string',
            enum: ['None', 'Ascending', 'Descending'],
            description: 'Sort order on this column',
          },
          filter: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['None', 'Equals', 'Contains', 'IsEmpty', 'IsNotEmpty'],
              },
              value: { type: 'string' },
              values: {
                type: 'array',
                items: { type: 'string' },
                description: 'Multi-value Equals filter',
              },
            },
          },
        },
        required: ['path', 'tableName', 'column'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tables',
      description: 'List RangeData tables in the workbook.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          sheet: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
];

/** Tools whose CSS/string args often break llama-server JSON parsing. */
const LLAMA_RISKY_TOOL_NAMES = new Set([
  'format_range',
  'format_ranges',
  'paste_range',
  'copy_range',
  'duplicate_range',
]);

const LLAMA_COMPACT_TOOL_NAMES = new Set([
  'paste_grid',
  'write_cell',
  'write_cells',
  'create_sheet',
  'apply_format',
]);

const LLAMA_SAFE_TOOL_NAMES = new Set([
  'read_cell',
  'write_cell',
  'write_formatted_cell',
  'write_cells',
  'read_range',
  'list_files',
  'paste_file_list',
  'list_sheets',
  'create_sheet',
  'read_workbook',
  'paste_grid',
  'list_tables',
  'create_table',
  'merge_cells',
  'resize_columns',
  'resize_rows',
  'get_column_width',
  'get_row_height',
  'apply_format',
]);

/**
 * @param {'default'|'safe'|'full'|'compact'} mode
 */
export function getOpenAiToolsForLlama(mode = 'default') {
  if (mode === 'full' || process.env.SK_LLAMA_MCP_FULL_TOOLS === '1') {
    return SK_MCP_OPENAI_TOOLS;
  }
  if (mode === 'compact') {
    return SK_MCP_OPENAI_TOOLS.filter((t) => LLAMA_COMPACT_TOOL_NAMES.has(t.function.name));
  }
  if (mode === 'safe') {
    return SK_MCP_OPENAI_TOOLS.filter((t) => LLAMA_SAFE_TOOL_NAMES.has(t.function.name));
  }
  return SK_MCP_OPENAI_TOOLS.filter((t) => !LLAMA_RISKY_TOOL_NAMES.has(t.function.name));
}

/**
 * @param {import('./SkeeptoTools.mjs').SkeeptoTools} tools
 * @param {Record<string, unknown>} args
 * @param {string} name
 */
async function invokeToolHandler(tools, name, args) {
  switch (name) {
    case 'read_cell': {
      const wParsed = parseRefAndSheet(String(args.ref), args.sheet ? String(args.sheet) : undefined);
      const wValue = await tools.readCell(String(args.path), wParsed.ref, wParsed.sheet);
      return { ref: wParsed.ref, sheet: wParsed.sheet, value: wValue };
    }
    case 'write_cell': {
      const wParsed = parseRefAndSheet(String(args.ref), args.sheet ? String(args.sheet) : undefined);
      const wResult = await tools.writeCell(
        String(args.path),
        wParsed.ref,
        String(args.value ?? ''),
        wParsed.sheet
      );
      return { ...wParsed, value: args.value, ...wResult };
    }
    case 'write_formatted_cell': {
      const wParsed = parseRefAndSheet(String(args.ref), args.sheet ? String(args.sheet) : undefined);
      const wValue = String(args.value ?? '');
      const wWriteResult = await tools.writeCell(
        String(args.path),
        wParsed.ref,
        wValue,
        wParsed.sheet
      );
      const wCss = buildFormatCssFromStructuredArgs({
        bold: args.bold === true,
        italic: args.italic === true,
        underline: args.underline === true,
        backgroundColor: args.backgroundColor != null ? String(args.backgroundColor) : undefined,
        color: args.color != null ? String(args.color) : undefined,
        fontFamily: args.fontFamily != null ? String(args.fontFamily) : undefined,
        fontSizePt: args.fontSizePt,
        textAlign: args.textAlign != null ? String(args.textAlign) : undefined,
      });
      let wFormatResult = null;
      if (wCss) {
        wFormatResult = await tools.formatRange(
          String(args.path),
          wParsed.ref,
          wCss,
          wParsed.sheet
        );
      }
      return {
        ...wParsed,
        value: wValue,
        css: wCss || undefined,
        ...wWriteResult,
        format: wFormatResult,
      };
    }
    case 'apply_format': {
      const wCss = buildFormatCssFromApplyFormatArgs(args);
      return tools.formatRange(
        String(args.path),
        String(args.range),
        wCss,
        args.sheet ? String(args.sheet) : ''
      );
    }
    case 'paste_file_list': {
      const wSheet = args.sheet ? String(args.sheet) : '';
      const wDirectory = typeof args.directory === 'string' ? args.directory : '';
      const wStartParsed = parseRefAndSheet(
        typeof args.startCell === 'string' && args.startCell.trim() ? args.startCell : 'A1',
        wSheet || undefined
      );
      const wList = await tools.listFiles(wDirectory);
      const wContents = Array.isArray(wList?.contents) ? wList.contents : [];
      const wFiles = wContents
        .filter((f) => f && !f.isDirectory)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
      if (wFiles.length === 0) {
        return { fileCount: 0, message: 'No files found on virtual disk.', startCell: wStartParsed.ref };
      }
      const wRows = [['Fichier', 'Chemin']];
      for (const wFile of wFiles) {
        wRows.push([String(wFile.name), String(wFile.path)]);
      }
      const wStartCol = wStartParsed.ref.replace(/\d+$/, '');
      const wStartRow = Number(wStartParsed.ref.replace(/^[A-Z]+/i, '')) || 1;
      const wEndCol = incrementColumnLabel(wStartCol);
      const wEndRow = wStartRow + wRows.length - 1;
      const wRange = `${wStartCol}${wStartRow}:${wEndCol}${wEndRow}`;
      const wPasteResult = await tools.pasteGrid(
        String(args.path),
        wRange,
        { rows: wRows },
        wStartParsed.sheet || wSheet
      );
      return {
        fileCount: wFiles.length,
        range: wRange,
        files: wFiles.map((f) => ({ name: f.name, path: f.path })),
        paste: wPasteResult,
      };
    }
    case 'read_range': {
      const wSheet = args.sheet ? String(args.sheet) : '';
      const wCells = expandRange(String(args.range));
      const wValues = {};
      for (const ref of wCells) {
        wValues[ref] = await tools.readCell(String(args.path), ref, wSheet);
      }
      return { range: args.range, sheet: wSheet, cells: wValues };
    }
    case 'list_sheets':
      return tools.listSheets(String(args.path));
    case 'create_sheet':
      return tools.createSheet(
        String(args.path),
        String(args.name),
        typeof args.insertAfter === 'string' ? args.insertAfter : ''
      );
    case 'list_files':
      return tools.listFiles(typeof args.directory === 'string' ? args.directory : '');
    case 'read_workbook':
      return tools.readWorkbook(String(args.path), {
        sheet: args.sheet ? String(args.sheet) : '',
        includeInternalSheets: false,
      });
    case 'paste_grid':
      return tools.pasteGrid(
        String(args.path),
        String(args.range || args.startRef || args.startCell || ''),
        { rows: args.rows, styles: args.styles },
        args.sheet ? String(args.sheet) : ''
      );
    case 'write_cells':
      return tools.writeCells(
        String(args.path),
        args.cells,
        args.sheet ? String(args.sheet) : ''
      );
    case 'copy_range':
      return tools.copyRange(
        String(args.path),
        String(args.range),
        args.sheet ? String(args.sheet) : ''
      );
    case 'paste_range':
      return tools.pasteRange(
        String(args.path),
        String(args.range),
        args.clipboard,
        args.sheet ? String(args.sheet) : ''
      );
    case 'duplicate_range':
      return tools.duplicateRange(
        String(args.path),
        String(args.sourceRange),
        String(args.destRange),
        args.sheet ? String(args.sheet) : ''
      );
    case 'format_ranges':
      return tools.formatRanges(
        String(args.path),
        args.items,
        args.sheet ? String(args.sheet) : ''
      );
    case 'format_range':
      return tools.formatRange(
        String(args.path),
        String(args.range),
        String(args.css),
        args.sheet ? String(args.sheet) : ''
      );
    case 'merge_cells':
      return tools.mergeCells(
        String(args.path),
        String(args.range),
        args.sheet ? String(args.sheet) : ''
      );
    case 'resize_columns':
      return tools.resizeColumns(
        String(args.path),
        String(args.columns),
        Number(args.widthPixels),
        args.sheet ? String(args.sheet) : ''
      );
    case 'resize_rows':
      return tools.resizeRows(
        String(args.path),
        String(args.rows),
        Number(args.heightPixels),
        args.sheet ? String(args.sheet) : ''
      );
    case 'get_column_width':
      return tools.getColumnWidth(
        String(args.path),
        String(args.column),
        args.sheet ? String(args.sheet) : ''
      );
    case 'get_row_height':
      return tools.getRowHeight(
        String(args.path),
        args.row != null ? args.row : '',
        args.sheet ? String(args.sheet) : ''
      );
    case 'create_table':
      return tools.createTable(String(args.path), String(args.range), {
        name: args.name ? String(args.name) : undefined,
        sheet: args.sheet ? String(args.sheet) : undefined,
        tableStyleName: args.tableStyleName ? String(args.tableStyleName) : undefined,
      });
    case 'apply_table_filter_sort':
      return tools.applyTableFilterSort(
        String(args.path),
        String(args.tableName),
        args.column,
        {
          sheet: args.sheet ? String(args.sheet) : undefined,
          sort: args.sort,
          filter: args.filter,
        }
      );
    case 'list_tables':
      return tools.listTables(String(args.path), args.sheet ? String(args.sheet) : '');
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

/**
 * @param {import('./SkeeptoTools.mjs').SkeeptoTools} spreadsheetTools
 * @param {{ defaultWorkbookPath?: string, userEmail?: string }} ctx
 */
export function createSkAiMcpToolExecutor(spreadsheetTools, ctx = {}) {
  const wDefaultPath = ctx.defaultWorkbookPath || '';

  /**
   * @param {string} name
   * @param {Record<string, unknown>} rawArgs
   */
  async function callTool(name, rawArgs) {
    const wArgs = { ...(rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) };
    if ((!wArgs.path || String(wArgs.path).trim() === '') && wDefaultPath) {
      wArgs.path = wDefaultPath;
    }
    if (!wArgs.path) {
      throw new Error('workbook path is required (path)');
    }

    const wWorkbookPath = String(wArgs.path);
    const wUserEmail = ctx.userEmail || '';

    const wResult = await runWithAiDispatchContext(
      { onBehalfOf: wUserEmail, workbookPath: wWorkbookPath },
      () => invokeToolHandler(spreadsheetTools, name, wArgs)
    );

    return clipLlamaToolResult(name, formatToolText(wResult));
  }

  return {
    getOpenAiTools: (mode = 'default') => getOpenAiToolsForLlama(mode),
    callTool,
  };
}

/**
 * Keep tool results small so llama does not spend 11 tok/s listing every cell.
 * @param {string} name
 * @param {string} text
 * @returns {string}
 */
function clipLlamaToolResult(name, text) {
  const wRaw = String(text || '');
  const wMax =
    name === 'read_range' || name === 'read_workbook' || name === 'read_cell' ? 800 : 2500;
  if (wRaw.length <= wMax) {
    return wRaw;
  }
  return `${wRaw.slice(0, wMax)}\n…truncated. Do not list every cell; summarize in one sentence and act.`;
}
