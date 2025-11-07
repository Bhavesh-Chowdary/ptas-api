import pool from '../config/db.js';
import { autoLogTime } from './timesheetController.js';

// Generate simple task key (e.g. PROJ-001)
const generateTaskKey = async (projectId) => {
  const countRes = await pool.query('SELECT COUNT(*) FROM tasks WHERE project_id = $1', [projectId]);
  const count = parseInt(countRes.rows[0].count) + 1;
  return `TASK-${count.toString().padStart(3, '0')}`;
};

export const createTask = async (req, res) => {
  try {
    const { project_id, title, description, assignee_id, est_hours, start_date, end_date } = req.body;
    const reporter_id = req.user.userId;

    if (!project_id || !title)
      return res.status(400).json({ error: 'project_id and title are required' });

    const task_key = await generateTaskKey(project_id);

    const q = `
      INSERT INTO tasks (project_id, task_key, title, description, assignee_id, reporter_id, est_hours, start_date, end_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`;
    const result = await pool.query(q, [
      project_id, task_key, title, description, assignee_id, reporter_id,
      est_hours || null, start_date || null, end_date || null
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getTasks = async (req, res) => {
  try {
    const { project_id, assignee_id, status } = req.query;
    let q = `
      SELECT t.*, 
             p.name AS project_name,
             a.full_name AS assignee_name,
             r.full_name AS reporter_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users a ON a.id = t.assignee_id
      LEFT JOIN users r ON r.id = t.reporter_id
      WHERE 1=1
    `;
    const params = [];
    if (project_id) { params.push(project_id); q += ` AND t.project_id = $${params.length}`; }
    if (assignee_id) { params.push(assignee_id); q += ` AND t.assignee_id = $${params.length}`; }
    if (status) { params.push(status); q += ` AND t.status = $${params.length}`; }

    q += ' ORDER BY t.created_at DESC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getTaskById = async (req, res) => {
  try {
    const { id } = req.params;
    const q = `
      SELECT t.*, 
             p.name AS project_name,
             a.full_name AS assignee_name,
             r.full_name AS reporter_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users a ON a.id = t.assignee_id
      LEFT JOIN users r ON r.id = t.reporter_id
      WHERE t.id = $1`;
    const result = await pool.query(q, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Task not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const before = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (before.rowCount === 0) return res.status(404).json({ error: 'Task not found' });

    const { status, actual_hours } = req.body;
    const user_id = req.user.userId;

    const q = `
      UPDATE tasks
      SET status = COALESCE($1, status),
          actual_hours = COALESCE($2, actual_hours),
          updated_at = NOW()
      WHERE id = $3
      RETURNING *`;
    const result = await pool.query(q, [status, actual_hours, id]);
    const after = result.rows[0];

    // Auto-log when task is done or started
    if (status === 'in_progress') {
      await autoLogTime(id, user_id, 30, 'Auto-log: Task started');
    } else if (status === 'done') {
      await autoLogTime(id, user_id, 60, 'Auto-log: Task completed');
    }

    res.json(after);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
