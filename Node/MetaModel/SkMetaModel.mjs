// ============================================================================
// Meta model Sker
// Author Stéphane ALLEZ le 19/08/2024
// ============================================================================
import { writeFile } from "fs";
import { SkObjectArray } from "./SkSortFind.mjs";

export class SkItem {
    constructor(sName,sType) {
        //this.m_Arc=new SkObjectArray()
        this.m_Type = sType
        this.m_Name = sName
    }
    // Returns the shortest form for id management
    // Mongo DB 
    ReturnShortForID() {
        let wReturn = {}
        wReturn.m_Type=this.m_Type
        wReturn.m_Name=this.m_Name
        return(wReturn)
    }
}

export class SkArc extends SkItem  {
    constructor(sName) {
        super(sName,'arc')
        this.m_To = ""
        this.m_From =""
    }
}

export class SkColumn extends SkItem {
    constructor(sName,sTypeColumn,sLength,sNotNull) {
        super(sName,"column")
        this.m_TypeColumn =sTypeColumn
        this.m_Length = sLength
        this.m_NotNull = sNotNull
      }
}

export class SkForeign {
    constructor(sConstraint,sTableOwner,sTableRef) {
       this.m_Constraint=sConstraint
       this.m_Key=[]
       this.m_TableOwner=sTableOwner
       this.m_Ref=[]
       this.m_TableRef=sTableRef
    }

    AddKey(sKey) {
        this.m_Key.push(sKey)
    }

    AddRef(sRef) {
        this.m_Ref.push(sRef)
    }

    GetKeyRef(sObj) {
        const wReturn={}
        for(let wInd=0;wInd<this.m_Key.length;wInd++) {
            let wName=this.m_Key[wInd]
            let wNameRef=this.m_Ref[wInd]
            let wValue=sObj[wName]
            wReturn[wNameRef]=wValue            
        }
        return(wReturn)
    }
}


export class SkTable extends SkItem {
    constructor(sName) {
      super(sName,'table')
      this.m_Columns = []
      this.m_Primary = []
      this.m_Foreign =[]
      this.m_ExternForeign=[]
    }
    AddColumn(sColumn) {
        this.m_Columns.push(sColumn)
    }
    Column(sColumn) {
        let wResult=this.m_Columns.filter((sItem) =>  
            (sItem.m_Name==sColumn))
        return(wResult)
    }
    AddPrimary(sID) {
        this.m_Primary.push(sID)
    }

    AddForeign(sForeign) {
        this.m_Foreign.push(sForeign)
    }

    AddExternForeign(sForeign) {
        this.m_ExternForeign.push(sForeign)
    }

    PrimaryKey(sObj) {
        let wReturn={}
        for(let wKey of this.m_Primary) {
            if (wKey!=='_id') {
                wReturn[wKey]=sObj[wKey]
            }
        }
        return(wReturn)
    }

