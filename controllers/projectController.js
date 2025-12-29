import pool from "../config/db.js";

export const createProject = async (req, res) => {
  try {
    const { userId, role } = req.user;

    // normalize role
    const isPM = role === "pm" || role === "Project Manager";

    if (!["admin"].includes(role) && !isPM) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const {
      name,
      description,
      start_date,
      end_date,
      status = "active",
    } = req.body;

    const members = req.body.members ? JSON.parse(req.body.members) : [];
    const modules = req.body.modules ? JSON.parse(req.body.modules) : [];

    if (!name) {
      return res.status(400).json({ error: "Project name required" });
    }

    const base = name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM projects WHERE project_code LIKE $1`,
      [`${base}%`]
    );

    const version = Number(countRes.rows[0].count) + 1;
    const projectCode = `${base}-${version}`;

    let document = null;
    let document_name = null;
    let document_type = null;

    if (req.file) {
      document = req.file.buffer;
      document_name = req.file.originalname;
      document_type = req.file.mimetype;
    }

    const projectRes = await pool.query(
      `
      INSERT INTO projects
      (name, description, start_date, end_date, status,
       created_by, project_code, version,
       document, document_name, document_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        document,
        document_name,
        document_type,
      ]
    );

    const project = projectRes.rows[0];

    for (const uid of members) {
      await pool.query(
        `INSERT INTO project_members (project_id, user_id)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [project.id, uid]
      );
    }

    let serial = 1;
    for (const m of modules) {
      if (!m.name?.trim()) continue;
      await pool.query(
        `INSERT INTO modules (project_id, name, module_code, module_serial)
         VALUES ($1,$2,'R',$3)`,
        [project.id, m.name.trim(), serial++]
      );
    }

    res.status(201).json(project);
  } catch (err) {
    console.error("createProject:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getProjects = async (req, res) => {
  try {
    const { userId, role } = req.user;
    const isPM = role === "pm" || role === "Project Manager";

    let query;
    let params = [];

    // Admin & PM → all projects
    if (role === "admin" || isPM) {
      query = `
        SELECT *
        FROM projects
        ORDER BY created_at DESC
      `;
    }
    // Dev / QA → only assigned
    else {
      query = `
        SELECT DISTINCT p.*
        FROM projects p
        INNER JOIN project_members pm ON pm.project_id = p.id
        WHERE pm.user_id = $1
        ORDER BY p.created_at DESC
      `;
      params = [userId];
    }

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("getProjects error:", err);
    res.status(500).json({ error: err.message });
  }
};


export const getProjectById = async (req, res) => {
  try {
    const { id } = req.query;
    const { userId, role } = req.user;
    const isPM = role === "pm" || role === "Project Manager";

    let query;
    let params = [id];

    if (role === "admin" || isPM) {
      query = `SELECT * FROM projects WHERE id = $1`;
    } else {
      query = `
        SELECT p.*
        FROM projects p
        INNER JOIN project_members pm ON pm.project_id = p.id
        WHERE p.id = $1 AND pm.user_id = $2
      `;
      params.push(userId);
    }

    const { rows } = await pool.query(query, params);

    if (!rows.length) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("getProjectById error:", err);
    res.status(500).json({ error: err.message });
  }
};




export const updateProject = async (req, res) => {
  try {
    const { id } = req.query;
    const { role } = req.user;
    if (!["admin", "Project Manager"].includes(role))
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