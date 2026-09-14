import React from 'react';
import { SkComponent } from './SkComponent';
import './SkComponent.css';

function resolveInitialSort(props) {
    const sortColumn = props.defaultSortColumn || null;
    const sortDirection = sortColumn ? (props.defaultSortDirection || 'asc') : null;
    return { sortColumn, sortDirection };
}

export class SkGridTreeView extends SkComponent {
    constructor(props) {
        super(props);
        const initialSort = resolveInitialSort(props);
        this.state = {
            expandedNodes: new Set(),
            flattenedData: [],
            sortColumn: initialSort.sortColumn,
            sortDirection: initialSort.sortDirection,
            isFocused: false,
            selectedIndex: -1,
            showScrollIndicator: false,
            scrollPosition: 0,
            resizingColumn: null,
            columnWidths: {}
        };
        this.gridRef = React.createRef();
        this.bodyRef = React.createRef();
        this.headerRef = React.createRef();
        this.startX = 0;
        this.startWidth = 0;
        this.IconsColumn="";
        // Restore scroll position from session only once on mount when data arrives.
        this._pendingScrollRestore = true;
    }

    componentDidMount() {
        this.updateFlattenedData();
        if (this.bodyRef.current) {
            this.bodyRef.current.addEventListener('scroll', this.handleScroll);
        }
        // Initialize the column widths (do not inherit Virtual Disk widths).
        const columnWidths = {};
        this.props.columns.forEach(column => {
            if (column.width) {
                columnWidths[column.field] = column.width;
            }
        });
        const widthsKey = this.props.columnWidthsKey || 'SkGridColumnWidths';
        // Merge with saved column widths from session if any
        try {
            const saved = sessionStorage.getItem(widthsKey);
            if (saved) {
                const parsed = JSON.parse(saved) || {};
                // Only apply widths for fields that exist on this grid.
                const fields = new Set((this.props.columns || []).map((c) => c.field));
                for (const [field, width] of Object.entries(parsed)) {
                    if (fields.has(field) && width) {
                        columnWidths[field] = width;
                    }
                }
            }
        } catch {}
        this.setState({ columnWidths }, () => {
            // Restore horizontal scroll position if saved
            try {
                if (this.bodyRef.current) {
                    const sl = Number(sessionStorage.getItem('SkGridScrollLeft'));
                    if (Number.isFinite(sl)) {
                        this.bodyRef.current.scrollLeft = sl;
                        if (this.headerRef.current) {
                            this.headerRef.current.scrollLeft = sl;
                        }
                    }
                }
            } catch {}
        });
    }

    componentWillUnmount() {
        if (this.bodyRef.current) {
            this.bodyRef.current.removeEventListener('scroll', this.handleScroll);
        }
    }

    handleScroll = () => {
        if (!this.bodyRef.current) return;

        const { scrollTop, scrollHeight, clientHeight, scrollLeft } = this.bodyRef.current;
        const maxScroll = scrollHeight - clientHeight;
        const scrollPercentage = maxScroll > 0 ? (scrollTop / maxScroll) * 100 : 0;

        // Keep header columns aligned with the horizontally scrolled body.
        if (this.headerRef.current) {
            this.headerRef.current.scrollLeft = scrollLeft;
        }

        // Persist the first visible row path to session storage
        try {
            const container = this.bodyRef.current;
            const rows = container.querySelectorAll('tbody tr');
            const containerTop = container.getBoundingClientRect().top;
            let topPath = null;
            for (const tr of rows) {
                const rect = tr.getBoundingClientRect();
                if (rect.bottom > containerTop + 1) { // first row crossing the top edge
                    topPath = tr.getAttribute('data-path');
                    break;
                }
            }
            if (topPath) {
                sessionStorage.setItem('SkGridTreeViewTopPath', topPath);
            }
            // Persist horizontal scroll position
            sessionStorage.setItem('SkGridScrollLeft', String(scrollLeft));
        } catch {}

        this.setState({
            scrollPosition: scrollPercentage,
            showScrollIndicator: scrollTop > 0 && scrollTop < maxScroll
        });
    }

