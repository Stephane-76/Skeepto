//=============================================================================
// SkCellClassCalendar
// Calendar class for spreadsheet cells
//=============================================================================
import React from "react";
import { GetTextAlign, GetVerticalTextAlign, GetFontStyle, GetFontWeight, buildCanvasFontFamily } from '../../utility/SkUtility.js'
import { fontSizePtFromCell, fontSizeCssPxFromPt } from '../../utility/SkFontPool.js'
import SkCellClass from "./SkCellClass.js"
import { getSpreadsheetLang, normalizeSpreadsheetLang } from '../SkeeptoLang.js'

// Locale settings aligned with SkRoot::tLocale (SkLocale.cpp).
const CALENDAR_LOCALE_CONFIG = {
    fr: {
        days: ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'],
        months: ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
            'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'],
        dateOrder: 'dmy',
        separator: '/',
        placeholder: 'jj/mm/aaaa',
        firstDayOfWeek: 1,
        ariaLabel: 'Ouvrir le calendrier'
    },
    us: {
        days: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
        months: ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'],
        dateOrder: 'mdy',
        separator: '/',
        placeholder: 'mm/dd/yyyy',
        firstDayOfWeek: 0,
        ariaLabel: 'Open calendar'
    },
    en: {
        days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
        months: ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'],
        dateOrder: 'dmy',
        separator: '/',
        placeholder: 'dd/mm/yyyy',
        firstDayOfWeek: 1,
        ariaLabel: 'Open calendar'
    },
    de: {
        days: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
        months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
            'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
        dateOrder: 'dmy',
        separator: '.',
        placeholder: 'tt.mm.jjjj',
        firstDayOfWeek: 1,
        ariaLabel: 'Kalender öffnen'
    },
    sp: {
        days: ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'],
        months: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
        dateOrder: 'dmy',
        separator: '/',
        placeholder: 'dd/mm/aaaa',
        firstDayOfWeek: 1,
        ariaLabel: 'Abrir calendario'
    },
    it: {
        days: ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'],
        months: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
            'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'],
        dateOrder: 'dmy',
        separator: '/',
        placeholder: 'gg/mm/aaaa',
        firstDayOfWeek: 1,
        ariaLabel: 'Apri calendario'
    }
};

function resolveCalendarLocale(lang) {
    return normalizeSpreadsheetLang(lang) || 'fr';
}

/** Map JsonView f_ah flex values to CSS text-align (same as canvas cell paint). */
function cssTextAlignFromCellAlign(cellAlign) {
    if (cellAlign === 'start') return 'left';
    if (cellAlign === 'end') return 'right';
    if (cellAlign === 'center') return 'center';
    return 'right';
}

/** Map JsonView f_av to flex cross-axis alignment (canvas default f_av=7 → center). */
function flexAlignFromCellVertical(cellVertical) {
    if (cellVertical === 'start') return 'flex-start';
    if (cellVertical === 'end') return 'flex-end';
    if (cellVertical === 'center') return 'center';
    return 'center';
}

function getCalendarLocaleConfig(lang) {
    const resolved = resolveCalendarLocale(lang);
    return CALENDAR_LOCALE_CONFIG[resolved] || CALENDAR_LOCALE_CONFIG.fr;
}

function formatDateForLocale(date, lang) {
    if (!date) return '';

    const config = getCalendarLocaleConfig(lang);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const sep = config.separator;

    if (config.dateOrder === 'mdy') {
        return `${month}${sep}${day}${sep}${year}`;
    }
    return `${day}${sep}${month}${sep}${year}`;
}

