//=============================================================================
// SkSpConditionalFormat
// Two internal stack panels:
//   1. List  — all rules, + Add, delete per row, pencil to edit
//   2. Edit  — create or modify a rule (OK / Cancel / Delete), back to list
//=============================================================================
import React, { Component } from 'react';

import { parseRangeBoundsSync } from './SkA1Ref.js';
import SkButton from '../component/SkButton';
import SkConditionalFormat from '../component/SkConditionalFormat';
import {
  cfRuleIdentityChanged,
  deleteConditionalFormatRule,
  fetchConditionalFormatRules,
  getRuleListTitle,
  getRulePreviewColor,
  getRuleRange,
  getRuleType,
} from './SkConditionalFormatRules';
import { applyConditionalFormatFromUi, resolveConditionalFormatApplyError } from './SkConditionalFormatApply';
import './SkSpreadSheet.css';

const DRAFT_INDEX = -2;
const STACK_LIST = 'list';
const STACK_EDIT = 'edit';

class SkSpConditionalFormat extends Component {
  constructor(props) {
    super(props);
    this.m_SpInterface = props.SpInterface;
    this.m_ListRef = React.createRef();
    this.m_EditSnapshot = null;

    this.state = {
      stackView: STACK_LIST,
      rules: [],
      rulesLoading: false,
      editingIndex: -1,
      highlightedIndex: -1,
      error: '',
      info: '',
    };

    this.refresh = this.refresh.bind(this);
    this.openList = this.openList.bind(this);
    this.startNew = this.startNew.bind(this);
    this.startEdit = this.startEdit.bind(this);
    this.cancelEdit = this.cancelEdit.bind(this);
    this.confirmEdit = this.confirmEdit.bind(this);
    this.deleteRuleAtIndex = this.deleteRuleAtIndex.bind(this);
    this.deleteCurrentRule = this.deleteCurrentRule.bind(this);
    this.onRowClick = this.onRowClick.bind(this);
    this.selectRuleRange = this.selectRuleRange.bind(this);
  }

