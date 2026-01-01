import pool from "../config/db.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";
import { generateActivityMessage } from "../utils/activityHelper.js";

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

const formatLog = (log) => {
  const meta = {};
  if (log.entity_type === 'task' && log.action === 'updated') {
    if (log.before_data?.status !== log.after_data?.status) {
      meta.from_status = log.before_data?.status;
      meta.to_status = log.after_data?.status;
    }
  }

  return {
    id: log.id,
    type: log.entity_type,
    action: log.action,
    entity_id: log.after_data?.task_code || log.after_data?.project_code || log.entity_id,
    message: generateActivityMessage(log),
    user_name: log.user_name || "Unknown User",
    user_id: log.changed_by,
    user: {
      id: log.changed_by,
      name: log.user_name || "Unknown User"
    },
    project_name: log.after_data?.project_name || log.before_data?.project_name || null,
    module_name: log.after_data?.module_name || log.before_data?.module_name || null,
    meta: Object.keys(meta).length > 0 ? meta : (log.after_data || {}),
    changed_at: log.changed_at,
    created_at: log.changed_at
  };
};

export const getChangeLogs = async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;

    let q = `
      SELECT c.*, u.full_name AS user_name
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
    successResponse(res, rows.map(formatLog));
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/**
 * 1️⃣ Project-Scoped Activity (Projects Page)
 */
export const getProjectActivity = async (req, res) => {
  try {
    const { id } = req.params;

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
          cl.entity_type IN ('task','module', 'sprint')
          AND (
            (cl.before_data->>'project_id')::uuid = $1::uuid
            OR (cl.after_data->>'project_id')::uuid = $1::uuid
          )
        )
      ORDER BY cl.changed_at DESC
      LIMIT 20
      `,
      [id]
    );

    successResponse(res, rows.map(formatLog));
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/**
 * 2️⃣ Global Activity (Dashboard)
 */
export const getGlobalActivity = async (req, res) => {
  try {
    const { userId, role } = req.user;
    const isAdmin = ["admin", "Project Manager"].includes(role);

    let q = `
      SELECT
        cl.*,
        u.full_name AS user_name
      FROM change_logs cl
      LEFT JOIN users u ON u.id = cl.changed_by
    `;
    const params = [];

    if (!isAdmin) {
      // Developer/QA visibility rules
      q += `
        WHERE 
          cl.changed_by = $1
          OR (
            cl.entity_type = 'task' 
            AND (cl.after_data->>'assignee_id' = $1 OR cl.before_data->>'assignee_id' = $1)
          )
          OR (
            cl.entity_type = 'project'
            AND EXISTS (
              SELECT 1 FROM project_members pm 
              WHERE pm.project_id = cl.entity_id AND pm.user_id = $1
            )
          )
          OR (
            cl.entity_type IN ('task', 'module', 'sprint')
            AND EXISTS (
              SELECT 1 FROM project_members pm 
              WHERE (pm.project_id = (cl.after_data->>'project_id')::uuid OR pm.project_id = (cl.before_data->>'project_id')::uuid)
              AND pm.user_id = $1
            )
          )
      `;
      params.push(userId);
    }

    q += ` ORDER BY cl.changed_at DESC LIMIT 50`;

    const { rows } = await pool.query(q, params);
    successResponse(res, rows.map(formatLog));
  } catch (err) {
    console.error("getGlobalActivity error:", err);
    errorResponse(res, err.message);
  }
};
