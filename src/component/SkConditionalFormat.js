//=============================================================================
// SkConditionalFormat
// Popup component for selecting and configuring conditional formats
// Supports: HighlightCellsRules, DataBars, ColorScales, IconSets, CustomFormulas
//=============================================================================
import React, { createRef } from 'react';
import { createPortal } from 'react-dom';
import { parseRangeBoundsSync } from '../spreadsheet/SkA1Ref.js';
import SkComponent from './SkComponent';
import PropTypes from 'prop-types';
import SkColor from './SkColor';
import SkButton from './SkButton';
import SkSpInplaceEdit from '../spreadsheet/SkSpInplaceEdit';
import { drawDataBars, normalizeHexColor, alignPopupWithinViewport } from '../utility/SkUtility';
import {
    defaultCellFormatStyle,
    cellFormatPreviewStyle,
    CF_FORMAT_PREVIEW_SAMPLE,
} from '../spreadsheet/SkConditionalFormatStyle';
import { ReactComponent as SvgBold } from '../svg/bold.svg';
import { ReactComponent as SvgItalic } from '../svg/italic.svg';
import { ReactComponent as SvgUnderline } from '../svg/underline.svg';
import { ReactComponent as SvgStrikethrough } from '../svg/strikethrough.svg';
import { ReactComponent as SvgFormatColorFillBucket } from '../svg/format_color_fill_bucket.svg';
import {
    deleteConditionalFormatRule,
    fetchConditionalFormatRules,
    getRuleListTitle,
    getRulePreviewColor,
    getRuleRange,
    getRuleType,
    ruleToFormState,
} from '../spreadsheet/SkConditionalFormatRules';
import './SkConditionalFormat.css';

export class SkConditionalFormat extends SkComponent {
    static getDefaultFormState() {
        return {
            activeTab: 'HighlightCellsRules',
            draftRef: '',
            highlightType: 'greaterThan',
            highlightValue: '',
            highlightFormatColor: '#FF0000',
            highlightFormat: defaultCellFormatStyle(),
            dataBarColor: '#0066FF',
            dataBarColorNegative: '#FF3333',
            dataBarStyle: 'gradient',
            dataBarMinValue: 0,
            dataBarMaxValue: 100,
            colorScaleType: '2-color',
            colorScaleMinColor: '#ED7D31',
            colorScaleMaxColor: '#FFF2CC',
            colorScaleMidColor: '#FFCC00',
            colorScaleMinType: 'lowest',
            colorScaleMaxType: 'highest',
            colorScaleMinValue: 0,
            colorScaleMaxValue: 100,
            iconSetType: 'Arrows',
            iconSetShowValue: true,
            iconSetReverse: false,
            iconSetCount: 3,
            customFormula: '',
            customFormatColor: '#FF0000',
            customFormat: defaultCellFormatStyle(),
            cfColorPopup: null,
            cfColorPopupAnchor: null,
        };
    }

    constructor(props) {
        super(props);
        const wFormDefaults = SkConditionalFormat.getDefaultFormState();
        const wFromRule = props.initialRule ? ruleToFormState(props.initialRule) : null;
        this.state = {
            isOpen: false,
            alignRight: false,
            existingRules: [],
            rulesLoading: false,
            ...wFormDefaults,
            ...(wFromRule || {}),
            draftRef: props.initialRef || wFromRule?.draftRef || '',
        };
        this.dropdownRef = createRef();
        this.containerRef = createRef();
        this.rangeInplaceRef = createRef();
        this.previewCanvasRefs = {
            HighlightCellsRules: createRef(),
            DataBars: createRef(),
            ColorScales: createRef(),
            IconSets: createRef(),
            CustomFormulas: createRef(),
        };
    }

    componentDidMount() {
        const { formOnly, embedded } = this.props;
        if (!formOnly && !embedded) {
            document.addEventListener('mousedown', this.handleClickOutside);
        } else if (embedded && !formOnly) {
            this.setState({ isOpen: true });
        }
        this.updatePreviews();
        if (!formOnly) {
            this.refreshExistingRules();
        }
        this._boundOnReloadView = () => {
            if (!this.props.formOnly) {
                this.refreshExistingRules();
            }
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('sker:reloadView', this._boundOnReloadView);
        }
        this._boundCloseCfColorPopup = (event) => {
            if (!this.state.cfColorPopup) return;
            if (event.target instanceof Element) {
                if (event.target.closest('.SkConditionalFormat__cell-format-color-popup')) return;
                if (event.target.closest('.SkConditionalFormat__cell-format-color-btn')) return;
                if (event.target.closest('.SkColor--inline')) return;
                if (event.target.closest('.SkColor__dropdown')) return;
                if (event.target.closest('input[type="color"]')) return;
            }
            this.closeCfColorPopup();
        };
        document.addEventListener('mousedown', this._boundCloseCfColorPopup);
        this.syncRuleKeyLock();
        if (this.props.formOnly && this.props.SpInterface?.clearFormulaBarCompileError) {
            this.props.SpInterface.clearFormulaBarCompileError();
        }
    }

    syncRuleKeyLock() {
        const wLocked = Boolean(this.props.lockRuleKey);
        const wInplace = this.rangeInplaceRef.current;
        if (wInplace && typeof wInplace.setDisabled === 'function') {
            wInplace.setDisabled(wLocked);
        }
    }

    componentWillUnmount() {
        const { formOnly, embedded } = this.props;
        if (!formOnly && !embedded) {
            document.removeEventListener('mousedown', this.handleClickOutside);
        }
        if (typeof window !== 'undefined' && this._boundOnReloadView) {
            window.removeEventListener('sker:reloadView', this._boundOnReloadView);
        }
        if (this._boundCloseCfColorPopup) {
            document.removeEventListener('mousedown', this._boundCloseCfColorPopup);
        }
    }