  componentDidMount() {
    this.refresh();
    this._boundOnReloadView = () => {
      this.refresh();
    };
    this._boundOnVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.refresh();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('sker:reloadView', this._boundOnReloadView);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._boundOnVisibility);
    }
  }

  componentWillUnmount() {
    void this.endInplaceEditIfNeeded();
    if (typeof window !== 'undefined' && this._boundOnReloadView) {
      window.removeEventListener('sker:reloadView', this._boundOnReloadView);
    }
    if (typeof document !== 'undefined' && this._boundOnVisibility) {
      document.removeEventListener('visibilitychange', this._boundOnVisibility);
    }
  }

  currentSheet() {
    return this.m_SpInterface?.m_UIView?.sheet || '';
  }

  async refresh() {
    this.setState({ rulesLoading: true, error: '' });
    try {
      const rules = await fetchConditionalFormatRules(this.currentSheet());
      this.setState({ rules, rulesLoading: false });
    } catch (error) {
      console.error('SkSpConditionalFormat::refresh error', error);
      this.setState({ rulesLoading: false, error: 'Failed to load rules.' });
    }
  }

  getDefaultRef() {
    try {
      return this.m_SpInterface?.select?.()?.str?.() || '';
    } catch (_) {
      return '';
    }
  }

  // Tear down the CF range picker so grid cell edit is not blocked afterward.
  async endInplaceEditIfNeeded() {
    const sp = this.m_SpInterface;
    if (!sp) return;
    const propEd = sp.m_SkSpInplaceEditProperty;
    if (propEd == null) return;
    const wProp =
      typeof propEd.property === 'function'
        ? propEd.property()
        : propEd.m_Property;
    if (wProp !== 'conditionalFormatRef') return;
    try {
      await sp.endEdit();
    } catch (error) {
      console.error('SkSpConditionalFormat::endEdit error', error);
    }
  }

  async openList() {
    await this.endInplaceEditIfNeeded();
    this.m_EditSnapshot = null;
    this.setState({
      stackView: STACK_LIST,
      editingIndex: -1,
      error: '',
    });
  }

  async startNew() {
    await this.endInplaceEditIfNeeded();
      this.m_SpInterface?.clearFormulaBarCompileError?.();
      this.m_EditSnapshot = null;
      this.setState({
      stackView: STACK_EDIT,
      editingIndex: DRAFT_INDEX,
      error: '',
      info: '',
    });
  }

  async startEdit(idx) {
    await this.endInplaceEditIfNeeded();
    this.m_SpInterface?.clearFormulaBarCompileError?.();
    const rule = this.state.rules[idx];
    this.m_EditSnapshot = rule ? { ...rule } : null;
    this.setState({
      stackView: STACK_EDIT,
      editingIndex: idx,
      error: '',
      info: '',
    });
  }

  async cancelEdit() {
    await this.openList();
  }

  async confirmEdit(format, ref) {
    const { editingIndex, rules } = this.state;
    const wIsNew = editingIndex === DRAFT_INDEX;
    const wRule = !wIsNew && editingIndex >= 0 ? rules[editingIndex] : null;
    const wRef = (ref || '').trim();
    if (!format?.type || !wRef) {
      this.setState({ error: 'Choose a range and complete the rule.', info: '' });
      return;
    }

    const wSheet = this.currentSheet();

    try {
      this.m_SpInterface?.clearFormulaBarCompileError?.();
      this.m_SpInterface?.setExtraUndo?.();

      // Range or rule type changed: remove the old key before creating the new one.
      if (wRule && cfRuleIdentityChanged(wRule, format.type, wRef)) {
        const deleted = await deleteConditionalFormatRule(wRule, wSheet);
        if (!deleted) {
          this.setState({ error: 'Could not replace the rule (delete failed).', info: '' });
          return;
        }
      }

      const applied = await applyConditionalFormatFromUi(
        this.m_SpInterface,
        format,
        wRef,
        wSheet
      );
      if (!applied) {
        const wMsg = await resolveConditionalFormatApplyError(
          this.m_SpInterface,
          format
        );
        if (typeof this.m_SpInterface?.setEditErrorMessage === 'function') {
          this.m_SpInterface.setEditErrorMessage(wMsg);
        } else if (typeof this.m_SpInterface?.notifyOperationFailure === 'function') {
          await this.m_SpInterface.notifyOperationFailure(wMsg, null, true);
        }
        this.setState({ error: '', info: '' });
        return;
      }

      this.m_SpInterface?.clearFormulaBarCompileError?.();

      await this.endInplaceEditIfNeeded();
      this.setState({
        stackView: STACK_LIST,
        editingIndex: -1,
        error: '',
        info: editingIndex === DRAFT_INDEX ? 'Rule created' : 'Rule updated',
      });
      await this.refresh();
    } catch (error) {
      console.error('SkSpConditionalFormat::confirmEdit error', error);
      this.setState({ error: 'Could not save the rule.', info: '' });
    }
  }

  async deleteRuleAtIndex(idx, event) {
    if (event) {
      event.stopPropagation();
    }
    const rule = this.state.rules[idx];
    if (!rule) return;

    try {
      this.m_SpInterface?.setExtraUndo?.();
      const deleted = await deleteConditionalFormatRule(rule, this.currentSheet());
      if (!deleted) {
        this.setState({ error: 'Could not delete the rule.', info: '' });
        return;
      }
      await this.m_SpInterface?.reloadView?.();
      await this.endInplaceEditIfNeeded();
      this.setState({
        stackView: STACK_LIST,
        editingIndex: -1,
        highlightedIndex: -1,
        error: '',
        info: 'Rule deleted',
      });
      await this.refresh();
    } catch (error) {
      console.error('SkSpConditionalFormat::deleteRuleAtIndex error', error);
      this.setState({ error: 'Could not delete the rule.', info: '' });
    }
  }

  async deleteCurrentRule() {
    const { editingIndex } = this.state;
    if (editingIndex < 0) return;
    await this.deleteRuleAtIndex(editingIndex);
  }

  async selectRuleRange(rule) {
    const sp = this.m_SpInterface;
    const ref = getRuleRange(rule);
    if (!sp || !ref) return;

    const bounds = parseRangeBoundsSync(ref);
    if (!bounds) return;
    const { top, left, bottom, right } = bounds;
    try {
      sp.m_Select?.raz?.();
      sp.m_SelectRow?.raz?.();
      sp.m_SelectCol?.raz?.();
      sp.m_Select?.addRange?.({ top, left, bottom, right });
      await sp.reloadView?.();
    } catch (error) {
      console.error('SkSpConditionalFormat::selectRuleRange error', error);
    }
  }

  onRowClick(idx) {
    const rule = this.state.rules[idx];
    if (!rule) return;
    this.setState({ highlightedIndex: idx });
    void this.selectRuleRange(rule);
  }

  renderPreview(rule) {
    const previewColor = getRulePreviewColor(rule);
    const type = getRuleType(rule);

    if (type === 'ColorScales') {
      const min = previewColor || '#ED7D31';
      const max = rule.param2 || '#FFF2CC';
      return (
        <span
          className="SkSpConditionalFormat-preview SkSpConditionalFormat-preview--scale"
          style={{ background: `linear-gradient(to right, ${min}, ${max})` }}
        />
      );
    }

    if (type === 'IconSets') {
      return <span className="SkSpConditionalFormat-preview SkSpConditionalFormat-preview--icon">★</span>;
    }

    return (
      <span
        className="SkSpConditionalFormat-preview"
        style={{ backgroundColor: previewColor || '#FF0000' }}
      />
    );
  }

  renderListPanel() {
    const { rules, rulesLoading, info, error, highlightedIndex } = this.state;

    return (
      <div className="SkSpConditionalFormat SkSpConditionalFormat--list" style={rootStyle}>
        <div style={headerStyle}>
          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>
            Conditional formatting ({rules.length})
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <SkButton onClick={this.startNew} title="Add a new rule">
              +
            </SkButton>
            <SkButton onClick={this.refresh} title="Refresh">
              ⟳
            </SkButton>
          </div>
        </div>

        {info && <div style={infoStyle}>{info}</div>}
        {error && <div style={errorStyle}>{error}</div>}

        <ul
          ref={this.m_ListRef}
          style={listStyle}
          className="SkSpConditionalFormat-list"
          tabIndex={0}
        >
          {rules.length === 0 ? (
            <li style={emptyStyle}>
              {rulesLoading ? 'Loading…' : 'No rules on this sheet — click "+" to create one.'}
            </li>
          ) : (
            rules.map((rule, idx) => {
              const wIsHighlighted = highlightedIndex === idx;
              return (
                <li
                  key={`row:${rule.key || idx}`}
                  style={rowStyle}
                  className={
                    'SkSpConditionalFormat-row' +
                    (wIsHighlighted ? ' SkSpConditionalFormat-row--highlighted' : '')
                  }
                  onClick={() => this.onRowClick(idx)}
                  title="Click to select range on sheet"
                >
                  {this.renderPreview(rule)}
                  <div style={rowContentStyle}>
                    <div style={rowNameStyle}>{getRuleListTitle(rule)}</div>
                    <div style={rowSubStyle}>{getRuleRange(rule)}</div>
                  </div>
                  <div style={rowActionsStyle}>
                    <button
                      type="button"
                      className="SkSpConditionalFormat-pencil"
                      style={iconButtonStyle}
                      onClick={(e) => {
                        e.stopPropagation();
                        this.startEdit(idx);
                      }}
                      title="Edit this rule"
                      aria-label={`Edit rule on ${getRuleRange(rule)}`}
                    >
                      {pencilIcon}
                    </button>
                    <button
                      type="button"
                      className="SkSpConditionalFormat-delete"
                      style={iconButtonStyle}
                      onClick={(e) => this.deleteRuleAtIndex(idx, e)}
                      title="Delete this rule"
                      aria-label={`Delete rule on ${getRuleRange(rule)}`}
                    >
                      {deleteIcon}
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>

        <button type="button" style={addRuleLinkStyle} onClick={this.startNew}>
          + Add a rule
        </button>
      </div>
    );
  }

  renderEditPanel() {
    const { editingIndex, rules, error } = this.state;
    const wIsNew = editingIndex === DRAFT_INDEX;
    const wRule = !wIsNew && editingIndex >= 0 ? rules[editingIndex] : null;
    const wTitle = wIsNew ? 'New formatting rule' : 'Edit formatting rule';

    return (
      <div className="SkSpConditionalFormat SkSpConditionalFormat--edit" style={editRootStyle}>
        <div className="SkSpConditionalFormat-editHeader" style={editHeaderStyle}>
          <button
            type="button"
            className="SkSpConditionalFormat-back"
            style={backButtonStyle}
            onClick={this.cancelEdit}
            title="Back to list"
          >
            ←
          </button>
          <div style={editTitleStyle}>{wTitle}</div>
        </div>

        {error && <div style={errorBannerStyle}>{error}</div>}

        <div className="SkSpConditionalFormat-editBody">
          <SkConditionalFormat
            key={wIsNew ? 'new' : `edit-${editingIndex}`}
            formOnly
            stacked
            SpInterface={this.m_SpInterface}
            initialRule={wRule}
            initialRef={wIsNew ? this.getDefaultRef() : getRuleRange(wRule)}
            onCancel={this.cancelEdit}
            onFormatChange={(format, ref) => this.confirmEdit(format, ref)}
            onDelete={wIsNew ? undefined : this.deleteCurrentRule}
          />
        </div>
      </div>
    );
  }

  render() {
    if (this.state.stackView === STACK_EDIT) {
      return this.renderEditPanel();
    }
    return this.renderListPanel();
  }
}

const pencilIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M11.5 2.5L13.5 4.5L5 13L2 14L3 11L11.5 2.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M10 4L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const deleteIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M3 4h10M6 4V3h4v1M5 4v9h6V4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '8px',
  flexShrink: 0,
};

const editHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '8px',
  flexShrink: 0,
};

const editTitleStyle = {
  fontWeight: 'bold',
  fontSize: '14px',
  flex: 1,
  minWidth: 0,
};

const backButtonStyle = {
  flex: '0 0 auto',
  width: '28px',
  height: '28px',
  padding: 0,
  border: '1px solid var(--sk-row-list-border-color)',
  borderRadius: '4px',
  background: 'var(--sk-color-background-tool)',
  color: 'var(--sk-color)',
  cursor: 'pointer',
  fontSize: '16px',
  lineHeight: 1,
};

const rootStyle = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  padding: '8px',
  boxSizing: 'border-box',
};

const editRootStyle = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: 0,
  height: 'auto',
  padding: '8px',
  boxSizing: 'border-box',
  overflow: 'hidden',
};

