//=============================================================================
// SkGenericDB.mjs
// Interface between table and mongodb 
// Author Stéphane ALLEZ 20/08/2024
//=============================================================================
//import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { fastifyMongodb, ObjectId } from '@fastify/mongodb'
import { ensureUserHomeDirectory } from '../SkVirtualDisk/SkUserHome.mjs'
import {
    openRecordImage,
    persistRecordImages,
    releaseRecordImages,
    releaseReplacedRecordImages,
    storeRecordImageValue,
} from './SkRecordImage.mjs'

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

// Query the child table for rows that still point at the record being deleted.
function externReferenceQuery(foreign, record) {
    const query = {}
    for (let i = 0; i < foreign.m_Key.length; i++) {
        query[foreign.m_Key[i]] = record[foreign.m_Ref[i]]
    }
    return query
}

async function referencingForeignError(fastify, table, record) {
    for (const foreign of table.m_ExternForeign || []) {
        const query = externReferenceQuery(foreign, record)
        if (Object.values(query).some((value) => value === undefined)) {
            continue
        }
        const hit = await fastify.mongo.db.collection(foreign.m_TableOwner).findOne(query)
        if (hit) {
            const constraint = foreign.m_Constraint || foreign.m_TableOwner
            return 'Foreign key error: ' + foreign.m_TableOwner +
                ' still references this ' + table.m_Name +
                ' (' + constraint + ') Key' + JSON.stringify(query)
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

    // Large images are uploaded here so they never ride inside the 1MB record body.
    fastify.post('/mdb/image', { bodyLimit: 24 * 1024 * 1024 }, async function (req, reply) {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
            const image = await storeRecordImageValue(fastify.mongo.db, body)
            return { message: 'success', image }
        } catch (error) {
            return reply.status(400).send({ message: 'error', error: error.message || String(error) })
        }
    })

    fastify.get('/mdb/image/:id', async function (req, reply) {
        try {
            const opened = await openRecordImage(fastify.mongo.db, req.params.id)
            if (!opened) {
                return reply.status(404).send({ message: 'error', error: 'Image not found' })
            }
            reply.header('Content-Type', opened.mime)
            reply.header('X-Content-Type-Options', 'nosniff')
            if (opened.mime === 'image/svg+xml') {
                reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
            }
            return reply.send(opened.stream)
        } catch (error) {
            return reply.status(400).send({ message: 'error', error: error.message || String(error) })
        }
    })

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

                // Outgoing foreign keys apply to insert and update.
                // Delete is blocked by the reverse link (another table still references this row).
                if (wOperationMode !== 'delete') {
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
                let wPreviousImages = null
                if (wOperationMode === 'insert' || wOperationMode === 'update') {
                    wPreviousImages = wOperationMode === 'update'
                        ? await wCollection.findOne(wPrimaryKey)
                        : null
                    await persistRecordImages(fastify.mongo.db, wTable, wRecord)
                }
                if (wOperationMode === 'insert') {
                    wResultInsertUpdate = await wCollection.insertOne(wRecord);
                    wResult.id = wResultInsertUpdate.insertedId
                    await releaseReplacedRecordImages(fastify.mongo.db, wTable, wPreviousImages, wRecord)
                    console.log("Insert document " + wCollectionStr + ", " + wKeyStr + " was inserted with the _id: " + wResult.id)
                } else if (wOperationMode === 'update') {
                    const { _id, ...updateData } = wRecord;
                    const updateOp = { $set: updateData }
                    if (wCollectionStr === 'User' && updateData.Password !== undefined) {
                        updateOp.$unset = { PassWord: '' }
                    }
                    wResultInsertUpdate = await wCollection.updateOne(wPrimaryKey, updateOp);
                    if (wResultInsertUpdate.matchedCount > 0) {
                        await releaseReplacedRecordImages(fastify.mongo.db, wTable, wPreviousImages, wRecord)
                    }
                    const wUpdatedDoc = await wCollection.findOne(wPrimaryKey)
                    wResult.id = wUpdatedDoc?._id ?? null
                    console.log(
                        "Update document " + wCollectionStr + ", " + wKeyStr +
                        " matched=" + wResultInsertUpdate.matchedCount +
                        " modified=" + wResultInsertUpdate.modifiedCount +
                        " _id=" + wResult.id
                    )
                } else if (wOperationMode === 'delete') {
                    const wForeignMessage = await referencingForeignError(fastify, wTable, wRecord)
                    if (wForeignMessage !== '') {
                        wResult.message = 'error'
                        wResult.error = wForeignMessage
                        return JSON.stringify(wResult);
                    }
                    const wPreviousImageDoc = await wCollection.findOne(wPrimaryKey)
                    wResultInsertUpdate = await wCollection.deleteOne(wPrimaryKey);
                    console.log("Delete document " + wCollectionStr + ", " + wKeyStr + " deletedCount=" + wResultInsertUpdate.deletedCount)
                    if (wResultInsertUpdate.deletedCount !== 1) {
                        wResult.message = 'error'
                        wResult.error = 'On table ' + wCollectionStr + " couldn't delete Key(" + wKeyStr + ")!"
                        return JSON.stringify(wResult);
                    }
                    await releaseRecordImages(fastify.mongo.db, wTable, wPreviousImageDoc)
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
            const wPreviousImageDoc = await wCollection.findOne(wQuery)
            const wResDelete = await wCollection.deleteOne(wQuery)
            if (wResDelete.deletedCount === 1) {
                const wMetaModel = global['metamodel']
                const wTableArray = wMetaModel?.Table(wCollectionStr) || []
                if (wTableArray.length > 0) {
                    await releaseRecordImages(fastify.mongo.db, wTableArray[0], wPreviousImageDoc)
                }
            }
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