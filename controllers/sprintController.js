import pool from "../config/db.js";
import { logChange } from "./changeLogController.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";

export const createSprint = async (req, res) => {
  try {
    const { project_id, start_date, end_date, goal, status } = req.body;
    const { role, userId } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return errorResponse(res, "Not allowed to create sprint", 403);
    }

    if (!project_id || !start_date || !end_date) {
      return errorResponse(res, "project_id, start_date and end_date are required", 400);
    }

    const maxResult = await pool.query(
      "SELECT MAX(sprint_number) as max_num FROM sprints WHERE project_id = $1",
      [project_id]
    );

    const sprint_number = (maxResult.rows[0].max_num || 0) + 1;

    const { rows } = await pool.query(
      `
      INSERT INTO sprints
      (project_id, name, start_date, end_date, status, goal, sprint_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        project_id,
        `Sprint ${sprint_number}`,
        start_date,
        end_date,
        status || 'active',
        goal || null,
        sprint_number,
      ]
    );

    const sprint = rows[0];

    /* ---- CHANGE LOG ---- */
    await logChange("sprint", sprint.id, "created", null, sprint, userId);

    successResponse(res, sprint, 201);
  } catch (err) {
    console.error("createSprint:", err);
    errorResponse(res, err.message);
  }
};

export const getNextSprintNumber = async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) {
      return errorResponse(res, "project_id is required", 400);
    }

    const maxResult = await pool.query(
      "SELECT MAX(sprint_number) as max_num FROM sprints WHERE project_id = $1",
      [project_id]
    );

    const nextNum = (maxResult.rows[0].max_num || 0) + 1;

    successResponse(res, { next_number: nextNum });
  } catch (err) {
    console.error("getNextSprintNumber:", err);
    errorResponse(res, err.message);
  }
};

export const getSprints = async (req, res) => {
  try {
    const { project_id } = req.query;

    let q = `
      SELECT
        s.*,
        p.name AS project_name,
        p.color AS project_color,
        COUNT(DISTINCT t.id) as total_tasks,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done') as completed_tasks,
        (
          SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name))
          FROM (
            SELECT DISTINCT u.id, u.full_name
            FROM tasks t2
            JOIN users u ON u.id = t2.assignee_id
            WHERE t2.sprint_id = s.id
          ) u
        ) as members
      FROM sprints s
      LEFT JOIN projects p ON p.id = s.project_id
      LEFT JOIN tasks t ON t.sprint_id = s.id
    `;
    const params = [];

    if (project_id) {
      params.push(project_id);
      q += ` WHERE s.project_id = $1`;
    }

    q += ` GROUP BY s.id, p.name, p.color ORDER BY s.sprint_number DESC`;

    const { rows } = await pool.query(q, params);
    successResponse(res, rows);
  } catch (err) {
    console.error("getSprints error:", err);
    errorResponse(res, err.message);
  }
};

export const getSprintById = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;

    if (!id) {
      return errorResponse(res, "Sprint id is required", 400);
    }

    const { rows } = await pool.query(
      `
      SELECT
        s.*,
        p.name AS project_name,
        p.color AS project_color,
        COUNT(t.id) as total_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks
      FROM sprints s
      LEFT JOIN projects p ON p.id = s.project_id
      LEFT JOIN tasks t ON t.sprint_id = s.id
      WHERE s.id = $1
      GROUP BY s.id, p.name, p.color
      `,
      [id]
    );

    if (!rows.length) {
      return errorResponse(res, "Sprint not found", 404);
    }

    successResponse(res, rows[0]);
  } catch (err) {
    console.error("getSprintById:", err);
    errorResponse(res, err.message);
  }
};

export const updateSprint = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role, userId } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return errorResponse(res, "Not allowed to update sprint", 403);
    }

    if (!id) {
      return errorResponse(res, "Sprint id is required", 400);
    }

    const beforeRes = await pool.query(
      "SELECT * FROM sprints WHERE id = $1",
      [id]
    );

    if (!beforeRes.rowCount) {
      return errorResponse(res, "Sprint not found", 404);
    }

    const before = beforeRes.rows[0];

    const { name, start_date, end_date, status, goal } = req.body;

    const { rows } = await pool.query(
      `
      UPDATE sprints
      SET
        name = COALESCE($1, name),
        start_date = COALESCE($2, start_date),
        end_date = COALESCE($3, end_date),
        status = COALESCE($4, status),
        goal = COALESCE($5, goal),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
      `,
      [name, start_date, end_date, status, goal, id]
    );

    const after = rows[0];

    await logChange("sprint", id, "updated", before, after, userId);

    /* ---- CHANGE LOG ---- */

    successResponse(res, after);
  } catch (err) {
    console.error("updateSprint:", err);
    errorResponse(res, err.message);
  }
};

export const deleteSprint = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return errorResponse(res, "Not allowed to delete sprint", 403);
    }

    if (!id) {
      return errorResponse(res, "Sprint id is required", 400);
    }

    const beforeRes = await pool.query("SELECT * FROM sprints WHERE id = $1", [id]);
    if (!beforeRes.rowCount) {
      return errorResponse(res, "Sprint not found", 404);
    }

    await pool.query("DELETE FROM sprints WHERE id = $1", [id]);

    /* ---- CHANGE LOG ---- */
    await logChange("sprint", id, "deleted", beforeRes.rows[0], null, req.user.userId);

    successResponse(res, { message: "Sprint deleted successfully" });
  } catch (err) {
    console.error("deleteSprint:", err);
    errorResponse(res, err.message);
  }
};

export const getSprintHierarchy = async (req, res) => {
  try {
    const { id } = req.params;

    const sprintRes = await pool.query(
      `SELECT s.*, p.name as project_name, p.color as project_color 
       FROM sprints s 
       JOIN projects p ON p.id = s.project_id 
       WHERE s.id = $1`,
      [id]
    );
    if (!sprintRes.rowCount) return errorResponse(res, "Sprint not found", 404);
    const sprint = sprintRes.rows[0];

    // Get modules linked via sprint_modules OR tasks
    const modulesRes = await pool.query(
      `SELECT DISTINCT m.* 
       FROM modules m
       WHERE m.id IN (
         SELECT module_id FROM sprint_modules WHERE sprint_id = $1
         UNION
         SELECT module_id FROM tasks WHERE sprint_id = $1 AND module_id IS NOT NULL
       )
       ORDER BY m.module_serial`,
      [id]
    );
    const modules = modulesRes.rows;

    const tasksRes = await pool.query(
      `SELECT t.*, u.full_name as assignee_name 
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.sprint_id = $1`,
      [id]
    );
    const tasks = tasksRes.rows;

    const hierarchy = modules.map(m => ({
      ...m,
      tasks: tasks.filter(t => t.module_id === m.id)
    }));

    const orphanTasks = tasks.filter(t => !t.module_id);
    if (orphanTasks.length > 0) {
      hierarchy.push({
        id: 'orphans',
        name: 'General Tasks',
        tasks: orphanTasks
      });
    }

    successResponse(res, {
      sprint,
      modules: hierarchy,
      tasks: tasks // flat list for FlowGraph
    });
  } catch (err) {
    console.error("getSprintHierarchy:", err);
    errorResponse(res, err.message);
  }
};

export const getSprintBurndown = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get Sprint Dates
    const sprintRes = await pool.query(
      "SELECT start_date, end_date FROM sprints WHERE id = $1",
      [id]
    );
    if (!sprintRes.rowCount) return errorResponse(res, "Sprint not found", 404);
    const { start_date, end_date } = sprintRes.rows[0];

    // 2. Get all tasks and their estimates + completion dates
    const tasksRes = await pool.query(
      `SELECT 
        COALESCE(est_hours, target_hours, 0) as estimate,
        completed_at,
        status
       FROM tasks 
       WHERE sprint_id = $1`,
      [id]
    );
    const tasks = tasksRes.rows;

    // 3. Get daily logged hours
    const logsRes = await pool.query(
      `SELECT 
        log_date::date as date,
        SUM(minutes_logged) / 60.0 as hours_logged
       FROM timesheets
       WHERE task_id IN (SELECT id FROM tasks WHERE sprint_id = $1)
       GROUP BY log_date::date
       ORDER BY log_date::date ASC`,
      [id]
    );
    const dailyLogs = logsRes.rows;

    // Generate Chart Data
    const start = new Date(start_date);
    const end = new Date(end_date);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const chartData = [];
    let current = new Date(start);
    const totalEst = tasks.reduce((sum, t) => sum + Number(t.estimate), 0);

    // Calculate days diff
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    const step = totalEst / (totalDays || 1);

    let dayIndex = 0;
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];

      // Method 1: Remaining Estimate
      const completedUntilNow = tasks.filter(t => {
        if (t.status !== 'done' || !t.completed_at) return false;
        const compDate = new Date(t.completed_at);
        return compDate <= current;
      });
      const completedEst = completedUntilNow.reduce((sum, t) => sum + Number(t.estimate), 0);
      const remainingEst = Math.max(0, totalEst - completedEst);

      // Method 2: Actual Time Remaining (Total Est - Cumulative Logged)
      const logsUntilNow = dailyLogs.filter(l => new Date(l.date) <= current);
      const totalLogged = logsUntilNow.reduce((sum, l) => sum + Number(l.hours_logged), 0);
      const remainingActual = Math.max(0, totalEst - totalLogged);

      // Ideal
      const ideal = Math.max(0, totalEst - (step * dayIndex));

      const isFuture = current > today;

      chartData.push({
        date: dateStr,
        displayDate: current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        ideal: Number(ideal.toFixed(1)),
        remainingEst: isFuture ? null : Number(remainingEst.toFixed(1)),
        remainingActual: isFuture ? null : Number(remainingActual.toFixed(1))
      });

      current.setDate(current.getDate() + 1);
      dayIndex++;
    }

    successResponse(res, chartData);
  } catch (err) {
    console.error("getSprintBurndown:", err);
    errorResponse(res, err.message);
  }
};
