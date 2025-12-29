import pool from "../config/db.js";

/* ================= WRITE LOG ================= */

export const logChange = async (
  entity_type,
  entity_id,
  action,
  beforeData,
  afterData,
  user_id
) => {
  try {
    await pool.query(
      `
      INSERT INTO change_logs
      (entity_type, entity_id, action, before_data, after_data, changed_by)
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [entity_type, entity_id, action, beforeData, afterData, user_id]
    );
  } catch (err) {
    console.error("Change log failed:", err.message);
  }
};

/* ================= READ LOGS ================= */

export const getChangeLogs = async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;

    let q = `
      SELECT c.*, u.full_name AS changed_by_name
      FROM change_logs c
      LEFT JOIN users u ON u.id = c.changed_by
      WHERE 1=1
    `;
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

    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getProjectActivity = async (req, res) => {
  try {
    const { projectId } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        cl.*,
        u.full_name AS user_name
      FROM change_logs cl
      LEFT JOIN users u ON u.id = cl.changed_by
      WHERE
        (cl.entity_type = 'project' AND cl.entity_id = $1)
        OR (
          cl.entity_type IN ('task','module')
          AND cl.entity_id IN (
            SELECT id FROM tasks WHERE project_id=$1
            UNION
            SELECT id FROM modules WHERE project_id=$1
          )
        )
      ORDER BY cl.changed_at DESC
      LIMIT 20
      `,
      [projectId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
