
import * as React  from "react";
import { SkComponent } from './component/SkComponent'
import { SkWidgetForm } from './SkWidgetForm';
import { SkWidgetGrid } from './SkWidgetGrid'
import "./App.css"


class SkWidgetInput extends SkComponent {
    constructor(props) {
      super(props)
      this.m_WidgetName=props.widgetname
      this.m_TableName=props.tablename
      this.setState( {  
        WidgetName : this.m_WidgetName,
        TableName : this.m_TableName,
        invalidate : false
      })
      this.m_RefForm=React.createRef();
      this.m_RefGrid=React.createRef();
      this.m_OnRecordSelect=props.onRecordSelect;
    }

    onRecordSelect= (record) => {
      console.log(record)
      this.m_RefForm.current.setRecord(record);
    }

    onResetCards=() => {
      this.m_RefCards.current.loadData();
    }

    render() {
      // Full-height column: form keeps its natural height at the top, grid
      // expands to fill the remaining space and scrolls internally.
      // (`SkFlex` is `inline-flex` which would not stretch — use display:flex.)
      return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
      }}>
        <div style={{ flex: '0 0 auto' }}>
          <SkWidgetForm
            ref={this.m_RefForm}
            widgetname={this.m_WidgetName}
          />
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex' }}>
          <SkWidgetGrid
            ref={this.m_RefGrid}
            style={{ flex: 1, minHeight: 0 }}
            widgetname={this.m_WidgetName}
            tablename={this.m_TableName}
            onRecordSelect={this.onRecordSelect}
          />
        </div>
     </div>
    );
  }
}
// ========================================

export default SkWidgetInput;