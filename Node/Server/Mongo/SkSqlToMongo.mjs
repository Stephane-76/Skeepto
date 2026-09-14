//=============================================================================
// SkSqlToMongo.mjs
// Convert SQL query to MongoDB query
// Author Stéphane ALLEZ 20/08/2024
//=============================================================================

/**
 * Clean string value by removing surrounding quotes
 * @param {string} value - The value to clean
 * @returns {string} - Cleaned value
 */
function cleanValue(value) {
    if (typeof value !== 'string') return value;
    // Remove surrounding quotes (both single and double)
    return value.replace(/^['"]|['"]$/g, '');
}

/**
 * Convert SQL query to MongoDB query
 * @param {string} sqlQuery - The SQL query to convert
 * @returns {Array} - MongoDB query array [query, sort]
 */
export function convertSqlToMongo(sqlQuery) {
    try {
        // Ensure sqlQuery is a string
        if (typeof sqlQuery !== 'string') {
            throw new Error('❌ SQL query must be a string');
        }

        // Parse SQL query
        const sql = sqlQuery;
        
        // Initialize query objects
        let wQuery = {};
        let wSort = {};
        let wConditions = [];

        // Extract collection name (FROM clause)
        const fromMatch = sql.match(/FROM\s+(\w+)/i);
        if (!fromMatch) {
            throw new Error('❌Missing FROM clause in SQL query');
        }
        const collection = fromMatch[1];

        // Extract WHERE conditions
        const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+by|\s+LIMIT|\s*$)/i);
        if (whereMatch) {
            // Check if there's an OR in the conditions
            if (whereMatch[1].includes(' OR ')) {
                // Split conditions by OR first
                const orConditions = whereMatch[1].split(/\s+OR\s+/i);
                let wOrConditions = [];
                
                orConditions.forEach(orCondition => {
                    // Then split each OR condition by AND
                    const andConditions = orCondition.split(/\s+AND\s+/i);
                    let wAndConditions = [];

                    andConditions.forEach(condition => {
                        const [field, operator, value] = condition.split(/\s+/);
                        let wCondition = {};
                        
                        // Clean the value
                        const cleanedValue = cleanValue(value);
                        
                        // Convert SQL operators to MongoDB operators
                        switch(operator) {
                            case '=':
                                wCondition[field] = cleanedValue;
                                break;
                            case '!=':
                            case '<>':
                                wCondition[field] = { $ne: cleanedValue };
                                break;
                            case '>':
                                wCondition[field] = { $gt: cleanedValue };
                                break;
                            case '>=':
                                wCondition[field] = { $gte: cleanedValue };
                                break;
                            case '<':
                                wCondition[field] = { $lt: cleanedValue };
                                break;
                            case '<=':
                                wCondition[field] = { $lte: cleanedValue };
                                break;
                            case 'LIKE':
                                // Convert SQL LIKE to MongoDB regex
                                const regexPattern = cleanedValue.replace(/%/g, '.*').replace(/_/g, '.');
                                wCondition[field] = { $regex: regexPattern, $options: 'i' };
                                break;
                            default:
                                throw new Error('❌ Sql Unsupported operator: ' + operator);
                        }
                        wAndConditions.push(wCondition);
                    });

                    // Combine AND conditions
                    if (wAndConditions.length > 0) {
                        wOrConditions.push(wAndConditions.length === 1 ? wAndConditions[0] : { $and: wAndConditions });
                    }
                });

                // Combine OR conditions
                if (wOrConditions.length > 0) {
                    wQuery = wOrConditions.length === 1 ? wOrConditions[0] : { $or: wOrConditions };
                }
            } else {
                // Handle AND conditions only
                const andConditions = whereMatch[1].split(/\s+AND\s+/i);
                let wAndConditions = [];

                andConditions.forEach(condition => {
                    const [field, operator, value] = condition.split(/\s+/);
                    let wCondition = {};
                    
                    // Clean the value
                    const cleanedValue = cleanValue(value);
                    
                    // Convert SQL operators to MongoDB operators
                    switch(operator) {
                        case '=':
                            wCondition[field] = cleanedValue;
                            break;
                        case '!=':
                        case '<>':
                            wCondition[field] = { $ne: cleanedValue };
                            break;
                        case '>':
                            wCondition[field] = { $gt: cleanedValue };
                            break;
                        case '>=':
                            wCondition[field] = { $gte: cleanedValue };
                            break;
                        case '<':
                            wCondition[field] = { $lt: cleanedValue };
                            break;
                        case '<=':
                            wCondition[field] = { $lte: cleanedValue };
                            break;
                        case 'LIKE':
                            // Convert SQL LIKE to MongoDB regex
                            const regexPattern = cleanedValue.replace(/%/g, '.*').replace(/_/g, '.');
                            wCondition[field] = { $regex: regexPattern, $options: 'i' };
                            break;
                        default:
                            throw new Error('❌ Sql Unsupported operator: ' + operator);
                    }
                    wAndConditions.push(wCondition);
                });

                // Combine AND conditions
                if (wAndConditions.length > 0) {
                    wQuery = wAndConditions.length === 1 ? wAndConditions[0] : { $and: wAndConditions };
                }
            }
        }

        // Extract ORDER BY clause
        const orderByMatch = sql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s*$)/i);
        if (orderByMatch) {
            const orderClauses = orderByMatch[1].split(',');
            orderClauses.forEach(clause => {
                const [field, direction] = clause.trim().split(/\s+/);
                wSort[field] = direction === 'DESC' ? -1 : 1;
            });
        }

        // Return array with query and sort
        return {collection: collection, select: { "query": wQuery, "sort": wSort}};

    } catch (error) {
        console.error('❌ Error converting SQL to MongoDB:', error);
        throw error;
    }
}

/**
 * Execute MongoDB query
 * @param {Object} sQueryObject - Object containing collection and select information
 * @param {Object} sCollection - MongoDB database instance
 * @returns {Promise<Array>} - Query results
 */
export async function executeMongoQuery(sQueryObject, sCollection) {
    try {
        let wCursor = sCollection.find(sQueryObject.query).sort(sQueryObject.sort);
        let wResult = await wCursor.toArray();
        return wResult;
    } catch (error) {
        console.error('❌ Error executing MongoDB query:', error);
        throw error;
    }
} 