/**
 * SkSpSelect.js
 * Selection management system for the spreadsheet
 * 
 * This file contains the core classes for handling selections in the spreadsheet:
 * - tPoint: Represents a cell position (row, column)
 * - tRange: Represents a range of cells (top-left to bottom-right)
 * - tSizer: Handles column/row resizing operations
 * - tSelect: Main selection management system
 * - tInterval: Represents a continuous range of rows or columns
 * - tColRowSelect: Manages row/column selection
 */



// Maximum number of rows and columns in the spreadsheet
const SkMaxRow = 1048576;
const SkMaxCol = 16384;

/**
 * Class tPoint
 * Represents a point in the spreadsheet (cell position)
 * @class
 */
export class tPoint {
    /**
     * Creates a new point
     * @param {number} sRow - Row number
     * @param {number} sCol - Column number
     */
    constructor(sRow, sCol) {
        this.m_Row = sRow;
        this.m_Col = sCol;
    }

    /**
     * Sets the row number
     * @param {number} sRow - New row number
     */
    setRow(sRow) {
        this.m_Row = sRow;
    }

    /**
     * Sets the column number
     * @param {number} sCol - New column number
     */
    setCol(sCol) {
        this.m_Col = sCol;
    }

    /**
     * Gets the row number
     * @returns {number} Current row number
     */
    row() { return this.m_Row; }

    /**
     * Gets the column number
     * @returns {number} Current column number
     */
    col() { return this.m_Col; }

    /**
     * Clones properties from another point
     * @param {tPoint} sPoint - Source point to clone from
     */
    clone(sPoint) {
        for (let key in sPoint) {
            this[key] = sPoint[key];
        }
    }
}

/**
 * Class tRange
 * Represents a range of cells in the spreadsheet
 * @extends tPoint
 */
export class tRange extends tPoint {
    /**
     * Creates a new range
     * @param {number} sTop - Top row
     * @param {number} sLeft - Left column
     * @param {number} sBottom - Bottom row
     * @param {number} sRight - Right column
     */
    constructor(sTop, sLeft, sBottom, sRight) {
        super(sTop, sLeft);
        this.m_Bottom = sBottom;
        this.m_Right = sRight;
    }

    /**
     * Gets the bottom row
     * @returns {number} Bottom row number
     */
    bottom() { return this.m_Bottom; }

    /**
     * Gets the right column
     * @returns {number} Right column number
     */
    right() { return this.m_Right; }

    /**
     * Sets the bottom row
     * @param {number} sBottom - New bottom row number
     */
    setBottom(sBottom) {
        this.m_Bottom = sBottom;
    }

    /**
     * Sets the right column
     * @param {number} sRight - New right column number
     */
    setRight(sRight) {
        this.m_Right = sRight;
    }

    /**
     * Normalizes the range (ensures top-left is less than bottom-right)
     * @returns {boolean} True if normalization was needed
     */
    normalize() {
        let wNormalize = false;
        if (this.m_Row > this.m_Bottom) {
            let wSwap = this.m_Row;
            this.m_Row = this.m_Bottom;
            this.m_Bottom = wSwap;
            wNormalize = true;
        }
        
        if (this.m_Col > this.m_Right) {
            let wSwap = this.m_Col;
            this.m_Col = this.m_Right;
            this.m_Right = wSwap;
            wNormalize = true;
        }
        return wNormalize;
    }
}

/**
 * Class tSizer
 * Handles column/row resizing operations
 */
export class tSizer {
    constructor() {
        this.m_Top = true;
        this.m_Active = false;
        this.m_ColRow = 0;
        this.m_Start = 0;
        this.m_Move = 0;
    }

    // Getters and setters for all properties
    setTop(sTop) { this.m_Top = sTop; }
    top() { return this.m_Top; }

    setActive(sActive) { this.m_Active = sActive; }
    active() { return this.m_Active; }

    setColRow(sColRow) { this.m_ColRow = sColRow; }
    colRow() { return this.m_ColRow; }