    componentDidUpdate(prevProps, prevState) {
        const { formOnly, embedded, stacked, inlineEdit } = this.props;
        const wEmbedded = embedded || formOnly || inlineEdit;
        if (!formOnly && !prevState.isOpen && this.state.isOpen) {
            this.calculateDropdownPosition();
        }
        const wShouldUpdatePreviews =
            (wEmbedded || stacked || (!prevState.isOpen && this.state.isOpen)) ||
            prevState.activeTab !== this.state.activeTab ||
            this.hasFormatChanged(prevState);
        if (wShouldUpdatePreviews) {
            this.updatePreviews();
        }
        if (!formOnly && !prevState.isOpen && this.state.isOpen) {
            this.refreshExistingRules();
        }
        if (prevProps.lockRuleKey !== this.props.lockRuleKey) {
            this.syncRuleKeyLock();
        }
    }

    calculateDropdownPosition = () => {
        if (!this.containerRef.current || !this.dropdownRef.current) return;
        
        const wContainerRect = this.containerRef.current.getBoundingClientRect();
        const wDropdown = this.dropdownRef.current;
        
        // Temporarily show dropdown to measure it
        const wWasVisible = wDropdown.style.display !== 'none';
        wDropdown.style.visibility = 'hidden';
        wDropdown.style.display = 'block';
        
        const wDropdownWidth = wDropdown.offsetWidth || 400; // min-width from CSS
        const wWindowWidth = window.innerWidth;
        const wRightEdge = wContainerRect.left + wDropdownWidth;
        
        // If dropdown would overflow on the right, align it to the right
        const wAlignRight = wRightEdge > wWindowWidth;
        
        wDropdown.style.visibility = '';
        wDropdown.style.display = wWasVisible ? '' : 'none';

        const wApplyViewportAlign = () => {
            if (this.dropdownRef.current) {
                alignPopupWithinViewport(this.dropdownRef.current);
            }
        };

        if (wAlignRight !== this.state.alignRight) {
            this.setState({ alignRight: wAlignRight }, () => {
                requestAnimationFrame(wApplyViewportAlign);
            });
        } else {
            requestAnimationFrame(wApplyViewportAlign);
        }
    }

    currentSheet() {
        const sp = this.props.SpInterface;
        if (sp?.m_UIView?.sheet) {
            return sp.m_UIView.sheet;
        }
        return '';
    }

    refreshExistingRules = async () => {
        this.setState({ rulesLoading: true });
        try {
            const rules = await fetchConditionalFormatRules(this.currentSheet());
            this.setState({ existingRules: rules, rulesLoading: false });
        } catch (error) {
            console.error('SkConditionalFormat::refreshExistingRules error', error);
            this.setState({ rulesLoading: false });
        }
    }

    deleteExistingRule = async (rule) => {
        const sp = this.props.SpInterface;
        try {
            sp?.setExtraUndo?.();
            const ok = await deleteConditionalFormatRule(rule, this.currentSheet());
            if (ok) {
                await sp?.reloadView?.();
            }
            await this.refreshExistingRules();
        } catch (error) {
            console.error('SkConditionalFormat::deleteExistingRule error', error);
        }
    }

