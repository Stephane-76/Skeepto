//=============================================================================
// SkAiCapabilities.mjs — MCP tool catalog for agent prompt (keep in sync with SkMcpToolRegistrar)
//=============================================================================

/** @typedef {{ id: string, summary: string }} SkMcpToolEntry */

/** @type {Record<string, SkMcpToolEntry[]>} */
export const SKER_MCP_TOOL_CATALOG = {
  read: [
    { id: 'read_workbook', summary: 'full workbook or one sheet (cells, formats)' },
    { id: 'read_cell', summary: 'single cell value' },
    { id: 'read_range', summary: 'A1 range values' },
    { id: 'list_sheets', summary: 'sheet names' },
    { id: 'create_sheet', summary: 'add a new sheet tab — call before writing on a new sheet name' },
    { id: 'get_column_width', summary: 'column width in pixels' },
    { id: 'get_row_height', summary: 'row height in pixels' },
    { id: 'list_files', summary: 'virtual disk paths under /share/…' },
  ],
  write: [
    { id: 'paste_grid', summary: 'NEW grid of VALUES + formulas (row 0 = header); follow with create_table when the table policy below says so' },
    { id: 'write_cells', summary: 'batch cell values' },
    { id: 'write_cell', summary: 'single cell value or formula' },
    {
      id: 'write_formatted_cell',
      summary: 'single cell value + CSS flags — only when user asks custom format (not for new tables)',
    },
    { id: 'paste_file_list', summary: 'list .sker files on disk and paste Fichier/Chemin table into workbook' },
    { id: 'paste_range', summary: 'paste native cp JSON (from copy_range)' },
  ],
  format: [
    { id: 'apply_format', summary: 'CSS on a range — use for format-string (numbers); avoid colors on tables (use tableStyleName)' },
    { id: 'format_range', summary: 'CSS on one range — format-string OK; avoid visual chrome on tables' },
    { id: 'format_ranges', summary: 'batch format ALL ranges of a sheet in ONE call/persist — format-string OK; avoid table look via CSS' },
    { id: 'merge_cells', summary: 'merge rectangular range, e.g. H11:J13' },
    { id: 'resize_columns', summary: 'column width in pixels, e.g. B:D → 140' },
    { id: 'resize_rows', summary: 'row height in pixels, e.g. 2:10 → 28' },
  ],
  copy: [
    { id: 'copy_range', summary: 'copy → native cp JSON' },
    { id: 'duplicate_range', summary: 'clone formatted block to another range' },
  ],
  tables: [
    { id: 'list_tables', summary: 'RangeData tables (name, ref, columns, sort/filter state)' },
    {
      id: 'create_table',
      summary:
        'Promote paste_grid range to a RangeData Excel table (sort/filter + tableStyleName). Omit name — auto Table2, Table3, … (names are workbook-global; reusing a name deletes the old table)',
    },
    {
      id: 'apply_table_filter_sort',
      summary: 'sort Ascending/Descending or filter one column on a RangeData table',
    },
  ],
  files: [
    { id: 'open_workbook', summary: 'load .sker into server WASM (skip if active workbook given)' },
    { id: 'save_workbook', summary: 'persist (most write tools already persist)' },
  ],
  advanced: [
    {
      id: 'spreadsheet_call',
      summary:
        'low-level WASM: Value, GetValue, GetFormula, InsertRow/Col, DeleteRow/Col, Format, Merge, RecalculateAll, SizeCol/Row, …',
    },
  ],
};

/**
 * Lines appended to the agent system prompt (American English instructions).
 * @param {{ useExcelTables?: boolean }} [options]
 *   useExcelTables — Cursor cloud defaults to RangeData Excel tables after paste_grid.
 *   Llama keeps a plain grid unless the user explicitly asks for an Excel table.
 * @returns {string[]}
 */