    setStart(sStart) { this.m_Start = sStart; }
    start() { return this.m_Start; }
    
    setMove(sMove) { this.m_Move = sMove; }
    move() { return this.m_Move; }
}

/**
 * Class tSelect
 * Main selection management system for the spreadsheet
 */
export class tSelect {
    constructor() {
        this.m_Cursor = new tPoint(1, 1);
        this.m_Selections = []; // Array of tPoint and tRange
        this.m_Shift = false;
        /** When the cursor sits in a merged block, header bands highlight the full span. */
        this.m_CursorMerge = null;
    }

    /**
     * Remember merged bounds for cursor-only selection (no drag range yet).
     * @param {number} top
     * @param {number} left
     * @param {number} bottom
     * @param {number} right
     */
    setCursorMergeBounds(top, left, bottom, right) {
        this.m_CursorMerge = {
            top: Number(top),
            left: Number(left),
            bottom: Number(bottom),
            right: Number(right),
        };
    }

    clearCursorMergeBounds() {
        this.m_CursorMerge = null;
    }

    cursorRowSelected(sValue) {
        if (this.m_Selections.length > 0) {
            return this.m_Cursor.row() === sValue;
        }
        if (this.m_CursorMerge) {
            return sValue >= this.m_CursorMerge.top && sValue <= this.m_CursorMerge.bottom;
        }
        return this.m_Cursor.row() === sValue;
    }

    cursorColSelected(sValue) {
        if (this.m_Selections.length > 0) {
            return this.m_Cursor.col() === sValue;
        }
        if (this.m_CursorMerge) {
            return sValue >= this.m_CursorMerge.left && sValue <= this.m_CursorMerge.right;
        }
        return this.m_Cursor.col() === sValue;
    }

    /**
     * Sets the cursor position
     * @param {tPoint} sCursor - New cursor position
     */
    setCursor(sCursor) {
        this.m_Cursor = sCursor;
    }
    
    /**
     * Gets the current cursor position
     * @returns {tPoint} Current cursor
     */
    cursor() {
        return this.m_Cursor;
    }

    /**
     * Converts a cell to string representation (e.g., "A1")
     * @param {tPoint} sCell - Cell to convert
     * @returns {string} Cell reference string
     */
    strCell(sCell) {
        return window.SkUISpreadSheet.base10toAlphaSync(sCell.col()) + sCell.row();
    }

    /**
     * Converts a range to string representation (e.g., "A1:B2")
     * @param {tRange} sRange - Range to convert
     * @returns {string} Range reference string
     */
    strRange(sRange) {
        return window.SkUISpreadSheet.base10toAlphaSync(sRange.col()) + sRange.row() + ":" +
               window.SkUISpreadSheet.base10toAlphaSync(sRange.right()) + sRange.bottom();
    }

    /**
     * Gets the current cursor position as a string
     * @returns {string} Cursor reference string
     */
    cursorStr() {
        return window.SkUISpreadSheet.base10toAlphaSync(this.m_Cursor.col()) + this.m_Cursor.row();
    }

    /**
     * Gets all selections as a string
     * @returns {string} All selections as a semicolon-separated string
     */
    str() {
        let wStr = "";
        if (this.m_Selections.length > 0) {
            wStr += this.strRange(this.m_Selections[0]);
            for (let i = 1; i < this.m_Selections.length; i++) {
                wStr += ";" + this.strRange(this.m_Selections[i]);
            }
        } else {
            wStr = this.cursorStr();
        }
        return wStr;
    }

    /**
     * Gets merged selections as a string
     * @param {SkSpInterface} sSpInterface - Spreadsheet interface
     * @returns {string} Merged selections as a string
     */
    async strMerged(sSpInterface) {
        let wStr = "";
        let wInd = 0;
        this.m_Selections.forEach((wRange) => {
            if (wInd > 0) wStr += ";";
            wStr += this.strRange(wRange);
            wInd += 1;
        });
        if (wStr === "") {
            let wRange = await sSpInterface.rangeSelect(this.m_Cursor);
            wStr = this.strRange(wRange);
        }
        return wStr;
    }

