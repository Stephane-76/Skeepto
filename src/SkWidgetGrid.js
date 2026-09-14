import * as React from "react";
import { SkComponent } from './component/SkComponent'
import { SkGrid } from './component/SkGrid'
import { SkActionButton as ActionButton } from './component/SkActionButton'
import { ReactComponent as SvgMinus } from './svg/minus.svg'
export class SkWidgetGrid extends SkComponent {
  constructor(props) {
    super(props)
 
    this.state = {   
      recordList: [],
      selectedRow: null,
      readOnly: true,
      columns: [],
      Validate: false
    };
  
    this.m_WidgetName = props.widgetname
    this.m_TableName = props.tablename
    this.m_Form = null
    this.m_Table = null
    this.m_OnRecordSelect = props.onRecordSelect;
    this.getWidget()
  }

  async getWidget() {
    // Load Model =============================================================
    let wResultStr = await window.WebInterface.getJson("/meta/widget/" + this.m_WidgetName + "_Grid")   
    let wResult = JSON.parse(wResultStr)

    if (wResult.message === "success") {
      this.m_Form = wResult.object
      this.setState({ 
        columns: wResult.object.m_Groups[0].m_Fields,
        Validate: false 
      })
      this.loadTable();
    }
  }

  async loadTable() {
    // Load Data ==============================================================
    let wResultStr = await window.WebInterface.getJson("/meta/table/" + this.m_TableName)   
    let wResult = JSON.parse(wResultStr)
    
    if (wResult.message === "success") {
      this.m_Table = wResult.object;
      
      // Refresh columns from the table
      const updatedColumns = this.state.columns.map(field => {
        const columnInfo = this.m_Table.m_Columns.find(col => col.m_Name === field.m_Name);
        let width=field.m_Width;
        if (width===0) {
          width=columnInfo?.m_Length ? `${columnInfo.m_Length * 5}px` : '150px';
        }
        
        return {
          m_Label: field.m_Label || field.m_Name,
          m_Name: field.m_Name,
          m_Width: width,
          m_TypeField: field.m_TypeField || 'string'
        };
      });

      this.setState({ 
        columns: updatedColumns,
        Validate: false 
      }, () => {
        this.loadData();
      });
    }
  }

  async loadData() {
    // Load Data ==============================================================
    let wSqlQuery = "{\"select\":\"SELECT * FROM " + this.m_TableName + "\"}"
    let wResult = await window.WebInterface.postJson('/sql', wSqlQuery)
    let wObjResult = JSON.parse(wResult)
    if (wObjResult.message === 'success') {
      this.setState({ 
        recordList: wObjResult.records,
        Validate: true 
      });
    }
    console.log('Get Grid ----->', wResult)
  }

  onCellEdit = (rowIndex, columnField, newValue) => {
    console.log('Cell edited:', rowIndex, columnField, newValue);
    // Update data
    const newData = [...this.state.recordList];
    newData[rowIndex] = {
      ...newData[rowIndex],
      [columnField]: newValue
    };
    this.setState({ recordList: newData });
  }

  handleEditClick = (rowIndex) => {
    console.log('Edit clicked for row:', rowIndex);
    // Here you can add logic to open a modification form
    // or perform other edit-related actions
  }

  handleDeleteClick = (rowIndex) => {
    console.log('Delete clicked for row:', rowIndex);
    // Remove row from data
    const newData = [...this.state.recordList];
    newData.splice(rowIndex, 1);
    this.setState({ recordList: newData });
  }

  handleRowSelect = (row) => {
    this.setState({ selectedRow: row });
    // Bubble the selection up to the parent (SkWidgetInput) which owns the
    // single editing form. The grid no longer renders a form of its own.
    if (this.m_OnRecordSelect) {
      this.m_OnRecordSelect(row);
    }
    console.log('Row selected:', row);
  }

  toggleReadOnly = () => {
    this.setState({ readOnly: !this.state.readOnly });
  }

  onResetGrid = () => {
    this.loadData();
  }

  render() {
    if (this.state.Validate === false) return (<h1>Load</h1>)
    let wClassName = this.m_Form?.m_Style || ''

    // Merge parent-provided style so the grid can be embedded inside a flex
    // layout (e.g. flex:1, minHeight:0) without losing the column structure.
    const rootStyle = {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      ...(this.props.style || {})
    };

    return (
      <div className={wClassName} ref={this.m_Ref} style={rootStyle}>
        <div className="SkWidgetGridControls" style={{ flex: '0 0 auto' }}>
        <div className='SkFlexRow' style={{ display: 'flex', gap: 10, padding: 10, alignItems: 'center' }}>
        <ActionButton
                  component={SvgMinus}
                  label="Delete"
                  color="#f44336"
                  onClick={this.handleDeleteClick}
        />
        </div>
        </div>
        <SkGrid
          style={{
            width: '100%',
            flex: '1 1 auto',
            minHeight: 0
          }}
          readOnly={this.state.readOnly}
          columns={this.state.columns}
          data={this.state.recordList}
          onRowSelect={this.handleRowSelect}
          selectedRow={this.state.selectedRow}
          onCellEdit={this.onCellEdit}
          onEdit={this.handleEditClick}
          onDelete={this.handleDeleteClick}
        />
      </div>
    )
  }
}

export default SkWidgetGrid; 