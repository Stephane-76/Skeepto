import { ObjectId } from '@fastify/mongodb'
import { GridFSBucket } from 'mongodb'
import { createHash } from 'crypto'

const SKER_HISTORY_COLLECTION = 'SpreadsheetHistory'
// MongoDB BSON document limit is 16MB; nested objects expand vs JSON string — keep a safe margin.
const MAX_SPREADSHEET_INLINE_BYTES = 15 * 1024 * 1024
const GRIDFS_CHUNK_SIZE = 14 * 1024 * 1024
const SKER_HISTORY_MAX_VERSIONS = Math.max(
  1,
  parseInt(process.env.SKER_HISTORY_MAX_VERSIONS || '50', 10) || 50
)

let historyIndexesEnsured = false

function resolveCanonicalPath(existingDirectoryDoc, fileNameOrPath) {
  if (existingDirectoryDoc?.path && typeof existingDirectoryDoc.path === 'string') {
    return existingDirectoryDoc.path
  }
  if (fileNameOrPath && typeof fileNameOrPath === 'string') {
    return fileNameOrPath.startsWith('/') ? fileNameOrPath : `/${fileNameOrPath}`
  }
  return null
}

function hashSpreadsheetData(spreadsheetData) {
  const serialized = JSON.stringify(spreadsheetData)
  return {
    serialized,
    contentHash: createHash('sha256').update(serialized).digest('hex'),
    size: Buffer.byteLength(serialized, 'utf8'),
  }
}

function getSpreadsheetGridFSBucket(db) {
  return new GridFSBucket(db, {
    bucketName: 'files',
    chunkSizeBytes: GRIDFS_CHUNK_SIZE,
  })
}

async function deleteGridFSFileSafe(bucket, gridfsId) {
  if (!gridfsId) return
  try {
    await bucket.delete(gridfsId)
  } catch (_) {}
}

async function writeSpreadsheetJsonToGridFS(bucket, filename, jsonString) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      metadata: { type: 'spreadsheet-json' },
    })
    uploadStream.on('error', reject)
    uploadStream.end(Buffer.from(jsonString, 'utf8'), (err) => {
      if (err) reject(err)
      else resolve(uploadStream.id)
    })
  })
}