    /**
     * Adds a range to selections
     * @param {tRange} sRange - Range to add
     */
    push(sRange) {
        this.m_Selections.push(sRange);
    }

    /**
     * Gets the last selection
     * @returns {tRange|null} Last selection or null if none
     */
    last() {
        return this.m_Selections.length > 0 ? this.m_Selections[this.m_Selections.length - 1] : null;
    }
    
    /**
     * Removes the last selection
     */
    deleteLast() {
        this.m_Selections.splice(-1);
    }

    /**
     * Gets all selections
     * @returns {Array} Array of selections
     */
    selections() {
        return this.m_Selections;
    }

    /**
     * Clones selections from another selection object
     * @param {Array} sSelection - Source selections to clone
     */
    selectionsClone(sSelection) {
        this.m_Selections = [];
        sSelection.forEach(wRange => {
            this.m_Selections.push(new tRange(wRange.m_Row, wRange.m_Col, wRange.m_Bottom, wRange.m_Right));
        });
    }

    /**
     * Clears all selections
     */
    raz() {
        this.m_Selections = [];
    }

    /**
     * Checks if a row is selected
     * @param {number} sValue - Row to check
     * @returns {boolean} True if row is selected
     */
    selectedRow(sValue) {
        let wOk = false;
        if (this.cursorRowSelected(sValue)) {
            wOk = true;
        }
        this.m_Selections.forEach((wRange) => {
            if ((sValue >= wRange.m_Row) && (sValue <= wRange.m_Bottom)) {
                wOk = true;
            }
        });
        return wOk;
    }

    /**
     * Checks if a column is selected
     * @param {number} sValue - Column to check
     * @returns {boolean} True if column is selected
     */
    selectedCol(sValue) {
        let wOk = false;
        if (this.cursorColSelected(sValue)) {
            wOk = true;
        }
        this.m_Selections.forEach((wRange) => {
            if ((sValue >= wRange.m_Col) && (sValue <= wRange.m_Right)) {
                wOk = true;
            }
        });
        return wOk;
    }
    /**
     * Selects all cells in the column to the left of the cursor
     */
    selectAllRow() {
       // Test if all columns are selected
       if (this.m_Selections.length === 1) {
            if (this.m_Selections[0].m_Row === 1 && this.m_Selections[0].m_Bottom === SkMaxRow) {
                return;
            }
        }
        this.m_Selections = [];
        this.m_Selections.push(new tRange(1, this.m_Cursor.col(), SkMaxRow, this.m_Cursor.col()));
    }

    selectAllColumn() {
        // Test if all rows are selected
        if (this.m_Selections.length === 1) {
            if (this.m_Selections[0].m_Col === 1 && this.m_Selections[0].m_Right === SkMaxCol) {
                return;
            }
        }
        this.m_Selections = [];
        this.m_Selections.push(new tRange(this.m_Cursor.row(), 1, this.m_Cursor.row(), SkMaxCol));
    }
    
}

/**
 * Class tInterval
 * Represents a continuous range of rows or columns
 */
export class tInterval {
    /**
     * Creates a new interval
     * @param {number} sAnchor - Anchor point
     */
    constructor(sAnchor) {
        this.m_Anchor = sAnchor;
        this.m_Begin = sAnchor;
        this.m_End = sAnchor;
    }

    /**
     * Moves the interval
     * @param {number} sValue - New value
     */
    move(sValue) {
        if (sValue < this.m_Anchor) {
            this.m_Begin = sValue;
            this.m_End = this.m_Anchor;
        } else {
            this.m_End = sValue;
            this.m_Begin = this.m_Anchor;
        }
    }

    /**
     * Compares this interval with another
     * @param {tInterval} sI2 - Interval to compare with
     * @returns {boolean} True if this interval should come before sI2
     */
    sort(sI2) {
        if (this.m_Begin === sI2.m_Begin) {
            return this.m_End < sI2.m_End;
        }
        return this.m_Begin < sI2.m_Begin;
    }
}

