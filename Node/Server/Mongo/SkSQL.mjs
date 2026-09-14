//=============================================================================
// SkSQL.mjs
// Interface between table and mongodb 
// Author Stéphane ALLEZ 20/08/2024
//=============================================================================
import { convertSqlToMongo, executeMongoQuery } from './SkSqlToMongo.mjs'

// Metamodel
//import { SkMetaModel, SkTable, SkArc } from '../../MetaModel/SkMetaModel.mjs'
//import { SkObjectArray } from '../../MetaModel/SkSortFind.mjs'

async function SkSQL(fastify, opts) {
    console.log('=== start SkSQL ===');
    
    fastify.post('/sql', async function (req, reply) {
        let wResult = {}
        try {
            // Differentiate between Node and Browser
            let wSelect=""
            if (typeof req.body === 'string') {
                wSelect=req.body
            } else {
                wSelect=JSON.stringify(req.body)
            }
            const mongoQuery = convertSqlToMongo(wSelect); 
            const wCollection = await fastify.mongo.db.collection(mongoQuery.collection);
            const results = await executeMongoQuery(mongoQuery.select, wCollection);
            wResult.message = 'success'
            wResult.records = results
        } catch (sError) {
            wResult.message = 'error'
            wResult.error = sError.toString()
        }   
        return JSON.stringify(wResult);
    })
}

export { SkSQL }