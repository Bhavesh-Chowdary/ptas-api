import pool from "../config/db.js";
import { logChange } from "./changeLogController.js";

const allowed = (role) => ["admin", "Project Manager"].includes(role);

/* ---------------- READ ---------------- */

export const getModules = async (req, res) => {
  try {
    const { project_id } = req.query;
    const { rows } = await pool.query(
      `
      SELECT * FROM modules
      WHERE ($1::uuid IS NULL OR project_id=$1)
      ORDER BY module_serial
      `,
      [project_id || null]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ---------------- CREATE ---------------- */

export const createModule = async (req, res) => {
  try {
    const { role, userId } = req.user;
    if (!allowed(role))
      return res.status(403).json({ error: "Locked" });

    const { project_id, name } = req.body;
    if (!project_id || !name || !name.trim())
      return res.status(400).json({ error: "Invalid module" });

    const count = await pool.query(
      `SELECT COUNT(*) FROM modules WHERE project_id=$1`,
      [project_id]
    );

    const serial = Number(count.rows[0].count) + 1;

    const { rows } = await pool.query(
      `
      INSERT INTO modules (project_id,name,module_code,module_serial)
      VALUES ($1,$2,'R',$3)
      RETURNING *
      `,
      [project_id, name.trim(), serial]
    );

    /* ---- CHANGE LOG ---- */
    await logChange(
      "module",
      rows[0].id,
      "created",
      null,
      rows[0],
      userId
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ---------------- UPDATE ---------------- */

export const updateModule = async (req, res) => {
  try {
    const { role, userId } = req.user;
    if (!allowed(role))
      return res.status(403).json({ error: "Locked" });

    const { id } = req.query;
    const { name } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ error: "Invalid name" });

    /* ---- BEFORE ---- */
    const beforeRes = await pool.query(
      `SELECT * FROM modules WHERE id=$1`,
      [id]
    );
    if (!beforeRes.rowCount)
      return res.status(404).json({ error: "Module not found" });

    const { rows } = await pool.query(
      `
      UPDATE modules
      SET name=$1, updated_at=NOW()
      WHERE id=$2
      RETURNING *
      `,
      [name.trim(), id]
    );

    /* ---- CHANGE LOG ---- */
    await logChange(
      "module",
      id,
      "updated",
      beforeRes.rows[0],
      rows[0],
      userId
    );

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ---------------- DELETE ---------------- */

export const deleteModule = async (req, res) => {
  try {
    const { role, userId } = req.user;
    if (!allowed(role))
      return res.status(403).json({ error: "Locked" });

    const { id } = req.query;

    /* ---- BEFORE ---- */
    const beforeRes = await pool.query(
      `SELECT * FROM modules WHERE id=$1`,
      [id]
    );
    if (!beforeRes.rowCount)
      return res.status(404).json({ error: "Module not found" });

    await pool.query(`DELETE FROM modules WHERE id=$1`, [id]);

    /* ---- CHANGE LOG ---- */
    await logChange(
      "module",
      id,
      "deleted",
      beforeRes.rows[0],
      null,
      userId
    );

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ---------------- GET BY ID ---------------- */

export const getModuleById = async (req, res) => {
  try {
    const { id } = req.query;
    const q = `
      SELECT m.*, p.name AS project_name
      FROM modules m
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.id = $1
    `;
    const result = await pool.query(q, [id]);

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Module not found" });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};