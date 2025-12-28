import pool from '../config/db.js';
export const getUsers = async (req, res) => {
  try {
    let q = `
      SELECT * FROM users WHERE  
    `;
    const result = await pool.query(q);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAssignableUsers = async (req, res) => {
  try {
    const q = `
      SELECT id, full_name, email, role
      FROM users
      WHERE role IN ('developer','qa')
        AND is_active=true
      ORDER BY full_name
    `;
    const { rows } = await pool.query(q);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
