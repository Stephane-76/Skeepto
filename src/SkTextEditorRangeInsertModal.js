import React from 'react';
import SkModal from './component/SkModal.js';
import SkInput from './component/SkInput.js';
import {
  defaultRangeInsertDialogValues,
  loadSheetsForWorkbookPath,
  rangeSelectionToHtmlTable,
  resolveWorkbookPath,
} from './spreadsheet/SkRangeToHtmlTable.js';
import {
  DEFAULT_RANGE_IMAGE_ZOOM,
  rangeSelectionToImage,
} from './spreadsheet/SkRangeToImage.js';

const modalFieldStyle = { marginBottom: '10px' };
const modalInputStyle = { width: '100%', boxSizing: 'border-box' };
const DEFAULT_ZOOM_PERCENT = Math.round(DEFAULT_RANGE_IMAGE_ZOOM * 100);

function resolvePresetZoomPercent(preset) {
  const raw = Number(preset?.zoomPercent ?? preset?.skerZoomPercent);
  if (Number.isFinite(raw) && raw >= 5 && raw <= 400) {
    return Math.round(raw);
  }
  return DEFAULT_ZOOM_PERCENT;
}

class SkTextEditorRangeInsertModal extends React.Component {
  constructor(props) {
    super(props);
    this.workbookRefreshTimer = null;
    this.state = {
      workbookPath: '',
      sheet: '',
      range: 'A1:C3',
      sheets: [],
      insertFormat: 'image',
      zoomPercent: DEFAULT_ZOOM_PERCENT,
      loading: false,
      error: '',
    };
  }

  componentWillUnmount() {
    if (this.workbookRefreshTimer) {
      clearTimeout(this.workbookRefreshTimer);
      this.workbookRefreshTimer = null;
    }
  }

  componentDidUpdate(prevProps) {
    if (this.props.show && !prevProps.show) {
      void this.openDialog();
    }
  }

  scheduleWorkbookRefresh = (workbookPath) => {
    if (this.workbookRefreshTimer) {
      clearTimeout(this.workbookRefreshTimer);
    }
    const trimmed = String(workbookPath || '').trim();
    if (!trimmed) {
      return;
    }
    this.workbookRefreshTimer = setTimeout(() => {
      this.workbookRefreshTimer = null;
      void this.refreshSheets(trimmed);
    }, 450);
  };

  openDialog = async () => {
    this.setState({ loading: true, error: '' });
    const { initialSelection, documentPath, mode = 'insert' } = this.props;
    const preset = initialSelection || null;
    const isEdit = mode === 'edit';

    if (preset && (preset.workbookPath || preset.sheet || preset.range)) {
      const workbookPath = preset.workbookPath || '';
      const sheets = Array.isArray(preset.sheets) ? preset.sheets : [];
      this.setState({
        workbookPath,
        sheet: preset.sheet || '',
        range: preset.range || 'A1:C3',
        sheets,
        insertFormat: isEdit ? 'table' : 'image',
        zoomPercent: resolvePresetZoomPercent(preset),
        loading: false,
        error: '',
      });
      if (workbookPath && sheets.length === 0) {
        void this.refreshSheets(workbookPath);
      }
      return;
    }

    try {
      const defaults = await defaultRangeInsertDialogValues(documentPath || '');
      this.setState({
        workbookPath: defaults.workbookPath,
        sheet: defaults.sheet,
        range: defaults.range,
        sheets: defaults.sheets,
        insertFormat: isEdit ? 'table' : 'image',
        zoomPercent: DEFAULT_ZOOM_PERCENT,
        loading: false,
        error: '',
      });
      if (defaults.workbookPath && defaults.sheets.length === 0) {
        void this.refreshSheets(defaults.workbookPath);
      }
    } catch (err) {
      this.setState({
        loading: false,
        error: err?.message || 'Unable to initialize the dialog.',
      });
    }
  };

  onWorkbookPathChange = (event) => {
    const workbookPath = event.target.value;
    this.setState({ workbookPath, sheets: [], sheet: '', error: '' });
    this.scheduleWorkbookRefresh(workbookPath);
  };

  onWorkbookPathBlur = () => {
    const { workbookPath } = this.state;
    if (workbookPath.trim()) {
      void this.refreshSheets(workbookPath);
    }
  };

  onSheetChange = (event) => {
    this.setState({ sheet: event.target.value });
  };

  onRangeChange = (event) => {
    this.setState({ range: event.target.value });
  };

  onInsertFormatChange = (event) => {
    this.setState({ insertFormat: event.target.value });
  };

