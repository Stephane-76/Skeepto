//=============================================================================
// SkFunctionSelector
// PopUp component to select and input spreadsheet functions
// Reads functions.json as a static asset from public/ (=> build/), served at the app root
// Author: Stéphane ALLEZ
//=============================================================================
import React from "react";
import PropTypes from "prop-types";
import SkComponent from './SkComponent';
import SkPopUp from './SkPopUp';
import SkButton from './SkButton';
import { SkInput } from './SkInput';
import SkSpInplaceEdit from '../spreadsheet/SkSpInplaceEdit';
import './SkComponent.css';
import './SkFunctionSelector.css';

class SkFunctionSelector extends SkComponent {
    constructor(props) {
        super(props);
        this.m_Label = props.label || "Function Selector";
        this.m_OnSelect = props.onSelect || null; // Callback when function is selected
        this.m_SpInterface = props.SpInterface || null;

        // Array of refs, one per argument, pointing to the SkSpInplaceEdit
        // instance that drives that argument's input. Refs are rebuilt each
        // time the user picks a different function (see handleFunctionSelect).
        this.m_ArgRefs = [];

        // Ref for the target cell input: the cell that will actually
        // receive the generated formula once the user validates.
        this.m_TargetRef = React.createRef();

        // In embedded mode the selector is rendered inline inside the right
        // command panel (no SkPopUp wrapper, no internal show/hide gating).
        const wEmbedded = props.embedded === true;

        this.state = {
            show: wEmbedded || props.show || false,
            functions: null,
            categories: [],
            selectedCategory: null,
            selectedFunction: null,
            functionArguments: [],
            searchQuery: '',
            // Text currently displayed in the Target input (cell to which
            // the formula will be written on validation). Kept in sync
            // with the uncontrolled SkSpInplaceEdit via onTextChange.
            targetRef: '',
            loading: false,
            error: null
        };
    }

    componentDidMount() {
        if (this.state.show) {
            this.loadFunctions();
        }
        this.initTargetFromCursor();
    }

    // Seed the target input with the current spreadsheet cursor so the
    // default destination is the cell the user already has selected.
    initTargetFromCursor() {
        if (!this.m_SpInterface || !this.m_SpInterface.m_Select) return;
        try {
            const wCursor = this.m_SpInterface.m_Select.cursorStr();
            if (wCursor && wCursor !== this.state.targetRef) {
                this.setState({ targetRef: wCursor }, () => {
                    const wRef = this.m_TargetRef.current;
                    if (wRef && typeof wRef.setText === 'function') {
                        try { wRef.setText(wCursor); } catch (e) { /* best effort */ }
                    }
                });
            }
        } catch (e) {
            // Interface not ready yet; leave the field empty.
        }
    }

    componentDidUpdate(prevProps) {
        if (this.props.embedded) return; // always visible when embedded
        if (this.props.show !== prevProps.show && this.props.show) {
            this.setState({ show: true });
            this.loadFunctions();
        } else if (this.props.show !== prevProps.show && !this.props.show) {
            this.setState({ show: false });
        }
    }

    // Load functions.json — a static reference asset shipped in public/ (=> build/),
    // served at the app root in both web and desktop (Electron) modes, exactly like
    // the SkReactSpreadSheet.mjs / .wasm engine files.
    async loadFunctions() {
        this.setState({ loading: true, error: null });

        try {
            const wUrl = `${process.env.PUBLIC_URL || ''}/functions.json`;
            const wResponse = await fetch(wUrl);
            if (!wResponse.ok) {
                this.setState({ error: 'File not found or empty', loading: false });
                return;
            }
            const wFunctionsData = await wResponse.json();

            if (wFunctionsData && wFunctionsData.functions) {
                const wCategories = Object.keys(wFunctionsData.functions);
                this.setState({
                    functions: wFunctionsData.functions,
                    categories: wCategories,
                    selectedCategory: wCategories.length > 0 ? wCategories[0] : null,
                    loading: false,
                    error: null
                });
            } else {
                this.setState({ error: 'Invalid functions.json format', loading: false });
            }
        } catch (error) {
            console.error('Error loading functions.json:', error);
            this.setState({ 
                error: `Failed to load functions: ${error.message}`, 
                loading: false 
            });
        }
    }

