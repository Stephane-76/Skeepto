//=============================================================================
// SkRecordImage.mjs
// Image values on generic records: small payloads stay in the document,
// larger ones go to GridFS. The record keeps a short descriptor either way.
//=============================================================================
import { ObjectId } from '@fastify/mongodb'
import { GridFSBucket } from 'mongodb'

// Keep the JSON document well under the 1MB /mdb body limit once base64-encoded.
export const RECORD_IMAGE_INLINE_MAX_BYTES = 256 * 1024
export const RECORD_IMAGE_MAX_BYTES = 16 * 1024 * 1024
const BUCKET_NAME = 'recordImages'

const ALLOWED_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
])

function imageBucket(db) {
    return new GridFSBucket(db, { bucketName: BUCKET_NAME })
}

function normalizeMime(mime) {
    const value = String(mime || '').trim().toLowerCase()
    if (value === 'image/jpg') {
        return 'image/jpeg'
    }
    return value
}

export function assertAllowedImageMime(mime) {
    const normalized = normalizeMime(mime)
    if (!ALLOWED_MIME.has(normalized)) {
        throw new Error('Unsupported image type: ' + (mime || '(empty)') + '. Use PNG, JPEG, GIF, WebP or SVG.')
    }
    return normalized
}

function decodeDataUrl(dataUrl) {
    const text = String(dataUrl || '')
    const base64 = text.match(/^data:([^;,]+);base64,([\s\S]+)$/i)
    if (base64) {
        return {
            mime: assertAllowedImageMime(base64[1]),
            buffer: Buffer.from(base64[2], 'base64'),
        }
    }
    const plain = text.match(/^data:([^;,]+),(.*)$/i)
    if (plain) {
        return {
            mime: assertAllowedImageMime(plain[1]),
            buffer: Buffer.from(decodeURIComponent(plain[2]), 'utf8'),
        }
    }
    throw new Error('Image data must be a data URL')
}

function gridfsIdOf(value) {
    if (!value || typeof value !== 'object') {
        return ''
    }
    if (value.storage !== 'gridfs' || !value.gridfsId) {
        return ''
    }
    return String(value.gridfsId)
}

async function deleteGridFSFileSafe(db, gridfsId) {
    if (!gridfsId) {
        return
    }
    try {
        await imageBucket(db).delete(new ObjectId(String(gridfsId)))
    } catch (_) {
        // Already removed, or the id is not a GridFS file.
    }
}

function uploadBuffer(db, filename, buffer, metadata) {
    return new Promise((resolve, reject) => {
        const stream = imageBucket(db).openUploadStream(filename || 'image', { metadata })
        stream.on('error', reject)
        stream.end(buffer, (err) => {
            if (err) {
                reject(err)
            } else {
                resolve(stream.id)
            }
        })
    })
}

function imageFieldNames(table) {
    return (table?.m_Columns || [])
        .filter((column) => column.m_TypeColumn === 'image')
        .map((column) => column.m_Name)
}

function inlineDescriptor(mime, name, dataUrl) {
    return {
        storage: 'inline',
        mime,
        name: name || '',
        data: dataUrl,
    }
}

async function storeBuffer(db, mime, name, buffer, dataUrl) {
    if (buffer.length > RECORD_IMAGE_MAX_BYTES) {
        throw new Error('Image is larger than 16MB')
    }
    if (buffer.length <= RECORD_IMAGE_INLINE_MAX_BYTES && dataUrl) {
        return inlineDescriptor(mime, name, dataUrl)
    }
    const id = await uploadBuffer(db, name || 'image', buffer, {
        mime,
        name: name || '',
        kind: 'record-image',
    })
    return {
        storage: 'gridfs',
        mime,
        name: name || '',
        gridfsId: String(id),
    }
}

/**
 * Turn a client image value into the object stored on the record.
 * A gridfs descriptor is kept. Inline bytes above the limit are moved to GridFS.
 */
export async function storeRecordImageValue(db, value) {
    if (value === null || value === undefined || value === '') {
        return null
    }
    if (typeof value === 'object' && value.storage === 'gridfs' && value.gridfsId) {
        const mime = assertAllowedImageMime(value.mime)
        return {
            storage: 'gridfs',
            mime,
            name: value.name || '',
            gridfsId: String(value.gridfsId),
        }
    }
    let dataUrl = ''
    let name = ''
    if (typeof value === 'string') {
        dataUrl = value
    } else if (typeof value === 'object' && typeof value.data === 'string') {
        dataUrl = value.data
        name = value.name || ''
    } else {
        throw new Error('Invalid image value')
    }
    const decoded = decodeDataUrl(dataUrl)
    return storeBuffer(db, decoded.mime, name, decoded.buffer, dataUrl)
}

export async function persistRecordImages(db, table, record) {
    for (const name of imageFieldNames(table)) {
        if (!Object.prototype.hasOwnProperty.call(record, name)) {
            continue
        }
        record[name] = await storeRecordImageValue(db, record[name])
    }
}

// Drop the previous GridFS file only after the record write succeeded.
export async function releaseReplacedRecordImages(db, table, previous, record) {
    if (!previous || !record) {
        return
    }
    for (const name of imageFieldNames(table)) {
        if (!Object.prototype.hasOwnProperty.call(record, name)) {
            continue
        }
        const previousId = gridfsIdOf(previous[name])
        const nextId = gridfsIdOf(record[name])
        if (previousId && previousId !== nextId) {
            await deleteGridFSFileSafe(db, previousId)
        }
    }
}

export async function releaseRecordImages(db, table, record) {
    if (!record) {
        return
    }
    for (const name of imageFieldNames(table)) {
        await deleteGridFSFileSafe(db, gridfsIdOf(record[name]))
    }
}

export async function openRecordImage(db, id) {
    let objectId
    try {
        objectId = new ObjectId(String(id))
    } catch {
        return null
    }
    const bucket = imageBucket(db)
    const files = await bucket.find({ _id: objectId }).toArray()
    if (files.length === 0) {
        return null
    }
    return {
        mime: files[0].metadata?.mime || 'application/octet-stream',
        stream: bucket.openDownloadStream(objectId),
    }
}