    selectExistingRuleRange = async (rule) => {
        const sp = this.props.SpInterface;
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
            console.error('SkConditionalFormat::selectExistingRuleRange error', error);
        }
    }

    handleHighlightFormatChange = (patch) => {
        this.setState((prev) => {
            const wNext = { ...prev.highlightFormat, ...patch, id: 0 };
            return {
                highlightFormat: wNext,
                highlightFormatColor: wNext.color ?? prev.highlightFormatColor,
            };
        });
    }

    handleCustomFormatChange = (patch) => {
        this.setState((prev) => {
            const wNext = { ...prev.customFormat, ...patch, id: 0 };
            return {
                customFormat: wNext,
                customFormatColor: wNext.color ?? prev.customFormatColor,
            };
        });
    }

    toggleCfColorPopup = (popupId, event) => {
        if (this.state.cfColorPopup === popupId) {
            this.closeCfColorPopup();
            return;
        }

        const rect = event?.currentTarget?.getBoundingClientRect?.();
        const anchor = rect
            ? {
                top: rect.top,
                left: rect.left,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            }
            : null;

        this.setState({
            cfColorPopup: popupId,
            cfColorPopupAnchor: anchor,
        });
    }

    closeCfColorPopup = () => {
        if (this.state.cfColorPopup) {
            this.setState({ cfColorPopup: null, cfColorPopupAnchor: null });
        }
    }

    getCfColorPopupFixedStyle(anchor, alignRight) {
        const margin = 8;
        const estHeight = 300;
        const openAbove = anchor.top >= estHeight + margin;
        const style = {
            position: 'fixed',
            zIndex: 20000,
            left: alignRight ? anchor.right : anchor.left,
        };
        if (openAbove) {
            style.top = anchor.top - 4;
            style.transform = alignRight ? 'translate(-100%, -100%)' : 'translateY(-100%)';
        } else {
            style.top = anchor.bottom + 4;
            if (alignRight) {
                style.transform = 'translateX(-100%)';
            }
        }
        return style;
    }

    renderCfColorPortal() {
        const { cfColorPopup, cfColorPopupAnchor: anchor, highlightFormat, customFormat } = this.state;
        if (!cfColorPopup || !anchor || typeof document === 'undefined') {
            return null;
        }

        const wIsCustom = cfColorPopup.startsWith('custom-');
        const wIsFill = cfColorPopup.endsWith('-fill');
        const format = wIsCustom ? customFormat : highlightFormat;
        const wColorKey = wIsFill ? 'color' : 'textColor';
        const wDefault = wIsFill
            ? (format?.color || '#FF0000')
            : (format?.textColor || '#000000');

        const wOnChange = wIsCustom ? this.handleCustomFormatChange : this.handleHighlightFormatChange;
        const wColorChange = (color, options = {}) => {
            wOnChange({ [wColorKey]: color });
            if (options.closePopup !== false) {
                this.closeCfColorPopup();
            }
        };

        return createPortal(
            <div
                className={`SkConditionalFormat__cell-format-color-popup SkConditionalFormat__cell-format-color-popup--portal${wIsFill ? ' SkConditionalFormat__cell-format-color-popup--fill' : ''}`}
                style={this.getCfColorPopupFixedStyle(anchor, wIsFill)}
            >
                <SkColor
                    key={`${cfColorPopup}-${format?.[wColorKey]}`}
                    inline
                    defaultColor={wDefault}
                    onColorChange={wColorChange}
                    title={wIsFill ? 'Fill color' : 'Text color'}
                />
            </div>,
            document.body
        );
    }

    renderExistingRules() {
        const { existingRules, rulesLoading } = this.state;

        return (
            <div className="SkConditionalFormat__rules">
                <div className="SkConditionalFormat__rules-header">
                    <span className="SkSpPanelTitle">Rules on this sheet</span>
                    <button
                        type="button"
                        className="SkConditionalFormat__rules-refresh"
                        onClick={this.refreshExistingRules}
                        disabled={rulesLoading}
                        title="Refresh rules"
                    >
                        {rulesLoading ? '…' : '↻'}
                    </button>
                </div>
                {existingRules.length === 0 ? (
                    <div className="SkConditionalFormat__rules-empty">
                        {rulesLoading ? 'Loading…' : 'No conditional formatting rules on this sheet.'}
                    </div>
                ) : (
                    <ul className="SkConditionalFormat__rules-list">
                        {existingRules.map((rule, index) => {
                            const previewColor = getRulePreviewColor(rule);
                            const type = getRuleType(rule);
                            return (
                                <li
                                    key={`${rule.key || index}-${type}`}
                                    className="SkConditionalFormat__rules-row"
                                >
                                    <button
                                        type="button"
                                        className="SkConditionalFormat__rules-select"
                                        onClick={() => this.selectExistingRuleRange(rule)}
                                        title="Select range on sheet"
                                    >
                                        {previewColor ? (
                                            <span
                                                className="SkConditionalFormat__rules-swatch"
                                                style={{ backgroundColor: previewColor }}
                                            />
                                        ) : (
                                            <span className="SkConditionalFormat__rules-swatch SkConditionalFormat__rules-swatch--icon">
                                                ★
                                            </span>
                                        )}
                                        <span className="SkConditionalFormat__rules-info">
                                            <span className="SkConditionalFormat__rules-range">
                                                {getRuleRange(rule)}
                                            </span>
                                            <span className="SkConditionalFormat__rules-desc">
                                                {getRuleListTitle(rule)}
                                            </span>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="SkConditionalFormat__rules-delete"
                                        onClick={() => this.deleteExistingRule(rule)}
                                        title="Delete rule"
                                    >
                                        ×
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        );
    }

    hasFormatChanged(prevState) {
        const formatKeys = [
            'dataBarColor', 'dataBarColorNegative', 'dataBarStyle', 
            'dataBarMinValue', 'dataBarMaxValue',
            'colorScaleType', 'colorScaleMinColor', 'colorScaleMaxColor', 
            'colorScaleMidColor', 'colorScaleMinType', 'colorScaleMaxType',
            'colorScaleMinValue', 'colorScaleMaxValue',
            'iconSetType', 'iconSetShowValue', 'iconSetReverse', 'iconSetCount',
            'highlightFormat', 'customFormat',
        ];
        return formatKeys.some((key) => {
            if (key === 'highlightFormat' || key === 'customFormat') {
                return JSON.stringify(prevState[key]) !== JSON.stringify(this.state[key]);
            }
            return prevState[key] !== this.state[key];
        });
    }

    handleClickOutside = (event) => {
        if (!this.dropdownRef.current) return;

        // Native color picker UI is outside the dropdown DOM tree
        const active = document.activeElement;
        if (active instanceof HTMLInputElement && active.type === 'color') {
            return;
        }
        if (event.target instanceof HTMLInputElement && event.target.type === 'color') {
            return;
        }
        if (event.target instanceof Element && event.target.closest('input[type="color"]')) {
            return;
        }
        
        // Check if click is inside SkConditionalFormat dropdown
        if (this.dropdownRef.current.contains(event.target)) {
            return;
        }
        
        // Check if click is inside a SkColor dropdown (rendered via portal)
        let target = event.target;
        while (target && target !== document.body) {
            if (target.classList && target.classList.contains('SkColor__dropdown')) {
                return; // Click is inside SkColor dropdown, don't close SkConditionalFormat
            }
            target = target.parentElement;
        }
        
        // Check if click is on SkColor preview button (to allow opening the color picker)
        target = event.target;
        while (target && target !== document.body) {
            if (target.classList && target.classList.contains('SkColor__preview')) {
                return; // Click is on SkColor button, don't close SkConditionalFormat
            }
            target = target.parentElement;
        }
        
        // Click is outside both dropdowns, close SkConditionalFormat
        this.setState({ isOpen: false });
    }

    toggleDropdown = () => {
        const sp = this.props.SpInterface;
        if (sp?.m_SkSpCommand?.openTab) {
            sp.m_SkSpCommand.openTab('Conditional');
            return;
        }
        const wWillOpen = !this.state.isOpen;
        this.setState(prevState => ({ isOpen: !prevState.isOpen }), () => {
            if (wWillOpen) {
                setTimeout(() => {
                    this.calculateDropdownPosition();
                }, 0);
            }
        });
    }

    selectTab = (tab) => {
        this.setState({ activeTab: tab });
    }

    getStyleOptions() {
        return [
            { value: 'HighlightCellsRules', label: 'Format cells that contain…' },
            { value: 'DataBars', label: 'Data Bars' },
            { value: 'ColorScales:2-color', label: '2-color scale' },
            { value: 'ColorScales:3-color', label: '3-color scale' },
            { value: 'IconSets', label: 'Icon Sets' },
            { value: 'CustomFormulas', label: 'Use a formula…' },
        ];
    }

    getCurrentStyleValue() {
        if (this.state.activeTab === 'ColorScales') {
            return `ColorScales:${this.state.colorScaleType}`;
        }
        return this.state.activeTab;
    }

    handleStyleChange = (event) => {
        const wValue = event.target.value;
        if (wValue.startsWith('ColorScales:')) {
            const wScaleType = wValue.split(':')[1];
            this.setState({
                activeTab: 'ColorScales',
                colorScaleType: wScaleType,
            });
            return;
        }
        this.setState({ activeTab: wValue });
    }

    isScaleValueDisabled(scaleType) {
        return scaleType === 'lowest' || scaleType === 'highest';
    }

    getScaleValuePlaceholder(scaleType) {
        if (scaleType === 'lowest') return '(Lowest value)';
        if (scaleType === 'highest') return '(Highest value)';
        return '';
    }

    getMaxIconCount(iconType) {
        const iconMap = {
            "Arrows": ["↓", "→", "↑"],
            "Shapes": ["●", "▲", "■"],
            "Indicators": ["✖", "○", "✔"],
            "Ratings": ["☆","★","★★","★★★","★★★★"],
            "Flags": ["🔴", "🟡", "🟠", "🟢", "🔵"]
        };
        const icons = iconMap[iconType] || iconMap["Arrows"];
        return icons.length;
    }

    handleFormatChange = () => {
        const format = this.getCurrentFormat();
        const wUsesRef = this.props.formOnly || this.props.inlineEdit || this.props.stacked;
        const ref = wUsesRef ? (this.getRefText() || '').trim() : '';
        if (this.props.onFormatChange) {
            if (wUsesRef) {
                this.props.onFormatChange(format, ref);
            } else {
                this.props.onFormatChange(format);
            }
        }
        if (!this.props.embedded && !this.props.formOnly && !this.props.inlineEdit) {
            this.setState({ isOpen: false });
        }
        if (!this.props.formOnly && !this.props.inlineEdit) {
            void this.refreshExistingRules();
        }
    }

    renderCellFormatEditor(format, onChange, scope) {
        const wPreviewStyle = cellFormatPreviewStyle(format);
        const wTextPopupId = `${scope}-text`;
        const wFillPopupId = `${scope}-fill`;

        const wToggle = (key) => () => {
            this.closeCfColorPopup();
            onChange({ [key]: !format[key] });
        };

        return (
            <div className="SkConditionalFormat__cell-format">
                <div
                    className="SkConditionalFormat__cell-format-preview"
                    style={wPreviewStyle.container}
                >
                    <span
                        className="SkConditionalFormat__cell-format-preview-text"
                        style={{
                            ...wPreviewStyle.text,
                            '--cf-preview-text-color': wPreviewStyle.text.color,
                        }}
                    >
                        {CF_FORMAT_PREVIEW_SAMPLE}
                    </span>
                </div>
                <div className="SkConditionalFormat__cell-format-toolbar">
                    <button
                        type="button"
                        className={`SkConditionalFormat__cell-format-btn${format.bold ? ' SkConditionalFormat__cell-format-btn--active' : ''}`}
                        title="Bold"
                        onClick={wToggle('bold')}
                    >
                        <SvgBold className="SkSvg" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className={`SkConditionalFormat__cell-format-btn${format.italic ? ' SkConditionalFormat__cell-format-btn--active' : ''}`}
                        title="Italic"
                        onClick={wToggle('italic')}
                    >
                        <SvgItalic className="SkSvg" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className={`SkConditionalFormat__cell-format-btn${format.underline ? ' SkConditionalFormat__cell-format-btn--active' : ''}`}
                        title="Underline"
                        onClick={wToggle('underline')}
                    >
                        <SvgUnderline className="SkSvg" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className={`SkConditionalFormat__cell-format-btn${format.strike ? ' SkConditionalFormat__cell-format-btn--active' : ''}`}
                        title="Strikethrough"
                        onClick={wToggle('strike')}
                    >
                        <SvgStrikethrough className="SkSvg" aria-hidden="true" />
                    </button>

                    <span className="SkConditionalFormat__cell-format-sep" aria-hidden="true" />

                    <div className="SkConditionalFormat__cell-format-colors">
                        <div className="SkConditionalFormat__cell-format-color-wrap">
                            <button
                                type="button"
                                className="SkConditionalFormat__cell-format-color-btn SkTextColorButton"
                                title="Text color"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    this.toggleCfColorPopup(wTextPopupId, event);
                                }}
                            >
                                <span
                                    className="SkTextColorLetter"
                                    style={{ color: format.textColor || '#000000' }}
                                >
                                    A
                                </span>
                            </button>
                        </div>

                        <div className="SkConditionalFormat__cell-format-color-wrap">
                            <button
                                type="button"
                                className="SkConditionalFormat__cell-format-color-btn SkBackgroundColorButton"
                                title="Fill color"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    this.toggleCfColorPopup(wFillPopupId, event);
                                }}
                            >
                                <span className="SkBackgroundColorFill">
                                    <SvgFormatColorFillBucket
                                        className="SkBackgroundColorFill-bucket"
                                        aria-hidden="true"
                                    />
                                    <span
                                        className="SkBackgroundColorFill-bar"
                                        style={{ backgroundColor: format.color || '#FF0000' }}
                                    />
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    getRefText() {
        const wRef = this.rangeInplaceRef.current;
        if (wRef && typeof wRef.text === 'function') {
            try {
                return wRef.text();
            } catch (_) {
                return this.state.draftRef;
            }
        }
        return this.state.draftRef;
    }

    renderRangeField() {
        const { SpInterface, formOnly, inlineEdit, lockRuleKey } = this.props;
        if (!formOnly && !inlineEdit) return null;

        const wLabel = inlineEdit ? (
            <label style={panelLabelStyle}>Apply to range</label>
        ) : (
            <label>Apply to range:</label>
        );

        return (
            <div className={`SkConditionalFormat__field${inlineEdit ? ' SkConditionalFormat__field--panel' : ''}`}>
                {wLabel}
                <SkSpInplaceEdit
                    ref={this.rangeInplaceRef}
                    style={{
                        flex: 1,
                        margin: '3px',
                        padding: '3px',
                        opacity: lockRuleKey ? 0.65 : 1,
                    }}
                    static="true"
                    AcceptSelection={lockRuleKey ? 'false' : 'true'}
                    SpInterface={SpInterface}
                    Id="InplaceEditConditionalFormatRef"
                    Property="conditionalFormatRef"
                    Text={this.state.draftRef}
                    onTextChange={(text) => this.setState({ draftRef: text })}
                >
                    {this.state.draftRef}
                </SkSpInplaceEdit>
            </div>
        );
    }

    getCurrentFormat() {
        const { activeTab } = this.state;
        
        switch (activeTab) {
            case 'HighlightCellsRules':
                return {
                    type: 'HighlightCellsRules',
                    css: this.state.highlightFormat?.id || 0,
                    highlightType: this.state.highlightType,
                    highlightValue: this.state.highlightValue,
                    highlightFormat: this.state.highlightFormat,
                };
            
            case 'DataBars':
                return {
                    type: 'DataBars',
                    color: normalizeHexColor(this.state.dataBarColor),
                    colorNegative: normalizeHexColor(this.state.dataBarColorNegative),
                    style: this.state.dataBarStyle,
                    minValue: parseFloat(this.state.dataBarMinValue) || 0,
                    maxValue: parseFloat(this.state.dataBarMaxValue) || 100,
                };
            
            case 'ColorScales':
                return {
                    type: 'ColorScales',
                    color: this.state.colorScaleMinColor,
                    colorScaleType: this.state.colorScaleType,
                    minColor: normalizeHexColor(this.state.colorScaleMinColor),
                    maxColor: normalizeHexColor(this.state.colorScaleMaxColor),
                    midColor: this.state.colorScaleType === '3-color' 
                        ? normalizeHexColor(this.state.colorScaleMidColor) 
                        : null,
                    minValue: this.state.colorScaleMinType === 'lowest'
                        ? ''
                        : String(this.state.colorScaleMinValue ?? ''),
                    maxValue: this.state.colorScaleMaxType === 'highest'
                        ? ''
                        : String(this.state.colorScaleMaxValue ?? ''),
                };
            
            case 'IconSets':
                return {
                    type: 'IconSets',
                    iconType: this.state.iconSetType,
                    showValue: this.state.iconSetShowValue,
                    reverse: this.state.iconSetReverse,
                    iconCount: this.state.iconSetCount,
                };
            
            case 'CustomFormulas':
                return {
                    type: 'CustomFormulas',
                    css: this.state.customFormat?.id || 0,
                    formula: this.state.customFormula,
                    customFormat: this.state.customFormat,
                };
            
            default:
                return null;
        }
    }

    updatePreviews() {
        // Update DataBars preview
        if (this.state.activeTab === 'DataBars') {
            this.drawDataBarsPreview();
        }
        // Update ColorScales preview
        if (this.state.activeTab === 'ColorScales') {
            this.drawColorScalesPreview();
        }
        // Update IconSets preview
        if (this.state.activeTab === 'IconSets') {
            this.drawIconSetsPreview();
        }
    }

    getPreviewSize(tab) {
        switch (tab) {
            case 'DataBars':
                return { width: 200, height: 96 };
            case 'ColorScales':
                return { width: 180, height: 30 };
            case 'IconSets':
                return { width: 180, height: 34 };
            default:
                return { width: 200, height: 96 };
        }
    }

    getCanvasContext(tab) {
        const canvas = this.previewCanvasRefs[tab]?.current;
        if (!canvas) return null;

        const { width: desiredWidth, height: desiredHeight } = this.getPreviewSize(tab);
        if (canvas.width !== desiredWidth) canvas.width = desiredWidth;
        if (canvas.height !== desiredHeight) canvas.height = desiredHeight;

        return canvas.getContext('2d');
    }

    drawDataBarsPreview() {
        const ctx = this.getCanvasContext('DataBars');
        if (!ctx) return;

        const canvas = this.previewCanvasRefs.DataBars.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const itemCF = {
            type: 'DataBars',
            color: normalizeHexColor(this.state.dataBarColor),
            colorNegative: normalizeHexColor(this.state.dataBarColorNegative),
            style: this.state.dataBarStyle,
            minValue: parseFloat(this.state.dataBarMinValue) || 0,
            maxValue: parseFloat(this.state.dataBarMaxValue) || 100,
        };

        const rows = [
            { label: '-80', value: -80 },
            { label: '-30', value: -30 },
            { label: '0', value: 0 },
            { label: '35', value: 35 },
            { label: '90', value: 90 },
        ];

        const startX = 8;
        const startY = 4;
        const rowHeight = 18;
        const barRectWidth = canvas.width - 58;
        const barRectHeight = 14;

        ctx.font = '11px Roboto';
        ctx.fillStyle = '#222';
        ctx.textBaseline = 'middle';

        rows.forEach((row, index) => {
            const y = startY + index * rowHeight;

            ctx.fillText(row.label, startX, y + barRectHeight / 2);

            const cellRect = {
                x: startX + 38,
                y: y,
                width: barRectWidth,
                height: barRectHeight,
            };

            const sCell = {
                c_v: row.value,
                f_p: 4,
            };

            drawDataBars(itemCF, ctx, cellRect, sCell, 0.9);
        });
    }

    drawColorScalesPreview() {
        const ctx = this.getCanvasContext('ColorScales');
        if (!ctx) return;

        const canvas = this.previewCanvasRefs.ColorScales.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const { colorScaleType, colorScaleMinColor, colorScaleMaxColor, 
                colorScaleMidColor, colorScaleMinValue, colorScaleMaxValue } = this.state;
        
        const minColor = normalizeHexColor(colorScaleMinColor);
        const maxColor = normalizeHexColor(colorScaleMaxColor);
        const midColor = colorScaleType === '3-color' 
            ? normalizeHexColor(colorScaleMidColor) 
            : null;

        const isThreeColor = colorScaleType === '3-color';
        const numColumns = isThreeColor ? 3 : 2;
        
        const minValue = parseFloat(colorScaleMinValue) || 0;
        const maxValue = parseFloat(colorScaleMaxValue) || 100;
        
        const values = isThreeColor 
            ? [
                minValue,
                minValue + (maxValue - minValue) * 0.5,
                maxValue
              ]
            : [
                minValue,
                maxValue
              ];

        const cellWidth = (canvas.width - 8) / numColumns;
        const cellHeight = canvas.height - 4;
        const startX = 4;
        const startY = 2;

        values.forEach((value, index) => {
            const x = startX + index * cellWidth;

            let color;
            if (isThreeColor && midColor) {
                if (index === 0) color = minColor;
                else if (index === 1) color = midColor;
                else color = maxColor;
            } else {
                color = index === 0 ? minColor : maxColor;
            }

            ctx.fillStyle = color;
            ctx.fillRect(x, startY, cellWidth - 1, cellHeight);

            ctx.save();
            ctx.fillStyle = '#222';
            ctx.font = '11px Roboto';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(Math.round(value), x + (cellWidth - 1) / 2, startY + cellHeight / 2);
            ctx.restore();
        });
    }

    drawIconSetsPreview() {
        const ctx = this.getCanvasContext('IconSets');
        if (!ctx) return;

        const canvas = this.previewCanvasRefs.IconSets.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const iconMap = {
            "Arrows": ["↓", "→", "↑"],
            "Shapes": ["●", "▲", "■"],
            "Indicators": ["✖", "○", "✔"],
            "Ratings": ["☆","★","★★","★★★","★★★★"],
            "Flags": ["🔴", "🟡", "🟠", "🟢", "🔵"]
        };

        const allIcons = iconMap[this.state.iconSetType] || iconMap["Arrows"];
        // For preview, show the selected number of icons
        const iconCount = parseInt(this.state.iconSetCount) || 3;
        const icons = allIcons.slice(0, iconCount);
        const cellWidth = (canvas.width - 8) / iconCount;
        const cellHeight = canvas.height - 4;
        const startX = 4;
        const startY = 2;

        icons.forEach((icon, index) => {
            const x = startX + index * cellWidth;

            ctx.save();
            ctx.fillStyle = '#222';
            ctx.font = '18px Roboto';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icon, x + cellWidth / 2, startY + cellHeight / 2);
            ctx.restore();
        });
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    renderFormBody() {
        const { formOnly, stacked, inlineEdit, onCancel, onDelete, initialRule, lockRuleKey } = this.props;
        const wTitle = initialRule ? 'Edit formatting rule' : 'New formatting rule';

        const wStyleRow = inlineEdit ? (
            <div className="SkConditionalFormat__field SkConditionalFormat__field--panel">
                <label style={panelLabelStyle} htmlFor="SkCF-style">Style</label>
                <select
                    id="SkCF-style"
                    value={this.getCurrentStyleValue()}
                    onChange={this.handleStyleChange}
                    disabled={lockRuleKey}
                >
                    {this.getStyleOptions().map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </div>
        ) : (
            <div className="SkConditionalFormat__style-row">
                <label htmlFor="SkCF-style">Style:</label>
                <select
                    id="SkCF-style"
                    value={this.getCurrentStyleValue()}
                    onChange={this.handleStyleChange}
                    disabled={lockRuleKey}
                >
                    {this.getStyleOptions().map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </div>
        );

        const wFields = (
            <>
                {this.renderRangeField()}
                {wStyleRow}
                <div className="SkConditionalFormat__content">
                    {this.renderTabContent()}
                </div>
            </>
        );

        const wActions = (stacked || inlineEdit) ? (
            <div className="SkConditionalFormat__actions SkConditionalFormat__actions--stacked">
                <SkButton
                    onClick={this.handleFormatChange}
                    title={stacked ? 'Apply rule' : 'Save'}
                >
                    {stacked ? 'Apply' : 'OK'}
                </SkButton>
                {(onCancel || (!formOnly && !this.props.embedded)) && (
                    <SkButton
                        onClick={() => {
                            if (onCancel) onCancel();
                            else this.setState({ isOpen: false });
                        }}
                        title="Discard changes"
                    >
                        Cancel
                    </SkButton>
                )}
                {onDelete && (
                    <SkButton
                        onClick={onDelete}
                        title="Delete this rule"
                        className="SkButtonDanger"
                    >
                        Delete
                    </SkButton>
                )}
            </div>
        ) : (
            <div className="SkConditionalFormat__actions">
                {(onCancel || (!formOnly && !this.props.embedded)) && (
                    <button
                        type="button"
                        className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                        onClick={() => {
                            if (onCancel) onCancel();
                            else this.setState({ isOpen: false });
                        }}
                    >
                        Cancel
                    </button>
                )}
                {onDelete && (
                    <button
                        type="button"
                        className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                        onClick={onDelete}
                    >
                        Delete
                    </button>
                )}
                <button
                    type="button"
                    className="SkModal-toolbarBtn SkModal-toolbarBtn--accent"
                    onClick={this.handleFormatChange}
                >
                    OK
                </button>
            </div>
        );

        return (
            <div className={`SkConditionalFormat__new-rule${stacked ? ' SkConditionalFormat__new-rule--stacked' : ''}${inlineEdit ? ' SkConditionalFormat__new-rule--inline' : ''}`}>
                {formOnly && !inlineEdit && !stacked && (
                    <div className="SkConditionalFormat__header">
                        {wTitle}
                    </div>
                )}

                {!formOnly && !inlineEdit && (
                    <div className="SkConditionalFormat__header">
                        New formatting rule
                    </div>
                )}

                {stacked || inlineEdit ? (
                    <div className="SkConditionalFormat__scroll-body">
                        {wFields}
                    </div>
                ) : (
                    wFields
                )}

                {wActions}
            </div>
        );
    }

    renderDialogBody() {
        if (this.props.formOnly || this.props.inlineEdit) {
            return this.renderFormBody();
        }

        return (
            <>
                {this.renderExistingRules()}
                {this.renderFormBody()}
            </>
        );
    }

    render() {
        const {
            className = '',
            disabled = false,
            embedded = false,
            formOnly = false,
            stacked = false,
            inlineEdit = false,
        } = this.props;
        const { isOpen } = this.state;

        let content;

        if (inlineEdit) {
            content = (
                <div className={`SkConditionalFormat SkConditionalFormat--inlineEdit ${className}`}>
                    {this.renderFormBody()}
                </div>
            );
        } else if (formOnly) {
            content = (
                <div
                    className={`SkConditionalFormat SkConditionalFormat--formOnly${stacked ? ' SkConditionalFormat--stacked' : ''} ${className}`}
                    ref={this.containerRef}
                >
                    <div className="SkConditionalFormat__panel" ref={this.dropdownRef}>
                        {this.renderFormBody()}
                    </div>
                </div>
            );
        } else if (embedded) {
            content = (
                <div
                    className={`SkConditionalFormat SkConditionalFormat--embedded ${className}`}
                    ref={this.containerRef}
                >
                    <div
                        className="SkConditionalFormat__panel"
                        ref={this.dropdownRef}
                    >
                        {this.renderDialogBody()}
                    </div>
                </div>
            );
        } else {
            content = (
                <div className={`SkConditionalFormat ${className}`} ref={this.containerRef}>
                    <button
                        className="SkConditionalFormat__preview"
                        onClick={this.toggleDropdown}
                        disabled={disabled}
                        title="Conditional Formats"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M9 9h6M9 15h6M9 12h6" />
                        </svg>
                    </button>

                    {isOpen && (
                        <div
                            className="SkConditionalFormat__dropdown"
                            ref={this.dropdownRef}
                            style={{
                                left: this.state.alignRight ? 'auto' : '0',
                                right: this.state.alignRight ? '0' : 'auto',
                            }}
                        >
                            {this.renderDialogBody()}
                        </div>
                    )}
                </div>
            );
        }

        return (
            <>
                {content}
                {this.renderCfColorPortal()}
            </>
        );
    }

    renderTabContent() {
        const { activeTab } = this.state;

        switch (activeTab) {
            case 'HighlightCellsRules':
                return this.renderHighlightCellsRules();
            case 'DataBars':
                return this.renderDataBars();
            case 'ColorScales':
                return this.renderColorScales();
            case 'IconSets':
                return this.renderIconSets();
            case 'CustomFormulas':
                return this.renderCustomFormulas();
            default:
                return null;
        }
    }

    renderHighlightCellsRules() {
        return (
            <div className="SkConditionalFormat__section">
                <div className="SkConditionalFormat__field">
                    <label>Rule type:</label>
                    <select
                        value={this.state.highlightType}
                        onChange={(e) => this.setState({ highlightType: e.target.value })}
                    >
                        <option value="greaterThan">Greater than</option>
                        <option value="lessThan">Less than</option>
                        <option value="equalTo">Equal to</option>
                        <option value="between">Between</option>
                        <option value="containsText">Contains text</option>
                    </select>
                </div>
                <div className="SkConditionalFormat__field">
                    <label>Value:</label>
                    <input
                        type="text"
                        value={this.state.highlightValue}
                        onChange={(e) => this.setState({ highlightValue: e.target.value })}
                        placeholder="Enter a value"
                    />
                </div>
                <div className="SkConditionalFormat__field">
                    <label>Format:</label>
                    {this.renderCellFormatEditor(
                        this.state.highlightFormat,
                        this.handleHighlightFormatChange,
                        'highlight'
                    )}
                </div>
            </div>
        );
    }

    renderDataBars() {
        return (
            <div className="SkConditionalFormat__section">
                <div className="SkConditionalFormat__preview-container">
                    <canvas ref={this.previewCanvasRefs.DataBars} className="SkConditionalFormat__preview-canvas" />
                </div>
                <div className="SkConditionalFormat__field">
                    <label>Positive color:</label>
                    <SkColor
                        defaultColor={this.state.dataBarColor}
                        onColorChange={(color) => this.setState({ dataBarColor: color })}
                    />
                </div>
                <div className="SkConditionalFormat__field">
                    <label>Negative color:</label>
                    <SkColor
                        defaultColor={this.state.dataBarColorNegative}
                        onColorChange={(color) => this.setState({ dataBarColorNegative: color })}
                    />
                </div>
                <div className="SkConditionalFormat__field">
                    <label>Style:</label>
                    <select
                        value={this.state.dataBarStyle}
                        onChange={(e) => this.setState({ dataBarStyle: e.target.value })}
                    >
                        <option value="solid">Solid</option>
                        <option value="gradient">Gradient</option>
                    </select>
                </div>
                <div className="SkConditionalFormat__field-row">
                    <div className="SkConditionalFormat__field">
                        <label>Min value:</label>
                        <input
                            type="number"
                            value={this.state.dataBarMinValue}
                            onChange={(e) => this.setState({ dataBarMinValue: e.target.value })}
                        />
                    </div>
                    <div className="SkConditionalFormat__field">
                        <label>Max value:</label>
                        <input
                            type="number"
                            value={this.state.dataBarMaxValue}
                            onChange={(e) => this.setState({ dataBarMaxValue: e.target.value })}
                        />
                    </div>
                </div>
            </div>
        );
    }

    renderColorScales() {
        const {
            colorScaleType,
            colorScaleMinType,
            colorScaleMaxType,
            colorScaleMinValue,
            colorScaleMaxValue,
            colorScaleMinColor,
            colorScaleMaxColor,
            colorScaleMidColor,
        } = this.state;

        const wMinDisabled = this.isScaleValueDisabled(colorScaleMinType);
        const wMaxDisabled = this.isScaleValueDisabled(colorScaleMaxType);

        return (
            <div className="SkConditionalFormat__section">
                <div className="SkConditionalFormat__preview-container">
                    <canvas ref={this.previewCanvasRefs.ColorScales} className="SkConditionalFormat__preview-canvas" />
                </div>

                <div className="SkConditionalFormat__grid">
                    <div />
                    <div className="SkConditionalFormat__grid-header">Type</div>
                    <div className="SkConditionalFormat__grid-header">Value</div>
                    <div className="SkConditionalFormat__grid-header">Color</div>

                    <div className="SkConditionalFormat__grid-row-label">Minimum</div>
                    <select
                        value={colorScaleMinType}
                        onChange={(e) => this.setState({ colorScaleMinType: e.target.value })}
                    >
                        <option value="lowest">Lowest value</option>
                        <option value="number">Number</option>
                        <option value="percent">Percent</option>
                    </select>
                    {wMinDisabled ? (
                        <span className="SkConditionalFormat__grid-auto-value" aria-readonly="true">
                            {this.getScaleValuePlaceholder(colorScaleMinType)}
                        </span>
                    ) : (
                        <input
                            type="text"
                            value={colorScaleMinValue}
                            onChange={(e) => this.setState({ colorScaleMinValue: e.target.value })}
                        />
                    )}
                    <div className="SkConditionalFormat__grid-color">
                        <SkColor
                            defaultColor={colorScaleMinColor}
                            onColorChange={(color) => this.setState({ colorScaleMinColor: color })}
                        />
                    </div>

                    {colorScaleType === '3-color' && (
                        <>
                            <div className="SkConditionalFormat__grid-row-label">Midpoint</div>
                            <select defaultValue="percent">
                                <option value="percent">Percent</option>
                                <option value="number">Number</option>
                            </select>
                            <input type="text" defaultValue="50" />
                            <div className="SkConditionalFormat__grid-color">
                                <SkColor
                                    defaultColor={colorScaleMidColor}
                                    onColorChange={(color) => this.setState({ colorScaleMidColor: color })}
                                />
                            </div>
                        </>
                    )}

                    <div className="SkConditionalFormat__grid-row-label">Maximum</div>
                    <select
                        value={colorScaleMaxType}
                        onChange={(e) => this.setState({ colorScaleMaxType: e.target.value })}
                    >
                        <option value="highest">Highest value</option>
                        <option value="number">Number</option>
                        <option value="percent">Percent</option>
                    </select>
                    {wMaxDisabled ? (
                        <span className="SkConditionalFormat__grid-auto-value" aria-readonly="true">
                            {this.getScaleValuePlaceholder(colorScaleMaxType)}
                        </span>
                    ) : (
                        <input
                            type="text"
                            value={colorScaleMaxValue}
                            onChange={(e) => this.setState({ colorScaleMaxValue: e.target.value })}
                        />
                    )}
                    <div className="SkConditionalFormat__grid-color">
                        <SkColor
                            defaultColor={colorScaleMaxColor}
                            onColorChange={(color) => this.setState({ colorScaleMaxColor: color })}
                        />
                    </div>
                </div>
            </div>
        );
    }

    renderIconSets() {
        return (
            <div className="SkConditionalFormat__section">
                <div className="SkConditionalFormat__preview-container">
                    <canvas ref={this.previewCanvasRefs.IconSets} className="SkConditionalFormat__preview-canvas" />
                </div>
                <div className="SkConditionalFormat__field">
                    <label>Icon type:</label>
                    <select
                        value={this.state.iconSetType}
                        onChange={(e) => {
                            const newType = e.target.value;
                            const maxCount = this.getMaxIconCount(newType);
                            const currentCount = this.state.iconSetCount;
                            this.setState({ 
                                iconSetType: newType,
                                iconSetCount: Math.min(currentCount, maxCount)
                            });
                        }}
                    >
                        <option value="Arrows">Arrows</option>
                        <option value="Shapes">Shapes</option>
                        <option value="Indicators">Indicators</option>
                        <option value="Ratings">Stars</option>
                        <option value="Flags">Flags</option>
                    </select>
                </div>
                <div className="SkConditionalFormat__field">
                    <label>Number of icons:</label>
                    <select
                        value={this.state.iconSetCount}
                        onChange={(e) => this.setState({ iconSetCount: parseInt(e.target.value) })}
                    >
                        {(() => {
                            const maxCount = this.getMaxIconCount(this.state.iconSetType);
                            const options = [];
                            for (let i = 2; i <= maxCount; i++) {
                                options.push(
                                    <option key={i} value={i}>{i}</option>
                                );
                            }
                            return options;
                        })()}
                    </select>
                </div>
                <div className="SkConditionalFormat__field">
                    <label>
                        <input
                            type="checkbox"
                            checked={this.state.iconSetShowValue}
                            onChange={(e) => this.setState({ iconSetShowValue: e.target.checked })}
                        />
                        Show value
                    </label>
                </div>
                <div className="SkConditionalFormat__field">
                    <label>
                        <input
                            type="checkbox"
                            checked={this.state.iconSetReverse}
                            onChange={(e) => this.setState({ iconSetReverse: e.target.checked })}
                        />
                        Reverse order
                    </label>
                </div>
            </div>
        );
    }

    renderCustomFormulas() {
        return (
            <div className="SkConditionalFormat__section">
                <div className="SkConditionalFormat__field">
                    <label>Formula:</label>
                    <textarea
                        value={this.state.customFormula}
                        onChange={(e) => {
                            this.props.SpInterface?.clearFormulaBarCompileError?.();
                            this.setState({ customFormula: e.target.value });
                        }}
                        placeholder="Ex: A1>10"
                        rows="3"
                        className="SkConditionalFormat__textarea"
                    />
                </div>
                <div className="SkConditionalFormat__field">
                    <label>Format:</label>
                    {this.renderCellFormatEditor(
                        this.state.customFormat,
                        this.handleCustomFormatChange,
                        'custom'
                    )}
                </div>
            </div>
        );
    }
}

SkConditionalFormat.propTypes = {
    defaultFormat: PropTypes.object,
    onFormatChange: PropTypes.func,
    onCancel: PropTypes.func,
    onDelete: PropTypes.func,
    className: PropTypes.string,
    disabled: PropTypes.bool,
    embedded: PropTypes.bool,
    formOnly: PropTypes.bool,
    stacked: PropTypes.bool,
    inlineEdit: PropTypes.bool,
    SpInterface: PropTypes.object,
    initialRule: PropTypes.object,
    initialRef: PropTypes.string,
    lockRuleKey: PropTypes.bool,
};

SkConditionalFormat.defaultProps = {
    defaultFormat: null,
    onFormatChange: undefined,
    onCancel: undefined,
    onDelete: undefined,
    className: '',
    disabled: false,
    embedded: false,
    formOnly: false,
    stacked: false,
    inlineEdit: false,
    SpInterface: null,
    initialRule: null,
    initialRef: '',
    lockRuleKey: false,
};

const panelLabelStyle = {
    fontSize: '11px',
    color: 'var(--sk-row-label-color)',
    marginTop: '6px',
    marginBottom: '2px',
};

export default SkConditionalFormat;

