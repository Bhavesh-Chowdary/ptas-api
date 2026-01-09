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
  console.log("\n\n🔍 getChangeLogs CALLED");
  console.log("Raw req.query:", JSON.stringify(req.query, null, 2));

  try {
    const {
      entity_type,
      entity_id,
      project_id,
      sprint_id,
      member_id,
      start_date,
      end_date
    } = req.query;

    let q = `
      SELECT c.*, u.full_name AS user_name
      FROM change_logs c
      LEFT JOIN users u ON u.id = c.changed_by
      WHERE 1=1
    `;
    console.log("ChangeLogs Request Query:", req.query);
    const params = [];

    if (entity_type) {
      params.push(entity_type);
      q += ` AND c.entity_type = $${params.length}`;
    }
    if (entity_id) {
      params.push(entity_id);
      q += ` AND c.entity_id = $${params.length}`;
    }
    if (member_id && member_id !== 'all') {
      params.push(member_id);
      q += ` AND c.changed_by = $${params.length}::uuid`;
    }
    if (project_id && project_id !== 'all') {
      params.push(project_id);
      const idx = params.length;
      q += ` AND (
        (c.entity_type = 'project' AND c.entity_id::text = $${idx}::text)
        OR (c.after_data->>'project_id' = $${idx}::text)
        OR (c.before_data->>'project_id' = $${idx}::text)
      )`;
    }
    if (sprint_id && sprint_id !== 'all') {
      params.push(sprint_id);
      const idx = params.length;
      q += ` AND (
        (c.entity_type = 'sprint' AND c.entity_id::text = $${idx}::text)
        OR (c.after_data->>'sprint_id' = $${idx}::text)
        OR (c.before_data->>'sprint_id' = $${idx}::text)
      )`;
    }
    if (start_date) {
      params.push(start_date);
      q += ` AND c.changed_at >= $${params.length}`;
    }
    if (end_date) {
      params.push(end_date);
      q += ` AND c.changed_at <= $${params.length}`;
    }

    q += ` ORDER BY c.changed_at DESC`;
    console.log("=== CHANGE LOGS QUERY DEBUG ===");
    console.log("Request Query Params:", req.query);
    console.log("SQL Query:", q);
    console.log("SQL Params:", params);
    console.log("================================");

    const { rows } = await pool.query(q, params);
    console.log(`Returned ${rows.length} log entries`);
    successResponse(res, rows.map(formatLog));
  } catch (err) {
    console.error("getChangeLogs Error:", err);
    errorResponse(res, err.message);
  }
};

/**
 * 1️⃣ Project-Scoped Activity (Projects Page)
 */
export const getProjectActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.user;
    const isAdmin = ["admin", "Project Manager"].includes(role);

    let q = `
      SELECT
        cl.*,
        u.full_name AS user_name,
        u.role AS user_role
      FROM change_logs cl
      LEFT JOIN users u ON u.id = cl.changed_by
      WHERE (
        (cl.entity_type = 'project' AND cl.entity_id = $1)
        OR (
          cl.entity_type IN ('task','module', 'sprint')
          AND (
            (cl.before_data->>'project_id')::uuid = $1::uuid
            OR (cl.after_data->>'project_id')::uuid = $1::uuid
          )
        )
      )
      AND cl.changed_at >= NOW() - INTERVAL '2 days'
    `;

    if (!isAdmin) {
      q += ` AND (u.role IS NULL OR u.role NOT IN ('admin', 'Project Manager')) `;
    }

    q += ` ORDER BY cl.changed_at DESC LIMIT 20`;

    const { rows } = await pool.query(q, [id]);
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
        u.full_name AS user_name,
        u.role AS user_role
      FROM change_logs cl
      LEFT JOIN users u ON u.id = cl.changed_by
      WHERE cl.changed_at >= NOW() - INTERVAL '2 days'
    `;
    const params = [];

    if (!isAdmin) {
      // Developer/QA visibility rules
      q += `
        AND u.role NOT IN ('admin', 'Project Manager')
        AND (
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
/**
 * 3️⃣ Sprint-Scoped Activity
 */
export const getSprintActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.user;
    const isAdmin = ["admin", "Project Manager"].includes(role);

    let q = `
      SELECT
        cl.*,
        u.full_name AS user_name,
        u.role AS user_role
      FROM change_logs cl
      LEFT JOIN users u ON u.id = cl.changed_by
      WHERE (
        (cl.entity_type = 'sprint' AND cl.entity_id = $1)
        OR (
          cl.entity_type = 'task'
          AND (
            (cl.before_data->>'sprint_id')::uuid = $1::uuid
            OR (cl.after_data->>'sprint_id')::uuid = $1::uuid
          )
        )
      )
      AND cl.changed_at >= NOW() - INTERVAL '2 days'
    `;

    if (!isAdmin) {
      q += ` AND (u.role IS NULL OR u.role NOT IN ('admin', 'Project Manager')) `;
    }

    q += ` ORDER BY cl.changed_at DESC LIMIT 20`;

    const { rows } = await pool.query(q, [id]);
    successResponse(res, rows.map(formatLog));
  } catch (err) {
    errorResponse(res, err.message);
  }
};