function parseDateWithLocale(dateStr, lang) {
    if (!dateStr) return null;

    const localeConfig = getCalendarLocaleConfig(lang);
    const isMonthFirst = localeConfig.dateOrder === 'mdy';
    const formats = isMonthFirst ? [
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // MM/DD/YYYY
        /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, // MM/DD/YY
        /^(\d{1,2})(\d{2})(\d{2})$/,       // MMDDYY
        /^(\d{1,2})(\d{2})(\d{4})$/,       // MMDDYYYY
        /^(\d{1,2})-(\d{1,2})-(\d{4})$/,   // MM-DD-YYYY
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/  // MM.DD.YYYY
    ] : [
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // DD/MM/YYYY
        /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, // DD/MM/YY
        /^(\d{1,2})(\d{2})(\d{2})$/,       // DDMMYY
        /^(\d{1,2})(\d{2})(\d{4})$/,       // DDMMYYYY
        /^(\d{1,2})-(\d{1,2})-(\d{4})$/,   // DD-MM-YYYY
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/  // DD.MM.YYYY
    ];

    for (const format of formats) {
        const match = dateStr.match(format);
        if (!match) continue;
        const [, first, second, yearStr] = match;
        let day, month;
        let year = parseInt(yearStr, 10);
        if (isMonthFirst) {
            month = parseInt(first, 10) - 1;
            day = parseInt(second, 10);
        } else {
            day = parseInt(first, 10);
            month = parseInt(second, 10) - 1;
        }
        if (year < 100) {
            year += year < 50 ? 2000 : 1900;
        }
        const date = new Date(year, month, day);
        if (
            date.getDate() === day &&
            date.getMonth() === month &&
            date.getFullYear() === year &&
            year >= 1900 &&
            year <= 2100
        ) {
            return date;
        }
    }
    return null;
}

function parseDateFlexible(dateStr, lang) {
    const wVariantWire = SkCellClass.parseVariantDateWire(dateStr);
    if (wVariantWire) {
        return wVariantWire;
    }
    const resolved = resolveCalendarLocale(lang);
    const parsed = parseDateWithLocale(dateStr, resolved);
    if (parsed) {
        return parsed;
    }
    if (resolved !== 'us') {
        return parseDateWithLocale(dateStr, 'us');
    }
    return null;
}

function Render(sCell,sSpInterface) {
    return(
        <SkCellClassCalendar
            Cell={sCell}
            locale={getSpreadsheetLang()}
            key={sCell.c_k}
            SpInterface={sSpInterface}
        />
    )
}

class SkCellClassCalendar extends SkCellClass {
    constructor(props) {
        super(props)
        this.state = {
            selectedDate: "",
            isOpen: false,
            zIndex: 10, // Z-index pass in front of all other cells PopUp
            currentMonth: new Date().getMonth(),
            currentYear: new Date().getFullYear(),
            locale: resolveCalendarLocale(props.locale || getSpreadsheetLang()),
            inputValue: "",
            lastValidDate: null
        };
        this.m_EditSessionActive = false;
        this.inputRef = null;
    }

    static ClassName() { return("SkCellClassCalendar") }

    static cellClassCapabilities() {
        return {
            ...SkCellClass.cellClassCapabilities(),
            selfEditing: true,
            calculableModelValue: true,
            calculableWireType: SkCellClass.VARIANT_JSON_TYPE_DATE,
        };
    }

