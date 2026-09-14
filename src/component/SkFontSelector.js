//=============================================================================
// SkFontSelector.js
// Modern Font Selector Component similar to Google Spreadsheet
//=============================================================================
import React from "react";
import { createPortal } from "react-dom";
import SkComponent from "./SkComponent";
import "./SkFontSelector.css";

let wFontAvailable = null;

const wFontCheck = new Set([
    // Windows 10
    'Roboto', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Cambria Math', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'HoloLens MDL2 Assets', 'Impact', 'Ink Free', 'Javanese Text', 'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett', 'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue', 'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti', 'MS Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe MDL2 Assets', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Historic', 'Segoe UI Emoji', 'Segoe UI Symbol', 'SimSun', 'Sitka', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic',
    // macOS
    'American Typewriter', 'Andale Mono', 'Arial', 'Arial Black', 'Arial Narrow', 'Arial Rounded MT Bold', 'Arial Unicode MS', 'Avenir', 'Avenir Next', 'Avenir Next Condensed', 'Baskerville', 'Big Caslon', 'Bodoni 72', 'Bodoni 72 Oldstyle', 'Bodoni 72 Smallcaps', 'Bradley Hand', 'Brush Script MT', 'Chalkboard', 'Chalkboard SE', 'Chalkduster', 'Charter', 'Cochin', 'Comic Sans MS', 'Copperplate', 'Courier', 'Courier New', 'Didot', 'DIN Alternate', 'DIN Condensed', 'Futura', 'Geneva', 'Georgia', 'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Herculanum', 'Hoefler Text', 'Impact', 'Lucida Grande', 'Luminari', 'Marker Felt', 'Menlo', 'Microsoft Sans Serif', 'Monaco', 'Noteworthy', 'Optima', 'Palatino', 'Papyrus', 'Phosphate', 'Rockwell', 'Savoye LET', 'SignPainter', 'Skia', 'Snell Roundhand', 'Tahoma', 'Times', 'Times New Roman', 'Trattatello', 'Trebuchet MS', 'Verdana', 'Zapfino',
    // Google Fonts equivalents
    'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans Pro', 'Raleway', 'PT Sans', 'Ubuntu', 'Noto Sans', 'Inter', 'Poppins', 'Merriweather', 'Playfair Display', 'Lora', 'Source Serif Pro', 'Crimson Text', 'Libre Baskerville', 'Bitter', 'Arvo', 'Josefin Sans', 'Abel', 'Oswald', 'Slabo 27px', 'Bree Serif', 'Pacifico', 'Dancing Script', 'Great Vibes', 'Satisfy', 'Kaushan Script', 'Permanent Marker', 'Caveat', 'Indie Flower', 'Shadows Into Light', 'Architects Daughter', 'Covered By Your Grace', 'Homemade Apple', 'Reenie Beanie', 'Patrick Hand', 'Just Another Hand', 'Rock Salt', 'Special Elite', 'VT323', 'Press Start 2P', 'Orbitron', 'Audiowide', 'Righteous', 'Bangers', 'Chewy', 'Fredoka One', 'Luckiest Guy', 'Comfortaa', 'Quicksand', 'Varela Round', 'Nunito', 'Work Sans', 'Rubik', 'Fira Sans', 'IBM Plex Sans', 'Titillium Web', 'Maven Pro', 'Exo 2', 'Rajdhani', 'Prompt', 'Kanit', 'Chakra Petch', 'Space Grotesk', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Inconsolata', 'Anonymous Pro', 'Cousine', 'Share Tech Mono', 'Roboto Mono', 'Ubuntu Mono', 'Overpass Mono', 'Red Hat Mono', 'IBM Plex Mono', 'Cascadia Code', 'Monaco', 'Menlo', 'Consolas', 'Courier New', 'Courier', 'monospace'
].sort());