    scrollToSelectedRow = () => {
        if (this.state.selectedIndex === -1 || !this.bodyRef.current) return;

        const container = this.bodyRef.current;
        const selectedRow = container.querySelector('.SkGridRow-selected');
        
        if (selectedRow) {
            const containerRect = container.getBoundingClientRect();
            const rowRect = selectedRow.getBoundingClientRect();
            const scrollAmount = 20; // Scroll offset in pixels
            const toolbarHeight = 80; // Fixed toolbar height

            // Selected row is above the visible area
            if (rowRect.top < containerRect.top) {
                container.scrollTop = container.scrollTop - (containerRect.top - rowRect.top) - scrollAmount;
            }
            // Selected row is below the visible area
            else if (rowRect.bottom > containerRect.bottom) {
                // Apply extra scroll to account for the toolbar
                const extraScroll = Math.max(0, rowRect.bottom - containerRect.bottom + toolbarHeight);
                container.scrollTop = container.scrollTop + extraScroll + scrollAmount;
            }
        }
    }

    componentDidUpdate(prevProps, prevState) {
        if (prevProps.data !== this.props.data || 
            prevState.expandedNodes !== this.state.expandedNodes) {
            this.updateFlattenedData();
        }

        if (prevProps.selectedRow?.path !== this.props.selectedRow?.path) {
            if (this.props.selectedRow) {
                const index = this.state.flattenedData.findIndex(
                    item => item.path === this.props.selectedRow.path
                );
                if (index !== -1) {
                    this.setState({ selectedIndex: index }, () => {
                        this.scrollToSelectedRow();
                    });
                }
            } else {
                this.setState({ selectedIndex: -1 });
            }
        }
    }

    resolveSelectedIndex = (flattenedData, prevSelectedIndex, prevFlattenedData) => {
        const localPath = (prevSelectedIndex >= 0 && prevSelectedIndex < prevFlattenedData.length)
            ? prevFlattenedData[prevSelectedIndex]?.path
            : null;
        const localIdx = localPath ? flattenedData.findIndex((item) => item.path === localPath) : -1;

        if (this.props.selectedRow) {
            const propsIdx = flattenedData.findIndex(
                (item) => item.path === this.props.selectedRow.path
            );
            // Parent selection wins when the row is visible (upload, restore, programmatic pick).
            if (propsIdx !== -1) {
                return propsIdx;
            }
            if (localIdx !== -1 && localPath !== this.props.selectedRow.path) {
                // Keep local click while ancestors are still expanding.
                return localIdx;
            }
            if (localIdx !== -1) {
                return localIdx;
            }
            return -1;
        }

        if (localIdx !== -1) {
            return localIdx;
        }
        if (prevSelectedIndex >= 0 && prevSelectedIndex < flattenedData.length) {
            return prevSelectedIndex;
        }
        return -1;
    }

    updateFlattenedData = (done) => {
        const flattenedData = this.flattenTree(this.props.data);
        const prevSelectedIndex = this.state.selectedIndex;
        const nextSelectedIndex = this.resolveSelectedIndex(
            flattenedData,
            prevSelectedIndex,
            this.state.flattenedData
        );
        this.setState({ flattenedData, selectedIndex: nextSelectedIndex }, () => {
            if (this._pendingScrollRestore && this.state.flattenedData.length > 0) {
                this._pendingScrollRestore = false;
                try {
                    const wantedPath = sessionStorage.getItem('SkGridTreeViewTopPath');
                    if (wantedPath) {
                        this.scrollRowToTopByPath(wantedPath);
                    }
                    if (this.bodyRef.current) {
                        const sl = Number(sessionStorage.getItem('SkGridScrollLeft'));
                        if (Number.isFinite(sl)) {
                            this.bodyRef.current.scrollLeft = sl;
                            if (this.headerRef.current) {
                                this.headerRef.current.scrollLeft = sl;
                            }
                        }
                    }
                } catch {}
            }

            if (
                this.props.selectedRow &&
                nextSelectedIndex !== -1 &&
                (prevSelectedIndex === -1 || prevSelectedIndex !== nextSelectedIndex)
            ) {
                const prevPath = prevSelectedIndex >= 0
                    ? this.state.flattenedData[prevSelectedIndex]?.path
                    : null;
                const nextPath = flattenedData[nextSelectedIndex]?.path;
                if (prevPath !== nextPath) {
                    this.scrollToSelectedRow();
                }
            }

            if (typeof done === 'function') {
                done(nextSelectedIndex);
            }
        });
    }

