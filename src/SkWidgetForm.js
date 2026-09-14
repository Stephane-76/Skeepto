import * as React  from "react";
import { stringToStyles,SkComponent } from './component/SkComponent'

import bcrypt from 'bcryptjs'

import { SkForm } from "./component/SkForm";
import { SkInput } from "./component/SkInput";
import { SkPassWord } from "./component/SkPassWord";
import { SkCalendar } from "./component/SkCalendar";
import { SkError } from "./component/SkError";
import { SkActionButton } from "./component/SkActionButton";

import { ReactComponent as SvgPlus } from "./svg/plus.svg";
import { ReactComponent as SvgUpdate } from "./svg/shift-arrow.svg";
import { ReactComponent as SvgValid } from "./svg/check.svg";
import { ReactComponent as SvgClose } from "./svg/close.svg";
import "./App.css";

function generateHash(password) {
  try {
      const hash = bcrypt.hashSync(password, 10);
      console.log('Generated hash:', hash);
      // Store this hash securely
      return hash;
  } catch (err) {
      console.error('Error hashing password:', err);
      return null;
  }
}

// Local alias to keep the existing JSX call sites (`<ActionButton .../>`)
// readable. The implementation now lives in component/SkActionButton.js so it
// can be reused from other widgets (e.g. SkWidgetGrid).
const ActionButton = SkActionButton;

export class SkWidgetForm extends SkComponent {
  constructor(props) {
    super(props);
    this.state = {
      validateError : true,
      db_Error: '',
      record: this.props.record,
      state : 'disabled'
    }
    this.m_WidgetName=props.widgetname
    this.m_Form = null
    this.setState( {   Validate : true });
    this.inputRefs = {};
    
    this.m_FormRef=React.createRef();

    /* Form example
    this.m_Form = {
      m_TableName : 'Group',
      m_Style : 'SkForm',
      m_Direction : 'row',
      m_Groups : [
         { m_Name : "Code", m_Direction: 'row', m_Style : '', m_Label : 'Code',
          m_Fields : [
            { m_Name : 'Code', m_Db : true ,m_Label : 'Code' , m_Styles :  '"width" :"150px", "backgroundColor":"white", "color":"black", "margin":"2px", "padding":"2px"',   m_Style : '', m_TypeField : 'string' },
            { m_Name : 'Label', m_Db : true, m_Label : 'Label' , m_Styles :   '"margin":"2px", "padding":"2px", "width" :"200px"',  m_Style : '', m_TypeField : 'string'}
          ] },
          { m_Name : "Identification", m_Direction:'col', m_Styles : '"min-width":"400px"', m_Style : 'SkGroup', m_Label : 'Identification',
            m_Fields : [
              { m_Name : 'PassWord',m_Label : 'Password' , m_Styles : '"backgroundColor" : "red", "color": "red", "width" :"100px"', m_Style : '', m_TypeField : 'password' },
              { m_Name : 'Email',m_Label : 'Email adress' , m_Styles : '"color": "red"', m_Style : '', m_TypeField : 'email' } 
            ] 
          },   
          { m_Name : "Rules", m_Style : 'SkGroup', m_Label : 'Rules',
            m_Fields : [
              { m_Name : 'Owner',Db : true, m_Label : 'Owner' , m_Styles :   '"margin":"2px", "padding":"2px", "width" :"200px"', m_Style : '', m_TypeField : 'string'},
              { m_Name : 'Rules',Db : true, m_Label : 'Rules' , m_Styles :  '"margin":"2px", "padding":"2px", "width" :"400px"', m_Style : '', m_TypeField : 'string' }    
            ] 
          }  
      ],
    }
    */
  }

  componentDidMount() {
    this.get()
  }

  componentDidUpdate() {
  }

  setStateEnabled() {
    if (this.m_FormRef.current!==null) {
      switch(this.state.state) {
        case 'disabled':
          this.m_FormRef.current.setEnabled(false);
          break;
        case 'insert':
        case 'update': 
          this.m_FormRef.current.setEnabled(true);
          break;
        case 'delete':
          this.m_FormRef.current.setEnabled(false);
          break;
        default:
          this.m_FormRef.current.setEnabled(false);
          break;
      }
    }
  }

