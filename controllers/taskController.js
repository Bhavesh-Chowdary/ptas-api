import pool from "../config/db.js";
import { autoLogTime } from "./timesheetController.js";
import { logChange } from "./changeLogController.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";

// Helper to extract ID from user object if needed
const getUserId = (user) => (typeof user === 'object' ? user.id : user);

// Statuses should be handled as snake_case directly from DB/UI
// Keeping this for reference if needed, but removing active usage
const ALLOWED_STATUSES = ["todo", "in_progress", "review", "done", "blocked"];

/*
  TASK CODE GENERATOR
*/
const generateTaskCode = async (
  project_id,
  sprint_id,
  module_id,
  assignee_id
) => {
  const [p, s, m, u, c] = await Promise.all([
    pool.query(
      "SELECT org_code, project_code, version FROM projects WHERE id=$1",
      [project_id]
    ),
    pool.query("SELECT sprint_number FROM sprints WHERE id=$1", [sprint_id]),
    pool.query(
      "SELECT module_code, module_serial FROM modules WHERE id=$1",
      [module_id]
    ),
    pool.query("SELECT resource_serial FROM users WHERE id=$1", [assignee_id]),
    pool.query("SELECT COUNT(*) FROM tasks WHERE project_id=$1", [project_id]),
  ]);

  const serial = Number(c.rows[0].count) + 1;

  return (
    `${p.rows[0].org_code}-` +
    `${p.rows[0].project_code}${String(p.rows[0].version).padStart(3, "0")}-` +
    `S${s.rows[0].sprint_number}-` +
    `${m.rows[0].module_code}${m.rows[0].module_serial}-` +
    `${String(serial).padStart(3, "0")}`
  );
};

