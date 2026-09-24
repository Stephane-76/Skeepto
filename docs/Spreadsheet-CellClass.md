# CellClass widgets

These classes are the **extensible** cell widgets (`SkCellClassCheck`,
`SkCellClassComboBox`, …). They are not the spreadsheet chrome. The shell
(`SkSpreadSheet`, canvas, ribbon, panels) is described in
[`Spreadsheet-React-Classes.md`](./Spreadsheet-React-Classes.md).

A new widget is a subclass of `SkCellClass`. You add a file under
`src/spreadsheet/CellClass/` and register it. You do not edit the grid,
the ribbon, or the canvas to make it appear.

The WASM engine in **skeepto-engine** is generic on this point. It does not
contain one C++ type per widget. `RegisterClassAttribute` records the class
name, and `AddProperty` records each attribute. A new `SkCellClassXxx` is
accepted with no change to the engine and no WASM rebuild.

Some of the built-in classes exist to carry Excel objects through that same
generic path. An Excel sparkline becomes a `SkCellClassSparkline` on the
cell. An Excel chart becomes a floating `SkCellClassLineChart` or
`SkCellClassPieChart`. Import and export map the workbook onto these classes;
they do not add a chart type inside the engine.

Units (`tCellUnit`) are not part of this family. There is no
`SkCellClassUnit.js`. They are painted by the canvas. See the Unit section
of [`Spreadsheet-React-Classes.md`](./Spreadsheet-React-Classes.md).

C++ paths are relative to `skeepto-engine/`. JavaScript paths are relative to
`skeepto/src/spreadsheet/`.

---

## 1. Where a widget shows up

`SkSpGridPanel` overlays a React widget on a JsonView cell when `c_t` is
`"c"` and `c_v.co` is set. `c_v.n` is the **class** name (`SkCellClassCheck`),
never the instance name.

```json
{
  "c_t": "c",
  "c_v": {
    "n": "SkCellClassCheck",
    "co": { },
    "c": { "t": "b", "v": true }
  }
}
```

- `c_v.n` — factory type. `GetRender` in `SkCellClass.js` picks the component.
- `c_v.c` — calculable payload (bool, date, string).
- `c_v.co` — marker that a React renderer exists.

A floating widget (`floatingObject`) is drawn by `SkSpFloatingLayer` instead
of the in-cell overlay. The same class and the same attributes apply.

---

## 2. The base class

`SkCellClass` (`CellClass/SkCellClass.js`) is the ancestor. A subclass
implements:

| Method | Role |
|--------|------|
| `ClassName()` | Factory name. Must match the file and the C++ registration (`SkCellClassXxx`) |
| `Icon()` | Palette glyph in `SkSpClass` |
| `registerClassAttribute(ui)` | Declares the model: label, family, properties |
| `cellClassCapabilities()` | Optional. Cross-cutting behavior (see below) |
| `render()` | The widget. Receives the cell JSON and `SpInterface` |

After WASM loads, `SkCellClassContainer` calls `registerClassAttribute()` on
each concrete class. That does two things:

1. Registers the JS renderer (`GetRender(className)`).
2. Registers the model on the engine (`RegisterClassAttribute` + `AddProperty`).