  onZoomPercentChange = (event) => {
    const raw = Number(event.target.value);
    const zoomPercent = Number.isFinite(raw)
      ? Math.max(5, Math.min(400, Math.round(raw)))
      : DEFAULT_ZOOM_PERCENT;
    this.setState({ zoomPercent });
  };

  refreshSheets = async (workbookPathOverride) => {
    const workbookPath = String(
      workbookPathOverride ?? this.state.workbookPath ?? ''
    ).trim();
    const { documentPath } = this.props;
    if (!workbookPath) {
      return;
    }
    this.setState({ loading: true, error: '' });
    try {
      const loaded = await loadSheetsForWorkbookPath(workbookPath, documentPath || '');
      this.setState((prev) => ({
        sheets: loaded.sheets,
        sheet: loaded.sheets.includes(prev.sheet)
          ? prev.sheet
          : (loaded.sheets[0] || prev.sheet || ''),
        loading: false,
        error: '',
      }));
    } catch (err) {
      this.setState({
        loading: false,
        error: err?.message || 'Unable to load the workbook.',
      });
    }
  };

  confirmInsert = async () => {
    const { workbookPath, sheet, range, sheets, insertFormat, zoomPercent } = this.state;
    const { documentPath, onInsert, onClose, mode = 'insert' } = this.props;
    if (!workbookPath.trim()) {
      return;
    }
    this.setState({ loading: true, error: '' });
    try {
      let activeSheet = sheet;
      if (!activeSheet || (sheets.length > 0 && !sheets.includes(activeSheet))) {
        const loaded = await loadSheetsForWorkbookPath(workbookPath, documentPath || '');
        activeSheet = loaded.sheets.includes(activeSheet)
          ? activeSheet
          : (loaded.sheets[0] || activeSheet);
        this.setState({ sheets: loaded.sheets, sheet: activeSheet });
      }

      const selection = {
        workbookPath,
        sheet: activeSheet,
        range,
        documentPath: documentPath || '',
      };

      const useImage = mode === 'editImage' || (mode !== 'edit' && insertFormat === 'image');
      if (useImage) {
        const zoom = Math.max(0.05, Math.min(4, (Number(zoomPercent) || DEFAULT_ZOOM_PERCENT) / 100));
        const imageResult = await rangeSelectionToImage({
          ...selection,
          zoom,
        });
        onInsert({
          format: 'image',
          dataUrl: imageResult.dataUrl,
          width: imageResult.width,
          height: imageResult.height,
          zoomPercent: Math.round(zoom * 100),
          source: {
            workbookPath,
            sheet: activeSheet,
            range,
          },
        });
      } else {
        const html = await rangeSelectionToHtmlTable(selection);
        onInsert({ format: 'table', html });
      }
      onClose();
    } catch (err) {
      this.setState({
        loading: false,
        error: err?.message || 'Operation failed.',
      });
    }
  };

  renderResolvedPathHint() {
    const { workbookPath } = this.state;
    const { documentPath } = this.props;
    if (!workbookPath || workbookPath.startsWith('/')) {
      return null;
    }
    const resolved = resolveWorkbookPath(workbookPath, documentPath || '');
    return (
      <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0', wordBreak: 'break-all' }}>
        Resolved path: <code>{resolved}</code>
      </p>
    );
  }

