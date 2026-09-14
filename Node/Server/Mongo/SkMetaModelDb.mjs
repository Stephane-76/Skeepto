//=============================================================================
// SkMetaModelDb.mjs
// Interface beetween metamodel and mongodb 
// Author Stéphane ALLEZ 20/08/2024
//=============================================================================
import MongoDB from '@fastify/mongodb'
import { readFile } from 'node:fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'


// Metamodel
import { SkMetaModel,SkArc  } from '../../MetaModel/SkMetaModel.mjs'
import { SkObjectArray } from '../../MetaModel/SkSortFind.mjs'
// __dirname for node  module 
const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

export async function SkMetaModelDb(fastify,opts) {
  
  let wMetaModel=new SkMetaModel("Sker Model","Version 1.0")

  fastify.get('/meta/:type/:name', async function (req, reply) {
    const wDB = fastify.mongo.db
    let wCollection = await wDB.collection('metamodel') 
    let wQuery={}
    let wResult={}
    wQuery.m_Type=req.params.type
    wQuery.m_Name=req.params.name 
    let wDoc={}
    try {
      wDoc = await wCollection.findOne(wQuery)
      if (wDoc=== null) {
          wResult.message='error'
          wResult.error = "On Metamodel don't find"+JSON.stringify(wQuery)+") !"   
          return(JSON.stringify(wResult));
      }   
    } catch(sError) {
      wResult.message='catch'
      wResult.error = "On Metamodel catch "+sError+" !"   
      return(JSON.stringify(wResult));
    }
    wResult.message='success'
    wResult.object  = wDoc   
    return(JSON.stringify(wResult));
  })

  fastify.get('/meta/json' , async function (req, reply) {
   // Load Metamodel File ====================================================
   const wFile = path.join(__dirname, "../Model/DataModel.json")
   let wData
   try {
     wData = await readFile(wFile, 'utf8')
   } catch (sError) {
     console.error(sError)
     reply.code(500)
     return JSON.stringify({ message: 'error', error: String(sError) })
   }

   wMetaModel.Parse(wData)
   const wError = wMetaModel.Verify(this)
   if (wError !== '') {
     const wObj = { message: 'Error', error: wError }
     reply.code(500)
     return JSON.stringify(wObj)
   }

   wMetaModel.Link()
   global['metamodel'] = wMetaModel

   const wObj = {}
   wObj.message = 'success'
   wObj.metamodel = JSON.stringify(wMetaModel)
   return JSON.stringify(wObj)
  })

  fastify.get('/meta/db', async function (req, reply) {
      
    const wDB = fastify.mongo.db
    let wCollection = await wDB.collection('metamodel') 
    let wResult={}
 
    // Set Query
    const wQuery = { m_Type : 'table' }
    const wOptions = {
      // Sort returned documents in ascending order by title (A->Z)
      sort: { _id : 1 },
      // Include only the `name` and id fields in each returned document
      // projection: { _id: 1,  m_Name: 2 }
    };

    try {
      const wCursor = await wCollection.find(wQuery,{})
      let wTables=await wCursor.toArray();

      for (const wTable of wTables) {
        //console.log('Table >',wTable.m_Name);
        // Search Arc Columns 
        let wQueryArc={}
        wQueryArc.m_From =wTable._id
        wQueryArc.m_Name='column'
        const wCursorArc = await wCollection.find(wQueryArc,{})
        let wArcs=await wCursorArc.toArray()
        for (const wArc of wArcs) {
          //console.log('Arc ---->',wArc.m_Name,":",wArc.m_Type);

          let wQueryColumn={}
          wQueryColumn._id = wArc.m_To
          
          const wCursorColumn=await wCollection.find(wQueryColumn,{})
          let wColumns=await wCursorColumn.toArray()
          for (const wColumn of wColumns) {
            console.log('---->',wColumn.m_Name,":",wColumn.m_Type);
          }
        }
      }
      wResult.message='success'
    } catch (sErr) {
      let wError={}
      wResult.message='error'
      wResult.error=sErr
    }
    wMetaModel.Link()
    global['metamodel']=wMetaModel
    return(wResult)
  })

  fastify.get('/meta/write', async function (req, reply) {
      
    const wDB = fastify.mongo.db

    const wCollections = await wDB.listCollections().toArray()
    let  wArray=new SkObjectArray()
    wCollections.map( (wTable) => wArray.push(wTable)) 
    // Raz Collection metamodel 
    if (wArray.Find('m_Name','metamodel')) {
          console.log('---->Raz metamodel collection')
          const wCollectionMetaModel  = await wDB.collection('metamodel') 
          //await wCollectionMetaModel.deleteMany({}) 
          await wCollectionMetaModel.drop()    
    }
          
    // Record Metamodel ========================================================
    try {
      await wDB.createCollection('metamodel')
      console.log("Collection 'metamodel' created!");
    } catch (err) {
      // Ignore if already exists
      if (String(err?.codeName) !== 'NamespaceExists' && Number(err?.code) !== 48) {
        throw err;
      }
      console.log("Collection 'metamodel' already exists, continue");
    }
    const wCollectionMetaModel  = await wDB.collection('metamodel') 
    wMetaModel=global['metamodel']
    const wResultTable = await wCollectionMetaModel.insertMany(wMetaModel.m_Tables);
    //console.log(wResulTable)
    const wResultWidget = await wCollectionMetaModel.insertMany(wMetaModel.m_Widgets);
    //console.log(wResultWidget)

  // Create Collection ======================================================
  for (const wTable of wMetaModel.m_Tables) {

    console.log(wTable.m_Name)
    
    try {
      await wDB.createCollection(wTable.m_Name)
      console.log(`Collection '${wTable.m_Name}' created!`);
    } catch (err) {
      if (String(err?.codeName) !== 'NamespaceExists' && Number(err?.code) !== 48) {
        throw err;
      }
      console.log(`Collection '${wTable.m_Name}' already exists, continue`);
    }
  }
  const wCollectionsAfter = await wDB.listCollections().toArray()
  const wCollectionNames = wCollectionsAfter.map((c) => c.name)
  let wObj={}
  wObj.message='success'
  wObj.collections = wCollectionNames;
  let wReturn=JSON.stringify(wObj)

  global['metamodel']=wMetaModel
  
  return (wReturn)

    /*
    // write  Meta model table in mongodb 
    for (const wTable of wMetaModel.m_Tables) {
      const wResult = await wCollectionMetaModel.insertOne(wTable.ReturnShortForID());
      console.log(`Table ${wTable.m_Name} was inserted with the _id: ${wResult.insertedId}`)
      const wIDTable=wResult.insertedId;

      for(const wColumn of wTable.m_Columns) {
        const wResult = await wCollectionMetaModel.insertOne(wColumn)
        console.log(`Column ${wColumn.m_Name} was inserted with the _id: ${wResult.insertedId}`)
        const wIDColumn=wResult.insertedId;
  
        // Write Arc
        let wArc=new SkArc("column")
        wArc.m_From=wIDTable;
        wArc.m_To=wIDColumn;
        const wResultArc = await wCollectionMetaModel.insertOne(wArc)
        console.log(` Arc ${wArc.m_Name} was inserted with the _id: ${wResultArc.insertedId}`)
        const wIDArc=wResult.insertedId;
      }
    }
    
    
    let wResulArray=await wCollectionMetaModel.find().toArray()
    console.log('----->find():',wResulArray.length)

    const collections = await wDB.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    console.log(collectionNames)
    let wObj={}
    wObj.message='success'
    wObj.collections = collectionNames;
    let wReturn=JSON.stringify(wObj)

    global['metamodel']=wMetaModel
    
    return (wReturn)
    */
  })
  

 }

export default SkMetaModelDb