import React from 'react';

import { SkComponent } from './SkComponent';
import { SkInput } from './SkInput';
import { SkButton } from './SkButton';
import { formatFloat,parseFloat } from './SkNumberFormat';
import './SkComponent.css';

/**
 * @class SkGrid
 * @extends SkComponent
 * @description A grid component for displaying and editing tabular data with features like:
 * - Row selection
 * - Cell editing
 * - Column resizing
 * - Keyboard navigation
 * - Column sorting (click header: asc → desc → none)
 * - Custom cell formatting
 * 
 * @example
 * // Basic usage
 * <SkGrid
 *   columns={[
 *     { field: 'name', header: 'Name' },
 *     { field: 'age', header: 'Age', type: 'integer' },
 *     { field: 'salary', header: 'Salary', type: 'float', decimals: 2 }
 *   ]}
 *   data={[
 *     { name: 'John', age: 30, salary: 50000 },
 *     { name: 'Jane', age: 25, salary: 60000 }
 *   ]}
 *   onRowSelect={(row) => console.log('Selected:', row)}
 *   onCellEdit={(rowIndex, field, value) => console.log('Edited:', rowIndex, field, value)}
 * />
 */
export class SkGrid extends SkComponent {
    /**
     * @constructor
     * @param {Object} props - Component props
     * @param {Array} props.columns - Column definitions
     * @param {Array} props.data - Grid data
     * @param {Function} [props.onRowSelect] - Callback when a row is selected
     * @param {Function} [props.onCellEdit] - Callback when a cell is edited
     * @param {Function} [props.onEdit] - Callback when edit button is clicked
     * @param {Function} [props.onDelete] - Callback when delete button is clicked
     * @param {boolean} [props.readOnly=false] - Whether the grid is read-only
     */
    constructor(props) {
        super(props);
        this.state = {
            selectedIndex: -1,
            sortColumn: null,
            sortDirection: null,
            showScrollIndicator: false,
            scrollPosition: 0,
            isFocused: false,
            resizingColumn: null,
            columnWidths: {},
            editingCell: null, // { rowIndex: number, columnField: string }
            editedValues: {}, // { 'rowIndex-columnField': value }
            modifiedRows: new Set() // To track modified rows
        };
        this.locale = 'fr-FR';
        this.gridRef = React.createRef();
        this.bodyRef = React.createRef();
        this.startX = 0;
        this.startWidth = 0;
    }

    /**
     * @method componentDidMount
     * @description Initializes the grid after mounting
     * - Sets up scroll event listener
     * - Initializes column widths
     */
    componentDidMount() {
        if (this.bodyRef.current) {
            this.bodyRef.current.addEventListener('scroll', this.handleScroll);
        }
        // Initialize column widths
        const columnWidths = {};
        this.props.columns.forEach(column => {
            if (column.m_Width) {
                columnWidths[column.m_Name] = column.m_Width;
            }
        });
        // Initialize Actions column width if not already set
        if (!columnWidths['actions']) {
            columnWidths['actions'] = 200;
        }
        this.setState({ columnWidths });
    }

    /**
     * @method componentWillUnmount
     * @description Cleans up event listeners when component is unmounted
     */
    componentWillUnmount() {
        if (this.bodyRef.current) {
            this.bodyRef.current.removeEventListener('scroll', this.handleScroll);
        }
    }

    /**
     * @method handleScroll
     * @description Handles scroll events and updates scroll indicator
     */
    handleScroll = () => {
        if (!this.bodyRef.current) return;

        const { scrollTop, scrollHeight, clientHeight } = this.bodyRef.current;
        const maxScroll = scrollHeight - clientHeight;
        const scrollPercentage = (scrollTop / maxScroll) * 100;

        this.setState({
            scrollPosition: scrollPercentage,
            showScrollIndicator: scrollTop > 0 && scrollTop < maxScroll
        });
    }

    componentDidUpdate(prevProps) {
        if (prevProps.selectedRow !== this.props.selectedRow) {
            if (this.props.selectedRow) {
                const index = this.props.data.findIndex(row => row === this.props.selectedRow);
                this.setState({ selectedIndex: index }, () => {
                    this.scrollToSelectedRow();
                });
            } else {
                this.setState({ selectedIndex: -1 });
            }
        }
    }

