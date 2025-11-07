import pool from '../config/db.js';

// Create Sprint
export const createSprint = async (req, res) => {
  try {
    const { project_id, name, start_date, end_date, status, notes } = req.body;

    if (!project_id || !name || !start_date || !end_date) {
      return res.status(400).json({ error: 'project_id, name, start_date, and end_date are required' });
    }

    const q = `
      INSERT INTO sprints (project_id, name, start_date, end_date, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`;
    const result = await pool.query(q, [project_id, name, start_date, end_date, status || 'planned', notes || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all sprints (optional filter by project)
export const getSprints = async (req, res) => {
  try {
    const { project_id } = req.query;
    let q = `
      SELECT s.*, p.name AS project_name
      FROM sprints s
      LEFT JOIN projects p ON p.id = s.project_id`;
    const params = [];

    if (project_id) {
      params.push(project_id);
      q += ` WHERE s.project_id = $1`;
    }

    q += ' ORDER BY s.start_date DESC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get sprint by ID
export const getSprintById = async (req, res) => {
  try {
    const { id } = req.params;
    const q = `
      SELECT s.*, p.name AS project_name
      FROM sprints s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`;
    const result = await pool.query(q, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Sprint not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update sprint
export const updateSprint = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_date, end_date, status, notes } = req.body;

    const q = `
      UPDATE sprints
      SET name = COALESCE($1, name),
          start_date = COALESCE($2, start_date),
          end_date = COALESCE($3, end_date),
          status = COALESCE($4, status),
          notes = COALESCE($5, notes),
          updated_at = NOW()
      WHERE id = $6
      RETURNING *`;
    const result = await pool.query(q, [name, start_date, end_date, status, notes, id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Sprint not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete sprint
export const deleteSprint = async (req, res) => {
  try {
    const { id } = req.params;
    const q = `DELETE FROM sprints WHERE id = $1 RETURNING *`;
    const result = await pool.query(q, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Sprint not found' });
    res.json({ message: 'Sprint deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