export function buildAgentCapabilitiesPromptLines(options = {}) {
  const wUseExcelTables = options.useExcelTables === true;
  const wFormatGroup = (label, entries) => {
    const wIds = entries.map((e) => `${e.id} (${e.summary})`).join('; ');
    return `- ${label}: ${wIds}`;
  };

  const wTablePolicy = wUseExcelTables
    ? [
        'Tables — DEFAULT is a real Excel RangeData table (you USE tables):',
        '- You have list_tables, create_table, and apply_table_filter_sort. For any new list/catalog/tableau, USE them.',
        '- Workflow: ONE paste_grid (values + "=…" formulas, row 0 = header), THEN create_table on the EXACT same A1 range, with tableStyleName (default TableStyleMedium2).',
        '- Do this even if the user just says "tableau", "liste", "mets ça dans un tableau", or does not mention Excel/sort/filter.',
        '- Look comes from tableStyleName (Medium1–Medium28, Light1–Light21, Dark1–Dark11). Do NOT also paint header/stripes with paste_grid styles or visual CSS.',
        '- Skip create_table only for a non-data layout (invoice letterhead, form labels, a single KPI row). Totals/subtotal rows can stay inside the table range if they are part of the grid.',
        '- Range must match exactly: paste_grid H1:J42 → create_table H1:J42 (NOT H1:J41 — off-by-one drops the last row from sort/filter).',
        '- Omit name (auto Table2, Table3, …). Names are workbook-global; never reuse one. Call list_tables first if tables may already exist, and before apply_table_filter_sort.',
        '- apply_table_filter_sort: column as letter (B) or 0-based offset; sort Ascending/Descending; filter { op, value } or { op: Equals, values: [...] }.',
        '- Write the table/list/document the user asked for. Do NOT substitute a different template (accounting, invoice, VAT, balance sheet) unless they asked for it.',
        '- format-string (number formats) via apply_format / format_range is always OK on table columns.',
      ]
    : [
        'Tables — DEFAULT is NO Excel table:',
        '- By default, build tabular data as a plain grid: paste_grid for values, plus paste_grid styles / format_range for the header and stripes look. Do NOT create an Excel table.',
        '- Write the table/list/document the user asked for. Do NOT substitute a different template (accounting, invoice, VAT, balance sheet) unless they asked for it.',
        '- Use create_table ONLY when the user EXPLICITLY asks for a real Excel table / sortable-filterable table (e.g. "fais-en un tableau Excel", "avec tri et filtre", "table Excel"). A simple request like "crée un tableau de données" is NOT such a request — keep it a plain grid.',
        '- When (and only when) the user asks for an Excel table: create_table with the EXACT same range as paste_grid (e.g. paste_grid H1:J42 → create_table H1:J42); off-by-one bottom row excludes data from sort. Omit name (auto Table2, …); names are workbook-global, never reuse one. list_tables first if tables may exist, and to verify a ref before apply_table_filter_sort.',
        '- format-string (number formats) via apply_format / format_range is always OK, table or not.',
      ];

  return [
    'MCP tool catalog (authoritative — do not invent tools beyond this list):',
    wFormatGroup('Read', SKER_MCP_TOOL_CATALOG.read),
    wFormatGroup('Write', SKER_MCP_TOOL_CATALOG.write),
    wFormatGroup('Format & layout', SKER_MCP_TOOL_CATALOG.format),
    wFormatGroup('Copy', SKER_MCP_TOOL_CATALOG.copy),
    wFormatGroup('Tables (RangeData)', SKER_MCP_TOOL_CATALOG.tables),
    wFormatGroup('Files', SKER_MCP_TOOL_CATALOG.files),
    wFormatGroup('Advanced', SKER_MCP_TOOL_CATALOG.advanced),
    'Meta-questions (user asks what you can do, "est-ce que tu sais faire une table", "connais-tu les fonctions Excel"):',
    '- Answer in French with the categories above; keep it concise (bullets, no emoji spam). Do NOT paste a grid.',
    '- Never mention internet, web browsing, or lacking network — you have local MCP tools on the open workbook and /share/ virtual disk.',
    ...wTablePolicy,
    'Formulas:',
    '- Put formula cells DIRECTLY in the paste_grid rows as strings starting with "=" (e.g. "=SUM(C5:C15)", "=C16+C24"), in the SAME paste_grid call as the data — do not add them in a separate pass.',
    '- paste_grid stores "=" strings as real formulas (not text); write totals/subtotals this way too.',
    '- NEVER tell the user that formulas or values were added unless you actually called a write tool (paste_grid / write_cell / write_cells) with them in this turn.',
    '- Do NOT claim a catalog of Excel formula functions (SUM, IF, …) — you may write formulas via paste_grid/write_cell/write_cells if you know the syntax.',
    'Dates:',
    '- Write dates as US values (MM/DD/YYYY or ISO yyyy-mm-dd, e.g. today 07/17/2026). write_cell/write_cells store them as real dates and auto-apply the mm-dd-yyyy mask (shows 07-17-2026) — do not write a date as a plain quoted string.',
    '- For a different date display, call apply_format / format_range with a date format-string (e.g. "mm-dd-yyyy", "dddd mmmm dd", "mmmm yyyy") after the value.',
    '- Do NOT list spreadsheet_call fn names unless the user asks for low-level API details.',
    '- Do NOT ask the user for language, locale, or date format — locale is in the prompt; proceed with MCP tools.',
  ];
}