    clearPendingScrollRestore = () => {
        this._pendingScrollRestore = false;
    }

    scrollRowToTopByPath = (path) => {
        if (!this.bodyRef.current || !path) return;
        const container = this.bodyRef.current;
        // Find the row by iterating instead of using CSS.escape for compatibility
        let row = null;
        const rows = container.querySelectorAll('tbody tr');
        for (const tr of rows) {
            if (tr.getAttribute('data-path') === path) {
                row = tr;
                break;
            }
        }
        if (row) {
            const containerRect = container.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            const delta = rowRect.top - containerRect.top;
            container.scrollTop = container.scrollTop + delta;
        }
    }

    flattenTree = (items, level = 0, parentId = null) => {
        let result = [];
        const sortedItems = this.sortSiblingItems(items);
        sortedItems.forEach(item => {
            const node = {
                ...item,
                level,
                parentId,
                hasChildren: item.children && item.children.length > 0
            };
            result.push(node);
            if (item.children && this.state.expandedNodes.has(item.id)) {
                result = result.concat(this.flattenTree(item.children, level + 1, item.id));
            }
        });
        return result;
    }

    sortSiblingItems(items) {
        if (!items || items.length === 0) {
            return [];
        }
        const { sortColumn, sortDirection } = this.state;
        if (!sortColumn || !sortDirection) {
            return items;
        }

        const column = (this.props.columns || []).find((col) => col.field === sortColumn);
        if (!column) {
            return items;
        }

        const direction = sortDirection === 'asc' ? 1 : -1;
        return [...items].sort((left, right) => {
            // Keep folders before files when sorting by name (Explorer-like).
            if (sortColumn === 'name' && !!left.isDirectory !== !!right.isDirectory) {
                return left.isDirectory ? -1 : 1;
            }
            const comparison = this.compareTreeValues(
                left[sortColumn],
                right[sortColumn],
                column
            );
            if (comparison !== 0) {
                return comparison * direction;
            }
            return String(left.name || '').localeCompare(String(right.name || ''), 'fr', { sensitivity: 'base' });
        });
    }

    compareTreeValues(leftValue, rightValue, column) {
        const leftEmpty = leftValue === null || leftValue === undefined || leftValue === '';
        const rightEmpty = rightValue === null || rightValue === undefined || rightValue === '';
        if (leftEmpty && rightEmpty) return 0;
        if (leftEmpty) return 1;
        if (rightEmpty) return -1;

        if (column.field === 'sizeStr') {
            return this.parseSizeValue(leftValue) - this.parseSizeValue(rightValue);
        }

        if (column.field === 'createdAt' || column.field === 'updatedAt') {
            return this.parseFrenchDateTime(leftValue) - this.parseFrenchDateTime(rightValue);
        }

        if (column.align === 'right') {
            const leftNumber = Number(String(leftValue).replace(/\s/g, '').replace(',', '.'));
            const rightNumber = Number(String(rightValue).replace(/\s/g, '').replace(',', '.'));
            if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
                return leftNumber - rightNumber;
            }
        }

