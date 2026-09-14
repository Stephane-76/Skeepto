import React from 'react';
import SkModal from './SkModal';

// Detect the host platform: 'mac' | 'windows' | 'linux' | 'other'.
// Prefer the modern userAgentData API and fall back to navigator.platform / userAgent.
function getPlatform() {
  if (typeof navigator === 'undefined') {
    return 'other';
  }
  const uaData = navigator.userAgentData;
  const source = `${(uaData && uaData.platform) || navigator.platform || ''} ${navigator.userAgent || ''}`;
  if (/Mac|iPhone|iPad|iPod/i.test(source)) {
    return 'mac';
  }
  if (/Win/i.test(source)) {
    return 'windows';
  }
  // Linux, and other Unix-like systems (X11, *BSD).
  if (/Linux|X11|BSD|Unix/i.test(source)) {
    return 'linux';
  }
  return 'other';
}

function isMacPlatform() {
  return getPlatform() === 'mac';
}

// Primary action modifier: Command on Mac, Ctrl on Windows/Unix.
function modLabel() {
  return isMacPlatform() ? '⌘' : 'Ctrl';
}

// Secondary modifier: Option on Mac, Alt on Windows/Unix.
function altLabel() {
  return isMacPlatform() ? '⌥' : 'Alt';
}

// Platform-specific sentence describing the modifier keys.
function platformHint() {
  switch (getPlatform()) {
    case 'mac':
      return 'On Mac, use ⌘ (Command) and ⌥ (Option) for actions shown with modifier keys.';
    case 'windows':
      return 'On Windows, use Ctrl and Alt for actions shown with modifier keys.';
    case 'linux':
      return 'On Linux/Unix, use Ctrl and Alt for actions shown with modifier keys.';
    default:
      return 'Use Ctrl (⌘ on Mac) and Alt (⌥ on Mac) for actions shown with modifier keys.';
  }
}

function getShortcutSections() {
  const mod = modLabel();
  const alt = altLabel();

  return [
    {
      title: 'Editing',
      items: [
        { keys: ['F2'], description: 'Edit the active cell' },
        { keys: ['Enter'], description: 'Confirm edit and move down' },
        { keys: ['Esc'], description: 'Cancel edit' },
        { keys: [`${alt}`, 'Enter'], description: 'Insert a line break inside the cell' },
        { keys: ['Any letter or digit'], description: 'Start editing and type that character' },
        { keys: ['Backspace'], description: 'Clear cell content (keep format)' },
        { keys: ['Delete'], description: 'Clear cell content (keep format)' },
        { keys: [mod, 'Delete'], description: 'Clear cell content and format' },
        { keys: [mod, 'Backspace'], description: 'Clear cell content and format' },
        { keys: [mod, 'Shift', 'Backspace'], description: 'Clear format only (keep content)' },
      ],
    },
    {
      title: 'Clipboard & history',
      items: [
        { keys: [mod, 'C'], description: 'Copy selection' },
        { keys: [mod, 'X'], description: 'Cut selection' },
        { keys: [mod, 'V'], description: 'Paste' },
        { keys: [mod, 'Z'], description: 'Undo' },
        { keys: [mod, 'Shift', 'Z'], description: 'Redo' },
      ],
    },
    {
      title: 'Insert',
      items: [
        { keys: [mod, 'Shift', 'I'], description: 'Insert an image' },
      ],
    },
    {
      title: 'Formulas',
      items: [
        { keys: ['F9'], description: 'Recalculate all formulas in the workbook' },
      ],
    },
    {
      title: 'Navigation',
      items: [
        { keys: ['↑', '↓', '←', '→'], description: 'Move active cell' },
        { keys: ['Shift', '↑', '↓', '←', '→'], description: 'Extend selection' },
        { keys: [mod, '↑', '↓', '←', '→'], description: 'Jump to the edge of the data region' },
        { keys: ['Page Up'], description: 'Move up one screen' },
        { keys: ['Page Down'], description: 'Move down one screen' },
        { keys: ['Home'], description: 'Move to the first column of the row' },
        { keys: ['End'], description: 'Move to the last used column of the row' },
        { keys: [mod, 'Home'], description: 'Move to the first cell of the sheet row (edge jump)' },
        { keys: [mod, 'End'], description: 'Move to the last used cell of the row (edge jump)' },
      ],
    },
    {
      title: 'Selection (mouse)',
      items: [
        { keys: ['Click'], description: 'Select a cell' },
        { keys: ['Shift', 'Click'], description: 'Add a separate cell to the selection (multi-selection)' },
        { keys: [mod, 'Click'], description: 'Add a separate cell to the selection (multi-selection)' },
        { keys: ['Drag'], description: 'Select a range' },
        { keys: ['Click', 'column/row header'], description: 'Select the whole column or row' },
        { keys: ['Drag', 'column/row headers'], description: 'Select several columns or rows' },
      ],
    },
    {
      title: 'Application menu',
      items: [
        { keys: ['F10'], description: 'Focus the menu bar' },
        { keys: ['←', '→'], description: 'Move between top-level menus (when focused)' },
        { keys: ['↓'], description: 'Open the highlighted menu' },
        { keys: ['Esc'], description: 'Close the menu' },
      ],
    },
  ];
}

function ShortcutKeys({ keys }) {
  return (
    <span className="SkShortcuts-keys">
      {keys.map((key, index) => (
        <React.Fragment key={`${key}-${index}`}>
          {index > 0 ? <span className="SkShortcuts-plus">+</span> : null}
          <kbd className="SkShortcuts-kbd">{key}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

function SkKeyboardShortcutsModal({ show, onClose }) {
  if (!show) {
    return null;
  }

  const sections = getShortcutSections();

  return (
    <SkModal
      show={show}
      title="Keyboard Shortcuts"
      width={760}
      height={600}
      closeButton
      onClose={onClose}
      footer={
        <button
          type="button"
          className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
          onClick={onClose}
        >
          Close
        </button>
      }
    >
      <p className="SkShortcuts-intro">
        Shortcuts available while the spreadsheet grid is focused.
        {' '}
        {platformHint()}
      </p>
      <div className="SkShortcuts-sections">
        {sections.map((section) => (
          <section key={section.title} className="SkShortcuts-section">
            <h3 className="SkShortcuts-sectionTitle">{section.title}</h3>
            <table className="SkShortcuts-table">
              <tbody>
                {section.items.map((item) => (
                  <tr key={`${section.title}-${item.description}`}>
                    <td className="SkShortcuts-tableKeys">
                      <ShortcutKeys keys={item.keys} />
                    </td>
                    <td className="SkShortcuts-tableDesc">{item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </SkModal>
  );
}

export default SkKeyboardShortcutsModal;
