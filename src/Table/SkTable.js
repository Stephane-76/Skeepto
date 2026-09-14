import SkWebInterface from "../SkWebInterface";



class SkTable {
    constructor(sTableName,sWebInterface) {
        this.m_TableName=sTableName
        this.m_WebInterface=sWebInterface
        this.m_Result=[]
    }

    async LoadData(sKeyFirst,sKeyLast) {
        let wKeyUsr ={ }
        let wSort = { }
        let wQuery = [ wKeyUsr,wSort ]
        
        wResult=await window.WebInterface.getJson('/mdb/'+this.m_TableName,JSON.stringify(wQuery))
        let wObjResult=JSON.parse(wResult)
        if (wObjResult.message==='success') {
          this.m_Result=wObjResult.records;
        }
       
        return(this.m_Result)
    }

}


export default SkTable