`addProperty` on the JS model becomes a C++ property on
`tCellModelClassAttribute`. Each property is a **first-class cell**
(`tCellAttribute`) hanging off the host. The formula parser treats it as a
member of the instance ([section 4](#4-attributes-in-formulas)).

| Capability | Effect |
|------------|--------|
| `floatingObject` | May live outside a cell (`SkSpFloatingLayer`) |
| `selfEditing` | Own editor; no generic `SkSpInplaceEdit` overlay |
| `inplaceEditBlocked` | No in-cell text edit (toggle, sparkline) |
| `calculableModelValue` | Scalar in `c_v.c.t` / `c_v.c.v` (bool, date, string) |

The container (`CellClass/SkCellClassContainer.js`) is the only list of
built-in widgets. Registration is skipped when the same WASM instance already
has them, so navigating away and back does not re-register.

---

## 3. Built-in widgets

| Class | Kind | Capabilities | Notes |
|-------|------|--------------|--------|
| `SkCellClassCheck` | Checkbox | inplace blocked, calculable bool | Value in the model, label as attribute |
| `SkCellClassSwitch` | Switch | same | |
| `SkCellClassButton` | Button | — | `onClick` event |
| `SkCellClassComboBox` | List | self-editing, calculable string | |
| `SkCellClassCalendar` | Date | self-editing, calculable date | |
| `SkCellClassSparkline` | Mini chart | inplace blocked | Stays in the cell |
| `SkCellClassCanvas` | Free canvas | floating | |
| `SkCellClassPieChart` | Pie | floating | |
| `SkCellClassLineChart` | Line | floating | |
| `SkCellClassGauge` | Gauge | floating | |
| `SkCellClassImage` | Image | floating | |
| `SkCellClassTextBox` | Text box | floating | |

These classes are examples of the extension point. A product widget follows
the same three steps as they do: subclass, `registerClassAttribute`, one line
in `SkCellClassContainer`.

---

## 4. Attributes in formulas

Placing a class on a cell does more than draw a widget. The instance **exposes
every registered property** to the worksheet formula language.

Put `MaClasse` on **A1**. If the model registered `myAttribute`, then **B1**
can read it:

```text
B1 = A1.myAttribute
```

The Lemon grammar accepts a cell (or an identifier) followed by `.Attribute`
(`CELL attribute` / `ID attribute` in `SkLemonSpreadSheet.y`). At evaluation,
`PushCell` / `PushID` resolve that member to the `tCellAttribute` on the
host (`tLemonInterface::CellAttribute`). The attribute sits on the calculation
path like any other cell: dependents recalc when it changes.

Two equivalent spellings:

| You type | What it binds |
|----------|----------------|
| `=A1.myAttribute` | Host **address** + property name |
| `=MaClasse.myAttribute` | Instance **ref name** (`RefName()`) + property name |

The engine often **rewrites** the address form to the instance name when
displaying the formula. Example from the unit tests: `=A3.Int+1` is stored /
shown as `tTestClass2.Int+1`. Clearing the host becomes `#REF!.Int`.

An attribute is itself a formula cell:

```text
A1.Int          = 12              literal
A1.Temperature  = A1.Int          another attribute of the same instance
A1.Name         = JSON(B2:B4)     worksheet function
C1              = A3.Int+1        another cell reading the instance
```

The Attribute tab (`SkSpClassAttribute`) edits these properties. Range-kind
properties (`kind: "range"`) store an A1 range (or a formula that evaluates
to one). The widget reads the **evaluated** value via `GetProperty` /
`resolvePropertyRangeRef`.

Deleting the host invalidates every `Host.attr` reference (`#REF!.attr`).
Moving a range updates attribute formulas the same way as ordinary cell refs.

---

## 5. How charts use attributes

Charts are not a separate data pipeline. `SkCellClassLineChart` /
`SkCellClassPieChart` / `SkCellClassGauge` / `SkCellClassSparkline` register
properties, then the React widget **reads those attributes** to know what to
plot.

![Expense report — pie, line, bar and gauge driven by the Attribute panel](./Graphics.png)

The Attribute tab on the selected chart (`Graphics.sker`) binds `Title`,
label range `B5:B10`, value range `C5:E10`, and series labels `C4:E4` to the
table on the left. Gauge, pie, line, and bar widgets all consume the same
kind of properties.

Typical LineChart model (`registerClassAttribute`):

| Property | Kind | Role |
|----------|------|------|
| `Title` | string | Chart title (literal or `=Sheet1!A1`) |
| `chartData` | range | Labels, or combined labels+values |
| `DataRange` | range | Values (or combined A:B block) |
| `seriesLabels` | range | Series names |
| `chartType` | enum | `line` / `bar` / `area` |
| `barDirection` | enum | `vertical` / `horizontal` |

So if the chart class sits on A1 (or as a floating object anchored on `_$$A`):

```text
A1.Title          = Expense report
A1.chartData      = B5:B10
A1.DataRange      = C5:E10
A1.seriesLabels   = C4:E4
```

The widget calls `resolvePropertyRangeRef(cell, "chartData")` (and
`DataRange`, …), pulls the viewport values, and paints. Another cell can
still do `=A1.Title` or `=A1.DataRange` — same member syntax as
`=A1.myAttribute`.

Floating charts keep the same attributes on the hidden host cell `_$$A`;
the formula language still addresses them by instance name.

---

## 6. Add a widget

1. Create `CellClass/SkCellClassXxx.js` extending `SkCellClass`.
2. Implement `ClassName()`, `Icon()`, `registerClassAttribute()`, and optionally
   `cellClassCapabilities()`.
3. Import it in `SkCellClassContainer.js` and call
   `SkCellClassXxx.registerClassAttribute(window.SkUISpreadSheet)` inside
   `RegisterClasses()`.
4. Do not modify skeepto-engine. `RegisterClassAttribute` and `AddProperty`
   already accept the new name and its properties.

The palette (`SkSpClass`) lists whatever the container registered. The
Attribute tab (`SkSpClassAttribute`) edits the properties that
`registerClassAttribute` declared.

---

## 7. Key files

| Topic | File |
|-------|------|
| Ancestor | `skeepto/src/spreadsheet/CellClass/SkCellClass.js` |
| Built-in list | `skeepto/src/spreadsheet/CellClass/SkCellClassContainer.js` |
| In-cell overlay | `skeepto/src/spreadsheet/SkSpGridPanel.js` |
| Floating overlay | `skeepto/src/spreadsheet/SkSpFloatingLayer.js` |
| Palette | `skeepto/src/spreadsheet/SkSpClass.js` |
| Attribute panel | `skeepto/src/spreadsheet/SkSpClassAttribute.js` |
| Attribute host / `tCellClassAttribute` | `skeepto-engine/Libraries/SkSpreadSheet/include/SkCellClassAttribute.hpp` |
| Formula `.attr` (`PushCell` / `PushID`) | `skeepto-engine/Libraries/SkSpreadSheet/source/SkLemonInterface.cpp` |
| Grammar `CELL attribute` | `skeepto-engine/Libraries/SkSpreadSheet/lemon/SkLemonSpreadSheet.y` |
| Attribute tests (`=A3.Int`) | `skeepto-engine/Libraries_test/SkSpreadSheet/source/TestSkCellClassAttribute.cpp` |
