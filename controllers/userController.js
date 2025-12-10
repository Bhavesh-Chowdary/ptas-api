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