import pool from '../config/db.js';

export const createProject = async (req, res) => {
  try {
    const { name, description, start_date, end_date, status } = req.body;
    const created_by = req.user.userId;

    if (!name) return res.status(400).json({ error: 'Project name is required' });

    const q = `INSERT INTO projects (name, description, start_date, end_date, status, created_by)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *`;
    const result = await pool.query(q, [name, description, start_date, end_date, status || 'active', created_by]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getProjects = async (req, res) => {
  try {
    const q = `
      SELECT p.*, u.full_name AS created_by_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.created_by
      ORDER BY p.created_at DESC
    `;
    const result = await pool.query(q);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const q = `
      SELECT p.*, u.full_name AS created_by_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.id = $1
    `;
    const result = await pool.query(q, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, start_date, end_date, status } = req.body;

    const q = `
      UPDATE projects
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          start_date = COALESCE($3, start_date),
          end_date = COALESCE($4, end_date),
          status = COALESCE($5, status),
          updated_at = NOW()
      WHERE id = $6
      RETURNING *`;
    const result = await pool.query(q, [name, description, start_date, end_date, status, id]);

    if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const q = `DELETE FROM projects WHERE id = $1 RETURNING *`;
    const result = await pool.query(q, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
