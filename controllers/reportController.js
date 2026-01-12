import db from "../config/knex.js";

export const getProjectOverview = async (req, res) => {
  try {
    const rawQuery = `
      SELECT 
        p.id,
        p.name,
        p.status,
        COUNT(DISTINCT t.id) AS total_tasks,
        COUNT(DISTINCT s.id) AS total_sprints,
        ROUND(
          (SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)::decimal 
          / NULLIF(COUNT(t.id), 0) * 100), 2
        ) AS completion_percentage
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      LEFT JOIN sprints s ON p.id = s.project_id
      GROUP BY p.id
      ORDER BY p.created_at DESC;
    `;
    const { rows } = await db.raw(rawQuery);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("Get Project Overview Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getSprintSummary = async (req, res) => {
  try {
    const { sprint_id } = req.query;
    if (!sprint_id) {
      return res.status(400).json({ success: false, error: 'sprint_id is required' });
    }

    const rawQuery = `
      SELECT 
        s.id AS sprint_id,
        s.name AS sprint_name,
        s.status AS sprint_status,
        COUNT(t.id) AS total_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed_tasks,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tasks,
        SUM(CASE WHEN t.status = 'todo' THEN 1 ELSE 0 END) AS pending_tasks,
        ROUND(
          (SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)::decimal 
          / NULLIF(COUNT(t.id), 0) * 100), 2
        ) AS completion_percentage
      FROM sprints s
      LEFT JOIN tasks t ON s.id = t.sprint_id
      WHERE s.id = ?
      GROUP BY s.id;
    `;
    const { rows } = await db.raw(rawQuery, [sprint_id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Sprint not found' });
    }
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("Get Sprint Summary Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getResourceAllocation = async (req, res) => {
  try {
    const rawQuery = `
      SELECT 
        u.id AS user_id,
        u.full_name,
        COALESCE(SUM(t.minutes_logged), 0) AS total_minutes,
        ROUND(COALESCE(SUM(t.minutes_logged), 0) / 60, 2) AS total_hours,
        COUNT(DISTINCT ts.project_id) AS project_count
      FROM users u
      LEFT JOIN timesheets t ON u.id = t.user_id
      LEFT JOIN tasks ts ON t.task_id = ts.id
      GROUP BY u.id
      ORDER BY total_hours DESC;
    `;
    const { rows } = await db.raw(rawQuery);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("Get Resource Allocation Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getTimesheetCompliance = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, error: 'start_date and end_date are required' });
    }

    const rawQuery = `
      WITH user_hours AS (
        SELECT 
          u.id AS user_id,
          u.full_name,
          COALESCE(SUM(t.minutes_logged), 0) / 60 AS logged_hours
        FROM users u
        LEFT JOIN timesheets t ON u.id = t.user_id
        WHERE t.log_date BETWEEN ? AND ?
        GROUP BY u.id
      ),
      workdays AS (
        SELECT COUNT(*) AS days
        FROM generate_series(?::date, ?::date, '1 day') g
        WHERE EXTRACT(ISODOW FROM g) < 6
      )
      SELECT 
        uh.user_id,
        uh.full_name,
        uh.logged_hours,
        ROUND((uh.logged_hours / (workdays.days * 8)) * 100, 2) AS compliance_percentage
      FROM user_hours uh, workdays
      ORDER BY compliance_percentage DESC;
    `;
    const { rows } = await db.raw(rawQuery, [start_date, end_date, start_date, end_date]);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("Get Timesheet Compliance Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
