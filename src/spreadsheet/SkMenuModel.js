// =============================================================================
// SkMenuModel
// Single source of truth for the common spreadsheet menus (Edit / Format / View
// / Named / Tools / Help). Plain serializable data (NO JSX, NO closures) so it
// can be:
//   - decorated by the web menu (SkeeptoMenu.js): icons, checked states,
//     dynamic format submenus, and Print inserted under Edit;
//   - resolved + pushed over IPC to the Electron main process (SkDesktopBridge
//     -> preload.setMenuModel -> electron/main.js) to build the native menu,
//     with Print placed under the native File menu instead.
//
// Node shapes:
//   { id, label, action, accelerator? }  -> command leaf
//   { type: 'separator' }                -> separator
//   { id, label, children: [...] }       -> static submenu
//   { id, label, dynamic: <key> }        -> submenu filled at build time
//   command leaf may carry { checkable: 'grid' } for toggle items (web only)
//
// dynamic keys: 'format-number' | 'format-currency' | 'format-percent'
//               | 'format-scientific' | 'format-date-time' | 'zoom'
//
// NOTE: Print is intentionally absent here; it is the only per-platform
// difference (web -> Edit, Electron -> File).
// =============================================================================

// Shared with the web builder and the desktop bridge so both stay in sync.
export const VIEW_ZOOM_PRESETS = [50, 75, 90, 100, 125, 150, 200];

// The spreadsheet action id for the Print dialog (placed per platform).
export const PRINT_ACTION = 'format-print';

/**
 * Serializable model of the common spreadsheet menus.
 * @returns {Array<object>} top-level menus, each with `children`.
 */
export function getCommonSpreadsheetMenuModel() {
  return [
    {
      id: 'edit',
      label: 'Edit',
      children: [
        // No accelerators on undo/redo/cut/copy/paste: the renderer already
        // handles those keys (grid + in-place editor); native accelerators here
        // would intercept them and break editing inside cells/inputs.
        { id: 'undo', label: 'Undo', action: 'undo' },
        { id: 'redo', label: 'Redo', action: 'redo' },
        { type: 'separator' },
        { id: 'cut', label: 'Cut', action: 'cut' },
        { id: 'copy', label: 'Copy', action: 'copy' },
        { id: 'paste', label: 'Paste', action: 'paste' },
        { type: 'separator' },
        { id: 'find-text', label: 'Find', action: 'find-text', accelerator: 'CmdOrCtrl+F' },
        { id: 'replace', label: 'Replace', action: 'replace' },
        // Print is injected here by the web builder (Electron uses File > Print).
        { type: 'separator' },
        { id: 'recalculate-all', label: 'Recalculate all (F9)', action: 'recalculate-all', accelerator: 'F9' },
      ],
    },
    {
      id: 'format',
      label: 'Format',
      children: [
        { id: 'format-number', label: 'Number', dynamic: 'format-number' },
        { id: 'format-currency', label: 'Currency', dynamic: 'format-currency' },
        { id: 'format-percent', label: 'Percent', dynamic: 'format-percent' },
        { id: 'format-scientific', label: 'Scientific', dynamic: 'format-scientific' },
        { id: 'format-date-time', label: 'Date & time', dynamic: 'format-date-time' },
        { type: 'separator' },
        {
          id: 'format-text',
          label: 'Text',
          children: [
            { id: 'format-bold', label: 'Bold', action: 'format-bold', accelerator: 'CmdOrCtrl+B' },
            { id: 'format-italic', label: 'Italic', action: 'format-italic', accelerator: 'CmdOrCtrl+I' },
            { id: 'format-underline', label: 'Underline', action: 'format-underline', accelerator: 'CmdOrCtrl+U' },
            { id: 'format-strikethrough', label: 'Strike', action: 'format-strikethrough' },
          ],
        },
        { type: 'separator' },
        { id: 'format-font', label: 'Font & Material Color', action: 'format-font' },
        { id: 'format-borders', label: 'Borders', action: 'format-borders' },
        { id: 'format-conditional', label: 'Conditional Formatting', action: 'format-conditional' },
        { type: 'separator' },
        { id: 'format-clear', label: 'Clear formats (Ctrl+Shift+Backspace)', action: 'format-clear' },
      ],
    },
    {
      id: 'view',
      label: 'View',
      children: [
        { id: 'view-zoom', label: 'Zoom', dynamic: 'zoom' },
        { id: 'view-grid-lines', label: 'Grid lines', action: 'view-grid-lines', checkable: 'grid' },
        {
          id: 'view-freeze-panes',
          label: 'Freeze panes',
          children: [
            { id: 'view-split-cursor-row', label: 'Horizontal split — freeze rows (at cursor)', action: 'view-split-cursor-row' },
            { id: 'view-split-cursor-col', label: 'Vertical split — freeze columns (at cursor)', action: 'view-split-cursor-col' },
            { type: 'separator' },
            { id: 'view-no-split', label: 'Clear freezes', action: 'view-no-split' },
          ],
        },
      ],
    },
    {
      id: 'name',
      label: 'Named',
      children: [
        { id: 'named-ranges', label: 'Ranges', action: 'named-ranges' },
        { id: 'named-formulas', label: 'Formulas', action: 'named-formulas' },
        { type: 'separator' },
        { id: 'sheet-tables', label: 'Tables…', action: 'sheet-tables' },
        { id: 'sheet-create-table', label: 'Create table', action: 'sheet-create-table' },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      children: [
        { id: 'tools-ai-assistant', label: 'Assistant IA', action: 'tools-ai-assistant' },
        { type: 'separator' },
        { id: 'tools-unit', label: 'Unit', action: 'tools-unit' },
        { type: 'separator' },
        { id: 'tools-class', label: 'Class', action: 'tools-class' },
        { id: 'tools-attribute', label: 'Attribute', action: 'tools-attribute' },
        { type: 'separator' },
        { id: 'show-function', label: 'Function (fx)', action: 'show-function' },
        { type: 'separator' },
        { id: 'tools-function', label: 'Function tools', action: 'tools-function' },
        { type: 'separator' },
        { id: 'tools-chat', label: 'Chat', action: 'tools-chat' },
        { id: 'tools-debug', label: 'Debug', action: 'tools-debug' },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      children: [
        { id: 'help-shortcuts', label: 'Keyboard Shortcuts', action: 'help-shortcuts' },
        { id: 'help-about', label: 'About', action: 'help-about' },
      ],
    },
  ];
}
