import React from "react";
import PropTypes from "prop-types";
import SkComponent from "./SkComponent.js";
import './SkComponent.css'
import { ReactComponent as SvgAngleDown } from "../svg/angle-down.svg";

class SkTab extends SkComponent {
  static propTypes = {
    label: PropTypes.string.isRequired,
    onDoubleClick: PropTypes.func,
    onTabMenuClick: PropTypes.func,
    onTabPointerDown: PropTypes.func,
    tabDragging: PropTypes.string,
    inlineRenameSheet: PropTypes.string,
    inlineRenameValue: PropTypes.string,
    onInlineRenameChange: PropTypes.func,
    onInlineRenameCommit: PropTypes.func,
    onInlineRenameCancel: PropTypes.func,
    title: PropTypes.string,
  };

  constructor(props) {
    super(props);
    this.m_RenameInputRef = React.createRef();
  }

  componentDidUpdate(prevProps) {
    const wWasRenaming = prevProps.inlineRenameSheet === prevProps.label;
    const wIsRenaming = this.props.inlineRenameSheet === this.props.label;
    if (!wWasRenaming && wIsRenaming && this.m_RenameInputRef.current) {
      const wInput = this.m_RenameInputRef.current;
      wInput.focus();
      wInput.select();
    }
  }

  onClick = (event) => {
    if (this.isRenaming()) {
      event.stopPropagation();
      return;
    }
    const { label, onClick } = this.props;
    onClick(label);
  };

  onDoubleClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.isRenaming()) {
      return;
    }
    const { label, onDoubleClick } = this.props;
    if (typeof onDoubleClick === "function") {
      onDoubleClick(label);
    }
  };

  onTabMenuClick = (event) => {
    event.stopPropagation();
    event.preventDefault();
    const { label, onTabMenuClick } = this.props;
    if (typeof onTabMenuClick === "function") {
      onTabMenuClick(event, label);
    }
  };

  onContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.isRenaming()) {
      return;
    }
    const { label, onTabMenuClick } = this.props;
    if (typeof onTabMenuClick === "function") {
      onTabMenuClick(event, label);
    }
  };

  onPointerDown = (event) => {
    if (this.isRenaming()) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest(".SkTab-menuBtn")) {
      return;
    }
    const { onTabPointerDown, label } = this.props;
    if (typeof onTabPointerDown === "function") {
      onTabPointerDown(event, label);
    }
  };

  isRenaming = () => this.props.inlineRenameSheet === this.props.label;

  onRenameInputChange = (event) => {
    event.stopPropagation();
    if (typeof this.props.onInlineRenameChange === "function") {
      this.props.onInlineRenameChange(event.target.value);
    }
  };

  onRenameInputKeyDown = (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      if (typeof this.props.onInlineRenameCommit === "function") {
        this.props.onInlineRenameCommit();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (typeof this.props.onInlineRenameCancel === "function") {
        this.props.onInlineRenameCancel();
      }
    }
  };

  onRenameInputBlur = () => {
    if (typeof this.props.onInlineRenameCommit !== "function") {
      return;
    }
    // Defer commit so menu close / pointer release does not cancel rename immediately.
    window.setTimeout(() => {
      const wInput = this.m_RenameInputRef.current;
      if (!wInput || document.activeElement === wInput) {
        return;
      }
      this.props.onInlineRenameCommit();
    }, 0);
  };

  onRenameInputPointerDown = (event) => {
    event.stopPropagation();
  };

  render() {
    const {
      onClick,
      props: {
        activeTab,
        label,
        tabDragging,
        onTabMenuClick,
        inlineRenameValue,
      },
    } = this;

    const wRenaming = this.isRenaming();
    let className = "SkTab-list-item";

    if (activeTab === label) {
      className += " SkTab-list-active";
    }
    if (tabDragging === label) {
      className += " SkTab-list-item--dragging";
    }
    if (wRenaming) {
      className += " SkTab-list-item--renaming";
    }
    if (onTabMenuClick && !wRenaming) {
      className += " SkTab-list-item--withMenu";
    }

    return (
      <div
        className={className}
        style={this.props.style}
        data-sheet-name={label}
        onClick={onClick}
        onDoubleClick={this.onDoubleClick}
        onPointerDown={this.onPointerDown}
        onContextMenu={this.onContextMenu}
        title={wRenaming ? undefined : this.props.title}
      >
        {wRenaming ? (
          <input
            ref={this.m_RenameInputRef}
            type="text"
            className="SkTab-list-renameInput"
            value={inlineRenameValue ?? label}
            aria-label="Rename sheet"
            onChange={this.onRenameInputChange}
            onKeyDown={this.onRenameInputKeyDown}
            onBlur={this.onRenameInputBlur}
            onPointerDown={this.onRenameInputPointerDown}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="SkTab-list-label" onDoubleClick={this.onDoubleClick}>
            {label}
          </span>
        )}
        {onTabMenuClick && !wRenaming && (
          <button
            type="button"
            className="SkTab-menuBtn"
            title="Sheet menu"
            aria-label={`Sheet menu for ${label}`}
            onClick={this.onTabMenuClick}
            onContextMenu={this.onContextMenu}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <SvgAngleDown className="SkSvg SkTab-menuChevron" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }
}

export default SkTab;
