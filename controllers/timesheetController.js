import pool from '../config/db.js';

// Create manual log
export const createTimesheet = async (req, res) => {
  try {
    const { task_id, minutes_logged, notes, log_date } = req.body;
    const user_id = req.user.userId;

    if (!minutes_logged || minutes_logged <= 0)
      return res.status(400).json({ error: 'minutes_logged must be greater than 0' });

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

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Auto-log time when a task changes status
export const autoLogTime = async (task_id, user_id, minutes, note) => {
  try {
    await pool.query(
      `INSERT INTO timesheets (user_id, task_id, log_date, minutes_logged, source, notes)
       VALUES ($1, $2, CURRENT_DATE, $3, 'auto', $4)`,
      [user_id, task_id, minutes, note]
    );
  } catch (err) {
    console.error('Auto-log error:', err.message);
  }
};

// Get user timesheets (filter by week/user)
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
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Approve a timesheet entry
export const approveTimesheet = async (req, res) => {
  try {
    const { id } = req.params;
    const approved_by = req.user.userId;

    const q = `
      UPDATE timesheets
      SET approved = TRUE, approved_by = $1
      WHERE id = $2
      RETURNING *`;
    const result = await pool.query(q, [approved_by, id]);

    if (result.rowCount === 0) return res.status(404).json({ error: 'Timesheet not found' });
    res.json({ message: 'Timesheet approved', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Weekly summary report
export const getWeeklySummary = async (req, res) => {
  try {
    const { week_start, week_end } = req.query;

    if (!week_start || !week_end)
      return res.status(400).json({ error: 'week_start and week_end are required' });

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

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