        return String(leftValue).localeCompare(String(rightValue), 'fr', { sensitivity: 'base' });
    }

    parseSizeValue(value) {
        const match = String(value || '').trim().match(/^([\d.,]+)\s*(B|KB|MB|GB|TB)?$/i);
        if (!match) {
            return 0;
        }
        const amount = Number(match[1].replace(',', '.'));
        if (Number.isNaN(amount)) {
            return 0;
        }
        const unit = (match[2] || 'B').toUpperCase();
        const multipliers = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
        return amount * (multipliers[unit] || 1);
    }

    parseFrenchDateTime(value) {
        const match = String(value || '').trim().match(
            /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/
        );
        if (!match) {
            return 0;
        }
        const [, day, month, year, hour = '0', minute = '0'] = match;
        return new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute)
        ).getTime();
    }

    handleHeaderClick = (column) => {
        if (this.props.sortable === false) {
            return;
        }

        this.setState((prevState) => {
            let sortColumn = column.field;
            let sortDirection = 'asc';
            if (prevState.sortColumn === column.field) {
                if (prevState.sortDirection === 'asc') {
                    sortDirection = 'desc';
                } else if (prevState.sortDirection === 'desc') {
                    sortColumn = null;
                    sortDirection = null;
                }
            }
            return { sortColumn, sortDirection };
        }, () => {
            this.updateFlattenedData();
        });
    }

    renderSortIndicator(column) {
        const { sortColumn, sortDirection } = this.state;
        if (sortColumn !== column.field || !sortDirection) {
            return null;
        }
        return (
            <span className="SkGridSortIcon" aria-hidden="true">
                {sortDirection === 'asc' ? '▲' : '▼'}
            </span>
        );
    }

    toggleNode = (nodeId) => {
        this.setState(prevState => {
            const newSet = new Set(prevState.expandedNodes);
            if (newSet.has(nodeId)) {
                newSet.delete(nodeId);
            } else {
                newSet.add(nodeId);
            }
            // Notify parent about expanded nodes change
            if (this.props.onExpandedChange) {
                this.props.onExpandedChange(newSet);
            }
            return { expandedNodes: newSet };
        });
    }

    handleTreeToggle = (e, row) => {
        e.stopPropagation();
        this.setState((prevState) => {
            const newSet = new Set(prevState.expandedNodes);
            if (newSet.has(row.id)) {
                newSet.delete(row.id);
            } else {
                newSet.add(row.id);
            }
            if (this.props.onExpandedChange) {
                this.props.onExpandedChange(newSet);
            }
            const index = prevState.flattenedData.findIndex((item) => item.path === row.path);
            return {
                expandedNodes: newSet,
                selectedIndex: index !== -1 ? index : prevState.selectedIndex,
                isFocused: true,
            };
        }, () => {
            if (this.props.onRowSelect) {
                this.props.onRowSelect(row, { scroll: false, syncExpanded: false });
            }
            this.gridRef.current?.focus();
        });
    }

    handleKeyDown = (e) => {
        if (!this.gridRef.current || !this.state.isFocused) return;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                if (this.state.selectedIndex >= 0 && 
                    this.state.expandedNodes.has(this.state.flattenedData[this.state.selectedIndex].id)) {
                    this.toggleNode(this.state.flattenedData[this.state.selectedIndex].id);
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (this.state.selectedIndex >= 0 && 
                    this.state.flattenedData[this.state.selectedIndex].hasChildren && 
                    !this.state.expandedNodes.has(this.state.flattenedData[this.state.selectedIndex].id)) {
                    this.toggleNode(this.state.flattenedData[this.state.selectedIndex].id);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (this.state.selectedIndex > 0) {
                    const newIndex = this.state.selectedIndex - 1;
                    this.setState({ selectedIndex: newIndex }, () => {
                        this.props.onRowSelect(this.state.flattenedData[newIndex]);
                        this.scrollToSelectedRow();
                    });
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (this.state.selectedIndex === -1 && this.state.flattenedData.length > 0) {
                    const newIndex = 0;
                    this.setState({ selectedIndex: newIndex }, () => {
                        this.props.onRowSelect(this.state.flattenedData[newIndex]);
                        this.scrollToSelectedRow();
                    });
                } else if (this.state.selectedIndex < this.state.flattenedData.length - 1) {
                    const newIndex = this.state.selectedIndex + 1;
                    this.setState({ selectedIndex: newIndex }, () => {
                        this.props.onRowSelect(this.state.flattenedData[newIndex]);
                        this.scrollToSelectedRow();
                    });
                }
                break;
            case 'Enter':
            case 'NumpadEnter':
                e.preventDefault();
                if (this.state.selectedIndex >= 0) {
                    const row = this.state.flattenedData[this.state.selectedIndex];
                    if (this.props.onRowDoubleClick) {
                        this.props.onRowDoubleClick(row);
                    } else if (this.props.onRowSelect) {
                        this.props.onRowSelect(row);
                    }
                }
                break;
            default:
                break;
        }
    }

    handleRowClick = (row) => {
        const index = this.state.flattenedData.findIndex(item => item.path === row.path);
        this.setState({ selectedIndex: index, isFocused: true }, () => {
            this.props.onRowSelect(row);
            this.gridRef.current?.focus();
        });
    }

    handleRowDoubleClick = (row) => {
        const index = this.state.flattenedData.findIndex(item => item.path === row.path);
        if (index !== -1 && index !== this.state.selectedIndex) {
            this.setState({ selectedIndex: index, isFocused: true }, () => {
                if (this.props.onRowDoubleClick) {
                    this.props.onRowDoubleClick(row);
                }
            });
            return;
        }
        if (this.props.onRowDoubleClick) {
            this.props.onRowDoubleClick(row);
        }
    }

    handleRowContextMenu = (e, row) => {
        if (!this.props.onRowContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        const index = this.state.flattenedData.findIndex((item) => item.path === row.path);
        this.setState({ selectedIndex: index, isFocused: true }, () => {
            this.props.onRowContextMenu(row, e);
            this.gridRef.current?.focus();
        });
    }

    handleGridContextMenu = (e) => {
        if (!this.props.onContextMenu) return;
        e.preventDefault();
        this.props.onContextMenu(e);
    }

    // iPadOS / iOS Safari rarely fires `dblclick` reliably from touch input,
    // and the synthetic click after a tap can be delayed enough that two
    // quick taps end up looking like a single click + zoom gesture. We
    // detect the double-tap ourselves on `touchend` and synthesize the
    // double-click + suppress the trailing synthetic click so the row does
    // not get re-selected immediately after opening.
    handleRowTouchEnd = (e, row) => {
        const now = Date.now();
        const lastAt = this._lastTapAt || 0;
        const lastRow = this._lastTapRow;
        const sameRow = lastRow && lastRow.path === row.path;

        if (sameRow && now - lastAt < 350) {
            // Second tap on the same row within 350ms -> double-click.
            // Block the synthetic click that would otherwise fire after
            // touchend so we don't re-trigger selection.
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            this._lastTapAt = 0;
            this._lastTapRow = null;
            this.handleRowDoubleClick(row);
            return;
        }

        this._lastTapAt = now;
        this._lastTapRow = row;
        // First tap -> let the native click fire, which calls handleRowClick
        // to select the row.
    }

    handleFocus = () => {
        this.setState({ isFocused: true });
    }

    handleBlur = () => {
        this.setState({ isFocused: false });
    }

    handleResizeStart = (e, column) => {
        e.preventDefault();
        const th = e.target.parentElement;
        this.startX = e.clientX;
        this.startWidth = th.offsetWidth;
        
        this.setState({ resizingColumn: column.field });
        
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
        // Persist column widths (scoped key so Virtual Disk does not overwrite Pool Stats)
        try {
            const widthsKey = this.props.columnWidthsKey || 'SkGridColumnWidths';
            sessionStorage.setItem(widthsKey, JSON.stringify(this.state.columnWidths));
        } catch {}
    }

    // Method to update expanded nodes from parent component
    updateExpandedNodes = (expandedNodes, done) => {
        this.setState({ expandedNodes: new Set(expandedNodes) }, () => {
            this.updateFlattenedData(done);
        });
    }

    updateExpandedNodesAsync = (expandedNodes) => {
        return new Promise((resolve) => {
            this.updateExpandedNodes(expandedNodes, resolve);
        });
    }

    /** Force grid highlight to match a tree path after programmatic selection. */
    selectRowByPath = (path) => {
        if (!path) return false;
        const index = this.state.flattenedData.findIndex((item) => item.path === path);
        if (index === -1) return false;
        if (index !== this.state.selectedIndex) {
            this.setState({ selectedIndex: index });
        }
        return true;
    }

    renderCell = (row, column) => {
        const value = row[column.field];
        
        // Special handling for the name column to show icons and tree structure
        if (column.field === 'name') {
            return (
                <div className="SkGridTreeCell" style={{ paddingLeft: `${row.level * 20}px` }}>
                    {row.hasChildren && (
                        <span 
                            className={`SkGridTree-toggle ${this.state.expandedNodes.has(row.id) ? 'expanded' : ''}`}
                            onClick={(e) => this.handleTreeToggle(e, row)}
                        >
                            {this.state.expandedNodes.has(row.id) ? '▼' : '▶'}
                        </span>
                    )}
                    {!row.hasChildren && <span className="SkGridTree-spacer"></span>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {row.icon}
                        <span className="SkGridTree-content">{value}</span>
                    </div>
                </div>
            );
        }
        
        return (
            <div style={{ textAlign: column.align || 'left' }}>
                {value}
            </div>
        );
    }

    render() {
        const { columns = [], sortable = true } = this.props;
        const { flattenedData, selectedIndex, isFocused, showScrollIndicator, scrollPosition, columnWidths, sortColumn, sortDirection } = this.state;

        const getColumnWidth = (column) => {
            const width = columnWidths[column.field] || column.width;
            return typeof width === 'number' ? `${width}px` : width;
        };

        const getAriaSort = (column) => {
            if (!sortable || sortColumn !== column.field || !sortDirection) {
                return 'none';
            }
            return sortDirection === 'asc' ? 'ascending' : 'descending';
        };

        return (
            <div 
                className={`SkGrid ${isFocused ? 'SkGridFocused' : ''}`}
                ref={this.gridRef}
                tabIndex={0}
                onFocus={this.handleFocus}
                onBlur={this.handleBlur}
                onKeyDown={this.handleKeyDown}
            >
                <div className="SkGridHeader" ref={this.headerRef}>
                    <table className="SkGridTable">
                        <colgroup>
                            {columns.map((column) => (
                                <col key={column.field} style={{ width: getColumnWidth(column) }} />
                            ))}
                        </colgroup>
                        <thead>
                            <tr>
                                {columns.map((column) => (
                                    <th 
                                        key={column.field} 
                                        className={`SkGridHeader${sortable ? ' SkGridHeader-sortable' : ''}${sortColumn === column.field ? ' SkGridHeader-sorted' : ''}`}
                                        style={{ 
                                            width: getColumnWidth(column),
                                            maxWidth: getColumnWidth(column),
                                            textAlign: column.align || 'left',
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
                                                <span className="SkGridHeader-label">{column.header}</span>
                                                {this.renderSortIndicator(column)}
                                            </button>
                                        ) : (
                                            column.header
                                        )}
                                        <div 
                                            className="SkGridHeader-resizer"
                                            onMouseDown={(e) => this.handleResizeStart(e, column)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    </th>
                                ))}
                            </tr>
                        </thead>
                    </table>
                </div>
                <div ref={this.bodyRef} className="SkGridBody" onContextMenu={this.handleGridContextMenu}>
                    {showScrollIndicator && (
                        <div className="SkGridScrollIndicator">
                            {Math.round(scrollPosition)}%
                        </div>
                    )}
                    <table className="SkGridTable">
                        <colgroup>
                            {columns.map((column) => (
                                <col key={column.field} style={{ width: getColumnWidth(column) }} />
                            ))}
                        </colgroup>
                        <tbody>
                            {flattenedData.map((row, index) => (
                                <tr
                                    key={row.id}
                                    data-path={row.path}
                                    className={`SkGridRow ${index === selectedIndex ? 'SkGridRow-selected' : ''}`}
                                    style={{ touchAction: 'manipulation' }}
                                    onClick={() => this.handleRowClick(row)}
                                    onDoubleClick={() => this.handleRowDoubleClick(row)}
                                    onContextMenu={(e) => this.handleRowContextMenu(e, row)}
                                    onTouchEnd={(e) => this.handleRowTouchEnd(e, row)}
                                >
                                    {columns.map((column) => (
                                        <td 
                                            key={column.field} 
                                            className="SkGridCell"
                                            style={{ 
                                                width: getColumnWidth(column),
                                                maxWidth: getColumnWidth(column),
                                                textAlign: column.align || 'left'
                                            }}
                                        >
                                            {this.renderCell(row, column)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
}

export default SkGridTreeView; 