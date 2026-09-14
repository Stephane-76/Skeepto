//=============================================================================
// SkGenericDB.mjs
// Interface between table and mongodb 
// Author Stéphane ALLEZ 20/08/2024
//=============================================================================
//import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { fastifyMongodb, ObjectId } from '@fastify/mongodb'
import { ensureUserHomeDirectory } from '../SkVirtualDisk/SkUserHome.mjs'

// Login/register store Password; the User form metamodel uses PassWord.
function normalizeUserPasswordFields(record) {
    if (record?.PassWord !== undefined && record.PassWord !== null && record.PassWord !== '') {
        record.Password = record.PassWord
        delete record.PassWord
    }
    return record
}

function entityTypeAllowed(allowedCsv, entityType) {
    if (!allowedCsv || allowedCsv.trim() === '' || allowedCsv.trim() === '*') {
        return true
    }
    return allowedCsv.split(',').map((s) => s.trim()).includes(entityType)
}

async function findEntityByRef(fastify, metaModel, entityType, entityId) {
    const tableArray = metaModel.Table(entityType)
    if (tableArray.length === 0) {
        return null
    }
    const table = tableArray[0]
    const collection = fastify.mongo.db.collection(entityType)
    if (table.m_Primary.length === 1) {
        const key = table.m_Primary[0]
        return collection.findOne({ [key]: entityId })
    }
    if (table.m_Primary.length > 1) {
        const query = {}
        for (const key of table.m_Primary) {
            if (entityId && typeof entityId === 'object' && entityId[key] !== undefined) {
                query[key] = entityId[key]
            }
        }
        if (Object.keys(query).length === table.m_Primary.length) {
            return collection.findOne(query)
        }
    }
    try {
        return collection.findOne({ _id: new ObjectId(String(entityId)) })
    } catch {
        return null
    }
}

async function validateRelationshipRecord(fastify, metaModel, record) {
    const relTypeCode = record.RelationshipType
    const relTypeDoc = await fastify.mongo.db.collection('RelationshipType').findOne({ Code: relTypeCode })
    if (relTypeDoc === null) {
        return 'RelationshipType ' + relTypeCode + ' does not exist'
    }
    if (!entityTypeAllowed(relTypeDoc.FromTypes, record.FromType)) {
        return 'FromType ' + record.FromType + ' is not allowed for relationship type ' + relTypeCode
    }
    if (!entityTypeAllowed(relTypeDoc.ToTypes, record.ToType)) {
        return 'ToType ' + record.ToType + ' is not allowed for relationship type ' + relTypeCode
    }
    if (metaModel.Table(record.FromType).length === 0) {
        return 'FromType table ' + record.FromType + ' does not exist'
    }
    if (metaModel.Table(record.ToType).length === 0) {
        return 'ToType table ' + record.ToType + ' does not exist'
    }
    const fromDoc = await findEntityByRef(fastify, metaModel, record.FromType, record.FromId)
    if (fromDoc === null) {
        return 'From entity ' + record.FromType + '(' + record.FromId + ') does not exist'
    }
    const toDoc = await findEntityByRef(fastify, metaModel, record.ToType, record.ToId)
    if (toDoc === null) {
        return 'To entity ' + record.ToType + '(' + record.ToId + ') does not exist'
    }
    if (record.Props !== undefined && record.Props !== null && record.Props !== '') {
        try {
            JSON.parse(record.Props)
        } catch {
            return 'Props must be valid JSON'
        }
    }
    return ''
}

function prepareRelationshipRecord(record, operationMode) {
    if (operationMode === 'insert') {
        if (!record.Code) {
            record.Code = randomUUID()
        }
        if (record.Date === undefined || record.Date === null || record.Date === '') {
            record.Date = Date.now()
        }
    }
    return record
}