// Font categories for better organization
const fontCategories = {
    'Sans Serif': ['Roboto', 'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Calibri', 'Segoe UI', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans Pro', 'Raleway', 'PT Sans', 'Ubuntu', 'Noto Sans', 'Inter', 'Poppins', 'Abel', 'Oswald', 'Quicksand', 'Varela Round', 'Nunito', 'Work Sans', 'Rubik', 'Fira Sans', 'IBM Plex Sans', 'Titillium Web', 'Maven Pro', 'Exo 2', 'Rajdhani', 'Prompt', 'Kanit', 'Chakra Petch', 'Space Grotesk'],
    'Serif': ['Times New Roman', 'Georgia', 'Palatino', 'Baskerville', 'Garamond', 'Bookman', 'New Century Schoolbook', 'American Typewriter', 'Bodoni 72', 'Didot', 'Hoefler Text', 'Libre Baskerville', 'Bitter', 'Arvo', 'Merriweather', 'Playfair Display', 'Lora', 'Source Serif Pro', 'Crimson Text', 'Bree Serif'],
    'Monospace': ['Courier New', 'Courier', 'Consolas', 'Monaco', 'Menlo', 'Lucida Console', 'Monaco', 'Andale Mono', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Inconsolata', 'Anonymous Pro', 'Cousine', 'Share Tech Mono', 'Roboto Mono', 'Ubuntu Mono', 'Overpass Mono', 'Red Hat Mono', 'IBM Plex Mono', 'Cascadia Code'],
    'Display': ['Impact', 'Comic Sans MS', 'Brush Script MT', 'Chalkboard', 'Papyrus', 'Marker Felt', 'Bradley Hand', 'Snell Roundhand', 'Zapfino', 'Pacifico', 'Dancing Script', 'Great Vibes', 'Satisfy', 'Kaushan Script', 'Permanent Marker', 'Caveat', 'Indie Flower', 'Shadows Into Light', 'Architects Daughter', 'Covered By Your Grace', 'Homemade Apple', 'Reenie Beanie', 'Patrick Hand', 'Just Another Hand', 'Rock Salt', 'Special Elite', 'VT323', 'Press Start 2P', 'Orbitron', 'Audiowide', 'Righteous', 'Bangers', 'Chewy', 'Fredoka One', 'Luckiest Guy', 'Comfortaa']
};

const fontSizeOptions = [
    { value: '8', label: '8', size: '8px' },
    { value: '9', label: '9', size: '9px' },
    { value: '10', label: '10', size: '10px' },
    { value: '11', label: '11', size: '11px' },
    { value: '12', label: '12', size: '12px' },
    { value: '14', label: '14', size: '14px' },
    { value: '16', label: '16', size: '16px' },
    { value: '18', label: '18', size: '18px' },
    { value: '20', label: '20', size: '20px' },
    { value: '22', label: '22', size: '22px' },
    { value: '24', label: '24', size: '24px' },
    { value: '26', label: '26', size: '26px' },
    { value: '28', label: '28', size: '28px' },
    { value: '30', label: '30', size: '30px' },
    { value: '32', label: '32', size: '32px' },
    { value: '34', label: '34', size: '34px' },
    { value: '36', label: '36', size: '36px' },
    { value: '40', label: '40', size: '40px' },
    { value: '48', label: '48', size: '48px' },
    { value: '56', label: '56', size: '56px' },
    { value: '64', label: '64', size: '64px' },
    { value: '72', label: '72', size: '72px' },
    { value: '96', label: '96', size: '96px' },
    { value: '120', label: '120', size: '120px' },
    { value: '144', label: '144', size: '144px' },
    { value: '288', label: '288', size: '288px' }
];

class SkFontSelector extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            fontName: "Roboto",
            fontSize: "11",
            highlightedFontName: null,
            highlightedFontSize: null,
            isFontDropdownOpen: false,
            isSizeDropdownOpen: false,
            searchTerm: "",
            selectedCategory: "All",
            fontDropdownPos: { top: 0, left: 0 },
            sizeDropdownPos: { top: 0, left: 0 },
        };

        this.SelectFont = this.props.SelectFont;
        this.SelectFontSize = this.props.SelectFontSize;
        this.fontButtonRef = React.createRef();
        this.sizeButtonRef = React.createRef();
        this.fontDropdownRef = React.createRef();
        this.sizeDropdownRef = React.createRef();
        this.searchInputRef = React.createRef();
        this.m_FontWheelEl = null;
        this.m_SizeWheelEl = null;

        this.m_Fonts = wFontAvailable;

        this.setState({ fontName: "Roboto", fontSize: "11" });
    }

    componentDidMount() {
        document.addEventListener('mousedown', this.handleClickOutside, true);
        window.addEventListener('scroll', this.updateDropdownPositions, true);
        window.addEventListener('resize', this.updateDropdownPositions);
        this.initializeFonts();
    }

    componentDidUpdate(prevProps, prevState) {
        if (this.state.isFontDropdownOpen && !prevState.isFontDropdownOpen) {
            this.updateFontDropdownPosition();
        }
        if (this.state.isSizeDropdownOpen && !prevState.isSizeDropdownOpen) {
            this.updateSizeDropdownPosition();
        }
        if (this.state.isFontDropdownOpen) {
            this.bindFontDropdownWheel();
            if (!this.m_FontWheelEl) {
                requestAnimationFrame(() => this.bindFontDropdownWheel());
            }
        } else if (prevState.isFontDropdownOpen) {
            this.unbindFontDropdownWheel();
        }
        if (this.state.isSizeDropdownOpen) {
            this.bindSizeDropdownWheel();
            if (!this.m_SizeWheelEl) {
                requestAnimationFrame(() => this.bindSizeDropdownWheel());
            }
        } else if (prevState.isSizeDropdownOpen) {
            this.unbindSizeDropdownWheel();
        }
        if (
            this.state.isSizeDropdownOpen &&
            prevState.highlightedFontSize !== this.state.highlightedFontSize
        ) {
            requestAnimationFrame(() => this.scrollSizeOptionIntoView());
        }
        if (
            this.state.isFontDropdownOpen &&
            prevState.highlightedFontName !== this.state.highlightedFontName
        ) {
            requestAnimationFrame(() => this.scrollFontOptionIntoView());
        }
    }

    componentWillUnmount() {
        document.removeEventListener('mousedown', this.handleClickOutside, true);
        window.removeEventListener('scroll', this.updateDropdownPositions, true);
        window.removeEventListener('resize', this.updateDropdownPositions);
        this.unbindFontDropdownWheel();
        this.unbindSizeDropdownWheel();
    }

    syncFont(sFontName, sFontSize) {
        const wNext = {};
        if (sFontName && sFontName !== this.state.fontName) {
            wNext.fontName = sFontName;
        }
        if (sFontSize !== undefined && sFontSize !== null) {
            const wSize = String(sFontSize).replace(/(pt|px)$/i, "");
            if (wSize !== this.state.fontSize) {
                wNext.fontSize = wSize;
            }
        }
        if (Object.keys(wNext).length > 0) {
            this.setState(wNext);
        }
    }

    initializeFonts = async () => {
        await document.fonts.ready;

        wFontAvailable = new Set();

        for (const wFont of wFontCheck.values()) {
            if (document.fonts.check(`12px "${wFont}"`)) {
                wFontAvailable.add(wFont);
            }
        }

        this.m_Fonts = wFontAvailable;
        this.forceUpdate();
    }

    updateDropdownPositions = () => {
        if (this.state.isFontDropdownOpen) {
            this.updateFontDropdownPosition();
        }
        if (this.state.isSizeDropdownOpen) {
            this.updateSizeDropdownPosition();
        }
    }

    updateFontDropdownPosition = () => {
        requestAnimationFrame(() => {
            const wButton = this.fontButtonRef.current;
            if (!wButton) {
                return;
            }
            const wRect = wButton.getBoundingClientRect();
            this.setState({
                fontDropdownPos: {
                    top: wRect.bottom + 4,
                    left: wRect.left,
                },
            });
        });
    }

    updateSizeDropdownPosition = () => {
        requestAnimationFrame(() => {
            const wButton = this.sizeButtonRef.current;
            if (!wButton) {
                return;
            }
            const wRect = wButton.getBoundingClientRect();
            const wWidth = Math.max(120, wRect.width);
            this.setState({
                sizeDropdownPos: {
                    top: wRect.bottom + 4,
                    left: wRect.right - wWidth,
                },
            }, () => {
                requestAnimationFrame(() => this.scrollSizeOptionIntoView());
            });
        });
    }

    handleClickOutside = (event) => {
        const wTarget = event.target;
        const wOnFontButton = wTarget?.closest?.('.Sk-font-selector-button');
        const wOnSizeButton = wTarget?.closest?.('.Sk-size-selector-button');
        const wInFontPopup = this.fontDropdownRef.current?.contains(wTarget);
        const wInSizePopup = this.sizeDropdownRef.current?.contains(wTarget);

        if (wOnSizeButton && this.state.isFontDropdownOpen) {
            this.setState({ isFontDropdownOpen: false, highlightedFontName: null });
        }
        if (wOnFontButton && this.state.isSizeDropdownOpen) {
            this.setState({ isSizeDropdownOpen: false, highlightedFontSize: null });
        }
        if (!wInFontPopup && !wOnFontButton && this.state.isFontDropdownOpen) {
            this.setState({ isFontDropdownOpen: false, highlightedFontName: null });
        }
        if (!wInSizePopup && !wOnSizeButton && this.state.isSizeDropdownOpen) {
            this.setState({ isSizeDropdownOpen: false, highlightedFontSize: null });
        }
    }

    bindFontDropdownWheel = () => {
        const wEl = this.fontDropdownRef.current;
        if (!wEl || this.m_FontWheelEl === wEl) {
            return;
        }
        this.unbindFontDropdownWheel();
        this.handleFontDropdownWheel = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.stepFontNameInList(event.deltaY > 0 ? 1 : -1);
        };
        wEl.addEventListener('wheel', this.handleFontDropdownWheel, { passive: false, capture: true });
        this.m_FontWheelEl = wEl;
    }

    unbindFontDropdownWheel = () => {
        if (this.m_FontWheelEl && this.handleFontDropdownWheel) {
            this.m_FontWheelEl.removeEventListener('wheel', this.handleFontDropdownWheel, { capture: true });
        }
        this.m_FontWheelEl = null;
        this.handleFontDropdownWheel = null;
    }

    bindSizeDropdownWheel = () => {
        const wEl = this.sizeDropdownRef.current;
        if (!wEl || this.m_SizeWheelEl === wEl) {
            return;
        }
        this.unbindSizeDropdownWheel();
        this.handleSizeDropdownWheel = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.stepFontSize(event.deltaY > 0 ? 1 : -1);
        };
        wEl.addEventListener('wheel', this.handleSizeDropdownWheel, { passive: false, capture: true });
        this.m_SizeWheelEl = wEl;
    }

    unbindSizeDropdownWheel = () => {
        if (this.m_SizeWheelEl && this.handleSizeDropdownWheel) {
            this.m_SizeWheelEl.removeEventListener('wheel', this.handleSizeDropdownWheel, { capture: true });
        }
        this.m_SizeWheelEl = null;
        this.handleSizeDropdownWheel = null;
    }

    scrollSizeOptionIntoView = () => {
        const wRoot = this.sizeDropdownRef.current;
        if (!wRoot) {
            return;
        }
        const wHighlight = this.state.highlightedFontSize ?? this.state.fontSize;
        const wSelected = wRoot.querySelector(`[data-size-value="${wHighlight}"]`);
        if (wSelected) {
            wSelected.scrollIntoView({ block: 'nearest' });
        }
    }

    scrollFontOptionIntoView = () => {
        const wRoot = this.fontDropdownRef.current;
        if (!wRoot) {
            return;
        }
        const wHighlight = this.state.highlightedFontName ?? this.state.fontName;
        const wOptions = wRoot.querySelectorAll('.Sk-font-option');
        for (const wOption of wOptions) {
            if (wOption.textContent === wHighlight) {
                wOption.scrollIntoView({ block: 'nearest' });
                break;
            }
        }
    }

    stepFontSize = (delta) => {
        const wValues = fontSizeOptions.map((option) => option.value);
        const wCurrent = this.state.highlightedFontSize ?? this.state.fontSize;
        const wCurrentIndex = wValues.indexOf(wCurrent);
        const wBaseIndex = wCurrentIndex >= 0 ? wCurrentIndex : 0;
        const wNextIndex = Math.max(0, Math.min(wValues.length - 1, wBaseIndex + delta));
        if (wNextIndex === wBaseIndex) {
            return;
        }
        this.setState({ highlightedFontSize: wValues[wNextIndex] });
    }

    stepFontNameInList = (delta) => {
        const wFonts = this.getFilteredFonts();
        if (wFonts.length === 0) {
            return;
        }
        const wCurrent = this.state.highlightedFontName ?? this.state.fontName;
        let wCurrentIndex = wFonts.indexOf(wCurrent);
        if (wCurrentIndex < 0) {
            wCurrentIndex = 0;
        }
        const wNextIndex = Math.max(0, Math.min(wFonts.length - 1, wCurrentIndex + delta));
        if (wNextIndex === wCurrentIndex) {
            return;
        }
        this.setState({ highlightedFontName: wFonts[wNextIndex] });
    }

    handleFontKeyDown = (event) => {
        if (!this.state.isFontDropdownOpen) {
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            this.stepFontNameInList(-1);
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            this.stepFontNameInList(1);
        }
    }

    handleSizeKeyDown = (event) => {
        if (!this.state.isSizeDropdownOpen) {
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            this.stepFontSize(-1);
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            this.stepFontSize(1);
        }
    }

    toggleFontDropdown = () => {
        this.setState((prevState) => {
            const wOpening = !prevState.isFontDropdownOpen;
            return {
                isFontDropdownOpen: wOpening,
                isSizeDropdownOpen: false,
                highlightedFontSize: null,
                searchTerm: "",
                highlightedFontName: wOpening ? prevState.fontName : null,
            };
        }, () => {
            if (this.state.isFontDropdownOpen) {
                setTimeout(() => this.searchInputRef.current?.focus(), 100);
            }
        });
    }

    toggleSizeDropdown = () => {
        this.setState((prevState) => {
            const wOpening = !prevState.isSizeDropdownOpen;
            return {
                isSizeDropdownOpen: wOpening,
                isFontDropdownOpen: false,
                highlightedFontName: null,
                highlightedFontSize: wOpening ? prevState.fontSize : null,
            };
        });
    }

    applyFont = (fontName) => {
        this.setState({
            fontName,
            isFontDropdownOpen: false,
            highlightedFontName: null,
            searchTerm: "",
        }, () => {
            if (this.SelectFont) {
                this.SelectFont(null, fontName, `${this.state.fontSize}pt`);
            }
        });
    }

    selectFont = (fontName) => {
        this.applyFont(fontName);
    }

    applyFontSize = (fontSize) => {
        this.setState({
            fontSize,
            isSizeDropdownOpen: false,
            highlightedFontSize: null,
        }, () => {
            if (this.SelectFontSize) {
                this.SelectFontSize(null, this.state.fontName, `${fontSize}pt`);
            }
        });
    }

    selectFontSize = (fontSize) => {
        this.applyFontSize(fontSize);
    }

    handleSearchChange = (event) => {
        const wSearchTerm = event.target.value;
        const wFonts = this.getFilteredFontsForSearch(wSearchTerm, this.state.selectedCategory);
        this.setState({
            searchTerm: wSearchTerm,
            highlightedFontName: wFonts[0] ?? this.state.fontName,
        });
    }

    handleCategoryChange = (event) => {
        const wCategory = event.target.value;
        const wFonts = this.getFilteredFontsForSearch(this.state.searchTerm, wCategory);
        this.setState({
            selectedCategory: wCategory,
            highlightedFontName: wFonts[0] ?? this.state.fontName,
        });
    }

    getFilteredFontsForSearch = (searchTerm, selectedCategory) => {
        let fonts = Array.from(this.m_Fonts || []);

        if (selectedCategory !== "All") {
            fonts = fonts.filter(font =>
                fontCategories[selectedCategory]?.includes(font)
            );
        }

        if (searchTerm) {
            fonts = fonts.filter(font =>
                font.toLowerCase().includes(String(searchTerm).toLowerCase())
            );
        }

        return fonts;
    }

    getFilteredFonts = () => {
        return this.getFilteredFontsForSearch(this.state.searchTerm, this.state.selectedCategory);
    }

    renderFontDropdown() {
        const filteredFonts = this.getFilteredFonts();
        const { fontDropdownPos, highlightedFontName, fontName } = this.state;
        const wHighlight = highlightedFontName ?? fontName;

        return createPortal(
            <div
                className="Sk-font-dropdown Sk-font-dropdown--portal"
                ref={this.fontDropdownRef}
                style={{
                    position: 'fixed',
                    top: `${fontDropdownPos.top}px`,
                    left: `${fontDropdownPos.left}px`,
                    zIndex: 2000,
                }}
            >
                <div className="Sk-font-dropdown-header">
                    <input
                        ref={this.searchInputRef}
                        type="text"
                        placeholder="Search fonts..."
                        value={this.state.searchTerm}
                        onChange={this.handleSearchChange}
                        className="Sk-font-search-input"
                    />
                    <select
                        value={this.state.selectedCategory}
                        onChange={this.handleCategoryChange}
                        className="Sk-font-category-select"
                    >
                        <option value="All">All Fonts</option>
                        {Object.keys(fontCategories).map(category => (
                            <option key={category} value={category}>{category}</option>
                        ))}
                    </select>
                </div>
                <div className="Sk-font-list">
                    {filteredFonts.map((font, index) => (
                        <div
                            key={index}
                            className={`Sk-font-option${wHighlight === font ? ' selected' : ''}${fontName === font ? ' applied' : ''}`}
                            onClick={() => this.selectFont(font)}
                            style={{ fontFamily: font }}
                        >
                            {font}
                        </div>
                    ))}
                    {filteredFonts.length === 0 && (
                        <div className="Sk-no-fonts-found">No fonts found</div>
                    )}
                </div>
            </div>,
            document.body
        );
    }

    renderSizeDropdown() {
        const { sizeDropdownPos, highlightedFontSize, fontSize } = this.state;
        const wHighlight = highlightedFontSize ?? fontSize;

        return createPortal(
            <div
                className="Sk-size-dropdown Sk-size-dropdown--portal"
                ref={this.sizeDropdownRef}
                style={{
                    position: 'fixed',
                    top: `${sizeDropdownPos.top}px`,
                    left: `${sizeDropdownPos.left}px`,
                    zIndex: 2000,
                    minWidth: '120px',
                }}
            >
                <div className="Sk-size-list">
                    {fontSizeOptions.map((option) => (
                        <div
                            key={option.value}
                            data-size-value={option.value}
                            className={`Sk-size-option${wHighlight === option.value ? ' selected' : ''}${fontSize === option.value ? ' applied' : ''}`}
                            onClick={() => this.selectFontSize(option.value)}
                        >
                            {option.label}
                        </div>
                    ))}
                </div>
            </div>,
            document.body
        );
    }

    render() {
        const { fontName, fontSize, isFontDropdownOpen, isSizeDropdownOpen } = this.state;

        return (
            <div className="Sk-font-selector">
                <div className="Sk-font-selector-container">
                    <div className={`Sk-font-selector-dropdown${isFontDropdownOpen ? ' open' : ''}`}>
                        <button
                            type="button"
                            ref={this.fontButtonRef}
                            className="Sk-font-selector-button"
                            tabIndex={0}
                            aria-haspopup="listbox"
                            aria-expanded={isFontDropdownOpen}
                            onClick={this.toggleFontDropdown}
                            onKeyDown={this.handleFontKeyDown}
                            style={{ fontFamily: fontName }}
                        >
                            <span className="Sk-font-name">{fontName}</span>
                            <span className="Sk-dropdown-arrow">▼</span>
                        </button>
                        {isFontDropdownOpen && this.renderFontDropdown()}
                    </div>
                </div>

                <div className="Sk-size-selector-container">
                    <div className={`Sk-size-selector-dropdown${isSizeDropdownOpen ? ' open' : ''}`}>
                        <button
                            type="button"
                            ref={this.sizeButtonRef}
                            className="Sk-size-selector-button"
                            tabIndex={0}
                            aria-haspopup="listbox"
                            aria-expanded={isSizeDropdownOpen}
                            onClick={this.toggleSizeDropdown}
                            onKeyDown={this.handleSizeKeyDown}
                        >
                            <span className="Sk-size-value">{fontSize}</span>
                            <span className="Sk-dropdown-arrow">▼</span>
                        </button>
                        {isSizeDropdownOpen && this.renderSizeDropdown()}
                    </div>
                </div>
            </div>
        );
    }

    FontName() {
        return this.state.fontName;
    }

    FontSize() {
        return this.state.fontSize;
    }
}

export default SkFontSelector;
