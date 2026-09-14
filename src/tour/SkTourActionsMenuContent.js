import React from 'react';

/**
 * Rich tooltip body for the Virtual Disk Actions menu tour step.
 */
export function SkTourActionsMenuContent() {
  return (
    <div className="sker-tour-actions-menu">
      <p className="sker-tour-actions-menu-lead">
        Click the Actions button at the bottom-right, or right-click the file tree,
        to open this menu. Actions apply to the selected item (or the current folder
        when nothing is selected).
      </p>
      <dl className="sker-tour-actions-menu-groups">
        <div>
          <dt>Create</dt>
          <dd>
            <strong>Upload</strong> files from your computer, add a <strong>New folder</strong>,
            a blank <strong>New spreadsheet</strong> (.sker) or a <strong>New HTML file</strong>.
          </dd>
        </div>
        <div>
          <dt>Sharing</dt>
          <dd>
            <strong>Access</strong> — set read/write permissions on the selected file or folder.
          </dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>
            <strong>Download</strong> saves the selection to your computer.
            <strong> Open in Excel</strong> launches a desktop workbook (.xlsx, .xls, .xlsm, .xlsb).
          </dd>
        </div>
        <div>
          <dt>Workbook history</dt>
          <dd>
            <strong>Save snapshot</strong> stores a labelled checkpoint of a .sker file.
            <strong> Versions</strong> lets you browse snapshots and restore an older revision.
          </dd>
        </div>
        <div>
          <dt>Excel interchange</dt>
          <dd>
            <strong>Convert Excel</strong> turns .xlsx into .sker.
            <strong> Export to Excel</strong> does the reverse for an open workbook.
          </dd>
        </div>
        <div>
          <dt>Organize</dt>
          <dd>
            <strong>Rename</strong> changes the name of the selected file or folder.
          </dd>
        </div>
        <div>
          <dt>Remove</dt>
          <dd><strong>Delete</strong> permanently removes the selected file or folder.</dd>
        </div>
      </dl>
      <p className="sker-tour-actions-menu-note">
        Greyed-out entries need a compatible selection (for example a .sker file for
        snapshots, or a file for download).
      </p>
    </div>
  );
}

export default SkTourActionsMenuContent;