const listStyle = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  border: '1px solid var(--sk-row-list-border-color)',
  borderRadius: '4px',
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
};

const rowStyle = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 10px',
  cursor: 'pointer',
  borderBottom: '1px solid var(--sk-row-border-color)',
  transition: 'background-color 0.15s',
};

const rowContentStyle = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
};

const rowActionsStyle = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '2px',
  flexShrink: 0,
};

const rowNameStyle = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--sk-color)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const rowSubStyle = {
  fontSize: '12px',
  color: 'var(--sk-row-label-color)',
  fontFamily: 'var(--sk-font-family)',
  marginTop: '2px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const iconButtonStyle = {
  width: '28px',
  height: '28px',
  padding: 0,
  border: '1px solid transparent',
  borderRadius: '4px',
  background: 'transparent',
  color: 'var(--sk-row-pencil-color)',
  cursor: 'pointer',
  opacity: 0.45,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const emptyStyle = {
  padding: '16px 10px',
  color: 'var(--sk-row-empty-color)',
  fontStyle: 'italic',
  textAlign: 'center',
};

const errorStyle = {
  color: '#c00',
  fontSize: '12px',
  marginBottom: '6px',
  flexShrink: 0,
};

const errorBannerStyle = {
  color: '#c00',
  fontSize: '12px',
  flexShrink: 0,
  marginBottom: '6px',
};

const infoStyle = {
  color: '#060',
  fontSize: '12px',
  marginBottom: '6px',
  flexShrink: 0,
};

const addRuleLinkStyle = {
  marginTop: '10px',
  padding: '8px 4px',
  border: 'none',
  background: 'transparent',
  color: 'var(--sk-accent-color, #1a73e8)',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  textAlign: 'left',
  flexShrink: 0,
};

export default SkSpConditionalFormat;