/*
  CREATE TASK
*/
export const createTask = async (req, res) => {
  try {
    const {
      project_id,
      sprint_id,
      module_id,
      assignee_id,
      title,
      description,
      est_hours,
      status,
    } = req.body;

    const { userId, role } = req.user;

    // Enforce Project Membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2`,
      [project_id, userId]
    );

    if (!memberCheck.rowCount && !["admin", "Project Manager"].includes(role)) {
      return res.status(403).json({ error: "Not part of this project" });
    }

    if (!["admin", "Project Manager", "developer", "qa"].includes(role) && !memberCheck.rowCount)
      return res.status(403).json({ error: "Not allowed" });

    const task_code = await generateTaskCode(
      project_id,
      sprint_id,
      module_id,
      assignee_id
    );

    const { rows } = await pool.query(
      `
      INSERT INTO tasks
      (task_code, task_key, task_serial, title, description, project_id,
       sprint_id, module_id, assignee_id, created_by, est_hours, status)
      VALUES ($1, $1,
        (SELECT COUNT(*)+1 FROM tasks WHERE project_id=$2),
        $3,$4,$2,$5,$6,$7,$8,$9, $10)
      RETURNING *
      `,
      [
        task_code,
        project_id,
        title,
        description || null,
        sprint_id,
        module_id,
        getUserId(assignee_id),
        userId,
        est_hours || null,
        status || 'todo',
      ]
    );

    /* ---- CHANGE LOG ---- */
    await logChange(
      "task",
      rows[0].id,
      "created",
      null,
      rows[0],
      userId
    );

    /* ---- COLLABORATORS ---- */
    const { collaborators } = req.body;
    if (Array.isArray(collaborators)) {
      for (const item of collaborators) {
        const uid = getUserId(item);
        if (!uid) continue;
        await pool.query(
          `INSERT INTO task_collaborators (task_id, user_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [rows[0].id, uid]
        );
      }
    }

    successResponse(res, rows[0], 201);
  } catch (err) {
    console.error(err);
    errorResponse(res, err.message);
  }
};

/*
  GET TASKS
*/
export const getTasks = async (req, res) => {
  try {
    const { role, userId } = req.user;

    let query = `
      SELECT
        t.*,
        p.name AS project_name,
        u.full_name AS assignee_name,
        c.full_name AS created_by_name,
        (
          SELECT COALESCE(json_agg(json_build_object('id', uc.id, 'name', uc.full_name)), '[]'::json)
          FROM task_collaborators tc
          JOIN users uc ON uc.id = tc.user_id
          WHERE tc.task_id = t.id
        ) AS collaborators
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN users c ON c.id = t.created_by
    `;

    const params = [];
    const filters = [];

    if (role === "DEVELOPER" || role === "developer") {
      filters.push(`(t.assignee_id = $${params.length + 1}
           OR EXISTS (
             SELECT 1
             FROM task_collaborators tc
             WHERE tc.task_id = t.id
               AND tc.user_id = $${params.length + 1}
           ))`);
      params.push(userId);
    }

    if (role === "Project Manager" || role === "pm") {
      filters.push(`p.manager_id = $${params.length + 1}`);
      params.push(userId);
    }

    const { project_id, sprint_id } = req.query;
    if (project_id) {
      filters.push(`t.project_id = $${params.length + 1}`);
      params.push(project_id);
    }
    if (sprint_id) {
      filters.push(`t.sprint_id = $${params.length + 1}`);
      params.push(sprint_id);
    }

    if (filters.length > 0) {
      query += " WHERE " + filters.join(" AND ");
    }

    query += " ORDER BY t.created_at DESC";

    const { rows } = await pool.query(query, params);

    const mapped = rows; // Return rows directly, status is already snake_case

    successResponse(res, rows);
  } catch (err) {
    console.error("getTasks:", err);
    errorResponse(res, err.message);
  }
};

/*
  GET TASK BY ID
*/
export const getTaskById = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;

    if (!id) {
      return errorResponse(res, "Task id is required", 400);
    }

    const q = `
      SELECT t.*, p.name AS project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = $1
    `;

    const { rows } = await pool.query(q, [id]);
    if (!rows.length) {
      return errorResponse(res, "Task not found", 404);
    }

    successResponse(res, rows[0]);
  } catch (err) {
    console.error("getTaskById:", err);
    errorResponse(res, err.message);
  }
};

/*
  UPDATE TASK
*/
export const updateTask = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role, userId } = req.user;

    if (!id) {
      return errorResponse(res, "Task id is required", 400);
    }

    const beforeRes = await pool.query(
      "SELECT * FROM tasks WHERE id = $1",
      [id]
    );
    if (!beforeRes.rowCount) {
      return errorResponse(res, "Task not found", 404);
    }

    const before = beforeRes.rows[0];

    if (role === "developer" && before.assignee_id !== userId) {
      return errorResponse(res, "Not allowed to edit this task", 403);
    }

    const {
      title,
      description,
      module_id,
      assignee_id,
      status,
      start_datetime,
      end_datetime,
      est_hours,
      actual_hours,
      collaborators,
    } = req.body;

    const updateQ = `
      UPDATE tasks
      SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        module_id = COALESCE($3, module_id),
        assignee_id = COALESCE($4, assignee_id),
        status = COALESCE($5, status),
        start_datetime = COALESCE($6, start_datetime),
        end_datetime = COALESCE($7, end_datetime),
        est_hours = COALESCE($8, est_hours),
        actual_hours = COALESCE($9, actual_hours),
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `;

    const { rows } = await pool.query(updateQ, [
      title,
      description,
      module_id,
      getUserId(assignee_id),
      status || null,
      start_datetime,
      end_datetime,
      est_hours,
      actual_hours,
      id,
    ]);

    const after = rows[0];

    if (Array.isArray(collaborators)) {
      await pool.query("DELETE FROM task_collaborators WHERE task_id = $1", [
        id,
      ]);
      for (const item of collaborators) {
        const uid = getUserId(item);
        if (!uid) continue;
        await pool.query(
          `INSERT INTO task_collaborators (task_id, user_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [id, uid]
        );
      }
    }

    /* ---- CHANGE LOG ---- */
    await logChange("task", id, "updated", before, after, userId);

    if (status === "in_progress") {
      await autoLogTime(id, userId, 30, "Auto-log: Task started");
    }
    if (status === "done") {
      await autoLogTime(id, userId, 60, "Auto-log: Task completed");
    }

    successResponse(res, after);
  } catch (err) {
    console.error("updateTask:", err);
    errorResponse(res, err.message);
  }
};

/*
  DELETE TASK
*/
export const deleteTask = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role, userId } = req.user;

    if (!id) {
      return errorResponse(res, "Task id is required", 400);
    }

    if (!["admin", "Project Manager", "developer"].includes(role)) {
      return errorResponse(res, "Not allowed to delete tasks", 403);
    }

    /* ---- BEFORE ---- */
    const beforeRes = await pool.query(
      "SELECT * FROM tasks WHERE id=$1",
      [id]
    );
    if (!beforeRes.rowCount) {
      return errorResponse(res, "Task not found", 404);
    }

    await pool.query("DELETE FROM tasks WHERE id = $1", [id]);

    /* ---- CHANGE LOG ---- */
    await logChange(
      "task",
      id,
      "deleted",
      beforeRes.rows[0],
      null,
      userId
    );

    successResponse(res, { message: "Task deleted successfully" });
  } catch (err) {
    console.error("deleteTask:", err);
    errorResponse(res, err.message);
  }
};
