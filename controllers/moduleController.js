import pool from "../config/db.js";

const allowed = (role) => ["admin", "pm"].includes(role);

/* ---------------- READ ---------------- */

export const getModules = async (req, res) => {
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
};

/* ---------------- CREATE ---------------- */

export const createModule = async (req, res) => {
  const { role } = req.user;
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

  res.status(201).json(rows[0]);
};

/* ---------------- UPDATE ---------------- */

export const updateModule = async (req, res) => {
  const { role } = req.user;
  if (!allowed(role))
    return res.status(403).json({ error: "Locked" });

  const { id } = req.query;
  const { name } = req.body;

  if (!name || !name.trim())
    return res.status(400).json({ error: "Invalid name" });

  const { rows } = await pool.query(
    `
    UPDATE modules
    SET name=$1, updated_at=NOW()
    WHERE id=$2
    RETURNING *
    `,
    [name.trim(), id]
  );

  res.json(rows[0]);
};

/* ---------------- DELETE ---------------- */

export const deleteModule = async (req, res) => {
  const { role } = req.user;
  if (!allowed(role))
    return res.status(403).json({ error: "Locked" });

  const { id } = req.query;
  await pool.query(`DELETE FROM modules WHERE id=$1`, [id]);
  res.json({ message: "Deleted" });
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