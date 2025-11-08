import pool from '../config/db.js';
import { logChange } from './changeLogController.js';

export const createModule = async (req, res) => {
  try {
    const { project_id, name, description } = req.body;
    if (!project_id || !name)
      return res.status(400).json({ error: 'project_id and name are required' });

    const q = `
      INSERT INTO modules (project_id, name, description)
      VALUES ($1, $2, $3)
      RETURNING *`;
    const result = await pool.query(q, [project_id, name, description || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getModules = async (req, res) => {
  try {
    const { project_id } = req.query;
    let q = `
      SELECT m.*, p.name AS project_name
      FROM modules m
      LEFT JOIN projects p ON p.id = m.project_id`;
    const params = [];

    if (project_id) {
      params.push(project_id);
      q += ` WHERE m.project_id = $1`;
    }

    q += ' ORDER BY m.created_at DESC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getModuleById = async (req, res) => {
  try {
    const { id } = req.query;
    const q = `
      SELECT m.*, p.name AS project_name
      FROM modules m
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.id = $1`;
    const result = await pool.query(q, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Module not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update module (with change logging)
export const updateModule = async (req, res) => {
  try {
    const { id } = req.query;
    const before = await pool.query('SELECT * FROM modules WHERE id = $1', [id]);
    if (before.rowCount === 0) return res.status(404).json({ error: 'Module not found' });

    const { name, description } = req.body;
    const q = `
      UPDATE modules
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          updated_at = NOW()
      WHERE id = $3
      RETURNING *`;
    const result = await pool.query(q, [name, description, id]);
    const after = result.rows[0];

    await logChange('module', id, 'update', before.rows[0], after, req.user.userId);

    res.json(after);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteModule = async (req, res) => {
  try {
    const { id } = req.query;
    const q = 'DELETE FROM modules WHERE id = $1 RETURNING *';
    const result = await pool.query(q, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Module not found' });
    res.json({ message: 'Module deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
