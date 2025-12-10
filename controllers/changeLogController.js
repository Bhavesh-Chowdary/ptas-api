import pool from '../config/db.js';

export const logChange = async (entity_type, entity_id, action, beforeData, afterData, user_id) => {
  try {
    await pool.query(
      `INSERT INTO change_logs (entity_type, entity_id, action, before_data, after_data, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entity_type, entity_id, action, beforeData, afterData, user_id]
    );
  } catch (err) {
    console.error('Change log failed:', err.message);
  }
};

export const getChangeLogs = async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    let q = `
      SELECT c.*, u.full_name AS changed_by_name
      FROM change_logs c
      LEFT JOIN users u ON u.id = c.changed_by
      WHERE 1=1`;
    const params = [];

    if (entity_type) {
      params.push(entity_type);
      q += ` AND c.entity_type = $${params.length}`;
    }
    if (entity_id) {
      params.push(entity_id);
      q += ` AND c.entity_id = $${params.length}`;
    }

    q += ` ORDER BY c.changed_at DESC`;
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