    /** Match name / label / description / syntax against the search radical. */
    functionMatchesQuery(func, sQuery) {
        if (!sQuery) {
            return true;
        }
        const wQuery = sQuery.toLowerCase();
        return (
            func.name.toLowerCase().includes(wQuery) ||
            (func.label && func.label.toLowerCase().includes(wQuery)) ||
            (func.description && func.description.toLowerCase().includes(wQuery)) ||
            (func.syntax && func.syntax.toLowerCase().includes(wQuery))
        );
    }

    // Get filtered functions: category list when idle; all categories when searching.
    getFilteredFunctions() {
        const { functions, selectedCategory, searchQuery } = this.state;
        if (!functions) return [];

        const wQuery = String(searchQuery || "").trim();
        if (!wQuery) {
            if (!selectedCategory) return [];
            return functions[selectedCategory] || [];
        }

        const wOut = [];
        const wSeen = new Set();
        for (const wCategory of Object.keys(functions)) {
            const wList = functions[wCategory] || [];
            for (const wFunc of wList) {
                const wName = String(wFunc?.name || "").toUpperCase();
                if (!wName || wSeen.has(wName)) {
                    continue;
                }
                if (this.functionMatchesQuery(wFunc, wQuery)) {
                    wSeen.add(wName);
                    wOut.push({ ...wFunc, _category: wCategory });
                }
            }
        }
        wOut.sort((a, b) => {
            const wA = a.name.toUpperCase();
            const wB = b.name.toUpperCase();
            const wQ = wQuery.toUpperCase();
            // Prefer exact / prefix matches (Excel-like).
            const wScore = (sName) => {
                if (sName === wQ) return 0;
                if (sName.startsWith(wQ)) return 1;
                return 2;
            };
            const wDiff = wScore(wA) - wScore(wB);
            return wDiff !== 0 ? wDiff : wA.localeCompare(wB);
        });
        return wOut;
    }

    handleSearchChange = (event) => {
        this.setState({ searchQuery: event.target.value });
    }

