//=============================================================================
// SkAiCapabilitiesHelp.js — empty-state help for the spreadsheet AI panel
// Keep tool ids in sync with Node/Server/SkAI/SkMcpToolRegistrar.mjs
//=============================================================================

import React from 'react';

const CAPABILITY_SECTIONS = [
  {
    title: 'Read',
    tools: ['read_workbook', 'read_cell', 'read_range', 'list_sheets', 'get_column_width', 'get_row_height'],
  },
  {
    title: 'Tables & values',
    tools: ['paste_grid', 'write_cells', 'write_cell', 'paste_range'],
    note: 'Prefer paste_grid for a new table (data + colors in a single call).',
  },
  {
    title: 'Formatting & sizes',
    tools: ['format_range', 'format_ranges', 'apply_format', 'merge_cells', 'resize_columns', 'resize_rows'],
  },
  {
    title: 'Copy & files',
    tools: ['copy_range', 'duplicate_range', 'list_files', 'open_workbook', 'save_workbook'],
  },
  {
    title: 'Tables (sort & filters)',
    tools: ['list_tables', 'create_table', 'apply_table_filter_sort'],
    note: 'After paste_grid: create_table on exactly the same range (same top-left and bottom-right), then list_tables and apply_table_filter_sort.',
  },
];

const EXAMPLE_PROMPTS = [
  'List French departments as a table',
  'Turn A1:D50 into a table and sort column B ascending',
  'Filter the table on column City = Paris',
  'Widen columns B through D to 140 pixels',
  'Read the content of the active sheet',
  'Merge cells H11:J13',
  'Which sheets does this workbook contain?',
];

export default function SkAiCapabilitiesHelp() {
  return (
    <div className="SkSpAiChat-help">
      <p className="SkSpAiChat-helpLead">
        The assistant edits the open workbook through the sker MCP (Cursor Cloud + HTTPS tunnel).
      </p>

      {CAPABILITY_SECTIONS.map((section) => (
        <div key={section.title} className="SkSpAiChat-helpSection">
          <div className="SkSpAiChat-helpTitle">{section.title}</div>
          <ul className="SkSpAiChat-helpTools">
            {section.tools.map((tool) => (
              <li key={tool}>
                <code>{tool}</code>
              </li>
            ))}
          </ul>
          {section.note ? (
            <p className="SkSpAiChat-helpNote">{section.note}</p>
          ) : null}
        </div>
      ))}

      <div className="SkSpAiChat-helpSection">
        <div className="SkSpAiChat-helpTitle">Example prompts</div>
        <ul className="SkSpAiChat-helpExamples">
          {EXAMPLE_PROMPTS.map((text) => (
            <li key={text}>&ldquo;{text}&rdquo;</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