async function SkGenericDb(fastify, opts) {
    console.log('=== start SkGenericDb ===');

    // POST record for insert/update ===========================================
    fastify.post('/mdb/:table', {
        config: function(req) {
            if (req.params.table === 'SpreadSheet') {
                return {
                    bodyLimit: 10 * 1024 * 1024,  // 10MB for SpreadSheet
                    timeout: 120000  // 2 minutes for SpreadSheet
                }
            }
            return {
                bodyLimit: 1 * 1024 * 1024,  // 1MB for other tables
                timeout: 30000  // 30 seconds for others
            }
        }
    }, async function (req, reply) {
        let wCollectionStr = req.params.table;
        let wResult = {}
        let wMetaModel = global['metamodel']
        let wTableArray = wMetaModel.Table(wCollectionStr)
        
        if (wTableArray.length !== 0) {
            let wTable = wTableArray[0]
            try {
                let wOperationMode = req.headers['x-operation-mode'] || 'insert';
                let wRecord = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

                if (wCollectionStr === 'User') {
                    normalizeUserPasswordFields(wRecord)
                }
                if (wCollectionStr === 'Relationship') {
                    prepareRelationshipRecord(wRecord, wOperationMode)
                }

                // Verify record
                let wMessage = wTable.VerifyRecord(wRecord)
                if (wMessage !== '') {
                    wResult.message = 'error'
                    wResult.error = wMessage + '!'
                    return JSON.stringify(wResult);
                }

                // Assign Mongo _id only on insert
                if (wOperationMode === 'insert') {
                    let wColumns = wTable.Column('_id')
                    if (wColumns.length > 0) {
                        let wColumn = wColumns[0]
                        if (wColumn.m_TypeColumn === 'id') {
                            wRecord['_id'] = new ObjectId()
                        }
                    }
                }

                // Check Primary Key
                let wPrimaryKey = wTable.PrimaryKey(wRecord)
                const wCollection = await fastify.mongo.db.collection(wCollectionStr)

                // Verify primary key existence
                if (wPrimaryKey !== '{}') {
                    const wDoc = await wCollection.findOne(wPrimaryKey)
                    if (wDoc !== null && wOperationMode === 'insert') {
                        wResult.message = 'error'
                        wResult.error = 'Record with Key(' + JSON.stringify(wPrimaryKey) + ') already exists!'
                        return JSON.stringify(wResult);
                    }
                    if (wDoc === null && wOperationMode === 'update') {
                        wResult.message = 'error'
                        wResult.error = 'Record with Key(' + JSON.stringify(wPrimaryKey) + ') does not exist!'
                        return JSON.stringify(wResult);
                    }
                }

                // Check Foreign Keys
                for (let wForeign of wTable.m_Foreign) {
                    const wCollectionForeign = await fastify.mongo.db.collection(wForeign.m_TableRef)
                    const wKey = wForeign.GetKeyRef(wRecord)
                    const wDoc = await wCollectionForeign.findOne(wKey)
                    if (wDoc === null) {
                        wResult.message = 'error'
                        wResult.error = 'Foreign key error on ' + wForeign.m_TableRef + ' Key' + JSON.stringify(wKey) + ' does not exist!'
                        return JSON.stringify(wResult);
                    }
                }

                if (wCollectionStr === 'Relationship') {
                    const wRelationshipMessage = await validateRelationshipRecord(fastify, wMetaModel, wRecord)
                    if (wRelationshipMessage !== '') {
                        wResult.message = 'error'
                        wResult.error = wRelationshipMessage + '!'
                        return JSON.stringify(wResult);
                    }
                }

                // Perform insert, update or delete
                const wKeyStr = JSON.stringify(wPrimaryKey)
                let wResultInsertUpdate = {}
                if (wOperationMode === 'insert') {
                    wResultInsertUpdate = await wCollection.insertOne(wRecord);
                    wResult.id = wResultInsertUpdate.insertedId
                    console.log("Insert document " + wCollectionStr + ", " + wKeyStr + " was inserted with the _id: " + wResult.id)
                } else if (wOperationMode === 'update') {
                    const { _id, ...updateData } = wRecord;
                    const updateOp = { $set: updateData }
                    if (wCollectionStr === 'User' && updateData.Password !== undefined) {
                        updateOp.$unset = { PassWord: '' }
                    }
                    wResultInsertUpdate = await wCollection.updateOne(wPrimaryKey, updateOp);
                    const wUpdatedDoc = await wCollection.findOne(wPrimaryKey)
                    wResult.id = wUpdatedDoc?._id ?? null
                    console.log(
                        "Update document " + wCollectionStr + ", " + wKeyStr +
                        " matched=" + wResultInsertUpdate.matchedCount +
                        " modified=" + wResultInsertUpdate.modifiedCount +
                        " _id=" + wResult.id
                    )
                } else if (wOperationMode === 'delete') {
                    wResultInsertUpdate = await wCollection.deleteOne(wPrimaryKey);
                    console.log("Delete document " + wCollectionStr + ", " + wKeyStr + " deletedCount=" + wResultInsertUpdate.deletedCount)
                }

                wResult.message = 'success'

                if (
                    wCollectionStr === 'User' &&
                    wOperationMode === 'insert' &&
                    wRecord?.Email
                ) {
                    try {
                        await ensureUserHomeDirectory(fastify.mongo.db, {
                            email: wRecord.Email,
                            group: wRecord.Group,
                        });
                    } catch (homeErr) {
                        console.warn('ensureUserHomeDirectory after User insert:', homeErr);
                    }
                }
            } catch (sError) {
                wResult.message = 'error'
                wResult.error = sError.toString()
            }
        } else {
            wResult.message = 'error'
            wResult.error = 'Table ' + wCollectionStr + ' does not exist!'
        }
        return JSON.stringify(wResult);
    })

    // DELETE record ==========================================================
    fastify.delete('/mdb/:table/:id', async function (req, reply) {
        let wCollectionStr = req.params.table;
        let wResult = {}
        try {
            const wCollection = fastify.mongo.db.collection(wCollectionStr)
            const wQuery = JSON.parse(req.params.id)
            console.log("Delete -->", wCollectionStr, " -_>", wQuery);
            const wResDelete = await wCollection.deleteOne(wQuery)
            if (wResDelete.deletedCount === 1) {
                wResult.message = 'success'
            } else {
                wResult.message = 'error'
                wResult.error = 'On table ' + wCollectionStr + " couldn't delete Key(" + JSON.stringify(wQuery) + ")!"
            }
        } catch (sError) {
            wResult.message = 'error'
            wResult.error = sError
        }
        return JSON.stringify(wResult);
    })


    // GET route
    fastify.get('/mdb/:table/:id', async function (req, reply) {
        let wCollectionStr = req.params.table;
        let wResult = {}
        try {
            let wQuery = JSON.parse(req.params.id)
            let wSort = {}
            if (Array.isArray(wQuery)) {
                if (wQuery.length >= 2) {
                    wQuery = wQuery[0]
                    wSort = wQuery[1]
                }
            }
            let wMetaModel = global['metamodel']
            let wTableArray = wMetaModel.Table(wCollectionStr)
            if (wTableArray.length !== 0) {
                let wTable = wTableArray[0]
                const wCollection = fastify.mongo.db.collection(wCollectionStr)

                if (wTable.IsKeyIsPrimaryKey(Object.keys(wQuery))) {
                    // One record
                    const wDoc = await wCollection.findOne(wQuery)
                    if (wDoc === null) {
                        wResult.message = 'error'
                        wResult.error = 'On table ' + wCollectionStr + " couldn't find Key(" + JSON.stringify(wQuery) + ")!"
                    } else {
                        wResult.message = 'success'
                        wResult.record = wDoc
                    }
                } else {
                    // Multiple records
                    const wCursor = await wCollection.find(wQuery).sort(wSort)
                    const wDocs = await wCursor.toArray()
                    wResult.message = 'success'
                    wResult.records = wDocs
                }
            } else {
                wResult.message = 'error'
                wResult.error = 'Table ' + wCollectionStr + " doesn't exist!"
            }
        } catch (sError) {
            wResult.message = 'error'
            wResult.error = sError
        }
        return JSON.stringify(wResult);
    })
}

export { SkGenericDb }