    Verify(sMetamodel) {
        for(let wColumn of this.m_Columns) {
            switch(wColumn.m_TypeColumn) {
                case 'string' : break;
                case 'number' : break;
                case 'date' : break;
                case 'id' : break;
                case 'boolean' : break;
                default : throw('On Table '+this.m_Name+' Column '+wColumn.m_Name+' bad type '+wColumn.m_TypeColumn)
            }
        }
        for(let wPrimary of this.m_Primary) {
            if (this.Column(wPrimary)===undefined) {
                throw('On Table '+this.m_Name+' Primary ('+wPrimary+") don't exists !")
            }
        }
        for(let wForeign of this.m_Foreign ) {

            if (wForeign.m_Key.length!=wForeign.m_Ref.length) {
                throw('On Table '+this.m_Name+' the table keys and the foreign table keys do not have the same number of items !')
            }
            for(let wKey of wForeign.m_Key) {
                if (this.Column(wKey).length===0) {
                    throw('On Table '+this.m_Name+' Foreign key Key( '+wKey+") don't exists !")
                }           
            }
            let wTableRefArray=sMetamodel.Table(wForeign.m_TableRef);
            if (wTableRefArray.length===0) {
                throw('On Table '+this.m_Name+' reference table ( '+wForeign.m_TableRef+") don't exists !")
            }
            let wTableRef=wTableRefArray[0]
            for(let wKey of wForeign.m_Ref) {
                if (wTableRef.Column(wKey)===undefined) {
                    throw('On Table '+this.m_Name+' table ref '+wTableRef.m_Name+' Reference key  ('+wKey+") don't exists !")
                }                  
            }
        }   
    }
    VerifNotNull(sColumn,sObj) {
        let wMessage=''
        // Test not null ==================================================
        if (sColumn.m_NotNull===true) {
            const wAttribute=sColumn.m_Name 
            const wValue=sObj[wAttribute]
            if ((wValue===undefined) || (wValue==='')) {
                wMessage=wAttribute+' is empty !'
                return(wMessage)
            }
        }
        return(wMessage)
    }
    VerifyRecord(sObj) {
        let wMessage=''
        for(let wColumn of this.m_Columns) {
            wMessage=this.VerifNotNull(wColumn,sObj)
            if (wMessage!='') return(wMessage)
        }
        for(let wColumnName of this.m_Primary) {
            let wColumnArray=this.Column(wColumnName)
            if (wColumnArray.length>0) {
                let wColumn=wColumnArray[0]
                if (!wColumn.m_NotNull) {
                    wMessage=this.VerifNotNull(wColumn,sObj)
                    if (wMessage!='') return(wMessage)
                }
                }
        }
        return(wMessage)
    }
    // In SkGenericDb Get one or multi record
    IsKeyIsPrimaryKey(sKeys) {
        if (sKeys.length==0) return(false)
        let wKeys=[];
        if (sKeys.length!=this.m_Primary.length) return(false)
        for(let wInd=0; wInd<sKeys.length; wInd++) {
            if (sKeys[wInd]!=this.m_Primary[wInd]) return(false)
        }
        return(true)
    }
    // For Instance ================================================================
    LoadFromObject(sTable) {
        sTable.m_Columns.map((wColumn,wIndex) => {
            //console.log("    -->",wColumn.name)
            // 
            let wNotNull=false
            if (wColumn.hasOwnProperty("m_NotNull")) wNotNull=wColumn.m_NotNull;  
            let wLength=0
            if (wColumn.hasOwnProperty("m_Length")) wLength=wColumn.m_Length;  
            this.AddColumn(new SkColumn(wColumn.m_Name,wColumn.m_Type,wLength,wNotNull))
        })

        if (sTable.hasOwnProperty("m_Primary")) { 
            sTable.m_Primary.map((wName,wIndex) => {
            this.AddPrimary(wName)
        }) 
        }
        if (sTable.hasOwnProperty("m_Foreign")) {
                sTable.m_Foreign.map((wForeign,wIndex) => {
                let wSkForeign=new SkForeign(wForeign.m_Constraint,
                            wForeign.m_TableOwner,
                            wForeign.m_TableRef)
        
                //console.log("  foreign-->",wForeign.constraint)
                wForeign.m_Key.map((sName,wIndex) => {
                    //console.log("          Key-->",sName)
                    wSkForeign.AddKey(sName)
                })
                wForeign.m_Ref.map((sRef,wIndex) => {
                    //console.log("          Reference-->",sRef)
                    wSkForeign.AddRef(sRef)
                })

                this.AddForeign(wSkForeign)
            })      
        }
        if (sTable.hasOwnProperty("m_ExternForeign")) {
                sTable.m_ExternForeign.map((wForeign,wIndex) => {
                    let wSkForeign=new SkForeign(wForeign.m_Constraint,
                        wForeign.m_TableOwner,
                        wForeign.m_TableRef)

                //console.log("  foreign-->",wForeign.constraint)
                wForeign.m_Key.map((sName,wIndex) => {
                    //console.log("          Key-->",sName)
                    wSkForeign.AddKey(sName)
                })
                wForeign.m_Ref.map((sRef,wIndex) => {
                    //console.log("          Reference-->",sRef)
                    wSkForeign.AddRef(sRef)
                })

                this.AddExternForeign(wSkForeign)
            })
        }

    }
}

export class SkField extends SkItem {
    constructor(sName,sTypeField) {
        super(sName,'field')
        this.m_TypeField=sTypeField
        this.m_Width=0;
        this.m_Db=true;  
    } 
}


export  class SkGroup extends SkItem {
    constructor(sName) {
        super(sName,'group')
        this.m_Fields=[] // Key string of fields
    }
    AddField(sField) {
        this.m_Fields.push(sField)
    }

}

let wLastGroup=null


function StringToStyles(sStyles) {
    const wStyleCss = `{${sStyles
        .replace(/'/g, '"')
        .replace(";", "")
    }}`;
        
    let wObjStyles={}
    try {
     wObjStyles = JSON.parse(wStyleCss);
    } catch (sError) {
        console.log(sError,"-->",console.log(wStyleCss))
    }
    const keyValues = Object.keys(wObjStyles).map((key) => {
        var camelCased = key.replace(/-[a-z]/g, (g) => g[1].toUpperCase());
        return { [camelCased]: wObjStyles[key] };
    });
    return Object.assign({}, ...keyValues);
}

export class SkWidget extends SkItem {
    constructor(sName,sTableName) {
        super(sName,'widget')
        this.m_TableName=sTableName
        this.m_Groups = new SkObjectArray()
    }

    AddGroup(sGroup) {
        this.m_Groups.push(sGroup)
    }
    
}

export class SkMetaModel extends SkItem {
    constructor(sName,sVersion) {
        super(sName,'metaModel')
        this.m_Version=sVersion
        this.m_Tables = new SkObjectArray()
        this.m_Items = new SkObjectArray()
        this.m_Widgets= new SkObjectArray()
    }
  
    Verify() {
        for(let wTable of this.m_Tables) {
            try {
                console.log("Verify-->",wTable.m_Name)
                wTable.Verify(this)
            } catch(sError) {
                throw(sError);
            }
        }
        for(let wWidget of this.m_Widgets) {

        }
        return('')
    }

