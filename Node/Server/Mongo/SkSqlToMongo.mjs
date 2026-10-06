//=============================================================================
// SkSqlToMongo.mjs
// Convert a small SQL dialect to a MongoDB find
// Author Stéphane ALLEZ 20/08/2024
//=============================================================================

const CLAUSE_ORDER = ['SELECT', 'FROM', 'WHERE', 'ORDER BY', 'LIMIT'];

/**
 * Convert an SQL query to a MongoDB find description.
 * @param {string} sqlQuery
 * @returns {{ collection: string, select: { query: object, sort: object, limit?: number, projection?: object } }}
 */
export function convertSqlToMongo(sqlQuery) {
    try {
        if (typeof sqlQuery !== 'string') {
            throw new Error('SQL query must be a string');
        }

        const text = sqlQuery.trim().replace(/;+\s*$/, '');
        const clauses = extractClauses(text);
        if (!clauses.FROM) {
            throw new Error('Missing FROM clause in SQL query');
        }

        const collection = clauses.FROM.trim();
        if (!/^[A-Za-z_][\w]*$/.test(collection)) {
            throw new Error('Invalid collection name: ' + collection);
        }

        const projection = parseProjection(clauses.SELECT);
        const query = clauses.WHERE ? parseWhere(clauses.WHERE) : {};
        const sort = clauses['ORDER BY'] ? parseOrderBy(clauses['ORDER BY']) : {};
        const limit = clauses.LIMIT !== undefined ? parseLimit(clauses.LIMIT) : undefined;

        const select = { query, sort };
        if (projection) {
            select.projection = projection;
        }
        if (limit !== undefined) {
            select.limit = limit;
        }
        return { collection, select };
    } catch (error) {
        console.error('Error converting SQL to MongoDB:', error);
        throw error;
    }
}

/**
 * Run the find described by convertSqlToMongo().select.
 * @param {{ query: object, sort: object, limit?: number, projection?: object }} sQueryObject
 * @param {object} sCollection - MongoDB collection
 * @returns {Promise<object[]>}
 */
export async function executeMongoQuery(sQueryObject, sCollection) {
    try {
        // MongoDB treats limit(0) as "no limit". SQL LIMIT 0 returns no rows.
        if (sQueryObject.limit === 0) {
            return [];
        }

        let wCursor = sCollection.find(sQueryObject.query || {});
        if (sQueryObject.projection) {
            wCursor = wCursor.project(sQueryObject.projection);
        }
        if (sQueryObject.sort && Object.keys(sQueryObject.sort).length > 0) {
            wCursor = wCursor.sort(sQueryObject.sort);
        }
        if (typeof sQueryObject.limit === 'number') {
            wCursor = wCursor.limit(sQueryObject.limit);
        }
        return await wCursor.toArray();
    } catch (error) {
        console.error('Error executing MongoDB query:', error);
        throw error;
    }
}

function extractClauses(sql) {
    const marks = findClauseMarks(sql);
    const seen = new Set();
    for (const mark of marks) {
        if (seen.has(mark.name)) {
            throw new Error('Duplicated clause: ' + mark.name);
        }
        seen.add(mark.name);
    }

    const present = marks.map((mark) => mark.name);
    const expected = CLAUSE_ORDER.filter((name) => present.includes(name));
    if (present.join('|') !== expected.join('|')) {
        throw new Error('Clauses must follow SELECT, FROM, WHERE, ORDER BY, LIMIT');
    }

    const clauses = {};
    for (let i = 0; i < marks.length; i++) {
        const mark = marks[i];
        const end = i + 1 < marks.length ? marks[i + 1].index : sql.length;
        clauses[mark.name] = sql.slice(mark.index + mark.name.length, end).trim();
    }
    return clauses;
}

function findClauseMarks(sql) {
    const marks = [];
    let quote = null;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (quote) {
            if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
        }
        if (isKeywordAt(sql, i, 'ORDER') && /^\s+BY\b/i.test(sql.slice(i + 5))) {
            marks.push({ name: 'ORDER BY', index: i });
            continue;
        }
        for (const name of ['SELECT', 'FROM', 'WHERE', 'LIMIT']) {
            if (isKeywordAt(sql, i, name)) {
                marks.push({ name, index: i });
                break;
            }
        }
    }
    if (quote) {
        throw new Error('Unclosed quote in SQL query');
    }
    return marks;
}

