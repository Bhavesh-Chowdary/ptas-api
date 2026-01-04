import pool from "../config/db.js";
import { autoLogTime } from "./timesheetController.js";
import { logChange } from "./changeLogController.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";

// Helper to extract ID from user object if needed
const getUserId = (user) => (typeof user === 'object' ? user.id : user);

/*
  TASK CODE GENERATOR
*/
const generateTaskCode = async (
  project_id,
  sprint_id,
  module_id,
  assignee_id
) => {
  const uid = getUserId(assignee_id);
  const [p, s, m, u, c] = await Promise.all([
    pool.query(
      "SELECT org_code, project_code, name, version FROM projects WHERE id=$1",
      [project_id]
    ),
    pool.query("SELECT sprint_number FROM sprints WHERE id=$1", [sprint_id]),
    pool.query(
      "SELECT module_serial FROM modules WHERE id=$1",
      [module_id]
    ),
    uid
      ? pool.query("SELECT resource_serial FROM users WHERE id=$1", [uid])
      : Promise.resolve({ rowCount: 0 }),
    pool.query("SELECT COUNT(*) FROM tasks WHERE project_id=$1", [project_id]),
  ]);

  if (!p.rowCount) throw new Error("Project not found");
  const proj = p.rows[0];
  const sprNum = s.rowCount ? s.rows[0].sprint_number : '0';
  const modSerial = m.rowCount ? m.rows[0].module_serial : '1';
  const resSerial = u.rowCount ? (u.rows[0].resource_serial || '0') : '0';
  const serial = Number(c.rows[0].count) + 1;

  // 1. org (RS)
  const org = (proj.org_code || 'RS').toUpperCase();

  // 2. project id (not name) -> use the code prefix
  const projId = (proj.project_code || 'PROJ').split('/')[0].toUpperCase();

  // 3. resource serial (from users table)
  const resourcePart = String(resSerial);

  // 4. version (V1, V2...)
  let version = String(proj.version || '1').toUpperCase();
  if (!version.startsWith('V')) version = 'V' + version;

  // 5. sprint (S1, S2...)
  const sprint = `S${sprNum}`;

  // 6. module id (2 letters from project id + serial)
  const projLetters = projId.substring(0, 2);
  const moduleId = `${projLetters}${modSerial}`;

  // 7. task serial
  const taskSerial = String(serial).padStart(3, "0");

  return [org, projId, resourcePart, version, sprint, moduleId, taskSerial].join("/");
};

const POTENTIAL_MAP = {
  'Very Small': { points: 1, hours: 2 },
  'Small': { points: 2, hours: 4 },
  'Medium': { points: 3, hours: 6 },
  'Large': { points: 5, hours: 10 },
  'Very Large': { points: 8, hours: 18 }
};