    Link() {
        for(let wTable of this.m_Tables) {
          for(let wForeign of wTable.m_Foreign ) {
            //console.log(wForeign)
            if (wForeign.m_TableOwner===wTable.m_Name) {
                let wForeignTable=this.Table(wForeign.m_TableRef)
                if (wForeignTable.length>0) {
                    wForeignTable[0].AddExternForeign(wForeign)
                }
            }
          }
        }
    }
  
    AddTable(sTable) {
        this.m_Tables.push(sTable)
    }

    Table(sTable) {
        return(this.m_Tables.Find("m_Name",sTable))
    }

    AddWidget(sWidget) {
        this.m_Widgets.push(sWidget)
    }

    Widget(sWidget) {
        return(this.m_Widgets.Find("m_Name",sWidget))
    }

    Parse(sJson) {
        // Parse ==============================================================
        let wMetaModel=JSON.parse(sJson)
        // Raz array ==========================================================
        this.m_Tables=new SkObjectArray()
        this.m_Items=new SkObjectArray()
        this.m_Widgets=new SkObjectArray()
        console.log("--------------",wMetaModel.Name)
        // Tables ==============================================================
        wMetaModel.Tables.map((wTable,wIndex) => {
          console.log("Table-->",wTable.Name)
          
          let wSkTable=new SkTable(wTable.Name)
          
          wTable.Columns.map((wColumn,wIndex) => {
              //console.log("    -->",wColumn.name)
              // 
              let wNotNull=false
              if (wColumn.hasOwnProperty("NotNull")) wNotNull=wColumn.NotNull;  
              let wLength=0
              if (wColumn.hasOwnProperty("Length")) wLength=wColumn.Length;  
              wSkTable.AddColumn(new SkColumn(wColumn.Name,wColumn.Type,wLength,wNotNull))
          })

          if (wTable.hasOwnProperty("Key")) {  
            let wKey=wTable.Key
            if (wKey.hasOwnProperty("Primary")) { 
            
              //console.log("Primary")
              wKey.Primary.map((wName,wIndex) => {
                //console.log("  Primary-->",wName)
                wSkTable.AddPrimary(wName)
              })
            }
            if (wKey.hasOwnProperty("Foreign")) {
                wKey.Foreign.map((wForeign,wIndex) => {
    
                    let wSkForeign=new SkForeign(wForeign.Constraint,
                        wSkTable.m_Name,
                        wForeign.Table
                        )
                    wSkTable.AddForeign(wSkForeign)

                    //console.log("  foreign-->",wForeign.constraint)
                    wForeign.Key.map((sName,wIndex) => {
                        //console.log("          Key-->",sName)
                        wSkForeign.AddKey(sName)
                    })
                    wForeign.Reference.map((sRef,wIndex) => {
                        //console.log("          Reference-->",sRef)
                        wSkForeign.AddRef(sRef)
                    })
                })
              
            }          
          }
          this.AddTable(wSkTable)
        })
    
        // Widget ===============================================================
        wMetaModel.Widgets.map((sWidget,sIndex) => {
            console.log("Widget-->",sWidget.Name)
            
            let wSkWidget=new SkWidget(sWidget.Name,sWidget.TableName)
           
            wSkWidget.m_Label=sWidget.Label
            wSkWidget.m_WidgetType=sWidget.WidgetType
       
            if (sWidget.hasOwnProperty('Style'))
                wSkWidget.m_Style=sWidget.Style

            if (sWidget.hasOwnProperty('Direction'))
                wSkWidget.m_Direction=sWidget.Direction

            if (sWidget.hasOwnProperty('StyleWidget'))
                wSkWidget.m_StyleWidget=sWidget.StyleWidget

            if (sWidget.hasOwnProperty('Groups')) {
                sWidget.Groups.map((wGroup,wIndex) => {
                    let wSkGroup=new SkGroup(wGroup.Name)
                    wSkGroup.m_Style=wGroup.Style
                    wSkGroup.m_Label=wGroup.Label
                    if (wGroup.hasOwnProperty('Direction'))
                    wSkGroup.m_Direction=wGroup.Direction
    
                wGroup.Fields.map((wField,wIndex) => {
                    let wSkField=new SkField(wField.Name,wField.Type)
                    if (wField.hasOwnProperty('Db'))
                        wSkField.m_Db=wField.Db
                    wSkField.m_Label=wField.Label
                    
                    wSkField.m_Style=wField.Style
                    if (wField.hasOwnProperty("Styles")) {
                        wSkField.m_Styles=wField.Styles
                        // For test Catch if error 
                        console.log("Style",StringToStyles(wField.Styles))
                    }
                    if (wField.hasOwnProperty("Width")) {
                        wSkField.m_Width=wField.Width
                    }
                    wSkGroup.AddField(wSkField)
                })
                wSkWidget.AddGroup(wSkGroup)
            })
        } // End of Groups
        this.AddWidget(wSkWidget);
        
        })
    }
   
}


