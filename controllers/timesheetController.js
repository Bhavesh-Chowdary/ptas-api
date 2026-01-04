import pool from '../config/db.js';
import { successResponse, errorResponse } from "../utils/apiResponse.js";
import { logChange } from './changeLogController.js';

export const createTimesheet = async (req, res) => {
  try {
    const { task_id, minutes_logged, notes, log_date } = req.body;
    const user_id = req.user.userId;

    if (!minutes_logged || minutes_logged <= 0)
      return errorResponse(res, 'minutes_logged must be greater than 0', 400);

    const q = `
      INSERT INTO timesheets (user_id, task_id, log_date, minutes_logged, source, notes)
      VALUES ($1, $2, $3, $4, 'manual', $5)
      RETURNING *`;
    const result = await pool.query(q, [
      user_id,
      task_id || null,
      log_date || new Date(),
      minutes_logged,
      notes || null
    ]);

    /* ---- CLEAR CACHE ---- */

    successResponse(res, result.rows[0], 201);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const autoLogTime = async (task_id, user_id, minutes, note) => {
  try {
    await pool.query(
      `INSERT INTO timesheets (user_id, task_id, log_date, minutes_logged, source, notes)
       VALUES ($1, $2, CURRENT_DATE, $3, 'auto', $4)`,
      [user_id, task_id, minutes, note]
    );
    /* ---- CLEAR CACHE ---- */
  } catch (err) {
    console.error('Auto-log error:', err.message);
  }
};

export const getTimesheets = async (req, res) => {
  try {
    const { user_id, week_start, week_end } = req.query;

    let q = `
      SELECT t.*, u.full_name AS user_name, ts.title AS task_title, p.name AS project_name
      FROM timesheets t
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN tasks ts ON ts.id = t.task_id
      LEFT JOIN projects p ON p.id = ts.project_id
      WHERE 1=1`;
    const params = [];

    if (user_id) {
      params.push(user_id);
      q += ` AND t.user_id = $${params.length}`;
    }
    if (week_start && week_end) {
      params.push(week_start, week_end);
      q += ` AND t.log_date BETWEEN $${params.length - 1} AND $${params.length}`;
    }

    q += ` ORDER BY t.log_date DESC`;
    const result = await pool.query(q, params);
    successResponse(res, result.rows);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

// Approve timesheet (with change log)
export const approveTimesheet = async (req, res) => {
  try {
    const { id } = req.params;
    const approved_by = req.user.userId;

    const before = await pool.query('SELECT * FROM timesheets WHERE id = $1', [id]);
    if (before.rowCount === 0) return errorResponse(res, 'Timesheet not found', 404);

    const q = `
      UPDATE timesheets
      SET approved_by = $1
      WHERE id = $2
      RETURNING *`;
    const result = await pool.query(q, [approved_by, id]);
    const after = result.rows[0];

    await logChange('timesheet', id, 'approve', before.rows[0], after, approved_by);

    /* ---- CLEAR CACHE ---- */

    successResponse(res, after);
  } catch (err) {
    errorResponse(res, err.message);
  }
};


// Weekly summary report
export const getWeeklySummary = async (req, res) => {
  try {
    const { week_start, week_end } = req.query;

    if (!week_start || !week_end)
      return errorResponse(res, 'week_start and week_end are required', 400);

    const q = `
      SELECT u.full_name,
             SUM(t.minutes_logged) AS total_minutes,
             COUNT(DISTINCT t.task_id) AS tasks_worked
      FROM timesheets t
      JOIN users u ON u.id = t.user_id
      WHERE t.log_date BETWEEN $1 AND $2
      GROUP BY u.full_name
      ORDER BY total_minutes DESC`;
    const result = await pool.query(q, [week_start, week_end]);

    successResponse(res, result.rows);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/**
 * GENERATE TIMESHEET PREVIEW
 */
export const getGeneratedTimesheetPreview = async (req, res) => {
  try {
    const { project_id, user_id, start_date, end_date } = req.query;

    if (!user_id || !start_date || !end_date) {
      return errorResponse(res, 'user_id, start_date, and end_date are required', 400);
    }

    // 1. Fetch User & Project Info
    const userRes = await pool.query('SELECT id, full_name, role, "Emp_id" FROM users WHERE id = $1', [user_id]);
    const projRes = project_id ? await pool.query('SELECT id, name, project_code FROM projects WHERE id = $1', [project_id]) : { rows: [] };

    if (userRes.rowCount === 0) return errorResponse(res, 'User not found', 404);
    const user = userRes.rows[0];
    const project = projRes.rows[0] || { name: 'N/A' };

    // 2. Fetch Daily Logs
    let logQuery = `
      SELECT t.*, ts.task_code, ts.title AS task_title
      FROM timesheets t
      LEFT JOIN tasks ts ON ts.id = t.task_id
      WHERE t.user_id = $1 
        AND t.log_date BETWEEN $2 AND $3
    `;
    const logParams = [user_id, start_date, end_date];
    if (project_id) {
      logQuery += ` AND ts.project_id = $4`;
      logParams.push(project_id);
    }
    logQuery += ` ORDER BY t.log_date ASC`;

    const logsRes = await pool.query(logQuery, logParams);
    const logs = logsRes.rows;

    // 2.5 Fetch all tasks assigned to this user in this project to pre-fill
    let taskQuery = `
      SELECT task_code, start_date, end_date 
      FROM tasks 
      WHERE assignee_id = $1 
        AND project_id = $2
    `;
    const assignedTasksRes = await pool.query(taskQuery, [user_id, project_id]);
    const assignedTasks = assignedTasksRes.rows;

    // 3. Generate daily slots from start to end date
    const dailyData = [];

    // Force UTC parsing to avoid timezone shifts
    const start = new Date(start_date + 'T00:00:00.000Z');
    const end = new Date(end_date + 'T00:00:00.000Z');

    let curr = new Date(start);

    while (curr <= end) {
      const dateStr = curr.toISOString().split('T')[0];
      const dayStrDisplay = curr.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });

      const dayLogs = logs.filter(l => {
        const d = new Date(l.log_date);
        return d.toISOString().split('T')[0] === dateStr;
      });

      if (dayLogs.length > 0) {
        // Use existing logs
        dayLogs.forEach(l => {
          const totalMins = l.minutes_logged;
          const regularHours = Math.min(8, totalMins / 60);
          const overtimeHours = Math.max(0, (totalMins / 60) - 8);

          dailyData.push({
            date: dateStr,
            day: dayStrDisplay,
            task_id: l.task_code || 'N/A',
            start_time: '10:00',
            end_time: '18:00',
            regular_hrs: regularHours.toFixed(2),
            overtime_hrs: overtimeHours.toFixed(2),
            sick_hrs: '0.00',
            vacation_hrs: '0.00',
            holiday_hrs: '0.00',
            other_hrs: '0.00',
            total_hrs: (totalMins / 60).toFixed(2)
          });
        });
      } else {
        // PRE-FILL LOGIC: If no logs, check for assigned tasks
        const tasksForDay = assignedTasks.filter(t => {
          if (!t.start_date) return false;
          // Tasks in DB are usually UTC or local but t.start_date as string is often just YYYY-MM-DD
          const sDate = new Date(t.start_date).toISOString().split('T')[0];
          const eDate = t.end_date ? new Date(t.end_date).toISOString().split('T')[0] : sDate;
          return dateStr >= sDate && dateStr <= eDate;
        });

        if (tasksForDay.length > 0) {
          tasksForDay.forEach(t => {
            dailyData.push({
              date: dateStr,
              day: dayStrDisplay,
              task_id: t.task_code || 'N/A',
              start_time: '10:00',
              end_time: '18:00',
              regular_hrs: '8.00',
              overtime_hrs: '0.00',
              sick_hrs: '0.00',
              vacation_hrs: '0.00',
              holiday_hrs: '0.00',
              other_hrs: '0.00',
              total_hrs: '8.00'
            });
          });
        } else {
          // Empty day placeholder
          dailyData.push({
            date: dateStr,
            day: dayStrDisplay,
            task_id: 'N/A',
            start_time: '',
            end_time: '',
            regular_hrs: '0.00',
            overtime_hrs: '0.00',
            sick_hrs: '0.00',
            vacation_hrs: '0.00',
            holiday_hrs: '0.00',
            other_hrs: '0.00',
            total_hrs: '0.00'
          });
        }
      }

      // Move to next day in UTC
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    const totalHours = dailyData.reduce((acc, d) => acc + parseFloat(d.total_hrs), 0).toFixed(2);

    successResponse(res, {
      employee: {
        id: user.id,
        name: user.full_name,
        emp_id: user.Emp_id
      },
      project: {
        id: project.id,
        name: project.name
      },
      start_date: start_date,
      end_date: end_date,
      daily_data: dailyData,
      assigned_tasks: assignedTasks,
      total_hours: totalHours
    });
  } catch (err) {
    console.error("getGeneratedTimesheetPreview error:", err);
    errorResponse(res, err.message);
  }
};

/**
 * SAVE TIMESHEET
 */
export const saveTimesheet = async (req, res) => {
  try {
    const {
      project_id,
      user_id,
      supervisor_id,
      start_date,
      end_date,
      daily_data,
      total_hours,
      status
    } = req.body;

    const q = `
      INSERT INTO weekly_timesheets 
      (project_id, user_id, supervisor_id, week_start, week_end, daily_data, total_hours, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const result = await pool.query(q, [
      project_id || null,
      user_id,
      supervisor_id || null,
      start_date,
      end_date,
      JSON.stringify(daily_data),
      total_hours,
      status || 'draft'
    ]);

    successResponse(res, result.rows[0], 201);
  } catch (err) {
    console.error("saveTimesheet error:", err);
    errorResponse(res, err.message);
  }
};

/**
 * GET TIMESHEET HISTORY
 */
export const getTimesheetHistory = async (req, res) => {
  try {
    const { role, userId } = req.user;
    let q = `
      SELECT wt.*, u.full_name AS employee_name, s.full_name AS supervisor_name, p.name AS project_name
      FROM weekly_timesheets wt
      LEFT JOIN users u ON u.id = wt.user_id
      LEFT JOIN users s ON s.id = wt.supervisor_id
      LEFT JOIN projects p ON p.id = wt.project_id
    `;
    const params = [];

    if (role === 'developer' || role === 'qa') {
      q += ` WHERE wt.user_id = $1`;
      params.push(userId);
    }

    q += ` ORDER BY wt.created_at DESC`;
    const result = await pool.query(q, params);
    successResponse(res, result.rows);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/**
 * GET TIMESHEET BY ID
 */
export const getTimesheetById = async (req, res) => {
  try {
    const { id } = req.params;
    const q = `
      SELECT wt.*, u.full_name AS employee_name, u."Emp_id" AS emp_id, s.full_name AS supervisor_name, p.name AS project_name
      FROM weekly_timesheets wt
      LEFT JOIN users u ON u.id = wt.user_id
      LEFT JOIN users s ON s.id = wt.supervisor_id
      LEFT JOIN projects p ON p.id = wt.project_id
      WHERE wt.id = $1
    `;
    const result = await pool.query(q, [id]);
    if (result.rowCount === 0) return errorResponse(res, 'Timesheet not found', 404);
    successResponse(res, result.rows[0]);
  } catch (err) {
    errorResponse(res, err.message);
  }
};