  renderInsertFormatField(isEditTable, isEditImage) {
    if (isEditTable) {
      return (
        <p style={{ fontSize: '12px', color: '#666', marginBottom: '14px' }}>
          Edit mode refreshes the embedded HTML table (live cells).
        </p>
      );
    }

    if (isEditImage) {
      const { zoomPercent } = this.state;
      return (
        <div style={modalFieldStyle}>
          <p style={{ fontSize: '12px', color: '#666', margin: '0 0 10px' }}>
            Regenerate the snapshot from the workbook (WYSIWYG image).
          </p>
          <label htmlFor="te-range-zoom" style={{ display: 'block', marginBottom: '6px' }}>
            Zoom (%)
          </label>
          <SkInput
            id="te-range-zoom"
            type="number"
            min={5}
            max={400}
            step={5}
            value={zoomPercent}
            onChange={this.onZoomPercentChange}
            disabled={this.state.loading}
            style={{ ...modalInputStyle, maxWidth: '120px' }}
          />
        </div>
      );
    }

    const { insertFormat, zoomPercent } = this.state;
    return (
      <div style={modalFieldStyle}>
        <span style={{ display: 'block', marginBottom: '6px' }}>Insert as</span>
        <label style={{ marginRight: '16px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="te-range-format"
            value="image"
            checked={insertFormat === 'image'}
            onChange={this.onInsertFormatChange}
            disabled={this.state.loading}
          />
          {' '}
          Image (WYSIWYG snapshot)
        </label>
        <label style={{ cursor: 'pointer' }}>
          <input
            type="radio"
            name="te-range-format"
            value="table"
            checked={insertFormat === 'table'}
            onChange={this.onInsertFormatChange}
            disabled={this.state.loading}
          />
          {' '}
          HTML table (editable cells)
        </label>
        {insertFormat === 'image' ? (
          <div style={{ marginTop: '10px' }}>
            <label htmlFor="te-range-zoom" style={{ display: 'block', marginBottom: '6px' }}>
              Zoom (%)
            </label>
            <SkInput
              id="te-range-zoom"
              type="number"
              min={5}
              max={400}
              step={5}
              value={zoomPercent}
              onChange={this.onZoomPercentChange}
              disabled={this.state.loading}
              style={{ ...modalInputStyle, maxWidth: '120px' }}
            />
            <p style={{ fontSize: '12px', color: '#666', margin: '6px 0 0' }}>
              Default {DEFAULT_ZOOM_PERCENT}% — lower values produce smaller snapshots.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  render() {
    const { show, onClose, documentPath, mode = 'insert' } = this.props;
    const { workbookPath, sheet, range, sheets, loading, error } = this.state;
    const busy = loading;
    const isEditTable = mode === 'edit';
    const isEditImage = mode === 'editImage';
    const isEdit = isEditTable || isEditImage;

    const modalWidth = isEditImage || isEditTable ? 480 : 520;
    const modalHeight = isEditImage ? 380 : (isEditTable ? 360 : 460);

    return (
      <SkModal
        show={show}
        title={
          isEditTable
            ? 'Edit range source'
            : (isEditImage ? 'Edit range snapshot' : 'Insert spreadsheet range')
        }
        width={modalWidth}
        height={modalHeight}
        closeButton={false}
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
              onClick={() => { void this.refreshSheets(); }}
              disabled={busy || !workbookPath.trim()}
            >
              Load sheets
            </button>
            <button
              type="button"
              className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
              onClick={() => { void this.confirmInsert(); }}
              disabled={busy || !workbookPath.trim() || !sheet || !range.trim()}
            >
              {isEdit ? 'Apply' : 'Insert'}
            </button>
          </>
        }
      >
        {documentPath ? (
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
            Document: <code>{documentPath}</code>
            {' — '}
            relative paths (<code>./</code>, <code>../</code>) are resolved from its folder.
          </p>
        ) : (
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
            Local draft: use an absolute path (<code>/…/file.sker</code>)
            or save the document to the virtual disk for relative paths.
          </p>
        )}

        {this.renderInsertFormatField(isEditTable, isEditImage)}

        <div style={modalFieldStyle}>
          <label htmlFor="te-range-workbook" style={{ display: 'block', marginBottom: '6px' }}>
            Workbook (.sker)
          </label>
          <SkInput
            id="te-range-workbook"
            type="text"
            value={workbookPath}
            onChange={this.onWorkbookPathChange}
            onBlur={this.onWorkbookPathBlur}
            placeholder="/Documents/MyWorkbook.sker or ./MyWorkbook.sker"
            disabled={busy}
            style={modalInputStyle}
          />
          {this.renderResolvedPathHint()}
        </div>

        <div style={modalFieldStyle}>
          <label htmlFor="te-range-sheet" style={{ display: 'block', marginBottom: '6px' }}>
            Sheet
          </label>
          {sheets.length > 0 ? (
            <select
              id="te-range-sheet"
              value={sheet}
              onChange={this.onSheetChange}
              disabled={busy}
              style={{ width: '100%', padding: '6px 8px', boxSizing: 'border-box' }}
            >
              {sheets.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          ) : (
            <SkInput
              id="te-range-sheet"
              type="text"
              value={sheet}
              onChange={this.onSheetChange}
              placeholder="Sheet1 — blur the workbook field to load the list"
              disabled={busy}
              style={modalInputStyle}
            />
          )}
        </div>

        <div style={modalFieldStyle}>
          <label htmlFor="te-range-ref" style={{ display: 'block', marginBottom: '6px' }}>
            Range
          </label>
          <SkInput
            id="te-range-ref"
            type="text"
            value={range}
            onChange={this.onRangeChange}
            placeholder="B2:J10"
            disabled={busy}
            style={modalInputStyle}
          />
        </div>

        {error ? (
          <p style={{ color: '#b00020', fontSize: '13px', margin: 0 }}>{error}</p>
        ) : null}
      </SkModal>
    );
  }
}

export default SkTextEditorRangeInsertModal;