/**
 * Class tColRowSelect
 * Manages row/column selection
 */
export class tColRowSelect  {
    /**
     * Creates a new column/row selector
     * @param {boolean} sIsRow - True for row selection, false for column selection
     */
    constructor(sIsRow) {
        this.m_Selections = [];
        this.m_IsRow = sIsRow;
    }

    /**
     * Sorts selections
     */
    sort() {
        this.m_Selections.sort((sI1, sI2) => sI1.sort(sI2));
    }

    /**
     * Gets the last selection
     * @returns {tInterval|null} Last selection or null if none
     */
    last() {
        return this.m_Selections.length > 0 ? this.m_Selections[this.m_Selections.length - 1] : null;
    }

    /**
     * Starts a new selection
     * @param {number} sAnchor - Anchor point
     */
    start(sAnchor) {
        this.raz();
        let wInterval = new tInterval(sAnchor);
        this.m_Selections.push(wInterval);
    }

    /**
     * Moves the current selection
     * @param {number} sValue - New value
     */
    move(sValue) {
        let wInterval = this.last();
        wInterval.move(sValue);
    }

    /**
     * Checks if a value is selected
     * @param {number} sValue - Value to check
     * @returns {boolean} True if value is selected
     */
    selected(sValue) {
        let wOk = false;
        this.m_Selections.forEach((wInterval) => {
            if ((sValue >= wInterval.m_Begin) && (sValue <= wInterval.m_End)) {
                wOk = true;
            }
        });
        return wOk;
    }

    /**
     * Ends the current selection
     */
    end() {
        // Implementation can be added if needed
    }
    
    /**
     * Clones selections from another selector
     * @param {Array} sSelection - Source selections to clone
     */
    selectionsClone(sSelection) {
        this.m_Selections = [];
        sSelection.forEach(wInterval => {
            this.m_Selections.push(new tInterval(wInterval.m_Anchor));
            this.last().m_Begin = wInterval.m_Begin;
            this.last().m_End = wInterval.m_End;
        });
    }

    /**
     * Clears all selections
     */
    raz() {
        this.m_Selections = [];
    }
    
    /**
     * Gets all selections
     * @returns {Array} Array of selections
     */
    selections() {
        return this.m_Selections;
    }

    /**
     * Gets selections as a string.
     * Uses engine ColRow full-span refs so IsRowSelect / IsColSelect match:
     * - row: @R:XFDR (col 0 .. MaxCol)
     * - col: C0:CMaxRow (row 0 .. MaxRow)
     * @returns {string} Selections as a string
     */
    str() {
        let wStr="";
        this.m_Selections.forEach((wInterval) => {
            if (wStr!=="") wStr+=";";
            if (this.m_IsRow) {
                // Col 0 is "@" in Base10ToAlpha — required for ApplyColRowFormat.
                wStr += "@" + wInterval.m_Begin + ":" +
                    window.SkUISpreadSheet.base10toAlphaSync(SkMaxCol) + wInterval.m_End;
            } else {
                wStr += window.SkUISpreadSheet.base10toAlphaSync(wInterval.m_Begin) + "0:" +
                    window.SkUISpreadSheet.base10toAlphaSync(wInterval.m_End) + SkMaxRow;
            }
        });
        return(wStr);
    }

    strColRow() {
        let wStr = "";
        if (this.m_Selections.length > 0) {
            let wInterval = this.m_Selections[0];
            if (this.m_IsRow) {
                wStr += "@" + wInterval.m_Begin + ":" +
                        window.SkUISpreadSheet.base10toAlphaSync(SkMaxCol) + wInterval.m_End;
            } else {
                wStr += window.SkUISpreadSheet.base10toAlphaSync(wInterval.m_Begin) + "0:" +
                        window.SkUISpreadSheet.base10toAlphaSync(wInterval.m_End) + SkMaxRow;
            }
        }
        return wStr;
    }
}

export default tSelect;