//=============================================================================
// SkSQL.mjs
// Interface between table and mongodb
// Author Stéphane ALLEZ 20/08/2024
//=============================================================================
import { convertSqlToMongo, executeMongoQuery } from './SkSqlToMongo.mjs'

// Clients post either raw SQL or { select: "SELECT ..." }.
function readSqlText(body) {
    if (typeof body === 'string') {
        const trimmed = body.trim();
        if (trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed.select === 'string') {
                    return parsed.select;
                }
            } catch {
                // Not a JSON envelope; treat the body as raw SQL.
            }
        }
        return body;
    }
    if (body && typeof body.select === 'string') {
        return body.select;
    }
    throw new Error('SQL query must be a string or { select: "..." }');
}

async function SkSQL(fastify, _opts) {
    fastify.post('/sql', async function (req) {
        let wResult = {}
        try {
            const wSelect = readSqlText(req.body);
            const mongoQuery = convertSqlToMongo(wSelect);
            const wCollection = fastify.mongo.db.collection(mongoQuery.collection);
            const results = await executeMongoQuery(mongoQuery.select, wCollection);
            wResult.message = 'success'
            wResult.records = results
        } catch (sError) {
            wResult.message = 'error'
            wResult.error = sError.toString()
        }
        // Fastify serializes the object. Callers parse it with response.json().
        return wResult;
    })
}

export { SkSQL }