    scrollToSelectedRow = () => {
        if (this.state.selectedIndex === -1 || !this.bodyRef.current) return;

        const container = this.bodyRef.current;
        const selectedRow = container.querySelector('.SkGridRow-selected');
        
        if (selectedRow) {
            const containerRect = container.getBoundingClientRect();
            const rowRect = selectedRow.getBoundingClientRect();

            if (rowRect.top < containerRect.top) {
                container.scrollTop += rowRect.top - containerRect.top;
            }
            else if (rowRect.bottom > containerRect.bottom) {
                container.scrollTop += rowRect.bottom - containerRect.bottom;
            }
        }
    }

    handleKeyDown = (e) => {
        if (!this.gridRef.current || !this.state.isFocused) return;

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                if (!this.state.editingCell) {
                    this.moveSelectionByDisplayOffset(-1);
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (!this.state.editingCell) {
                    this.moveSelectionByDisplayOffset(1);
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (this.state.selectedIndex >= 0) {
                    this.props.onRowSelect(this.props.data[this.state.selectedIndex]);
                }
                break;
            default:
                break;
        }
    }

    handleFocus = () => {
        this.setState({ isFocused: true });
        const { data = [], columns = [] } = this.props;
        if (this.state.selectedIndex === -1 && data.length > 0) {
            const displayOrder = this.getDisplayOrder(data, columns);
            const originalIndex = displayOrder[0];
            this.setState({ selectedIndex: originalIndex }, () => {
                this.props.onRowSelect(data[originalIndex]);
            });
        }
    }

    handleBlur = () => {
        this.setState({ isFocused: false });
    }

    handleRowClick = (row, originalIndex) => {
        this.setState({ selectedIndex: originalIndex, isFocused: true }, () => {
            this.props.onRowSelect(row);
            this.scrollToSelectedRow();
            this.gridRef.current?.focus();
        });
    }

    getDisplayOrder(data, columns) {
        const indices = data.map((_, index) => index);
        const { sortColumn, sortDirection } = this.state;
        if (!sortColumn || !sortDirection || !data.length) {
            return indices;
        }

        const column = columns.find((col) => col.m_Name === sortColumn);
        if (!column) {
            return indices;
        }

        const direction = sortDirection === 'asc' ? 1 : -1;
        return indices.sort((leftIndex, rightIndex) => {
            const leftValue = data[leftIndex][sortColumn];
            const rightValue = data[rightIndex][sortColumn];
            const comparison = this.compareCellValues(leftValue, rightValue, column);
            if (comparison !== 0) {
                return comparison * direction;
            }
            return leftIndex - rightIndex;
        });
    }

    compareCellValues(leftValue, rightValue, column) {
        const leftEmpty = leftValue === null || leftValue === undefined || leftValue === '';
        const rightEmpty = rightValue === null || rightValue === undefined || rightValue === '';
        if (leftEmpty && rightEmpty) return 0;
        if (leftEmpty) return 1;
        if (rightEmpty) return -1;

        switch (column.m_TypeField) {
            case 'integer': {
                const leftNumber = Number(leftValue);
                const rightNumber = Number(rightValue);
                if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
                    return String(leftValue).localeCompare(String(rightValue), this.locale, { sensitivity: 'base' });
                }
                return leftNumber - rightNumber;
            }
            case 'float': {
                const leftNumber = Number(String(leftValue).replace(/\s/g, '').replace(',', '.'));
                const rightNumber = Number(String(rightValue).replace(/\s/g, '').replace(',', '.'));
                if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
                    return String(leftValue).localeCompare(String(rightValue), this.locale, { sensitivity: 'base' });
                }
                return leftNumber - rightNumber;
            }
            case 'date': {
                const leftTime = new Date(leftValue).getTime();
                const rightTime = new Date(rightValue).getTime();
                if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
                    return leftTime - rightTime;
                }
                return String(leftValue).localeCompare(String(rightValue), this.locale, { sensitivity: 'base' });
            }
            default:
                return String(leftValue).localeCompare(String(rightValue), this.locale, { sensitivity: 'base' });
        }
    }

    handleHeaderClick = (column) => {
        if (this.props.sortable === false) {
            return;
        }

        this.setState((prevState) => {
            if (prevState.sortColumn !== column.m_Name) {
                return { sortColumn: column.m_Name, sortDirection: 'asc' };
            }
            if (prevState.sortDirection === 'asc') {
                return { sortColumn: column.m_Name, sortDirection: 'desc' };
            }
            return { sortColumn: null, sortDirection: null };
        });
    }

    renderSortIndicator(column) {
        const { sortColumn, sortDirection } = this.state;
        if (sortColumn !== column.m_Name || !sortDirection) {
            return null;
        }
        return (
            <span className="SkGridSortIcon" aria-hidden="true">
                {sortDirection === 'asc' ? '▲' : '▼'}
            </span>
        );
    }

    moveSelectionByDisplayOffset = (offset) => {
        const { data = [], columns = [] } = this.props;
        if (!data.length) {
            return;
        }

        const displayOrder = this.getDisplayOrder(data, columns);
        let displayIndex = displayOrder.indexOf(this.state.selectedIndex);
        if (displayIndex < 0) {
            displayIndex = 0;
        }

        displayIndex = Math.max(0, Math.min(displayOrder.length - 1, displayIndex + offset));
        const originalIndex = displayOrder[displayIndex];
        this.setState({ selectedIndex: originalIndex }, () => {
            this.props.onRowSelect(data[originalIndex]);
            this.scrollToSelectedRow();
        });
    }

    handleResizeStart = (e, column) => {
        e.preventDefault();
        const th = e.target.parentElement;
        this.startX = e.clientX;
        this.startWidth = th.offsetWidth;
        
        this.setState({ resizingColumn: column.m_Name });
        
        document.addEventListener('mousemove', this.handleResizeMove);
        document.addEventListener('mouseup', this.handleResizeEnd);
    }

    handleResizeMove = (e) => {
        if (!this.state.resizingColumn) return;
        
        const diff = e.clientX - this.startX;
        const newWidth = Math.max(50, this.startWidth + diff); // Largeur minimale de 50px
        
        this.setState(prevState => ({
            columnWidths: {
                ...prevState.columnWidths,
                [this.state.resizingColumn]: newWidth
            }
        }));
    }

    handleResizeEnd = () => {
        this.setState({ resizingColumn: null });
        document.removeEventListener('mousemove', this.handleResizeMove);
        document.removeEventListener('mouseup', this.handleResizeEnd);
    }

    /**
     * @method handleCellDoubleClick
     * @description Handles double-click on a cell to start editing
     * @param {Object} row - The row data
     * @param {number} rowIndex - The row index
     * @param {Object} column - The column definition
     */
    handleCellDoubleClick = (row, rowIndex, column) => {
        // If we're in edit mode and trying to edit a different row, ignore the double click
        if (this.state.editingCell && this.state.editingCell.rowIndex !== rowIndex) {
            return;
        }

        let initialValue = row[column.m_Name];
        // Convert initial value for editing if it's a number
        if (column.m_TypeField === 'float') {
            // Replace comma with dot and remove spaces for editing
            initialValue = String(initialValue).replace(/\s/g, '').replace(',', '.');
        }

        this.setState({
            editingCell: { rowIndex, columnField: column.m_Name },
            editedValues: {
                [`${rowIndex}-${column.m_Name}`]: initialValue
            }
        }, () => {
            // Force focus on the input after render
            const inputId = `SkGridCell-${rowIndex}-${column.m_Name}`;
            const input = document.getElementById(inputId);
            if (input) {
                input.focus();
            }
        });
    }

    /**
     * @method handleCellChange
     * @description Handles cell value changes during editing
     * @param {Event} event - The change event
     * @param {number} rowIndex - The row index
     * @param {Object} column - The column definition
     */
    handleCellChange = (event, rowIndex, column) => {
        const newValue = event.target.value;
        let processedValue = newValue;

        // Process the value based on column type
        switch (column.m_TypeField) {
            case 'integer':
                processedValue = parseInt(newValue) || 0;
                break;
            case 'float':
                processedValue = newValue;
                break;
            case 'date':
                processedValue = newValue;
                break;
            default:
                processedValue = newValue;
        }

        this.setState(prevState => ({
            editedValues: {
                ...prevState.editedValues,
                [`${rowIndex}-${column.m_Name}`]: processedValue
            }
        }));
    }

    /**
     * @method handleCellEditKeyDown
     * @description Handles keyboard events during cell editing
     * @param {Event} event - The keyboard event
     * @param {number} rowIndex - The row index
     * @param {Object} column - The column definition
     */
    handleCellEditKeyDown = (event, rowIndex, column) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            const key = `${rowIndex}-${column.m_Name}`;
            let newValue = this.state.editedValues[key];

            // Validation only for decimal numbers
            let isValid = true;
            if (column.m_TypeField === 'float') {
                const parsedValue = parseFloat(newValue, { locale: this.locale });
                if (!parsedValue.isValid) {
                    isValid = false;
                    console.log( 'Invalid numeric value');
                } else {
                    newValue = parsedValue.value;
                }
            }

            if (isValid) {
                // Call the callback if provided
                if (this.props.onCellEdit) {
                    this.props.onCellEdit(rowIndex, column.m_Name, newValue);
                    // Mark the row as modified
                    this.setState(prevState => ({
                        modifiedRows: new Set([...prevState.modifiedRows, rowIndex])
                    }));
                }

                // Update state immediately to close the input
                this.setState({
                    editingCell: null,
                    editedValues: {}
                }, () => {
                    // Set focus back to the grid
                    this.gridRef.current?.focus();
                });
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.setState({
                editingCell: null,
                editedValues: {}
            }, () => {
                // Set focus back to the grid
                this.gridRef.current?.focus();
            });
        } else if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            
            const currentColumnIndex = this.props.columns.findIndex(col => col.m_Name === column.m_Name);
            const newColumnIndex = event.shiftKey
                ? Math.max(0, currentColumnIndex - 1)
                : Math.min(this.props.columns.length - 1, currentColumnIndex + 1);
            
            const newColumn = this.props.columns[newColumnIndex];
            
            // Save current value
            const key = `${rowIndex}-${column.m_Name}`;
            let currentValue = this.state.editedValues[key];
            
            // Validation for decimal numbers
            let isValid = true;
            if (column.m_TypeField === 'float') {
                const parsedValue = parseFloat(currentValue, { locale: this.locale });
                if (!parsedValue.isValid) {
                    isValid = false;
                    console.log( 'Invalid numeric value');
                } else {
                    currentValue = parsedValue.value;
                }
            }
            
            if (isValid) {
                // Call the callback if provided
                if (this.props.onCellEdit) {
                    this.props.onCellEdit(rowIndex, column.m_Name, currentValue);
                    // Mark the row as modified
                    this.setState(prevState => ({
                        modifiedRows: new Set([...prevState.modifiedRows, rowIndex])
                    }));
                }

                // Move editing to the new column
                let newInitialValue = this.props.data[rowIndex][newColumn.m_Name];

                this.setState({
                    editingCell: { rowIndex, columnField: newColumn.m_Name },
                    editedValues: {
                        [`${rowIndex}-${newColumn.m_Name}`]: newInitialValue
                    }
                }, () => {
                    // Force focus on the new input after render
                    const newInputId = `SkGridCell-${rowIndex}-${newColumn.m_Name}`;
                    const newInput = document.getElementById(newInputId);
                    if (newInput) {
                        newInput.focus();
                    }
                });
            }
        }
    }

    handleCellClick = (e, row, rowIndex, column) => {
        // If we're in edit mode
        if (this.state.editingCell) {
            e.stopPropagation();
            // If clicking on the same cell, do nothing
            if (this.state.editingCell.rowIndex === rowIndex && 
                this.state.editingCell.columnField === column.m_Name) {
                return;
            }
            // If clicking on another cell in the same row, switch to edit mode for that cell
            if (this.state.editingCell.rowIndex === rowIndex) {
                this.setState({
                    editingCell: { rowIndex, columnField: column.m_Name },
                    editedValues: {
                        [`${rowIndex}-${column.m_Name}`]: row[column.m_Name]
                    }
                }, () => {
                    // Force focus on the new input after render
                    const inputId = `SkGridCell-${rowIndex}-${column.m_Name}`;
                    const input = document.getElementById(inputId);
                    if (input) {
                        input.focus();
                    }
                });
                return;
            }
            return;
        }
        this.handleRowClick(row, rowIndex);
    }

    handleInputClick = (e) => {
        // Prevent click propagation to avoid triggering handleCellClick
        e.stopPropagation();
    }

    handleInputBlur = (e, rowIndex, column) => {
        // Prevent propagation to avoid conflicts
        e.stopPropagation();
        const key = `${rowIndex}-${column.m_Name}`;
        let newValue = this.state.editedValues[key];
        
        // Call the callback if provided
        if (this.props.onCellEdit) {
            this.props.onCellEdit(rowIndex, column.m_Name, newValue);
            // Mark the row as modified
            this.setState(prevState => ({
                modifiedRows: new Set([...prevState.modifiedRows, rowIndex])
            }));
        }

        // Update state
        this.setState({
            editingCell: null,
            editedValues: {}
        });
    }

    handleEditClick = (rowIndex) => {
        if (this.props.onEdit) {
            this.props.onEdit(rowIndex);
        }
        
        // Activate editing on the first column
        const firstColumn = this.props.columns[0];
        this.setState({
            editingCell: { rowIndex, columnField: firstColumn.m_Name },
            editedValues: {
                [`${rowIndex}-${firstColumn.m_Name}`]: this.props.data[rowIndex][firstColumn.m_Name]
            }
        }, () => {
            // Force focus on the input after render
            const inputId = `SkGridCell-${rowIndex}-${firstColumn.m_Name}`;
            const input = document.getElementById(inputId);
            if (input) {
                input.focus();
            }
        });
    }

    handleDeleteClick = (rowIndex) => {
        if (this.props.onDelete) {
            this.props.onDelete(rowIndex);
        }
    }

    /**
     * @method renderCellValue
     * @description Renders a cell value with appropriate formatting
     * @param {*} value - The cell value
     * @param {Object} column - The column definition
     * @returns {string} The formatted cell value
     */
    renderCellValue = (value, column) => {
        if (value === null || value === undefined) return '';
        
        switch (column.m_TypeField) {
            case 'date':
                try {
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        return date.toLocaleDateString(this.locale);
                    }
                    return value;
                } catch (e) {
                    return value;
                }
            case 'float':
                try {
                    const wFormatFloat = formatFloat(value, {
                        decimals: column.decimals || 2,
                        locale: this.locale
                    });
                    return wFormatFloat;
                } catch (e) {
                    return "Float error: " + e.message;
                }
            default:
                return value;
        }
    }

    /**
     * @method getInputValue
     * @description Gets the formatted value for input fields
     * @param {*} value - The cell value
     * @param {Object} column - The column definition
     * @returns {string} The formatted input value
     */
    getInputValue = (value, column) => {
        if (value === null || value === undefined) return '';
        
        switch (column.m_TypeField) {
            case 'date':
                try {
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        return date.toISOString().split('T')[0];
                    }
                    return value;
                } catch (e) {
                    return value;
                }
            case 'float':
                try {
                    const wFormatFloat = formatFloat(value, {
                        decimals: column.decimals || 2,
                        locale: this.locale
                    });
                    return wFormatFloat;
                } catch (e) {
                    return e.message;
                }
            default:
                return value;
        }
    }

    /**
     * @method render
     * @description Renders the grid component
     * @returns {JSX.Element} The rendered grid
     */
    render() {
        const { columns = [], data = [], className = '', style = {}, readOnly = false } = this.props;
        const { showScrollIndicator, scrollPosition, isFocused, columnWidths, editingCell, modifiedRows } = this.state;

        /**
         * @function getColumnWidth
         * @description Gets the width for a column
         * @param {Object} column - The column definition
         * @returns {string} The column width
         */
        const getColumnWidth = (column) => {
            const width = columnWidths[column.m_Name] || column.m_Width;
            return typeof width === 'number' ? `${width}px` : width;
        };

        /**
         * @function getColumnAlignment
         * @description Gets the alignment for a column
         * @param {Object} column - The column definition
         * @returns {string} The column alignment
         */
        const getColumnAlignment = (column) => {
            // Right align for numeric types
            if (column.m_TypeField === 'integer' || column.m_TypeField === 'float') {
                return 'right';
            }
            // Use specified alignment or default to left
            return column.align || 'left';
        };

        const sortable = this.props.sortable !== false;
        const displayOrder = this.getDisplayOrder(data, columns);

        const getAriaSort = (column) => {
            if (!sortable || this.state.sortColumn !== column.m_Name || !this.state.sortDirection) {
                return 'none';
            }
            return this.state.sortDirection === 'asc' ? 'ascending' : 'descending';
        };

        return (
            <div 
                ref={this.gridRef}
                className={`SkGrid ${className} ${isFocused ? 'SkGridFocused' : ''}`}
                style={style}
                tabIndex={-1}
                onKeyDown={this.handleKeyDown}
                onFocus={this.handleFocus}
                onBlur={this.handleBlur}
            >
                <div className="SkGridHeader">
                    <table className="SkGridTable">
                        <thead>
                            <tr>
                                {columns.map((column, index) => (
                                    <th 
                                        key={index} 
                                        className={`SkGridHeader${sortable ? ' SkGridHeader-sortable' : ''}${this.state.sortColumn === column.m_Name ? ' SkGridHeader-sorted' : ''}`}
                                        style={{ 
                                            width: getColumnWidth(column),
                                            textAlign: getColumnAlignment(column),
                                            position: 'relative'
                                        }}
                                        aria-sort={getAriaSort(column)}
                                    >
                                        {sortable ? (
                                            <button
                                                type="button"
                                                className="SkGridHeader-sortButton"
                                                onClick={() => this.handleHeaderClick(column)}
                                            >
                                                <span className="SkGridHeader-label">{column.m_Label}</span>
                                                {this.renderSortIndicator(column)}
                                            </button>
                                        ) : (
                                            column.m_Label
                                        )}
                                        <div 
                                            className="SkGridHeader-resizer"
                                            onMouseDown={(e) => this.handleResizeStart(e, column)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    </th>
                                ))}
                                {!readOnly && (
                                    <th 
                                        className="SkGridHeader" 
                                        style={{ 
                                            width: getColumnWidth({ m_Name: 'actions', m_Width: 200 }),
                                            position: 'relative'
                                        }}
                                    >
                                        Actions
                                        <div 
                                            className="SkGridHeader-resizer"
                                            onMouseDown={(e) => this.handleResizeStart(e, { m_Name: 'actions' })}
                                        />
                                    </th>
                                )}
                                <th>
                                <div/>
                            </th>
                            </tr>
                        </thead>
                    </table>
                </div>
                <div ref={this.bodyRef} className="SkGridBody">
                    {showScrollIndicator && (
                        <div className="SkGridScrollIndicator">
                            {Math.round(scrollPosition)}%
                        </div>
                    )}
                    <table className="SkGridTable">
                        <tbody>
                            {displayOrder.map((originalIndex) => {
                                const row = data[originalIndex];
                                return (
                                <tr
                                    key={originalIndex}
                                    className={`SkGridRow ${originalIndex === this.state.selectedIndex ? 'SkGridRow-selected' : ''}`}
                                >
                                    {columns.map((column, colIndex) => (
                                        <td 
                                            key={colIndex} 
                                            className="SkGridCell"
                                            style={{ 
                                                width: getColumnWidth(column),
                                                textAlign: getColumnAlignment(column)
                                            }}
                                            onClick={(e) => {
                                                if (readOnly) {
                                                    this.handleRowClick(row, originalIndex);
                                                } else {
                                                    this.handleCellClick(e, row, originalIndex, column);
                                                }
                                            }}
                                            onDoubleClick={() => !readOnly && this.handleCellDoubleClick(row, originalIndex, column)}
                                        >
                                            {!readOnly && editingCell && 
                                             editingCell.rowIndex === originalIndex && 
                                             editingCell.columnField === column.m_Name ? (
                                                <SkInput
                                                    id={`SkGridCell-${originalIndex}-${column.m_Name}`}
                                                    name={`SkGridCell-${originalIndex}-${column.m_Label}`}
                                                    type={column.m_TypeField === 'date' ? 'date' : 
                                                          column.m_TypeField === 'integer' ? 'number' : 'text'}
                                                    step={column.m_TypeField === 'integer' ? '1' : undefined}
                                                    value={this.getInputValue(this.state.editedValues[`${originalIndex}-${column.m_Name}`] || row[column.m_Name], column)}
                                                    onChange={(e) => this.handleCellChange(e, originalIndex, column)}
                                                    onKeyDown={(e) => this.handleCellEditKeyDown(e, originalIndex, column)}
                                                    onClick={this.handleInputClick}
                                                    onBlur={(e) => this.handleInputBlur(e, originalIndex, column)}
                                                    tabIndex={0}
                                                />
                                            ) : (
                                                this.renderCellValue(row[column.m_Name], column)
                                            )}
                                        </td>
                                    ))}
                                    {!readOnly && (
                                        <td className="SkGridCell" style={{ width: '200px' }}>
                                            <div className="SkGridActions">
                                                {modifiedRows.has(originalIndex) && (
                                                    <span className="SkGridModified" title="Modified row">✎</span>
                                                )}
                                                <SkButton
                                                    onClick={() => this.handleEditClick(originalIndex)}
                                                    className="SkGridActionButton"
                                                    title="Edit"
                                                >
                                                    ▲
                                                </SkButton>
                                                <SkButton
                                                    onClick={() => this.handleDeleteClick(originalIndex)}
                                                    className="SkGridActionButton"
                                                    title="Delete"
                                                >
                                                    ×
                                                </SkButton>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
}

export default SkGrid;