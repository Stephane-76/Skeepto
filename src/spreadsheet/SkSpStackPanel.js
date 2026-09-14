//=============================================================================
// SkSpStackPanel
// A strip-less replacement for SkTabs: children keyed by their `label` prop
// are stacked, only the active one is rendered. Activation is driven from
// the outside (e.g. the app menu) via the imperative `openPanel(label)`
// method. The last active panel is persisted in sessionStorage so it is
// restored across reloads for the same tab.
//=============================================================================
import React, { Component } from "react";
import PropTypes from "prop-types";

const STORAGE_KEY = "SkSpStackPanel:lastActive";

class SkSpStackPanel extends Component {
  static propTypes = {
    children: PropTypes.node.isRequired,
    defaultPanel: PropTypes.string,
    persistKey: PropTypes.string,
    onClose: PropTypes.func,
  };

  static defaultProps = {
    defaultPanel: undefined,
    persistKey: STORAGE_KEY,
    onClose: undefined,
  };

  constructor(props) {
    super(props);

    const labels = this._collectLabels(props.children);
    const persisted = SkSpStackPanel._readPersisted(props.persistKey);
    const fallback = props.defaultPanel || labels[0] || null;

    this.state = {
      activePanel: labels.includes(persisted) ? persisted : fallback,
    };
  }

  static _readPersisted(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  static _writePersisted(key, value) {
    try {
      if (value == null) {
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
      }
    } catch (_) {
      /* ignore quota / disabled storage */
    }
  }

  _collectLabels(children) {
    const out = [];
    React.Children.forEach(children, (child) => {
      if (!child || !child.props) return;
      const { label } = child.props;
      if (typeof label === "string" && label.length > 0) {
        out.push(label);
      }
    });
    return out;
  }

  // Public API used by SkSpCommand.openTab(label) and the app menu.
  openPanel(label) {
    if (typeof label !== "string" || label.length === 0) return;
    const labels = this._collectLabels(this.props.children);
    if (!labels.includes(label)) return;
    SkSpStackPanel._writePersisted(this.props.persistKey, label);
    if (this.state.activePanel !== label) {
      this.setState({ activePanel: label });
    }
  }

  // Back-compat: SkSpCommand.openTab was hitting SkTabs.SetTab(label).
  SetTab(label) {
    this.openPanel(label);
  }

  /** Active right-panel tab label (e.g. "Debug"). */
  getActivePanel() {
    return this.state.activePanel;
  }

  render() {
    const { children, onClose } = this.props;
    const { activePanel } = this.state;

    let rendered = null;
    React.Children.forEach(children, (child) => {
      if (rendered !== null) return;
      if (!child || !child.props) return;
      if (child.props.label !== activePanel) return;
      rendered = child.props.children;
    });

    return (
      <div className="SkSpStackPanel">
        {activePanel ? (
          <div className="SkSpStackPanel-header">
            <span className="SkSpStackPanel-title">{activePanel}</span>
            {typeof onClose === 'function' ? (
              <button
                type="button"
                className="SkPanelCloseBtn"
                title="Close right panel"
                aria-label="Close right panel"
                onClick={onClose}
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="SkSpStackPanel-content">{rendered}</div>
      </div>
    );
  }
}

export default SkSpStackPanel;
