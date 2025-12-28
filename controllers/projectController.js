import pool from "../config/db.js";

export const createProject = async (req, res) => {
  try {
    const { userId, role } = req.user;
    if (!["admin", "pm"].includes(role))
      return res.status(403).json({ error: "Not allowed" });

    const {
      name,
      description,
      start_date,
      end_date,
      status = "active",
      members = [],
      modules = [],
    } = req.body;

    if (!name)
      return res.status(400).json({ error: "Project name required" });

    /* ---- PROJECT CODE AUTO GENERATION ---- */
    const base = name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM projects WHERE project_code LIKE $1`,
      [`${base}%`]
    );

    const version = Number(countRes.rows[0].count) + 1;
    const projectCode = `${base}-${version}`;

    /* ---- CREATE PROJECT ---- */
    const projectRes = await pool.query(
      `
      INSERT INTO projects
      (name, description, start_date, end_date, status,
       created_by, project_code, version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        name,
        description || null,
        start_date || null,
        end_date || null,
        status,
        userId,
        projectCode,
        version,
      ]
    );

    const project = projectRes.rows[0];

    /* ---- ASSIGN MEMBERS ---- */
    for (const uid of members) {
      await pool.query(
        `
        INSERT INTO project_members (project_id,user_id)
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
        `,
        [project.id, uid]
      );
    }

    /* ---- CREATE MODULES (VALIDATED) ---- */
    let serial = 1;
    for (const m of modules) {
      if (!m.name || !m.name.trim()) continue;

      await pool.query(
        `
        INSERT INTO modules (project_id,name,module_code,module_serial)
        VALUES ($1,$2,'R',$3)
        `,
        [project.id, m.name.trim(), serial++]
      );
    }

    res.status(201).json(project);
  } catch (err) {
    console.error("createProject:", err);
    res.status(500).json({ error: err.message });
  }
};


export const getProjects = async (_, res) => {
  const { rows } = await pool.query(
    `
    SELECT p.*, u.full_name AS created_by_name
    FROM projects p
    LEFT JOIN users u ON u.id = p.created_by
    ORDER BY p.created_at DESC
    `
  );
  res.json(rows);
};

export const getProjectById = async (req, res) => {
  const { id } = req.query;
  const r = await pool.query(`SELECT * FROM projects WHERE id=$1`, [id]);
  if (!r.rowCount) return res.status(404).json({ error: "Not found" });
  res.json(r.rows[0]);
};


export const updateProject = async (req, res) => {
  try {
    const { id } = req.query;
    const { role } = req.user;
    if (!["admin", "pm"].includes(role))
      return res.status(403).json({ error: "Not allowed" });

    const {
      name,
      description,
      start_date,
      end_date,
      status,
      members = [],
      modules = [],
    } = req.body;

    const before = await pool.query(`SELECT * FROM projects WHERE id=$1`, [id]);
    if (!before.rowCount)
      return res.status(404).json({ error: "Project not found" });

    const { rows } = await pool.query(
      `
      UPDATE projects
      SET name=COALESCE($1,name),
          description=COALESCE($2,description),
          start_date=COALESCE($3,start_date),
          end_date=COALESCE($4,end_date),
          status=COALESCE($5,status),
          updated_at=NOW()
      WHERE id=$6
      RETURNING *
      `,
      [name, description, start_date, end_date, status, id]
    );

    /* ---- REPLACE MEMBERS ---- */
    await pool.query(`DELETE FROM project_members WHERE project_id=$1`, [id]);
    for (const uid of members) {
      await pool.query(
        `
        INSERT INTO project_members (project_id,user_id)
        VALUES ($1,$2)
        `,
        [id, uid]
      );
    }

    /* ---- OPTIONAL MODULE ADDITIONS ---- */
    let serialRes = await pool.query(
      `SELECT COALESCE(MAX(module_serial),0) FROM modules WHERE project_id=$1`,
      [id]
    );
    let serial = Number(serialRes.rows[0].coalesce) + 1;

    for (const m of modules) {
      if (!m.name || !m.name.trim()) continue;
      await pool.query(
        `
        INSERT INTO modules (project_id,name,module_code,module_serial)
        VALUES ($1,$2,'R',$3)
        `,
        [id, m.name.trim(), serial++]
      );
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteProject = async (req, res) => {
  const { id } = req.query;
  await pool.query(`DELETE FROM projects WHERE id=$1`, [id]);
  res.json({ message: "Deleted" });
};

export const downloadDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const q = `SELECT document, document_name, document_type FROM projects WHERE id = $1`;
    const result = await pool.query(q, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });

    const file = result.rows[0];
    if (!file.document) return res.status(404).json({ error: 'No document uploaded' });

    res.setHeader('Content-Disposition', `attachment; filename="${file.document_name}"`);
    res.setHeader('Content-Type', file.document_type);
    res.send(file.document);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};