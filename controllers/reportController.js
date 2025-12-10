import pool from '../config/db.js';

export const getProjectOverview = async (req, res) => {
  try {
    const q = `
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
    const result = await pool.query(q);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getSprintSummary = async (req, res) => {
  try {
    const { sprint_id } = req.query;
    if (!sprint_id) return res.status(400).json({ error: 'sprint_id is required' });

    const q = `
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
      WHERE s.id = $1
      GROUP BY s.id;
    `;
    const result = await pool.query(q, [sprint_id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Sprint not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getResourceAllocation = async (req, res) => {
  try {
    const q = `
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
    const result = await pool.query(q);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getTimesheetCompliance = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    if (!start_date || !end_date)
      return res.status(400).json({ error: 'start_date and end_date are required' });

    const q = `
      WITH user_hours AS (
        SELECT 
          u.id AS user_id,
          u.full_name,
          COALESCE(SUM(t.minutes_logged), 0) / 60 AS logged_hours
        FROM users u
        LEFT JOIN timesheets t ON u.id = t.user_id
        WHERE t.log_date BETWEEN $1 AND $2
        GROUP BY u.id
      ),
      workdays AS (
        SELECT COUNT(*) AS days
        FROM generate_series($1::date, $2::date, '1 day') g
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
    const result = await pool.query(q, [start_date, end_date]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