const checkDeveloperLoad = async (assignee_id, sprint_id, current_task_id = null) => {
  if (!assignee_id || !sprint_id) return { points: 0, hours: 0 };
  const q = `
    SELECT SUM(potential_points) as total_points, SUM(target_hours) as total_hours
    FROM tasks
    WHERE assignee_id = $1 AND sprint_id = $2 AND id != $3
  `;
  const { rows } = await pool.query(q, [assignee_id, sprint_id, current_task_id || -1]);
  return {
    points: parseInt(rows[0].total_points || 0),
    hours: parseFloat(rows[0].total_hours || 0)
  };
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
      priority = "Medium",
      start_date,
      end_date,
      collaborators,
      goal_index,
      potential,
    } = req.body;

    const { userId, role } = req.user;

    // Enforce Project Membership
    if (role.toLowerCase() === 'developer' && Number(assignee_id) !== Number(userId)) {
      return errorResponse(res, "Developers can only create tasks assigned to themselves.", 403);
    }

    // Enforce Project Membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2`,
      [project_id, userId]
    );

    if (!memberCheck.rowCount && !["admin", "Project Manager"].includes(role)) {
      return errorResponse(res, "Not part of this project", 403);
    }

    const task_code = await generateTaskCode(
      project_id,
      sprint_id,
      module_id,
      assignee_id
    );

    // Load Check
    if (assignee_id && sprint_id && potential && POTENTIAL_MAP[potential]) {
      const load = await checkDeveloperLoad(assignee_id, sprint_id);
      const newTaskLoad = POTENTIAL_MAP[potential];
      if (load.points + newTaskLoad.points > 20 || load.hours + newTaskLoad.hours > 40) {
        return errorResponse(res, `Assignee has exceeded the workload limit for this sprint (Max: 20 pts / 40 hrs). Current: ${load.points} pts / ${load.hours} hrs`, 400);
      }
    }

    const potData = potential ? POTENTIAL_MAP[potential] : { points: null, hours: null };

    const { rows } = await pool.query(
      `
      INSERT INTO tasks
      (task_code, task_key, task_serial, title, description, project_id,
       sprint_id, module_id, assignee_id, created_by, est_hours, status,
       priority, start_date, end_date, goal_index, potential, potential_points, target_hours)
      VALUES ($1, $1,
        (SELECT COUNT(*)+1 FROM tasks WHERE project_id=$2),
        $3,$4,$2,$5,$6,$7,$8,$9, $10, $11, $12, $13, $14, $15, $16, $17)
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
        priority,
        start_date || null,
        end_date || null,
        goal_index !== undefined ? goal_index : null,
        potential || null,
        potData.points,
        potData.hours
      ]
    );

    const taskId = rows[0].id;

    /* ---- COLLABORATORS ---- */
    if (Array.isArray(collaborators)) {
      for (const item of collaborators) {
        const uid = getUserId(item);
        if (!uid) continue;
        await pool.query(
          `INSERT INTO task_collaborators (task_id, user_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [taskId, uid]
        );
      }
    }

    /* ---- RETURN JOINED DATA ---- */
    const joinedRes = await pool.query(`
      SELECT
        t.*,
        p.name AS project_name,
        p.color AS project_color,
        m.name AS module_name,
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
      LEFT JOIN modules m ON m.id = t.module_id
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN users c ON c.id = t.created_by
      WHERE t.id = $1
    `, [taskId]);

    const finalTask = joinedRes.rows[0];

    /* ---- CHANGE LOG ---- */
    await logChange("task", taskId, "created", null, finalTask, userId);

    successResponse(res, finalTask, 201);
  } catch (err) {
    console.error("createTask:", err);
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
        p.color AS project_color,
        m.name AS module_name,
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
      LEFT JOIN modules m ON m.id = t.module_id
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN users c ON c.id = t.created_by
    `;

    const params = [];
    const filters = [];

    if (role === "developer" || role === "DEVELOPER") {
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
    if (!id) return errorResponse(res, "Task id is required", 400);

    const q = `
      SELECT t.*, p.name AS project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = $1
    `;

    const { rows } = await pool.query(q, [id]);
    if (!rows.length) return errorResponse(res, "Task not found", 404);

    successResponse(res, rows[0]);
  } catch (err) {
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

    if (!id) return errorResponse(res, "Task id is required", 400);

    const beforeRes = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
    if (!beforeRes.rowCount) return errorResponse(res, "Task not found", 404);
    const before = beforeRes.rows[0];

    const userRole = (role || "").toLowerCase();
    const canManageAll = userRole === "admin" || role === "Project Manager"; // PM is often mixed case in this DB

    if (userRole === "developer" && Number(before.assignee_id) !== Number(userId)) {
      return errorResponse(res, "Developers can only edit tasks assigned to themselves.", 403);
    }

    const {
      title,
      description,
      module_id,
      assignee_id,
      sprint_id,
      status,
      start_datetime,
      end_datetime,
      start_date,
      end_date,
      est_hours,
      actual_hours,
      collaborators,
      priority,
      goal_index,
      potential,
    } = req.body;

    // Developer Restriction: Cannot change assignee
    if (userRole === "developer" && assignee_id && Number(assignee_id) !== Number(userId)) {
      return errorResponse(res, "Developers cannot reassign tasks to others.", 403);
    }
    const targetAssignee = assignee_id || before.assignee_id;
    const targetSprint = sprint_id || before.sprint_id;
    const targetPotential = potential || before.potential;

    if (targetAssignee && targetSprint && targetPotential && POTENTIAL_MAP[targetPotential]) {
      const load = await checkDeveloperLoad(targetAssignee, targetSprint, id);
      const newTaskLoad = POTENTIAL_MAP[targetPotential];
      if (load.points + newTaskLoad.points > 20 || load.hours + newTaskLoad.hours > 40) {
        return errorResponse(res, `Assignee workload limit exceeded (Max: 20 pts / 40 hrs). Sprint load would become: ${load.points + newTaskLoad.points} pts / ${load.hours + newTaskLoad.hours} hrs`, 400);
      }
    }

    const potData = potential ? POTENTIAL_MAP[potential] : null;

    let in_progress_at = before.in_progress_at;
    let completed_at = before.completed_at;
    let duration = before.task_duration_minutes || 0;
    let current_period_start = before.current_period_start;

    // Transition Logic
    if (status && status !== before.status) {
      const normalizedStatus = status.toLowerCase().replace(/\s+/g, '_');
      const normalizedBefore = (before.status || '').toLowerCase().replace(/\s+/g, '_');

      if (normalizedStatus !== normalizedBefore) {
        // Moving TO in_progress
        if (normalizedStatus === 'in_progress') {
          current_period_start = new Date();
          if (!in_progress_at) in_progress_at = current_period_start;
        }
        // Moving FROM in_progress
        else if (normalizedBefore === 'in_progress') {
          if (current_period_start) {
            const diff = new Date() - new Date(current_period_start);
            duration = Number(duration) + Math.round(diff / (1000 * 60));
            current_period_start = null;
          }
        }

        if (normalizedStatus === 'done') {
          completed_at = new Date();
        }
      }
    }

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
        in_progress_at = $11,
        completed_at = $12,
        task_duration_minutes = $13,
        priority = COALESCE($14, priority),
        start_date = COALESCE($15, start_date),
        end_date = COALESCE($16, end_date),
        goal_index = COALESCE($17, goal_index),
        potential = COALESCE($18, potential),
        potential_points = COALESCE($19, potential_points),
        target_hours = COALESCE($20, target_hours),
        current_period_start = $21,
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `;

    await pool.query(updateQ, [
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
      in_progress_at,
      completed_at,
      duration,
      priority,
      start_date,
      end_date,
      goal_index !== undefined ? goal_index : null,
      potential || null,
      potData ? potData.points : null,
      potData ? potData.hours : null,
      current_period_start
    ]);

    if (Array.isArray(collaborators)) {
      await pool.query("DELETE FROM task_collaborators WHERE task_id = $1", [id]);
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

    /* ---- RETURN JOINED DATA ---- */
    const joinedRes = await pool.query(`
      SELECT
        t.*,
        p.name AS project_name,
        p.color AS project_color,
        m.name AS module_name,
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
      LEFT JOIN modules m ON m.id = t.module_id
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN users c ON c.id = t.created_by
      WHERE t.id = $1
    `, [id]);

    const updatedTask = joinedRes.rows[0];

    /* ---- CHANGE LOG ---- */
    await logChange("task", id, "updated", before, updatedTask, userId);

    if (status === "in_progress" && before.status !== "in_progress") {
      await autoLogTime(id, userId, 30, "Auto-log: Task started");
    }
    if (status === "done" && before.status !== "done") {
      await autoLogTime(id, userId, 60, "Auto-log: Task completed");
    }

    successResponse(res, updatedTask);
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

    if (!id) return errorResponse(res, "Task id is required", 400);

    if (!["admin", "Project Manager", "developer"].includes(role)) {
      return errorResponse(res, "Not allowed to delete tasks", 403);
    }

    const beforeRes = await pool.query("SELECT * FROM tasks WHERE id=$1", [id]);
    if (!beforeRes.rowCount) return errorResponse(res, "Task not found", 404);

    await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
    await logChange("task", id, "deleted", beforeRes.rows[0], null, userId);

    successResponse(res, { message: "Task deleted successfully" });
  } catch (err) {
    errorResponse(res, err.message);
  }
};