    /** Enter in Search: select the best match (first filtered row). */
    handleSearchKeyDown = (event) => {
        if (event.key !== "Enter") {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const wFiltered = this.getFilteredFunctions();
        if (wFiltered.length === 0) {
            return;
        }
        this.handleFunctionSelect(wFiltered[0]);
    }

    // Handle category selection
    handleCategoryChange = (event) => {
        const wCategory = event.target.value;
        this.setState({ 
            selectedCategory: wCategory,
            selectedFunction: null,
            functionArguments: [],
            searchQuery: ''
        });
    }

    // Handle function selection
    handleFunctionSelect = (func) => {
        const wArgs = func.arguments || [];
        const wInitialArgs = wArgs.map(arg => ({ 
            name: arg.name, 
            value: '', 
            type: arg.type,
            required: arg.required !== false,
            description: arg.description || ''
        }));

        // Rebuild the argument ref array so each input gets a fresh
        // SkSpInplaceEdit instance (wired to this specific argument).
        this.m_ArgRefs = wInitialArgs.map(() => React.createRef());

        const wNext = {
            selectedFunction: func,
            functionArguments: wInitialArgs,
        };
        // Keep category in sync when the hit comes from a cross-category search.
        if (func._category && func._category !== this.state.selectedCategory) {
            wNext.selectedCategory = func._category;
        }
        this.setState(wNext);
    }

    // Handle argument value change
    handleArgumentChange = (index, value) => {
        const wArgs = [...this.state.functionArguments];
        if (!wArgs[index]) return;
        if (wArgs[index].value === value) return;
        wArgs[index].value = value;
        this.setState({ functionArguments: wArgs });
    }

    // Format one argument for the formula string.
    // String args must use Excel double quotes ("..."); single quotes are for
    // sheet refs ('Sheet'!A1) and break the lexer when used as string literals
    // with mismatched / typographic closers.
    formatFormulaArgument(arg) {
        let wValue = String(arg.value ?? '').trim();
        if (wValue === '') return '';

        const wType = String(arg.type || '').toLowerCase();
        if (wType !== 'string' && wType !== 'text') {
            return wValue;
        }

        // Strip one layer of wrapping quotes the user may have typed.
        if (
            (wValue.startsWith('"') && wValue.endsWith('"') && wValue.length >= 2) ||
            (wValue.startsWith("'") && wValue.endsWith("'") && wValue.length >= 2)
        ) {
            wValue = wValue.slice(1, -1);
        }

        // Escape embedded double quotes by doubling them (Excel style).
        return `"${wValue.replace(/"/g, '""')}"`;
    }

    // Generate function formula
    generateFormula() {
        const { selectedFunction, functionArguments } = this.state;
        if (!selectedFunction) return '';

        const wArgs = functionArguments
            .map((arg) => this.formatFormulaArgument(arg))
            .filter((val) => val !== '')
            .join(', ');

        return `${selectedFunction.name}(${wArgs})`;
    }

    // Pull the live values from every argument's SkSpInplaceEdit into
    // this.state.functionArguments so that the preview and the inserted
    // formula reflect any text the user typed or picked on the grid but
    // that was not yet flushed through onTextChange.
    syncArgumentsFromRefs() {
        if (!this.m_SpInterface) return;
        const wArgs = [...this.state.functionArguments];
        let wChanged = false;
        this.m_ArgRefs.forEach((wRef, i) => {
            if (!wRef || !wRef.current) return;
            if (typeof wRef.current.text !== "function") return;
            try {
                const wVal = wRef.current.text();
                if (wArgs[i] && wArgs[i].value !== wVal) {
                    wArgs[i].value = wVal;
                    wChanged = true;
                }
            } catch (e) {
                // Ignore, the input may be unmounted.
            }
        });
        if (wChanged) {
            this.setState({ functionArguments: wArgs });
        }
    }

    // Read the live target ref straight from the SkSpInplaceEdit so a
    // grid pick that hasn't yet flushed through onTextChange is still
    // honored on validation.
    getTargetRef() {
        const wRef = this.m_TargetRef.current;
        if (wRef && typeof wRef.text === 'function') {
            try {
                const wVal = wRef.text();
                if (wVal && wVal.trim()) return wVal.trim();
            } catch (e) {
                // Fall through to state.
            }
        }
        return (this.state.targetRef || '').trim();
    }

    handleTargetChange = (val) => {
        if (val !== this.state.targetRef) {
            this.setState({ targetRef: val });
        }
    }

    // Handle insert button click
    handleInsert = async () => {
        this.syncArgumentsFromRefs();
        const wTarget = this.getTargetRef();
        // End any currently-active property-level edit so the grid stops
        // redirecting keyboard/mouse selections to one of our argument
        // inputs after the formula has been inserted.
        if (this.m_SpInterface) {
            try {
                await this.m_SpInterface.endEdit();
            } catch (e) {
                // Best effort; endEdit is a no-op when no edit is active.
            }
        }
        const wFormula = this.generateFormula();
        if (wFormula && this.m_OnSelect) {
            this.m_OnSelect(wFormula, wTarget || null);
        }
        if (this.props.onClose) {
            this.props.onClose();
        }
        if (!this.props.embedded) {
            this.setState({ show: false });
        }
    }

    // Handle close (or reset in embedded mode)
    handleClose = () => {
        if (this.props.onClose) {
            this.props.onClose();
        }
        if (this.props.embedded) {
            // Embedded mode has no close semantic: clear the current selection instead.
            this.setState({ selectedFunction: null, functionArguments: [], searchQuery: '' });
            return;
        }
        this.setState({ show: false });
    }

    render() {
        const wEmbedded = this.props.embedded === true;
        if (!wEmbedded && !this.state.show) return null;

        const { 
            categories, 
            selectedCategory, 
            selectedFunction, 
            functionArguments,
            searchQuery,
            loading,
            error
        } = this.state;

        const wFilteredFunctions = this.getFilteredFunctions();
        const wFormula = this.generateFormula();

        const wRootClass = [
            'SkFunctionSelector',
            wEmbedded ? 'SkFunctionSelector--embedded' : '',
        ].filter(Boolean).join(' ');

        const wInner = (
                <div className={wRootClass}>
                    {loading && (
                        <div className="SkFunctionSelector-loading">
                            Loading functions...
                        </div>
                    )}

                    {error && (
                        <div className="SkFunctionSelector-error">
                            {error}
                        </div>
                    )}

                    {!loading && !error && (
                        <>
                            {/* Category selector */}
                            <div className="SkFunctionSelector-field">
                                <label className="SkFunctionSelector-label">
                                    Category:
                                </label>
                                <select
                                    className="SkFunctionSelector-select"
                                    value={selectedCategory || ''}
                                    onChange={this.handleCategoryChange}
                                >
                                    {categories.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Search input */}
                            <div className="SkFunctionSelector-field">
                                <label className="SkFunctionSelector-label">
                                    Search:
                                </label>
                                <SkInput
                                    value={searchQuery}
                                    onChange={this.handleSearchChange}
                                    onKeyDown={this.handleSearchKeyDown}
                                    placeholder="Search functions..."
                                    style={{ width: '100%' }}
                                />
                            </div>

                            {/* Target cell: where the formula will be applied */}
                            {this.m_SpInterface && (
                                <div className="SkFunctionSelector-field">
                                    <label className="SkFunctionSelector-label">
                                        Target:
                                    </label>
                                    <div className="SkFunctionSelector-targetRow">
                                        <div className="SkFunctionSelector-targetInput">
                                            <SkSpInplaceEdit
                                                ref={this.m_TargetRef}
                                                static="true"
                                                AcceptSelection="true"
                                                SpInterface={this.m_SpInterface}
                                                Id="InplaceEditFuncTarget"
                                                Property="functionTarget"
                                                Text={this.state.targetRef}
                                                placeholder="Pick a target cell"
                                                rows={1}
                                                className="SkSpInplaceEditStatic--panel"
                                                style={{ width: '100%', margin: 0 }}
                                                onTextChange={this.handleTargetChange}
                                            />
                                        </div>
                                        <SkButton
                                            className={[
                                                'SkFunctionSelector-applyBtn',
                                                wFormula ? 'is-enabled' : '',
                                            ].filter(Boolean).join(' ')}
                                            onClick={this.handleInsert}
                                            disabled={!wFormula}
                                            title={wFormula
                                                ? 'Apply formula to target cell'
                                                : 'Pick a function first'}
                                        >
                                            ✓
                                        </SkButton>
                                    </div>
                                </div>
                            )}

                            {/* Functions list */}
                            <div className="SkFunctionSelector-list">
                                {wFilteredFunctions.map((func, index) => (
                                    <div
                                        key={index}
                                        className={[
                                            'SkFunctionSelector-listItem',
                                            selectedFunction === func ? 'is-selected' : '',
                                        ].filter(Boolean).join(' ')}
                                        onClick={() => this.handleFunctionSelect(func)}
                                    >
                                        <div className="SkFunctionSelector-listTitle">
                                            {func.name}
                                            {func.label && ` - ${func.label}`}
                                        </div>
                                        {func.syntax && (
                                            <div className="SkFunctionSelector-listSyntax">
                                                {func.syntax}
                                            </div>
                                        )}
                                        {func.description && (
                                            <div className="SkFunctionSelector-listDesc">
                                                {func.description}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Selected function details */}
                            {selectedFunction && (
                                <div className="SkFunctionSelector-detail">
                                    <div className="SkFunctionSelector-detailTitle">
                                        {selectedFunction.name}
                                    </div>
                                    {selectedFunction.description && (
                                        <div className="SkFunctionSelector-detailDesc">
                                            {selectedFunction.description}
                                        </div>
                                    )}

                                    {/* Arguments input */}
                                    {functionArguments.length > 0 && (
                                        <div>
                                            <div className="SkFunctionSelector-argsTitle">
                                                Arguments:
                                            </div>
                                            {functionArguments.map((arg, index) => {
                                                const wType = String(arg.type || '').toLowerCase();
                                                const wIsString = wType === 'string' || wType === 'text';
                                                const wPlaceholder = wIsString
                                                    ? `${arg.name} (quotes added automatically)`
                                                    : `Enter ${arg.name}`;
                                                return (
                                                <div key={index} className="SkFunctionSelector-argBlock">
                                                    <label className="SkFunctionSelector-argLabel">
                                                        {arg.name}
                                                        {arg.required && (
                                                            <span className="SkFunctionSelector-argRequired"> *</span>
                                                        )}
                                                        {arg.type && (
                                                            <span className="SkFunctionSelector-argType">
                                                                ({arg.type})
                                                            </span>
                                                        )}
                                                    </label>
                                                    {arg.description && (
                                                        <div className="SkFunctionSelector-argHint">
                                                            {arg.description}
                                                        </div>
                                                    )}
                                                    {this.m_SpInterface ? (
                                                        <SkSpInplaceEdit
                                                            ref={this.m_ArgRefs[index]}
                                                            static="true"
                                                            AcceptSelection="true"
                                                            SpInterface={this.m_SpInterface}
                                                            Id={`InplaceEditFuncArg_${selectedFunction.name}_${index}`}
                                                            Property={`functionArg_${index}`}
                                                            Text={arg.value}
                                                            placeholder={wPlaceholder}
                                                            rows={1}
                                                            className="SkSpInplaceEditStatic--panel"
                                                            style={{ width: '100%', margin: 0 }}
                                                            onTextChange={(val) => this.handleArgumentChange(index, val)}
                                                        />
                                                    ) : (
                                                        <SkInput
                                                            value={arg.value}
                                                            onChange={(e) => this.handleArgumentChange(index, e.target.value)}
                                                            placeholder={wPlaceholder}
                                                            style={{ width: '100%' }}
                                                        />
                                                    )}
                                                </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Generated formula preview */}
                            {wFormula && (
                                <div className="SkFunctionSelector-preview">
                                    <div className="SkFunctionSelector-previewLabel">
                                        Formula:
                                    </div>
                                    <div className="SkFunctionSelector-previewFormula">
                                        {wFormula}
                                    </div>
                                </div>
                            )}

                            {/* Buttons */}
                            <div className="SkFunctionSelector-actions">
                                <SkButton onClick={this.handleClose}>
                                    {wEmbedded ? 'Reset' : 'Cancel'}
                                </SkButton>
                                <SkButton
                                    className={[
                                        'SkFunctionSelector-insertBtn',
                                        wFormula ? 'is-enabled' : '',
                                    ].filter(Boolean).join(' ')}
                                    onClick={this.handleInsert}
                                    disabled={!wFormula}
                                >
                                    Insert
                                </SkButton>
                            </div>
                        </>
                    )}
                </div>
        );

        if (wEmbedded) {
            return wInner;
        }
        return (
            <SkPopUp Label={this.m_Label}>
                {wInner}
            </SkPopUp>
        );
    }
}

SkFunctionSelector.propTypes = {
    show: PropTypes.bool,
    embedded: PropTypes.bool,
    label: PropTypes.string,
    onSelect: PropTypes.func,
    onClose: PropTypes.func,
    // eslint-disable-next-line react/forbid-prop-types
    SpInterface: PropTypes.object
};

export default SkFunctionSelector;

