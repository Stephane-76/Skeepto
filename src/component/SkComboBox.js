import React from 'react';
import PropTypes from 'prop-types';
import SkComponent from './SkComponent';
import './SkComponent.css';

// The component renders an input with an attached popup list.
// It supports filtering, keyboard navigation and outside click close.
export class SkComboBox extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            isOpen: false,
            query: props.value ?? '',
            filterText: '',
            highlightedIndex: -1,
            selectedValues: Array.isArray(props.selectedValues) ? props.selectedValues : [],
            popupWidth: undefined,
            containerWidth: undefined
        };
        this.m_PopupRef = React.createRef();
        this.m_InputRef = React.createRef();
        this.m_ResizeObserver = null;
        this.m_SuppressDocumentClose = false;
        this.handleDocumentClick = this.handleDocumentClick.bind(this);
        this.handleWindowResize = this.handleWindowResize.bind(this);
    }

    usesMeasuredContainerWidth() {
        return this.props.measureContainerWidth !== false;
    }

    componentDidMount() {
        document.addEventListener('mousedown', this.handleDocumentClick, true);
        window.addEventListener('resize', this.handleWindowResize);
        if (this.usesMeasuredContainerWidth()) {
            this.measureWidths();
        }

        if (this.props.observeResize && typeof window !== 'undefined' && 'ResizeObserver' in window) {
            this.m_ResizeObserver = new ResizeObserver(() => {
                this.measureWidths();
            });
            const el = this.m_Ref.current || this.m_InputRef.current;
            if (el) this.m_ResizeObserver.observe(el);
        }
    }

    componentWillUnmount() {
        document.removeEventListener('mousedown', this.handleDocumentClick, true);
        window.removeEventListener('resize', this.handleWindowResize);
        if (this.m_ResizeObserver) {
            try { this.m_ResizeObserver.disconnect(); } catch (e) { /* noop */ }
            this.m_ResizeObserver = null;
        }
    }

    componentDidUpdate(prevProps) {
        if (prevProps.value !== this.props.value && this.props.value !== this.state.query) {
            this.setState({ query: this.props.value ?? '', filterText: '' });
        }
        if (prevProps.selectedValues !== this.props.selectedValues && Array.isArray(this.props.selectedValues)) {
            this.setState({ selectedValues: this.props.selectedValues });
        }
        if (
            prevProps.isOpen !== this.props.isOpen &&
            this.props.isOpen !== undefined &&
            this.props.isOpen !== this.state.isOpen
        ) {
            this.setState({ isOpen: this.props.isOpen }, () => {
                if (this.props.isOpen) {
                    this.updatePopupWidth();
                }
            });
        }
        if (prevProps.isOpen !== this.props.isOpen && this.props.isOpen === true) {
            this.setState({ filterText: '', highlightedIndex: -1 });
        }
    }

    isOpenState() {
        return this.props.isOpen !== undefined ? this.props.isOpen : this.state.isOpen;
    }

    setOpen(open, callback) {
        if (this.props.isOpen !== undefined && typeof this.props.onOpenChange === 'function') {
            this.props.onOpenChange(open);
            if (typeof callback === 'function') {
                callback();
            }
            return;
        }
        this.setState(
            { isOpen: open, highlightedIndex: open ? this.state.highlightedIndex : -1 },
            () => {
                if (open) {
                    this.updatePopupWidth();
                }
                if (typeof callback === 'function') {
                    callback();
                }
            }
        );
    }

    handleWindowResize() {
        if (this.usesMeasuredContainerWidth()) {
            this.measureWidths();
        }
    }

    updatePopupWidth() {
        const wRoot = this.m_Ref.current;
        const input = this.m_InputRef.current;
        if (!input) {
            return;
        }
        const width = this.usesMeasuredContainerWidth()
            ? input.getBoundingClientRect().width
            : (wRoot ? wRoot.getBoundingClientRect().width : input.getBoundingClientRect().width);
        if (width && width !== this.state.popupWidth) {
            this.setState({ popupWidth: width });
        }
    }

    measureWidths() {
        if (!this.usesMeasuredContainerWidth()) {
            return;
        }
        const input = this.m_InputRef.current;
        if (!input) return;
        const width = input.getBoundingClientRect().width;
        if (width) {
            this.setState({ containerWidth: width, popupWidth: width });
        }
    }

    handleDocumentClick(event) {
        if (this.m_SuppressDocumentClose) {
            return;
        }
        const root = this.m_Ref.current;
        const popup = this.m_PopupRef.current;
        const outsideRoot = this.props.outsideClickRoot && this.props.outsideClickRoot.current;
        if (!root && !outsideRoot) {
            return;
        }
        const clickedInsideRoot = root && root.contains(event.target);
        const clickedInsideOutsideRoot = outsideRoot && outsideRoot.contains(event.target);
        const clickedInsidePopup = popup && popup.contains(event.target);
        if (
            !clickedInsideRoot &&
            !clickedInsideOutsideRoot &&
            !clickedInsidePopup &&
            this.isOpenState()
        ) {
            this.setOpen(false);
        }
    }

    getFilteredOptions() {
        const { options = [], filterField = 'label' } = this.props;
        const { filterText } = this.state;
        if (!filterText) {
            return options;
        }
        const q = String(filterText).toLowerCase();
        return options.filter(opt => {
            const value = (typeof opt === 'string') ? opt : (opt[filterField] ?? opt.label ?? '');
            return String(value).toLowerCase().includes(q);
        });
    }

    notifyChange(optionOrValues) {
        const { onChange, valueField = 'value', labelField = 'label', multiple } = this.props;
        if (!onChange) return;
        if (multiple) {
            const values = optionOrValues;
            const customEvent = { target: { id: this.props.id, name: this.props.name, value: values } };
            onChange(customEvent);
            return;
        }
        const option = optionOrValues;
        const value = (typeof option === 'string') ? option : (option[valueField] ?? option[labelField] ?? '');
        const label = (typeof option === 'string') ? option : (option[labelField] ?? option[valueField] ?? '');
        const customEvent = { target: { id: this.props.id, name: this.props.name, value, label } };
        onChange(customEvent);
    }

    handleInputChange = (event) => {
        const query = event.target.value;
        this.setState({ query, filterText: query, highlightedIndex: -1 }, () => {
            this.setOpen(true);
        });
        if (this.props.onInputChange) this.props.onInputChange(query);
    };

    handleReadOnlyInputPointer = (event) => {
        if (!this.props.readOnly || !this.props.showToggleButton || this.props.disabled) {
            return;
        }
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!this.isOpenState()) {
            this.setState({ filterText: '', highlightedIndex: -1 }, () => this.setOpen(true));
        }
    };

    getValue() {
        return this.state.query != null ? String(this.state.query) : "";
    }

    handleTogglePointer = (event) => {
        if (this.props.disabled) {
            return;
        }
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (this.props.readOnly && !this.props.showToggleButton) {
            return;
        }
        const wNext = !this.isOpenState();
        this.m_SuppressDocumentClose = true;
        window.setTimeout(() => {
            this.m_SuppressDocumentClose = false;
        }, 0);
        if (wNext) {
            this.setState({ filterText: '', highlightedIndex: -1 }, () => {
                this.setOpen(true, () => {
                    const input = this.m_InputRef.current;
                    if (input) {
                        input.focus();
                    }
                });
            });
            return;
        }
        this.setOpen(false, () => {
            const input = this.m_InputRef.current;
            if (input) {
                input.focus();
            }
        });
    };

    handleKeyDown = (event) => {
        const { multiple, valueField = 'value', labelField = 'label' } = this.props;
        const filtered = this.getFilteredOptions();
        const lastIndex = filtered.length - 1;
        let { highlightedIndex } = this.state;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (!this.isOpenState()) {
                    const wOptions = this.props.options || [];
                    this.setState({
                        filterText: '',
                        highlightedIndex: wOptions.length > 0 ? 0 : -1,
                    });
                    this.setOpen(true);
                    break;
                }
                this.setState({
                    highlightedIndex: Math.min(highlightedIndex + 1, lastIndex),
                });
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.setState({ highlightedIndex: Math.max(highlightedIndex - 1, 0) });
                break;
            case 'Enter':
                if (this.isOpenState() && highlightedIndex >= 0 && highlightedIndex <= lastIndex) {
                    const option = filtered[highlightedIndex];
                    if (multiple) {
                        const value = (typeof option === 'string') ? option : (option[valueField] ?? option[labelField] ?? '');
                        const exists = this.state.selectedValues.includes(value);
                        const selectedValues = exists
                            ? this.state.selectedValues.filter(v => v !== value)
                            : [...this.state.selectedValues, value];
                        this.setState({ selectedValues });
                        this.notifyChange(selectedValues);
                    } else {
                        const label = (typeof option === 'string') ? option : (option[this.props.labelField] ?? option[this.props.valueField] ?? '');
                        this.setState({ query: label, filterText: '' });
                        this.setOpen(false);
                        this.notifyChange(option);
                    }
                }
                break;
            case ' ':
                if (multiple && this.isOpenState() && highlightedIndex >= 0 && highlightedIndex <= lastIndex) {
                    event.preventDefault();
                    const option = filtered[highlightedIndex];
                    const value = (typeof option === 'string') ? option : (option[valueField] ?? option[labelField] ?? '');
                    const exists = this.state.selectedValues.includes(value);
                    const selectedValues = exists
                        ? this.state.selectedValues.filter(v => v !== value)
                        : [...this.state.selectedValues, value];
                    this.setState({ selectedValues });
                    this.notifyChange(selectedValues);
                }
                break;
            case 'Escape':
                this.setOpen(false);
                break;
            case 'Backspace':
                if (multiple && this.state.query === '' && this.state.selectedValues.length > 0) {
                    const selectedValues = this.state.selectedValues.slice(0, -1);
                    this.setState({ selectedValues });
                    this.notifyChange(selectedValues);
                }
                break;
            default:
                break;
        }
        if (this.props.onKeyDown) this.props.onKeyDown(event);
    };

    handleFocus = () => {
        if (this.props.readOnly && !this.props.showToggleButton) {
            return;
        }
        if (this.props.openOnFocus) {
            this.setState({ filterText: '' }, () => this.setOpen(true));
        }
    };

    handleOptionClick = (option) => {
        const { multiple, valueField = 'value', labelField = 'label' } = this.props;
        if (multiple) {
            const value = (typeof option === 'string') ? option : (option[valueField] ?? option[labelField] ?? '');
            const exists = this.state.selectedValues.includes(value);
            const selectedValues = exists
                ? this.state.selectedValues.filter(v => v !== value)
                : [...this.state.selectedValues, value];
            this.setState({ selectedValues });
            this.setOpen(true);
            this.notifyChange(selectedValues);
            return;
        }
        const label = (typeof option === 'string') ? option : (option[this.props.labelField] ?? option[this.props.valueField] ?? '');
        this.setState({ query: label, filterText: '', highlightedIndex: -1 });
        this.setOpen(false);
        this.notifyChange(option);
    };

    removeChip = (value) => {
        const selectedValues = this.state.selectedValues.filter(v => v !== value);
        this.setState({ selectedValues });
        this.notifyChange(selectedValues);
    };

    renderOption(option, index, isHighlighted) {
        const { labelField = 'label', valueField = 'value', multiple } = this.props;
        const key = (typeof option === 'string') ? option : `${option[valueField]}-${index}`;
        const label = (typeof option === 'string') ? option : (option[labelField] ?? option[valueField] ?? '');
        const className = `SkComboBox-option${isHighlighted ? ' SkComboBox-option--active' : ''}`;
        const value = (typeof option === 'string') ? option : (option[valueField] ?? option[labelField] ?? '');
        const checked = multiple ? this.state.selectedValues.includes(value) : false;
        return (
            <div
                key={key}
                className={className}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => this.handleOptionClick(option)}
            >
                <span className="SkComboBox-option-label">{label}</span>
                {multiple && (
                    <input
                        className="SkComboBox-option-checkbox"
                        type="checkbox"
                        readOnly
                        checked={checked}
                    />
                )}
            </div>
        );
    }

    renderList() {
        if (!this.isOpenState()) {
            return null;
        }
        const filtered = this.getFilteredOptions();
        const { highlightedIndex, popupWidth } = this.state;
        const wListStyle = {
            ...(this.props.listZIndex != null ? { zIndex: this.props.listZIndex } : {}),
        };
        if (this.usesMeasuredContainerWidth()) {
            if (popupWidth) {
                wListStyle.width = popupWidth;
            }
        } else {
            wListStyle.width = '100%';
            wListStyle.minWidth = '100%';
        }
        return (
            <div ref={this.m_PopupRef} className="SkComboBox-list" style={wListStyle}>
                {filtered.length === 0 && (
                    <div className="SkComboBox-empty">No results</div>
                )}
                {filtered.map((opt, idx) => this.renderOption(opt, idx, idx === highlightedIndex))}
            </div>
        );
    }

    render() {
        const {
            placeholder,
            style,
            className = '',
            multiple,
            readOnly = false,
            inputStyle,
            inputClassName = '',
            showToggleButton = false,
        } = this.props;
        const { query, selectedValues, containerWidth } = this.state;
        const wRootStyle =
            this.usesMeasuredContainerWidth() && containerWidth
                ? { ...style, width: containerWidth }
                : style;
        return (
            <div ref={this.m_Ref} className={`SkComboBox ${className}`} style={wRootStyle}>
                {multiple && selectedValues.length > 0 && (
                    <div className="SkComboBox-chips">
                        {selectedValues.map((val, idx) => (
                            <span key={`${val}-${idx}`} className="SkComboBox-chip">
                                <span className="SkComboBox-chip-text">{val}</span>
                                <button type="button" className="SkComboBox-chip-remove" onClick={() => this.removeChip(val)}>×</button>
                            </span>
                        ))}
                    </div>
                )}
                <input
                    className={`SkComboBox-input ${inputClassName}`.trim()}
                    ref={this.m_InputRef}
                    value={query}
                    readOnly={readOnly}
                    disabled={this.props.disabled}
                    onChange={this.handleInputChange}
                    onKeyDown={this.handleKeyDown}
                    onFocus={this.handleFocus}
                    onMouseDown={
                        readOnly && showToggleButton ? this.handleReadOnlyInputPointer : undefined
                    }
                    placeholder={placeholder}
                    style={inputStyle}
                />
                {showToggleButton ? (
                    <button
                        type="button"
                        className="SkComboBox-toggle"
                        tabIndex={-1}
                        aria-label="Open list"
                        disabled={this.props.disabled}
                        onMouseDown={this.handleTogglePointer}
                    >
                        ▾
                    </button>
                ) : null}
                {this.renderList()}
            </div>
        );
    }
}

SkComboBox.propTypes = {
    id: PropTypes.string,
    name: PropTypes.string,
    options: PropTypes.arrayOf(PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.object
    ])),
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    placeholder: PropTypes.string,
    className: PropTypes.string,
    style: PropTypes.object,
    valueField: PropTypes.string,
    labelField: PropTypes.string,
    filterField: PropTypes.string,
    openOnFocus: PropTypes.bool,
    isOpen: PropTypes.bool,
    onOpenChange: PropTypes.func,
    readOnly: PropTypes.bool,
    disabled: PropTypes.bool,
    inputStyle: PropTypes.object,
    inputClassName: PropTypes.string,
    showToggleButton: PropTypes.bool,
    listZIndex: PropTypes.number,
    outsideClickRoot: PropTypes.shape({ current: PropTypes.instanceOf(Element) }),
    observeResize: PropTypes.bool,
    measureContainerWidth: PropTypes.bool,
    onChange: PropTypes.func,
    onKeyDown: PropTypes.func,
    onInputChange: PropTypes.func
};

SkComboBox.defaultProps = {
    options: [],
    placeholder: '',
    valueField: 'value',
    labelField: 'label',
    filterField: 'label',
    openOnFocus: true,
    observeResize: false
};

export default SkComboBox;


