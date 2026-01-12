import db from '../config/knex.js';

/**
 * Query Builder Helpers for common patterns
 */

/**
 * Execute a transaction with automatic rollback on error
 */
export const withTransaction = async (callback) => {
    const trx = await db.transaction();
    try {
        const result = await callback(trx);
        await trx.commit();
        return result;
    } catch (error) {
        await trx.rollback();
        throw error;
    }
};

/**
 * Find a single record by ID
 */
export const findById = async (table, id, columns = '*') => {
    return await db(table)
        .select(columns)
        .where({ id })
        .first();
};

/**
 * Find records with conditions
 */
export const findWhere = async (table, conditions, columns = '*') => {
    return await db(table)
        .select(columns)
        .where(conditions);
};

/**
 * Insert a single record and return it
 */
export const insertOne = async (table, data) => {
    const [result] = await db(table)
        .insert(data)
        .returning('*');
    return result;
};

/**
 * Insert multiple records
 */
export const insertMany = async (table, dataArray) => {
    return await db(table)
        .insert(dataArray)
        .returning('*');
};

/**
 * Update records and return updated rows
 */
export const updateWhere = async (table, conditions, data) => {
    return await db(table)
        .where(conditions)
        .update({
            ...data,
            updated_at: db.fn.now(),
        })
        .returning('*');
};

/**
 * Update by ID
 */
export const updateById = async (table, id, data) => {
    const [result] = await db(table)
        .where({ id })
        .update({
            ...data,
            updated_at: db.fn.now(),
        })
        .returning('*');
    return result;
};

/**
 * Delete records
 */
export const deleteWhere = async (table, conditions) => {
    return await db(table)
        .where(conditions)
        .del();
};

/**
 * Delete by ID
 */
export const deleteById = async (table, id) => {
    return await db(table)
        .where({ id })
        .del();
};

/**
 * Count records
 */
export const countWhere = async (table, conditions = {}) => {
    const result = await db(table)
        .where(conditions)
        .count('* as count')
        .first();
    return parseInt(result.count);
};

/**
 * Check if record exists
 */
export const exists = async (table, conditions) => {
    const count = await countWhere(table, conditions);
    return count > 0;
};

/**
 * Paginate results
 */
export const paginate = async (query, page = 1, limit = 10) => {
    const offset = (page - 1) * limit;

    const [data, countResult] = await Promise.all([
        query.clone().limit(limit).offset(offset),
        query.clone().count('* as count').first(),
    ]);

    const total = parseInt(countResult.count);

    return {
        data,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNext: page * limit < total,
            hasPrev: page > 1,
        },
    };
};

/**
 * Batch insert with conflict handling
 */
export const upsert = async (table, data, conflictColumns, updateColumns) => {
    const query = db(table).insert(data);

    if (conflictColumns && updateColumns) {
        const updateData = {};
        updateColumns.forEach(col => {
            updateData[col] = db.raw(`EXCLUDED.${col}`);
        });

        return await query
            .onConflict(conflictColumns)
            .merge(updateData)
            .returning('*');
    }

    return await query.returning('*');
};

/**
 * Execute raw query (for complex queries)
 */
export const raw = async (sql, bindings = []) => {
    return await db.raw(sql, bindings);
};

/**
 * Get query builder instance
 */
export const getQueryBuilder = (table) => {
    return db(table);
};

export default db;