function isKeywordAt(text, index, keyword) {
    if (text.slice(index, index + keyword.length).toUpperCase() !== keyword) {
        return false;
    }
    const beforeOk = index === 0 || /[\s(]/.test(text[index - 1]);
    const afterIndex = index + keyword.length;
    const afterOk = afterIndex >= text.length || /[\s)]/.test(text[afterIndex]);
    return beforeOk && afterOk;
}

function parseProjection(selectList) {
    if (selectList === undefined || selectList.trim() === '' || selectList.trim() === '*') {
        return null;
    }
    const projection = {};
    for (const part of selectList.split(',')) {
        const field = part.trim();
        if (!/^[A-Za-z_][\w]*$/.test(field)) {
            throw new Error('Unsupported select item: ' + field);
        }
        projection[field] = 1;
    }
    return projection;
}

function parseLimit(limitText) {
    if (!/^\d+$/.test(limitText.trim())) {
        throw new Error('LIMIT must be a non-negative integer');
    }
    return Number(limitText.trim());
}

function parseOrderBy(orderText) {
    const sort = {};
    for (const piece of orderText.split(',')) {
        const tokens = piece.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) {
            continue;
        }
        if (tokens.length > 2 || !/^[A-Za-z_][\w]*$/.test(tokens[0])) {
            throw new Error('Unsupported ORDER BY clause: ' + piece.trim());
        }
        let direction = 1;
        if (tokens.length === 2) {
            const word = tokens[1].toUpperCase();
            if (word === 'DESC') {
                direction = -1;
            } else if (word !== 'ASC') {
                throw new Error('Unsupported sort direction: ' + tokens[1]);
            }
        }
        sort[tokens[0]] = direction;
    }
    return sort;
}

function parseWhere(whereText) {
    const orParts = splitByKeyword(whereText, 'OR');
    const orConditions = orParts.map((part) => {
        const andParts = splitByKeyword(part, 'AND');
        const andConditions = andParts.map(parseCondition);
        return andConditions.length === 1 ? andConditions[0] : { $and: andConditions };
    });
    return orConditions.length === 1 ? orConditions[0] : { $or: orConditions };
}

function splitByKeyword(text, keyword) {
    const parts = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            current += ch;
            if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            current += ch;
            continue;
        }
        if (isKeywordAt(text, i, keyword)) {
            parts.push(current.trim());
            current = '';
            i += keyword.length - 1;
            continue;
        }
        current += ch;
    }
    if (quote) {
        throw new Error('Unclosed quote in SQL query');
    }
    const trimmed = current.trim();
    if (trimmed) {
        parts.push(trimmed);
    }
    if (parts.length === 0 || parts.some((part) => part === '')) {
        throw new Error('Missing condition around ' + keyword);
    }
    return parts;
}

function parseCondition(condition) {
    const match = condition.match(/^\s*([A-Za-z_][\w]*)\s*(<=|>=|<>|!=|=|<|>|LIKE)\s*([\s\S]+?)\s*$/i);
    if (!match) {
        throw new Error('Unsupported condition: ' + condition);
    }
    const field = match[1];
    const operator = match[2].toUpperCase();
    const value = parseLiteral(match[3].trim());
    return conditionToMongo(field, operator, value);
}

function parseLiteral(raw) {
    if (raw.length >= 2) {
        const quote = raw[0];
        if ((quote === "'" || quote === '"') && raw[raw.length - 1] === quote) {
            return raw.slice(1, -1);
        }
    }
    if (/^-?\d+$/.test(raw) || /^-?\d+\.\d+$/.test(raw)) {
        return Number(raw);
    }
    if (/^\S+$/.test(raw)) {
        return raw;
    }
    throw new Error('Value must be quoted: ' + raw);
}

function conditionToMongo(field, operator, value) {
    switch (operator) {
        case '=':
            return { [field]: value };
        case '!=':
        case '<>':
            return { [field]: { $ne: value } };
        case '>':
            return { [field]: { $gt: value } };
        case '>=':
            return { [field]: { $gte: value } };
        case '<':
            return { [field]: { $lt: value } };
        case '<=':
            return { [field]: { $lte: value } };
        case 'LIKE':
            return { [field]: { $regex: likeToRegex(String(value)), $options: 'i' } };
        default:
            throw new Error('Unsupported operator: ' + operator);
    }
}

// SQL LIKE: % any sequence, _ one character. Other characters are literal.
// The pattern is anchored, so LIKE 'foo' matches the whole value.
function likeToRegex(pattern) {
    let regex = '^';
    for (const ch of pattern) {
        if (ch === '%') {
            regex += '.*';
        } else if (ch === '_') {
            regex += '.';
        } else {
            regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
    }
    return regex + '$';
}