async function readSpreadsheetJsonFromGridFS(bucket, gridfsId) {
  const chunks = []
  const stream = bucket.openDownloadStream(gridfsId)
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Load spreadsheet payload from Spreadsheet doc (inline object, JSON string, or GridFS). */
export async function loadSpreadsheetDataFromRecord(fastify, recordDoc) {
  if (!recordDoc) return null
  if (typeof recordDoc.dataJson === 'string' && recordDoc.dataJson.length > 0) {
    return JSON.parse(recordDoc.dataJson)
  }
  if (recordDoc.data && typeof recordDoc.data === 'object') {
    return recordDoc.data
  }
  if (recordDoc.gridfsId && fastify?.mongo?.db) {
    const bucket = getSpreadsheetGridFSBucket(fastify.mongo.db)
    const raw = await readSpreadsheetJsonFromGridFS(bucket, recordDoc.gridfsId)
    return JSON.parse(raw)
  }
  return null
}

async function ensureHistoryIndexes(fastify) {
  if (historyIndexesEnsured || !fastify?.mongo?.db) {
    return
  }
  const historyCol = fastify.mongo.db.collection(SKER_HISTORY_COLLECTION)
  await historyCol.createIndex({ path: 1, revision: -1 })
  await historyCol.createIndex({ path: 1, contentHash: 1 })
  historyIndexesEnsured = true
}

async function trimSkerHistory(fastify, canonicalPath) {
  const historyCol = fastify.mongo.db.collection(SKER_HISTORY_COLLECTION)
  const excess = await historyCol
    .find({ path: canonicalPath }, { projection: { _id: 1, revision: 1 } })
    .sort({ revision: -1 })
    .skip(SKER_HISTORY_MAX_VERSIONS)
    .toArray()

  if (excess.length === 0) {
    return
  }

  const ids = excess.map((doc) => doc._id)
  await historyCol.deleteMany({ _id: { $in: ids } })
}

/**
 * Append a manual or explicit version snapshot.
 * Skips identical consecutive versions unless allowDuplicate is true.
 */
export async function appendSkerHistory(
  fastify,
  {
    path: canonicalPath,
    recordId,
    spreadsheetData,
    size = 0,
    author = '',
    email = '',
    source = 'snapshot',
    label = '',
    comment = '',
    allowDuplicate = false,
  }
) {
  if (!fastify?.mongo?.db || !canonicalPath || !spreadsheetData) {
    return null
  }

  await ensureHistoryIndexes(fastify)

  const { contentHash, size: computedSize } = hashSpreadsheetData(spreadsheetData)
  const historyCol = fastify.mongo.db.collection(SKER_HISTORY_COLLECTION)

  const last = await historyCol.findOne(
    { path: canonicalPath },
    { sort: { revision: -1 }, projection: { revision: 1, contentHash: 1 } }
  )

  if (!allowDuplicate && last?.contentHash === contentHash) {
    return null
  }

  const revision = (last?.revision || 0) + 1
  const info = spreadsheetData.info && typeof spreadsheetData.info === 'object'
    ? spreadsheetData.info
    : null

  const doc = {
    path: canonicalPath,
    recordId: recordId ? new ObjectId(String(recordId)) : null,
    revision,
    label: String(label || '').trim(),
    comment: String(comment || '').trim(),
    data: spreadsheetData,
    size: size || computedSize,
    author: author || info?.author || '',
    email: email || info?.email || '',
    source,
    contentHash,
    createdAt: new Date(),
  }

  const ins = await historyCol.insertOne(doc)
  await trimSkerHistory(fastify, canonicalPath)

  return {
    id: ins.insertedId,
    revision,
    label: doc.label,
    comment: doc.comment,
    size: doc.size,
    author: doc.author,
    email: doc.email,
    source,
    createdAt: doc.createdAt,
  }
}

/**
 * Capture the current persisted .sker content as a labeled version snapshot.
 */
export async function createSkerHistorySnapshot(fastify, canonicalPath, options = {}) {
  const directoryCol = fastify.mongo.db.collection('Directory')
  const file = await directoryCol.findOne({ path: canonicalPath, isDirectory: false })
  if (!file) {
    throw new Error('File not found')
  }

  const label = String(options.label || '').trim()
  if (!label) {
    throw new Error('Label is required')
  }

  const rebuilt = await rebuildSkerContentFromRecord(fastify, file)
  if (!rebuilt?.content) {
    throw new Error('No spreadsheet content available for snapshot')
  }

  let spreadsheetData
  try {
    spreadsheetData = JSON.parse(rebuilt.content)
  } catch (parseError) {
    throw new Error(`Invalid spreadsheet content: ${parseError.message}`)
  }

  spreadsheetData.uri = canonicalPath

  const entry = await appendSkerHistory(fastify, {
    path: canonicalPath,
    recordId: file.record,
    spreadsheetData,
    size: rebuilt.size,
    author: options.author || '',
    email: options.email || '',
    source: 'snapshot',
    label,
    comment: String(options.comment || '').trim(),
    allowDuplicate: true,
  })

  if (!entry) {
    throw new Error('Snapshot was not created')
  }

  return entry
}

export async function listSkerHistory(fastify, canonicalPath, limit = 20) {
  if (!fastify?.mongo?.db || !canonicalPath) {
    return []
  }

  await ensureHistoryIndexes(fastify)

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
  const historyCol = fastify.mongo.db.collection(SKER_HISTORY_COLLECTION)

  const rows = await historyCol
    .find(
      { path: canonicalPath },
      {
        projection: {
          data: 0,
        },
      }
    )
    .sort({ revision: -1 })
    .limit(safeLimit)
    .toArray()

  return rows.map((row) => ({
    id: row._id,
    path: row.path,
    revision: row.revision,
    label: row.label || '',
    comment: row.comment || '',
    size: row.size,
    author: row.author,
    email: row.email,
    source: row.source,
    createdAt: row.createdAt,
    recordId: row.recordId,
  }))
}

export async function getSkerHistoryVersion(fastify, versionId) {
  if (!fastify?.mongo?.db || !versionId) {
    return null
  }

  let objectId = null
  try {
    objectId = new ObjectId(String(versionId))
  } catch (_) {
    return null
  }

  const historyCol = fastify.mongo.db.collection(SKER_HISTORY_COLLECTION)
  return historyCol.findOne({ _id: objectId })
}

export async function restoreSkerFromHistory(fastify, canonicalPath, versionId, options = {}) {
  const version = await getSkerHistoryVersion(fastify, versionId)
  if (!version) {
    throw new Error('History version not found')
  }
  if (version.path !== canonicalPath) {
    throw new Error('History version does not belong to this file path')
  }

  const directoryCol = fastify.mongo.db.collection('Directory')
  const existing = await directoryCol.findOne({ path: canonicalPath, isDirectory: false })
  if (!existing) {
    throw new Error('File not found')
  }

  const restoredData = {
    ...(version.data || {}),
    uri: canonicalPath,
  }

  const result = await saveSkerToCollections(
    fastify,
    existing,
    canonicalPath,
    restoredData,
    {
      skipHistory: true,
      historyAuthor: options.author || version.author || '',
      historyEmail: options.email || version.email || '',
    }
  )

  return {
    version,
    ...result,
  }
}

// saveSkerToCollections: parse .sker content, extract info, write Spreadsheet.data, return references
export async function saveSkerToCollections(
  fastify,
  existingDirectoryDoc,
  fileName,
  fileContent,
  options = {}
) {
  if (!fileName || typeof fileName !== 'string' || !fileName.toLowerCase().endsWith('.sker')) {
    return { recordId: null, info: null, spreadsheetData: null, size: 0, historyEntry: null }
  }

  let parsed = null
  if (typeof fileContent === 'string') {
    parsed = JSON.parse(fileContent)
  } else if (fileContent && typeof fileContent === 'object') {
    parsed = fileContent
  }
  if (!parsed) {
    return { recordId: null, info: null, spreadsheetData: null, size: 0, historyEntry: null }
  }

  const info = parsed.info || null
  const spreadsheetData = { ...parsed }
  const canonicalPath = resolveCanonicalPath(existingDirectoryDoc, fileName)

  if (canonicalPath) {
    spreadsheetData.uri = canonicalPath
    if (existingDirectoryDoc?.path) {
      console.log(`🔧 Corrected URI in save: ${parsed.uri || 'missing'} -> ${existingDirectoryDoc.path}`)
    } else if (fileName.includes('/')) {
      console.log(`🔧 URI set from virtual path: ${canonicalPath}`)
    } else {
      console.log(`🔧 Constructed URI from fileName: ${canonicalPath}`)
    }
  }

  const spreadsheetCol = fastify.mongo.db.collection('Spreadsheet')
  const bucket = getSpreadsheetGridFSBucket(fastify.mongo.db)

  let serialized = ''
  let size = 0
  try {
    serialized = JSON.stringify(spreadsheetData)
    size = Buffer.byteLength(serialized, 'utf8')
  } catch (sizeError) {
    console.warn('Error calculating size in saveSkerToCollections:', sizeError)
    if (typeof fileContent === 'string') {
      try {
        serialized = fileContent
        size = Buffer.byteLength(fileContent, 'utf8')
      } catch (_) {}
    }
  }

  let existingSpreadsheetDoc = null
  if (existingDirectoryDoc?.record) {
    try {
      existingSpreadsheetDoc = await spreadsheetCol.findOne({
        _id: new ObjectId(String(existingDirectoryDoc.record)),
      })
    } catch (_) {}
  }

  const useGridFS = size > MAX_SPREADSHEET_INLINE_BYTES
  const gridfsFilename = `spreadsheet/${canonicalPath || fileName}`

  let recordId = null
  if (existingDirectoryDoc && existingDirectoryDoc.record) {
    recordId = new ObjectId(String(existingDirectoryDoc.record))
    if (useGridFS) {
      // Write the new blob first, then retarget the record, then drop the old file.
      // Deleting first opened a FileNotFound window (100MB+ books / long WriteJson after recalc).
      const previousGridfsId = existingSpreadsheetDoc?.gridfsId
      const gridfsId = await writeSpreadsheetJsonToGridFS(bucket, gridfsFilename, serialized)
      await spreadsheetCol.updateOne(
        { _id: recordId },
        {
          $set: { gridfsId, size, updatedAt: new Date() },
          $unset: { data: '', dataJson: '' },
        },
        { upsert: true }
      )
      if (previousGridfsId && String(previousGridfsId) !== String(gridfsId)) {
        await deleteGridFSFileSafe(bucket, previousGridfsId)
      }
      console.log(`📦 Spreadsheet stored in GridFS (${size} bytes): ${canonicalPath || fileName}`)
    } else {
      await spreadsheetCol.updateOne(
        { _id: recordId },
        {
          $set: { dataJson: serialized, size, updatedAt: new Date() },
          $unset: { data: '', gridfsId: '' },
        },
        { upsert: true }
      )
      await deleteGridFSFileSafe(bucket, existingSpreadsheetDoc?.gridfsId)
    }
  } else if (useGridFS) {
    const gridfsId = await writeSpreadsheetJsonToGridFS(bucket, gridfsFilename, serialized)
    const ins = await spreadsheetCol.insertOne({
      gridfsId,
      size,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    recordId = ins.insertedId
    console.log(`📦 Spreadsheet stored in GridFS (${size} bytes): ${canonicalPath || fileName}`)
  } else {
    const ins = await spreadsheetCol.insertOne({
      dataJson: serialized,
      size,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    recordId = ins.insertedId
  }

  let historyEntry = null
  // Version history is recorded only via POST /files/history/snapshot (manual snapshots).

  return { recordId, info, spreadsheetData, size, historyEntry }
}

// rebuildSkerContentFromRecord: read Spreadsheet by record and merge with info
export async function rebuildSkerContentFromRecord(fastify, directoryDoc) {
  if (!directoryDoc || directoryDoc.isDirectory) return { content: null, size: 0 }
  const name = directoryDoc.name || ''
  const pathStr = typeof directoryDoc.path === 'string' ? directoryDoc.path : ''
  const isSker =
    (typeof name === 'string' && name.toLowerCase().endsWith('.sker')) ||
    pathStr.toLowerCase().endsWith('.sker')
  if (!isSker) {
    return { content: null, size: 0 }
  }
  if (!directoryDoc.record) return { content: null, size: 0 }

  const spreadsheetCol = fastify.mongo.db.collection('Spreadsheet')
  let rec = null
  try {
    rec = await spreadsheetCol.findOne({ _id: new ObjectId(String(directoryDoc.record)) })
  } catch (_) {
    return { content: null, size: 0 }
  }
  const loadedData = await loadSpreadsheetDataFromRecord(fastify, rec)
  if (!loadedData) return { content: null, size: 0 }

  let dataOut = loadedData
  if ((typeof dataOut !== 'object' || dataOut === null) || (!('info' in dataOut) && directoryDoc.info)) {
    dataOut = { ...(dataOut || {}), ...(directoryDoc.info ? { info: directoryDoc.info } : {}) }
  }

  if (directoryDoc.path && typeof directoryDoc.path === 'string') {
    dataOut.uri = directoryDoc.path
    console.log(`🔧 Corrected URI in rebuilt content: ${loadedData.uri || 'missing'} -> ${directoryDoc.path}`)
  }

  const content = JSON.stringify(dataOut)
  let size = 0
  try { size = Buffer.byteLength(content, 'utf8') } catch (_) {}
  return { content, size }
}
