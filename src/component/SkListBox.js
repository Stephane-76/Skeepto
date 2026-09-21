import React, { Component, createRef } from "react";
import PropTypes from "prop-types";
import "./SkComponent.css";

/**
 * Scrollable checkbox list (Excel-style filter value picker).
 */
class SkListBox extends Component {
  constructor(props) {
    super(props);
    this.m_ListRef = createRef();
  }

  componentDidMount() {
    if (this.props.autoFocus) {
      this.focusList();
    }
  }

  focusList() {
    const wEl = this.m_ListRef.current;
    if (wEl) {
      wEl.focus({ preventScroll: true });
    }
  }

  handleMouseEnter = () => {
    this.focusList();
  };

  /** Keep wheel scrolling inside the list; do not let the sheet eat the event. */
  handleWheel = (event) => {
    event.stopPropagation();
  };

  isSelected(sValue) {
    const wSelected = this.props.selected;
    if (wSelected instanceof Set) {
      return wSelected.has(sValue);
    }
    if (Array.isArray(wSelected)) {
      return wSelected.includes(sValue);
    }
    return false;
  }

  renderRow(sItem, sOptions = {}) {
    const wValue = sItem.value;
    const wLabel = sItem.label != null ? sItem.label : String(wValue);
    const wChecked = sOptions.checked != null ? sOptions.checked : this.isSelected(wValue);
    const wOnToggle = sOptions.onToggle || (() => this.props.onToggle?.(wValue));
    const wClass = sOptions.rowClass || "SkListBox-row";

    return (
      <label key={sOptions.key || wValue} className={wClass} title={wLabel}>
        <input type="checkbox" checked={wChecked} onChange={wOnToggle} />
        <span className="SkListBox-label">{wLabel}</span>
      </label>
    );
  }

  render() {
    const {
      items = [],
      headerItem = null,
      emptyText = "No values",
      className = "",
      style = {},
      height = 200,
      ariaLabel = "Liste",
    } = this.props;

    const wHeight =
      typeof height === "number" ? `${height}px` : String(height || "200px");
    const wListStyle = {
      ...style,
      height: wHeight,
      maxHeight: wHeight,
      boxSizing: "border-box",
    };

    return (
      <div
        ref={this.m_ListRef}
        className={`SkListBox ${className}`.trim()}
        style={wListStyle}
        role="listbox"
        aria-label={ariaLabel}
        aria-multiselectable="true"
        tabIndex={0}
        onMouseEnter={this.handleMouseEnter}
        onWheel={this.handleWheel}
      >
        {headerItem ? this.renderRow(headerItem, {
          key: "__select_all__",
          rowClass: "SkListBox-row SkListBox-row-header",
          checked: headerItem.checked,
          onToggle: headerItem.onToggle,
        }) : null}
        {items.map((wItem) => this.renderRow(wItem))}
        {items.length === 0 ? (
          <div className="SkListBox-empty">{emptyText}</div>
        ) : null}
      </div>
    );
  }
}

SkListBox.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string,
    })
  ),
  selected: PropTypes.oneOfType([
    PropTypes.instanceOf(Set),
    PropTypes.arrayOf(PropTypes.string),
  ]),
  onToggle: PropTypes.func,
  headerItem: PropTypes.shape({
    value: PropTypes.string,
    label: PropTypes.string.isRequired,
    checked: PropTypes.bool,
    onToggle: PropTypes.func,
  }),
  emptyText: PropTypes.string,
  className: PropTypes.string,
  style: PropTypes.object,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  ariaLabel: PropTypes.string,
  autoFocus: PropTypes.bool,
};

SkListBox.defaultProps = {
  items: [],
  selected: new Set(),
  emptyText: "No values",
  className: "",
  style: {},
  height: 200,
  ariaLabel: "Liste",
  autoFocus: false,
};

export default SkListBox;