    // SVG icon representing a calendar page with a highlighted day
    static Icon() {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
                <rect x="3" y="5" width="18" height="16" rx="2" ry="2"
                      fill="#ffffff" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="3" y="5" width="18" height="5"
                      fill="#e63946" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="8"  y1="3" x2="8"  y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <line x1="16" y1="3" x2="16" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <rect x="10" y="13" width="4" height="4" fill="#1976d2"/>
            </svg>
        );
    }

    static registerClassAttribute(sUISpreadSheet) {
        super.registerClassAttribute(sUISpreadSheet, "Calendar", "Javascript", Render);
        // Value lives in CalculableValue() (c_v.c.t / c_v.c.v) — edited in-cell, not Attribute panel.
    }

    // Persist as tVariant::t_date — C++ ValueClassCalculable uses tClassDate::UsDate like tVariant::Json.
    persistValue = async (dateOrText, options = {}) => {
        const wReloadView = options.reloadView !== false;
        let wVariantWire = "";
        if (dateOrText instanceof Date) {
            wVariantWire = SkCellClass.formatVariantDateWire(dateOrText);
        } else {
            const wParsed = parseDateFlexible(dateOrText || "", this.state.locale);
            wVariantWire = wParsed ? SkCellClass.formatVariantDateWire(wParsed) : "";
        }
        if (wVariantWire === (this.m_CalculableValue || "")) {
            return;
        }
        const wOk = await this.SetCalculableValue(wVariantWire);
        if (!wOk) {
            console.error("SetCalculableValue failed for", this.cellStr(), wVariantWire);
            return;
        }
        this.m_CalculableValue = wVariantWire;
        if (!wReloadView) {
            return;
        }
        // UndoCellClassCalculable already recalculates dependents; reloadView refreshes JsonView (formulas, f_value).
        if (this.m_SpInterface && typeof this.m_SpInterface.reloadView === "function") {
            await this.m_SpInterface.reloadView();
        }
    }

    getLocaleConfig() {
        return getCalendarLocaleConfig(this.state.locale);
    }

    applyLocale = (lang) => {
        const resolved = resolveCalendarLocale(lang);
        if (resolved === this.state.locale) {
            return;
        }

        this.setState((prevState) => {
            const updates = { locale: resolved };
            const date = prevState.lastValidDate
                || parseDateFlexible(prevState.inputValue, resolved);
            if (date) {
                const formatted = formatDateForLocale(date, resolved);
                updates.inputValue = formatted;
                updates.selectedDate = formatted;
                updates.lastValidDate = date;
                updates.currentMonth = date.getMonth();
                updates.currentYear = date.getFullYear();
            }
            return updates;
        });
    }

    // Keep the popup month/selection aligned with the text field.
    syncCalendarViewFromInput = (inputValue = this.state.inputValue) => {
        if (!inputValue) {
            return null;
        }
        return parseDateFlexible(inputValue, this.state.locale);
    }

    getCalendarViewStateFromDate = (date) => {
        if (!date) {
            return {
                lastValidDate: null,
                currentMonth: new Date().getMonth(),
                currentYear: new Date().getFullYear()
            };
        }
        return {
            lastValidDate: date,
            currentMonth: date.getMonth(),
            currentYear: date.getFullYear()
        };
    }

    async componentDidMount() {
        document.addEventListener('mousedown', this.handleClickOutside, true);
        this.handleLangChange = (event) => {
            const lang = event?.detail?.lang || getSpreadsheetLang();
            this.applyLocale(lang);
        };
        window.addEventListener('skeeptoLangChange', this.handleLangChange);

        const wStoredSync = SkCellClass.readCalculableFromCellJson(this.m_Cell)
            || SkCellClass.readLegacyValueAttribute(this.m_Cell);
        const wStored = wStoredSync || await this.GetCalculableValue();
        this.m_CalculableValue = wStored;
        const wParsed = parseDateFlexible(wStored || "", this.state.locale);
        const wFormatted = wParsed ? formatDateForLocale(wParsed, this.state.locale) : (wStored || "");

        this.setState({
            inputValue: wFormatted,
            selectedDate: wFormatted,
            lastValidDate: wParsed,
            currentMonth: wParsed ? wParsed.getMonth() : new Date().getMonth(),
            currentYear:  wParsed ? wParsed.getFullYear() : new Date().getFullYear()
        });

        // Re-persist as t_date when loaded data is still a locale string (t_string).
        const wVariantType = SkCellClass.readCalculableVariantType(this.m_Cell);
        if (wParsed && wVariantType !== SkCellClass.VARIANT_JSON_TYPE_DATE) {
            this.persistValue(wParsed, { reloadView: false }).catch((error) => {
                console.error("Calendar calculable repair failed for", this.cellStr(), error);
            });
        }
    }

    componentWillUnmount() {
        document.removeEventListener('mousedown', this.handleClickOutside, true);
        if (this.handleLangChange) {
            window.removeEventListener('skeeptoLangChange', this.handleLangChange);
        }
    }

    handleClickOutside = (event) => {
        if (this.calendarRef && !this.calendarRef.contains(event.target) && 
            this.containerRef && !this.containerRef.contains(event.target)) {
            this.setState({ isOpen: false });
        }
    }

    ensureEditSessionForCalendarToggle = async () => {
        const sp = this.m_SpInterface;
        if (!sp) {
            return;
        }
        if (!this.isCursorOnThisCell()) {
            await this.focusCursorOnCell(null);
        }
        if (typeof sp.getUseEdit === "function" && !sp.getUseEdit()) {
            await sp.beginEdit();
        }
    };

    toggleCalendar = (event) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (this.isFormulaPickActive()) {
            return;
        }
        void this.ensureEditSessionForCalendarToggle().then(() => {
            this.setState((prevState) => {
                const wNext = !prevState.isOpen;
                if (!wNext) {
                    return { isOpen: false };
                }
                const wDate = parseDateFlexible(prevState.inputValue, prevState.locale)
                    || prevState.lastValidDate;
                return {
                    isOpen: true,
                    ...this.getCalendarViewStateFromDate(wDate),
                };
            });
        });
    }

    openCalendar = () => {
        if (this.state.isOpen) {
            return;
        }
        const wDate = this.syncCalendarViewFromInput() || this.state.lastValidDate;
        this.setState({
            isOpen: true,
            ...this.getCalendarViewStateFromDate(wDate)
        });
    }

    closeCalendar = () => {
        if (this.state.isOpen) this.setState({ isOpen: false });
    }

    commitDate = async (wDate) => {
        const wFormatted = this.formatDate(wDate);
        this.setState({
            selectedDate: wFormatted,
            inputValue: wFormatted,
            lastValidDate: wDate,
            currentMonth: wDate.getMonth(),
            currentYear:  wDate.getFullYear()
        });
        await this.persistValue(wDate);
        if (this.props.onValueChange) {
            this.props.onValueChange(wFormatted);
        }
    }

    clearDate = async () => {
        this.setState({
            selectedDate: "",
            inputValue: "",
            lastValidDate: null
        });
        await this.persistValue("");
        if (this.props.onValueChange) {
            this.props.onValueChange("");
        }
    }

    handleDateSelect = (date) => {
        this.commitDate(date)
            .then(() => {
                this.setState({ isOpen: false });
            })
            .catch((error) => {
                console.error("Error persisting calendar date selection:", error);
            });
    }

    changeMonth = (offset) => {
        this.setState(prevState => {
            const currentDate = new Date(prevState.currentYear, prevState.currentMonth);
            currentDate.setMonth(currentDate.getMonth() + offset);
            
            return {
                currentMonth: currentDate.getMonth(),
                currentYear: currentDate.getFullYear()
            };
        });
    }

    // Free input: update the field and sync the popup when the text is a complete date.
    handleInputChange = (e) => {
        const inputValue = e.target.value;
        const updates = { inputValue };
        if (!inputValue) {
            updates.lastValidDate = null;
        } else {
            const wParsed = parseDateFlexible(inputValue, this.state.locale);
            if (wParsed) {
                Object.assign(updates, this.getCalendarViewStateFromDate(wParsed));
            }
        }
        this.setState(updates);
    }

    handleBlur = () => {
        this.validateDate().catch((error) => {
            console.error("Error validating calendar date on blur:", error);
        });
    }

    releaseInplaceEditorFocus = () => {
        const wInput = this.inputRef;
        if (wInput && document.activeElement === wInput) {
            wInput.blur();
        }
    }

    exitEditSession = async ({ cancel = false } = {}) => {
        this.m_EditSessionActive = false;
        this.closeCalendar();
        if (cancel) {
            this.setState({
                inputValue: this.state.selectedDate || ""
            });
        } else {
            await this.validateDate();
        }
        this.releaseInplaceEditorFocus();
        const sp = this.m_SpInterface;
        if (
            sp &&
            typeof sp.getUseEdit === "function" &&
            sp.getUseEdit()
        ) {
            await sp.endEdit();
        }
        this.restoreGridKeyboardFocus();
    }

    handleKeyDown = (e) => {
        switch (e.key) {
            case 'Enter':
                e.preventDefault();
                e.stopPropagation();
                this.exitEditSession({ cancel: false }).catch((error) => {
                    console.error("Error finishing calendar keyboard entry:", error);
                });
                break;
            case 'Escape':
                e.preventDefault();
                e.stopPropagation();
                this.exitEditSession({ cancel: true }).catch((error) => {
                    console.error("Error cancelling calendar keyboard entry:", error);
                });
                break;
            case 'ArrowDown':
                // Keyboard shortcut to open the picker
                if (!this.state.isOpen) {
                    e.preventDefault();
                    this.openCalendar();
                }
                break;
            default:
                break;
        }
    }

    parseDate = (dateStr) => {
        return parseDateFlexible(dateStr, this.state.locale);
    }

    validateDate = async () => {
        const dateStr = SkCellClass.normalizeWasmCellValue(this.state.inputValue);
        if (!dateStr) {
            await this.clearDate();
            return;
        }

        const wValidDate = this.parseDate(dateStr);
        if (wValidDate) {
            await this.commitDate(wValidDate);
        } else {
            // Invalid entry: revert to the last valid value if we have one,
            // otherwise clear the field
            if (this.state.lastValidDate) {
                const wFormatted = this.formatDate(this.state.lastValidDate);
                this.setState({
                    inputValue: wFormatted,
                    selectedDate: wFormatted
                });
            } else {
                await this.clearDate();
            }
        }
    }

    handleFocus = (e) => {
        if (!this.shouldActivateSelfEditingWidget()) {
            e.target.blur();
            return;
        }
        e.target.select(); // Select all text on focus for fast typing
    }

    formatDate = (date) => {
        return formatDateForLocale(date, this.state.locale);
    }

    // For date comparison in calendar
    isSelectedDate = (date) => {
        if (!this.state.lastValidDate) return false;
        
        return date.getDate() === this.state.lastValidDate.getDate() &&
               date.getMonth() === this.state.lastValidDate.getMonth() &&
               date.getFullYear() === this.state.lastValidDate.getFullYear();
    }

    focusInplaceEditor = () => {
        if (!this.shouldActivateSelfEditingWidget()) {
            return;
        }
        const sp = this.m_SpInterface;
        const wInput = this.inputRef;
        if (!wInput) {
            return;
        }
        const wChar =
            sp && typeof sp.lastChar === "function" ? sp.lastChar() : "";
        if (wChar) {
            this.setState({ inputValue: wChar }, () => {
                if (!this.shouldActivateSelfEditingWidget()) {
                    return;
                }
                wInput.focus();
                const wLen = wChar.length;
                wInput.setSelectionRange(wLen, wLen);
                if (sp && typeof sp.setLastChar === "function") {
                    sp.setLastChar("");
                }
            });
            return;
        }
        wInput.focus();
        if (typeof wInput.select === "function") {
            wInput.select();
        }
    };

    // Update when props change
    componentDidUpdate(prevProps) {
        if (prevProps.locale !== this.props.locale) {
            this.applyLocale(this.props.locale || getSpreadsheetLang());
        }
        if (prevProps.value !== this.props.value && this.props.value !== this.state.selectedDate) {
            const wParsed = parseDateFlexible(this.props.value || "", this.state.locale);
            const wFormatted = wParsed
                ? formatDateForLocale(wParsed, this.state.locale)
                : (this.props.value || "");
            this.setState({
                inputValue: wFormatted,
                selectedDate: wFormatted,
                ...this.getCalendarViewStateFromDate(wParsed)
            });
        }

        const wEditing = this.shouldActivateSelfEditingWidget();
        if (wEditing && !this.m_EditSessionActive) {
            this.m_EditSessionActive = true;
            requestAnimationFrame(() => this.focusInplaceEditor());
        } else if (!wEditing) {
            this.m_EditSessionActive = false;
            if (this.state.isOpen) {
                this.setState({ isOpen: false });
            }
        }
    }

    renderCalendarButton(styles, sCalendarEditActive) {
        const localeConfig = this.getLocaleConfig();
        const wTextAlignCss = cssTextAlignFromCellAlign(styles.textAlign);
        const wIconPad = '26px';
        const containerStyle = {
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: flexAlignFromCellVertical(styles.verticalAlign),
            position: 'relative'
        };

        return (
            <div 
                style={containerStyle}
                ref={ref => this.containerRef = ref}
            >
                <input
                    ref={(ref) => { this.inputRef = ref; }}
                    type="text"
                    className="SkCellClassCalendar-input"
                    value={this.state.inputValue}
                    placeholder={localeConfig.placeholder}
                    readOnly={!sCalendarEditActive}
                    tabIndex={sCalendarEditActive ? 0 : -1}
                    onChange={this.handleInputChange}
                    onBlur={this.handleBlur}
                    onKeyDown={this.handleKeyDown}
                    onFocus={this.handleFocus}
                    style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        outline: 'none',
                        backgroundColor: 'transparent',
                        color: styles.color || 'black',
                        fontFamily: styles.fontFamily || 'Roboto',
                        fontSize: styles.fontSize || '14px',
                        fontWeight: styles.fontWeight || 'normal',
                        fontStyle: styles.fontStyle || 'normal',
                        textDecoration: styles.textDecoration || 'none',
                        textAlign: wTextAlignCss,
                        paddingLeft: wTextAlignCss === 'right' ? '4px' : '4px',
                        paddingRight: wIconPad,
                        boxSizing: 'border-box',
                        lineHeight: 'normal',
                        cursor: sCalendarEditActive ? 'text' : 'default'
                    }}
                />
                <button
                    type="button"
                    className="SkCellClassCalendar-toggle"
                    tabIndex={-1}
                    aria-label={localeConfig.ariaLabel}
                    onMouseDown={this.toggleCalendar}
                    style={{
                        position: 'absolute',
                        right: '2px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        zIndex: 2,
                        background: 'rgba(255,255,255,0.85)',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '0 4px',
                        height: '90%',
                        cursor: 'pointer',
                        fontSize: '14px',
                        lineHeight: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    📅
                </button>
            </div>
        );
    }

    renderCalendarDropdown(styles) {
        if (!this.state.isOpen) return null;

        const localeConfig = this.getLocaleConfig();
        const daysInMonth = new Date(this.state.currentYear, this.state.currentMonth + 1, 0).getDate();
        const firstDayOfMonth = new Date(this.state.currentYear, this.state.currentMonth, 1).getDay();
        const firstDayOffset = (firstDayOfMonth - localeConfig.firstDayOfWeek + 7) % 7;

        const calendarStyle = {
            position: 'absolute',
            top: '100%',
            left: '0',
            backgroundColor: 'white',
            border: '1px solid #ccc',
            borderRadius: '4px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            zIndex: this.state.zIndex,
            padding: '10px',
            width: '250px'
        };

        const headerStyle = {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px'
        };

        const monthYearStyle = {
            fontWeight: 'bold',
            fontSize: '14px'
        };

        const navButtonStyle = {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0 5px'
        };

        const daysHeaderStyle = {
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '2px',
            marginBottom: '5px'
        };

        const dayHeaderStyle = {
            textAlign: 'center',
            fontSize: '12px',
            fontWeight: 'bold',
            color: '#666'
        };

        const daysGridStyle = {
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '2px'
        };

        const dayStyle = {
            backgroundColor: 'transparent',
            color: 'black',
            textAlign: 'center',
            padding: '5px',
            cursor: 'pointer',
            fontSize: '12px',
            borderRadius: '3px'
        };

        const selectedDayStyle = {
            ...dayStyle,
            backgroundColor: '#007bff',
            color: 'white'
        };

        const todayStyle = {
            ...dayStyle,
            border: '1px solid #007bff'
        };

        return (
            <div className="SkCellClassCalendar-popup" style={calendarStyle} ref={ref => this.calendarRef = ref}>
                <div style={headerStyle}>
                    <button style={navButtonStyle} onClick={() => this.changeMonth(-1)}>←</button>
                    <div style={monthYearStyle}>
                        {localeConfig.months[this.state.currentMonth]} {this.state.currentYear}
                    </div>
                    <button style={navButtonStyle} onClick={() => this.changeMonth(1)}>→</button>
                </div>

                <div style={daysHeaderStyle}>
                    {localeConfig.days.map(day => (
                        <div key={day} style={dayHeaderStyle}>{day}</div>
                    ))}
                </div>

                <div style={daysGridStyle}>
                    {Array.from({ length: firstDayOffset }, (_, i) => (
                        <div key={`empty-${i}`} style={dayStyle}></div>
                    ))}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                        const date = new Date(this.state.currentYear, this.state.currentMonth, i + 1);
                        const isSelected = this.isSelectedDate(date);
                        const isToday = this.isToday(date);
                        return (
                            <div
                                key={i}
                                style={isSelected ? selectedDayStyle : isToday ? todayStyle : dayStyle}
                                onClick={() => this.handleDateSelect(date)}
                            >
                                {i + 1}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    isToday(date) {
        const today = new Date();
        return date.getDate() === today.getDate() &&
               date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    }

    paintExportInk(ctx, width, height) {
        const wStyles = SkCellClass.cellStylesForCanvasExport(this.m_Cell);
        const wInset = wStyles.inset ?? 2;
        const wInnerW = Math.max(0, width - wInset * 2);
        const wInnerH = Math.max(0, height - wInset * 2);
        const wText = this.state?.inputValue || "";

        ctx.save();
        ctx.translate(wInset, wInset);
        SkCellClass.applyCanvasFont(ctx, wStyles);
        ctx.textAlign = SkCellClass.canvasExportTextAlign(wStyles.textAlign);
        ctx.textBaseline = "middle";
        const wPadL = 4;
        const wPadR = 26;
        const wX =
            wStyles.textAlign === "start"
                ? wPadL
                : wStyles.textAlign === "end"
                  ? wInnerW - wPadR
                  : wInnerW / 2;
        const wY = SkCellClass.canvasExportTextY(wStyles.verticalAlign, wInnerH);
        ctx.fillText(String(wText), wX, wY);
        const wBtnW = 22;
        const wBtnH = Math.max(12, Math.min(wInnerH - 4, wInnerH * 0.9));
        const wBtnX = wInnerW - wBtnW - 2;
        const wBtnY = (wInnerH - wBtnH) / 2;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        SkCellClass.roundRectPath(ctx, wBtnX, wBtnY, wBtnW, wBtnH, 3);
        ctx.fill();
        const wIx = wBtnX + 4;
        const wIy = wBtnY + 3;
        const wIw = wBtnW - 8;
        const wIh = wBtnH - 6;
        ctx.strokeStyle = "#333333";
        ctx.lineWidth = 1;
        SkCellClass.roundRectPath(ctx, wIx, wIy, wIw, wIh, 1.5);
        ctx.stroke();
        ctx.fillStyle = "#e63946";
        ctx.fillRect(wIx, wIy, wIw, wIh * 0.35);
        ctx.fillStyle = "#1976d2";
        ctx.fillRect(wIx + wIw * 0.35, wIy + wIh * 0.55, wIw * 0.2, wIh * 0.2);
        ctx.restore();
    }

    render() {
        let wCell=this.props.Cell;
        // Set default value
       
        const wZIndex = 3;

        let wFontName="Roboto";
        let wFontSizePt=11;
        let wPadding="0px";
        let wColor="black";
        let wTextAlign="end"; // Default Right (f_ah=3)
        let wVerticalTextAlign="center"; // Default middle (f_av=7, same as canvas)
        let wBackgroundColor="transparent";
        let wTextDecoration="";
        let wFontStyle="";
        let wFontWeight="";
        
        // Padding 
        if (wCell.f_p!=="") {
            wPadding=wCell.f_p;
        }
       
        // Formatted value
        if (wCell.hasOwnProperty("f_value")) {
            if (wCell.f_value!==null) {
             //wCellText=String(wCell.f_value) // IMPORTANT BUG OBJECT;
            }
        }
        // Color
        if (wCell.hasOwnProperty("f_c")) {
            wColor=wCell.f_c; 
        }
        // Background Color
        if (wCell.hasOwnProperty("f_bc")) {
            wBackgroundColor=wCell.f_bc; 
        }
        // Horizontal Align
        if (wCell.hasOwnProperty("f_ah")) {
            wTextAlign=GetTextAlign(wCell.f_ah); 
        }
        // Vertical Align
        if (wCell.hasOwnProperty("f_av")) {
            wVerticalTextAlign=GetVerticalTextAlign(wCell.f_av); 
        }
        // Underline Line-through
        if (wCell.hasOwnProperty("f_d_u")) {
            wTextDecoration="underline"; 
        }
        if (wCell.hasOwnProperty("f_d_l")) {
            if (wTextDecoration!=="") {
            wTextDecoration=wTextDecoration+" line-through";
            } else {
            wTextDecoration="line-through";
            } 
        }
        // Italic
        if (wCell.hasOwnProperty("f_st")) {
            wFontStyle=GetFontStyle(wCell.f_st); 
        }
        // Bold
        if (wCell.hasOwnProperty("f_we")) {
            wFontWeight=GetFontWeight(wCell.f_we); 
        }
        // Font Name
        if (wCell.hasOwnProperty("f_f_n")) {
            wFontName=wCell.f_f_n;
        }
        wFontSizePt = fontSizePtFromCell(wCell, 11);
        const wFontSizeCss = fontSizeCssPxFromPt(wFontSizePt);
        const wFontFamily = buildCanvasFontFamily(wFontName);
        const wCalendarEditActive = this.shouldActivateSelfEditingWidget();
        const wCellInset = 2;
        const wOverlay = this.CellClassClippedOverlayLayout({
            inset: wCellInset,
            innerPadding: wPadding,
            overflow: this.state.isOpen ? 'visible' : 'hidden',
        });

        const wCellStyleParent = {
            ...wOverlay.outerStyle,
            display: 'inline-block',
            zIndex: wZIndex+1, // front of parent
            alignItems: wVerticalTextAlign,
            justifyContent: wTextAlign,
            backgroundColor: wBackgroundColor,
            pointerEvents: 'auto',
        };

        const wCellStyleInner = {
            ...wOverlay.innerStyle,
            backgroundColor: wBackgroundColor,
        };

        return (
            <div
                style={wCellStyleParent}
                onMouseDownCapture={this.onCellClassMouseDownCapture}
            >
                <div style={wCellStyleInner}>
                    {this.renderCalendarButton({
                        color: wColor,
                        backgroundColor: wBackgroundColor,
                        fontFamily: wFontFamily,
                        fontSize: wFontSizeCss + "px",
                        fontWeight: wFontWeight,
                        fontStyle: wFontStyle,
                        textDecoration: wTextDecoration,
                        textAlign: wTextAlign,
                        verticalAlign: wVerticalTextAlign
                    }, wCalendarEditActive)}
                </div>
                {this.renderCalendarDropdown({
                    color: wColor,
                    backgroundColor: wBackgroundColor,
                    fontFamily: wFontFamily,
                    fontSize: wFontSizeCss + "px",
                    fontWeight: wFontWeight,
                    fontStyle: wFontStyle,
                    textDecoration: wTextDecoration
                })}
            </div>
        );
    }
}

SkCellClass.installPdfExportStatics(SkCellClassCalendar, {
    initialState: () => ({
        locale: resolveCalendarLocale(getSpreadsheetLang()),
        inputValue: "",
        selectedDate: "",
        lastValidDate: null,
    }),
    hydrate: async (painter, cell) => {
        const wLocale = painter.state.locale;
        const wStoredSync = SkCellClass.readCalculableFromCellJson(cell)
            || SkCellClass.readLegacyValueAttribute(cell);
        const wStored = wStoredSync || (await painter.GetCalculableValue());
        const wParsed = parseDateFlexible(wStored || "", wLocale);
        const wFormatted = wParsed
            ? formatDateForLocale(wParsed, wLocale)
            : (wStored || "");
        painter.state.inputValue = wFormatted;
        painter.state.selectedDate = wFormatted;
        painter.state.lastValidDate = wParsed;
    },
});

// ============================================================================
export default SkCellClassCalendar; 