  async get() {
    let wResultStr=await window.WebInterface.getJson("/meta/widget/"+this.m_WidgetName)   
    let wResult=JSON.parse(wResultStr)

    if (wResult.message==="success") {
      this.m_Form=wResult.object
      this.setState( { Validate : false },() => {
        this.setStateEnabled();
      })
    }
    console.log('get Form ----->',wResult)
  }

  validate(sField,sValue ) {
    if ((sField===null) || (sField===undefined)) {
      console.log("Validate",null)
      return(true)
    }
    console.log("Validate",sField.m_Name," Db",sField.m_Db)
    switch(sField.m_TypeField) {
      case 'string' : break;
      case 'email' : {
        let wNode=document.getElementById(sField.m_Name+"Error")
        wNode.innerText="";
        if (sValue!=="") {
          if (!/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(sValue)) {
            wNode.innerText="Please enter a valid email";
            this.setState( { validate :false})
          }
        }
        break;
      }
      case 'password' : {
        let wNode=document.getElementById(sField.m_Name+"Error")
        wNode.innerText="";
        // Optional on update when the password is not being changed.
        if (this.state.state === 'update' && (!sValue || sValue === '')) {
          break;
        }
        // Password strength validation
        if (sValue.length < 8) {
          wNode.innerText="The password must be 8 characters or longer"
          this.setState( { validate :false})
        }
        // Check for common patterns
        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(sValue)) {
          wNode.innerText="Password must contain at least one uppercase letter, one lowercase letter, and one number"
          this.setState( { validate :false})
        }
        break;
      }
     
      default: break;
    }
    this.setState( { validate : true})
  } 

  findField = (sName) => {
    let wFieldResult=null
    this.m_Form.m_Groups.map((wGroup,wIndexGroup) => (   
      wGroup.m_Fields.filter(wField => wField.m_Name===sName).map( wField => 
         wFieldResult=wField 
      )
    ))
    return(wFieldResult)
  }

  findFirstField = () => {
    if (this.m_Form.m_Groups.length>0) {
      if(this.m_Form.m_Groups[0].m_Fields.length> 0) {
        return this.m_Form.m_Groups[0].m_Fields[0]
      }
    }
    return null
  }

  handleChange=(event) => {
    let wName=event.target.id
    let wField=this.findField(wName)
    let wValue=this.getValue(wName)
    console.log('Change ',wField,'=',wValue)

    let wOk=this.validate(wField,wValue)
    if (wOk!==this.state.validateError) { 
      this.setState( { validateError :!wOk } )
    }
  }

  // Method to create a ref for each input
  setInputRef = (name) => (element) => {
    this.inputRefs[name] = element;
  };

  // Method to get the value of an input by its name
  getValue = (sName) => {
    if (this.inputRefs[sName]) {
        return this.inputRefs[sName].value();
    }
    return null;
  };

  // Method to get the record
  getRecord=() => {
    let wRecord={};
    this.m_Form.m_Groups.forEach((wGroup) => {
      wGroup.m_Fields.filter(wField => wField.m_Db===true).forEach((wField) => {
        const wValue = this.getValue(wField.m_Name)
        if (wField.m_TypeField === 'password') {
          if (this.state.state === 'update' && (!wValue || wValue === '')) {
            return
          }
          wRecord[wField.m_Name] = generateHash(wValue)
        } else {
          wRecord[wField.m_Name] = wValue
        }
      })
    })
    return wRecord
  }

  // Remove all errors
  clearErrors = () => {
    this.m_Form.m_Groups.forEach(group => {
        group.m_Fields.forEach(field => {
            const errorElement = document.getElementById(field.m_Name + "Error");
            if (errorElement) {
                errorElement.innerText = "";
            }
        });
    });
  }

  reset = () => {
    this.m_FormRef.current.reset();
  }

  insert=() => {
    this.setState( { state : 'insert' },() => {
      this.setStateEnabled();
      this.reset();
      if (this.findFirstField()!==null) {
        this.m_FormRef.current.setFocus(this.findFirstField().m_Name);
      }
    })
  }

  update=() => {
    this.setState( { state : 'update' },() => {
      this.setStateEnabled();
      if (this.findFirstField()!==null) {
        this.m_FormRef.current.setFocus(this.findFirstField().m_Name);
      }
    })
  }

  handleSubmit = async (event) => {
    let wState=this.state.state;
    event.preventDefault();
    this.setState( { validateError : true } )
    // Verify ===================================================
    this.m_Form.m_Groups.map(wGroup => (  
      wGroup.m_Fields.map( wField => ( 
        this.validate(wField,this.getValue(wField.m_Name))
        )
      ) 
    ))
  
    if (this.state.validateError===false) {
        return
    }
  
    // Post ======================================================
    let wRecord=this.getRecord();
    
    const wJson = JSON.stringify(wRecord);
    let wJsonRet=await window.WebInterface.postJson('/mdb/'+this.m_Form.m_TableName,wJson,this.state.state)
  
    const  wObjReturn=JSON.parse(wJsonRet)
    if (wObjReturn.message==='success') {
      if (wState==='insert') {
        this.reset();
      }
      this.setState( { db_Error : '' }) 
      this.setState( { state : 'disabled' },() => {
        this.setStateEnabled();
      })
      if (this.props.onResetCards) {
        this.props.onResetCards();
      }
    } else {
      this.setState( { db_Error : wObjReturn.error }) 
    }
    console.log("<--",wJson);
    console.log("--> ",wJsonRet);
  }
 
  
  setRecord(sRecord) {
    if (!sRecord) return; // Guard against a null or undefined record
      if (this.state.state==='disabled') {
      this.setState( { record : sRecord },() => {
        this.setStateEnabled();
      })
      this.m_Form.m_Groups.forEach((wGroup) => {
          wGroup.m_Fields.forEach((wField) => {
            if (sRecord.hasOwnProperty(wField.m_Name)) {
              if (this.inputRefs[wField.m_Name]) {
                  this.inputRefs[wField.m_Name].setValue(sRecord[wField.m_Name]);
              }
            }
        });
    });
  
   }
  }

  delete=async(event) => {
    event.preventDefault();
    
    const wRecord=this.getRecord()
    console.log("Delete -->",wRecord)
    const wJsonRet=await window.WebInterface.postJson('/mdb/'+this.m_Form.m_TableName,JSON.stringify(wRecord),'delete')
    const wObjReturn=JSON.parse(wJsonRet)
    if (wObjReturn.message==='success') {
      this.setState( { state : 'disabled' },() => {
        this.setStateEnabled();
      })
      if (this.props.onResetCards) {
        this.props.onResetCards();
      }
    } else {
      this.setState( { db_Error : wObjReturn.error }) 
    }
    this.setState( { record : null })
  }


  handleCancel = () => {    
    this.setState( { state : 'disabled' },() => {
      this.reset();
      this.clearErrors();
      this.setState( { record : undefined }) 
      this.setStateEnabled();
    })
  }

  renderField(sField) {
    // Add width to styles if defined
    let baseStyles = stringToStyles(sField.m_Styles);
    let containerStyles = { ...baseStyles };
    if (sField.m_Width !== undefined) {
      containerStyles.width = sField.m_Width;
      baseStyles.width = "100%";
    }
    
    switch(sField.m_TypeField) {
      case 'string' : {  
        return(
          <div className={sField.m_Style} key={sField.m_Name} id={sField.m_Name} style={containerStyles}>
            <div>{sField.m_Label}</div>
            <SkInput placeholder={"Enter "+sField.m_Label} 
                ref={this.setInputRef(sField.m_Name)}
                id={sField.m_Name} 
                name={sField.m_Name}
                style={baseStyles}
                onChange={this.handleChange}></SkInput>
          </div>
        )
      }
      case 'email' : {
          return(
            <div className={sField.m_Style} key={sField.m_Name} id={sField.m_Name} style={containerStyles}>
            <div>{sField.m_Label}</div>
            <SkInput type="email" 
                placeholder={"Enter "+sField.m_Label}  
                id={sField.m_Name}
                ref={this.setInputRef(sField.m_Name)}
                style={baseStyles}
                onChange={this.handleChange}></SkInput>
            <div className="text-muted">
                We'll never share your email with anyone else.
            </div>
            <SkError id={sField.m_Name+"Error"} ></SkError>
            </div>
          )
      }
      case 'password' : {
          return(
            <div className={sField.m_Style}  key={sField.m_Name} id={sField.m_Name} style={containerStyles}>
            <div>{sField.m_Label}</div>
            <SkPassWord type="password" 
                placeholder={"Enter "+sField.Label}  
                id={sField.m_Name}
                ref={this.setInputRef(sField.m_Name)}
                style={baseStyles}
                onChange={this.handleChange}></SkPassWord>
            <div className="text-muted">
                Enter a strong pasword.
            </div>
            <SkError id={sField.m_Name+"Error"} ></SkError>
            </div>
        )
      }
      case 'date': {
        return (
            <div className={sField.m_Style} key={sField.m_Name} id={sField.m_Name} style={containerStyles}>
                <div>{sField.m_Label}</div>
                <SkCalendar
                    placeholder={"Select a date"}  // English placeholder
                    id={sField.m_Name}
                    ref={this.setInputRef(sField.m_Name)}
                    style={baseStyles}
                    onChange={this.handleChange}
                />
            </div>
        );
      }
      default: break;
    }
  }

  renderGroup(sGroup) {
    let wDirection='SkFlexColumn'
    if (sGroup.hasOwnProperty('m_Direction')) {
      if (sGroup.m_Direction==='row') wDirection='SkFlexRow'
    }
    return(
      <div  key={sGroup.m_Name+"1"} style={stringToStyles(sGroup.m_Styles)} className={sGroup.m_Style+" SkForm-group"}>
      <h2>{sGroup.m_Label}</h2>
      <div className={"SkFlex "+wDirection}>
      {        
        sGroup.m_Fields.map(wField  => (
            this.renderField(wField)
         ))
      }
      </div>
      </div>
    )
  }

  renderBlock() {
     return(
        this.m_Form.m_Groups.map((wGroup,wIndexGroup) => (  
               this.renderGroup(wGroup)
          ) // Group
        ) // Map Group
      )
  }

  // Check if insert operation is allowed (returns true when form is in disabled state)
  canInsert=() => {
    return this.state.state==='disabled'
  }

  // Check if update operation is allowed (returns true when form is disabled and a record exists)
  canUpdate=() => {
    return (this.state.state==='disabled') && (this.state.record!==undefined)
  }

  // Check if delete operation is allowed (returns true when form is disabled and a record exists)
  canDelete=() => {
    return (this.state.state==='disabled') && (this.state.record!==undefined)
  }

  // Check if form submission is allowed (returns true when form is in insert or update state)
  canSubmit=() => {
    return (this.state.state==='insert') || (this.state.state==='update') 
  }

  // Cancel reverts an in-progress edit, so it shares the same precondition as Submit.
  canCancel=() => {
    return (this.state.state==='insert') || (this.state.state==='update')
  }

  render() {
    
    let wErrorVisible='invisible'
    if (this.m_Form===null) return(<div>
    <h1>Error Loading form....{this.m_TableName}</h1>
    </div>)

    let wDirection='SkFlexRow'
    if (this.m_Form.hasOwnProperty('m_Direction')) {
      if (this.m_Form.m_Direction==='col') wDirection='SkFlexColumn'
    }

    if (this.state.db_Error !=="") wErrorVisible='visible'
    return (
      <div className="SkFlex SkFlexColumn">
        <SkForm ref={this.m_FormRef} id="form" className={"SkFlex SkFlexRow SkSizeAuto Space Margin"} onSubmit={this.handleSubmit} onCancel={this.handleCancel} >   
           <div className={this.m_Form.m_Style+' '+wDirection}>
            {
              this.renderBlock()
            }
            </div>
        </SkForm>         
          <div className={wErrorVisible}>
            <div className="alert alert-error" role="alert">
              <h4 className="alert-heading">{this.state.db_Error}</h4>
            </div>
          </div>
          <div className='SkFlexRow' style={{ display: 'flex', gap: 10, padding: 10, alignItems: 'center' }}>
              <ActionButton
                  component={SvgPlus}
                  label="Insert"
                  color="#4CAF50"
                  disabled={!this.canInsert()}
                  onClick={this.insert}
              />
              <ActionButton
                  component={SvgUpdate}
                  label="Update"
                  color="#FF9800"
                  disabled={!this.canUpdate()}
                  onClick={this.update}
              />
              <ActionButton
                  component={SvgValid}
                  label="Submit"
                  color="#2196F3"
                  disabled={!this.canSubmit()}
                  onClick={this.handleSubmit}
              />
              <ActionButton
                  component={SvgClose}
                  label="Cancel"
                  color="#757575"
                  disabled={!this.canCancel()}
                  onClick={this.handleCancel}
              />
          </div>         
        </div>
    )
  }
}
// ============================================================================
export default SkWidgetForm;