/**
 * Instant French answer for "que peux-tu faire" in agent mode (no llama round-trip).
 * @returns {string}
 */
export function buildFrenchAgentCapabilitiesAnswer() {
  const wFullTools = process.env.SK_LLAMA_MCP_FULL_TOOLS === '1';
  const wLines = [
    'Je peux faire les actions suivantes avec ce tableur :',
    '',
    '• Lire et écrire des cellules (valeur ou formule =SUM, =IF, …)',
    '• Coller des grilles de données (mise en forme en-tête/lignes) ; création de table Excel (tri, filtre, style TableStyleMedium2) uniquement si vous le demandez',
    '• Formater des plages hors table si demandé (apply_format)',
    '• Ajuster largeurs de colonnes / hauteurs de lignes (resize_columns, resize_rows, get_column_width, get_row_height)',
    '• Créer des feuilles',
    '• Lister les fichiers sur le disque virtuel /share/',
  ];
  if (wFullTools) {
    wLines.push('• Copier des plages formatées (duplicate_range, paste_range)');
  }
  wLines.push(
    '',
    'Ce qui manque :',
    '• Pas d\'Internet ni de recherche en ligne',
    '• Pas de graphiques ou diagrammes',
    '• Pas de catalogue automatique de toutes les fonctions Excel — je peux écrire SUM, IF, VLOOKUP, INDEX, MATCH, SUMIF, COUNTIF, AVERAGE, TODAY, IFERROR, … si vous me demandez de les poser dans le classeur',
  );
  return wLines.join('\n');
}

/**
 * Instant French answer for "connais-tu les fonctions Excel" (no llama round-trip).
 * @returns {string}
 */
export function buildFrenchExcelFunctionsAnswer() {
  return [
    'Je n\'ai pas de catalogue complet des fonctions Excel intégré.',
    '',
    'Je peux écrire des formules en syntaxe anglaise via write_cell / paste_grid, par exemple :',
    '• Maths : SUM, AVERAGE, MIN, MAX, ROUND, ABS',
    '• Logique : IF, IFS, AND, OR, IFERROR, IFNA',
    '• Recherche : VLOOKUP, HLOOKUP, INDEX, MATCH, XLOOKUP',
    '• Texte : LEFT, RIGHT, MID, LEN, TRIM, CONCAT, TEXT',
    '• Dates : TODAY, NOW, YEAR, MONTH, DAY, DATE, EOMONTH',
    '• Stats : COUNT, COUNTA, COUNTIF, SUMIF, SUMIFS',
    '',
    'Pour coller un tableau de fonctions dans le classeur, dites par exemple : « mets la liste des fonctions Excel dans un tableau ».',
  ].join('\n');
}
