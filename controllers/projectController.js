import pool from "../config/db.js";
import { logChange } from "./changeLogController.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";

/* ================= CREATE PROJECT ================= */

export const createProject = async (req, res) => {
  try {
    const { userId, role } = req.user;
    const isPM = role === "Project Manager"; // Normalized

    if (!["admin"].includes(role) && !isPM) {
      return errorResponse(res, "Not allowed", 403);
    }

    const {
      name,
      description,
      start_date,
      end_date,
      status = "active",
      color,
    } = req.body;

    const members =
      typeof req.body.members === "string"
        ? JSON.parse(req.body.members)
        : req.body.members || [];

    const modules =
      typeof req.body.modules === "string"
        ? JSON.parse(req.body.modules)
        : req.body.modules || [];

    if (!name) {
      return errorResponse(res, "Project name required", 400);
    }

    /* ---- PROJECT CODE ---- */
    const generateUniqueProjectCode = async (projectName) => {
      // Remove numbers and special chars, keep only letters
      let alphaOnly = projectName.trim().toUpperCase().replace(/[^A-Z]/g, "");
      let baseCode = alphaOnly.substring(0, 4);
      if (baseCode.length < 3) baseCode = (baseCode + "PRJ").substring(0, 3);

      let code = baseCode;
      let attempt = 0;
      while (attempt < 20) {
        const check = await pool.query("SELECT 1 FROM projects WHERE project_code = $1", [code]);
        if (check.rowCount === 0) return code;

        // If exists, try shifting or appending letters to keep it unique without numbers
        attempt++;
        if (alphaOnly.length >= 4 + attempt) {
          code = alphaOnly.substring(attempt, attempt + 4);
        } else {
          code = baseCode.substring(0, 3) + String.fromCharCode(64 + attempt);
        }
      }
      return baseCode + Math.floor(Math.random() * 100); // Absolute fallback
    };

    const projectCode = await generateUniqueProjectCode(name);

    // Extract version if name is like "TEST-1"
    let version = 1;
    const versionMatch = name.match(/-(\d+)$/);
    if (versionMatch) {
      version = parseInt(versionMatch[1]);
    }

    /* ---- DOCUMENT ---- */
    let document = null;
    let document_name = null;
    let document_type = null;

    if (req.file) {
      document = req.file.buffer;
      document_name = req.file.originalname;
      document_type = req.file.mimetype;
    }

    /* ---- CREATE PROJECT ---- */
    const projectRes = await pool.query(
      `
      INSERT INTO projects
      (name, description, start_date, end_date, status,
       created_by, manager_id, project_code, version,
       document, document_name, document_type, color)
      VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12)
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
        color || "#4F7DFF",
      ]
    );

    const project = projectRes.rows[0];

    /* ---- MEMBERS ---- */
    for (const uid of members) {
      await pool.query(
        `
        INSERT INTO project_members (project_id, user_id)
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
        `,
        [project.id, uid]
      );
    }

    /* ---- MODULES ---- */
    let serial = 1;
    for (const m of modules) {
      if (!m.name?.trim()) continue;
      // Module code format: PROJECT_CODE + M + SERIAL (e.g., TEST/V1/M1)
      const moduleCode = `${projectCode}M${serial}`;
      await pool.query(
        `
        INSERT INTO modules (project_id, name, module_code, module_serial, description)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [project.id, m.name.trim(), moduleCode, serial++, m.description || null]
      );
    }

    /* ---- CHANGE LOG ---- */
    await logChange(
      "project",
      project.id,
      "created",
      null,
      project,
      userId
    );

    successResponse(res, project, 201);
  } catch (err) {
    console.error("createProject:", err);
    errorResponse(res, err.message);
  }
};

/* ================= GET PROJECTS ================= */

export const getProjects = async (req, res) => {
  try {
    const { userId, role } = req.user;
    const isPM = role === "Project Manager";

    let select = `
      p.*,
      COUNT(DISTINCT t.id) as total_tasks,
      COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done') as completed_tasks,
      (
        SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name))
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = p.id
      ) as members
    `;

    let query;
    let params = [];

    if (role === "admin" || isPM) {
      query = `
        SELECT ${select}
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
    } else {
      query = `
        SELECT ${select}
        FROM projects p
        INNER JOIN project_members pm ON pm.project_id = p.id
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE pm.user_id = $1
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `;
      params = [userId];
    }

    const { rows } = await pool.query(query, params);
    successResponse(res, rows);
  } catch (err) {
    console.error("getProjects error:", err);
    errorResponse(res, err.message);
  }
};

/* ================= GET PROJECT BY ID ================= */

export const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user;
    const isPM = role === "Project Manager"; // Normalized

    let query;
    let params = [id];

    if (role === "admin" || isPM) {
      query = `
        SELECT p.*,
          COUNT(t.id) as total_tasks,
          COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.id = $1
        GROUP BY p.id
      `;
    } else {
      query = `
        SELECT p.*,
          COUNT(t.id) as total_tasks,
          COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks
        FROM projects p
        INNER JOIN project_members pm ON pm.project_id = p.id
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.id = $1 AND pm.user_id = $2
        GROUP BY p.id
      `;
      params.push(userId);
    }

    const { rows } = await pool.query(query, params);

    if (!rows.length) {
      return errorResponse(res, "Access denied", 403);
    }

    successResponse(res, rows[0]);
  } catch (err) {
    errorResponse(res, err.message);
  }
};


/* ================= UPDATE PROJECT ================= */

export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return errorResponse(res, "Not allowed", 403);
    }

    const {
      name,
      description,
      start_date,
      end_date,
      status,
      color,
    } = req.body;

    const members =
      typeof req.body.members === "string"
        ? JSON.parse(req.body.members)
        : req.body.members || [];

    const modules =
      typeof req.body.modules === "string"
        ? JSON.parse(req.body.modules)
        : req.body.modules || [];

    /* ---- BEFORE ---- */
    const beforeRes = await pool.query(
      `SELECT * FROM projects WHERE id=$1`,
      [id]
    );
    if (!beforeRes.rowCount) {
      return errorResponse(res, "Project not found", 404);
    }
    const before = beforeRes.rows[0];

    /* ---- UPDATE DOCUMENT IF ANY ---- */
    if (req.file) {
      await pool.query(
        `UPDATE projects SET document=$1, document_name=$2, document_type=$3 WHERE id=$4`,
        [req.file.buffer, req.file.originalname, req.file.mimetype, id]
      );
    }

    /* ---- UPDATE PROJECT FIELDS ---- */
    const { rows } = await pool.query(
      `
      UPDATE projects
      SET name=COALESCE($1,name),
          description=COALESCE($2,description),
          start_date=COALESCE($3,start_date),
          end_date=COALESCE($4,end_date),
          status=COALESCE($5,status),
          color=COALESCE($6,color),
          updated_at=NOW()
      WHERE id=$7
      RETURNING *
      `,
      [
        name || null,
        description || null,
        start_date || null,
        end_date || null,
        status || null,
        color || null,
        id
      ]
    );

    const updated = rows[0];

    /* ---- MEMBERS (Optimized Batch Insert) ---- */
    if (req.body.members !== undefined) {
      await pool.query(`DELETE FROM project_members WHERE project_id=$1`, [id]);
      if (members.length > 0) {
        const values = members.map((_, i) => `($1, $${i + 2})`).join(",");
        await pool.query(
          `INSERT INTO project_members (project_id, user_id) VALUES ${values}`,
          [id, ...members]
        );
      }
    }

    /* ---- MODULES (Optimized Batch Insert) ---- */
    if (req.body.modules !== undefined) {
      const validModules = modules.filter(m => m.name?.trim());
      if (validModules.length > 0) {
        let serialRes = await pool.query(
          `SELECT COALESCE(MAX(module_serial),0) FROM modules WHERE project_id=$1`,
          [id]
        );
        let serial = Number(serialRes.rows[0].coalesce) + 1;

        const values = validModules.map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`).join(",");
        const flatParams = validModules.flatMap(m => {
          const modSerial = serial++;
          const modCode = `${updated.project_code}M${modSerial}`;
          return [m.name.trim(), modCode, modSerial];
        });
        await pool.query(
          `INSERT INTO modules (project_id, name, module_code, module_serial) VALUES ${values}`,
          [id, ...flatParams]
        );
      }
    }

    /* ---- CHANGE LOG ---- */
    await logChange(
      "project",
      id,
      "updated",
      before,
      updated,
      userId
    );

    successResponse(res, updated);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/* ================= DELETE PROJECT ================= */

export const deleteProject = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { userId, role } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      await client.query("ROLLBACK");
      return errorResponse(res, "Not allowed to delete projects", 403);
    }

    await client.query("BEGIN");

    const beforeRes = await client.query(
      `SELECT * FROM projects WHERE id=$1`,
      [id]
    );
    if (!beforeRes.rowCount) {
      await client.query("ROLLBACK");
      return errorResponse(res, "Project not found", 404);
    }
    const before = beforeRes.rows[0];

    // Cascade Delete
    // 1. Delete timesheets for tasks in this project
    await client.query(
      `DELETE FROM timesheets WHERE task_id IN (SELECT id FROM tasks WHERE project_id = $1)`,
      [id]
    );

    // 2. Delete task collaborators
    await client.query(
      `DELETE FROM task_collaborators WHERE task_id IN (SELECT id FROM tasks WHERE project_id = $1)`,
      [id]
    );

    // 3. Delete tasks
    await client.query(`DELETE FROM tasks WHERE project_id = $1`, [id]);

    // 4. Delete modules
    await client.query(`DELETE FROM modules WHERE project_id = $1`, [id]);

    // 5. Delete sprints
    await client.query(`DELETE FROM sprints WHERE project_id = $1`, [id]);

    // 6. Delete project members
    await client.query(`DELETE FROM project_members WHERE project_id = $1`, [id]);

    // 7. Finally delete the project
    await client.query(`DELETE FROM projects WHERE id=$1`, [id]);

    /* ---- CHANGE LOG ---- */
    await logChange(
      "project",
      id,
      "deleted",
      before,
      null,
      userId
    );

    await client.query("COMMIT");
    successResponse(res, { message: "Project and all related data deleted successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("deleteProject error:", err);
    errorResponse(res, err.message);
  } finally {
    client.release();
  }
};

/* ================= DOWNLOAD DOCUMENT ================= */

export const downloadDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const q = `
      SELECT document, document_name, document_type
      FROM projects
      WHERE id = $1
    `;
    const result = await pool.query(q, [id]);

    if (!result.rowCount)
      return errorResponse(res, "Project not found", 404);

    const file = result.rows[0];
    if (!file.document)
      return errorResponse(res, "No document uploaded", 404);

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${file.document_name}"`
    );
    res.setHeader("Content-Type", file.document_type || 'application/octet-stream');
    res.send(file.document);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const getProjectSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const [modules, tasks, sprint] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (
            WHERE id IN (SELECT module_id FROM tasks WHERE project_id=$1 AND LOWER(status) != 'done')
          ) as active
        FROM modules 
        WHERE project_id=$1
      `, [id]),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('done', 'completed')) AS active,
          COUNT(*) FILTER (WHERE LOWER(status) IN ('done', 'completed')) AS completed,
          COUNT(*) AS total,
          COALESCE(SUM(potential_points), 0) as total_points,
          COALESCE(SUM(potential_points) FILTER (WHERE LOWER(status) IN ('done', 'completed')), 0) as completed_points
        FROM tasks
        WHERE project_id=$1
      `, [id]),
      pool.query(`
        SELECT 
          s.*,
          (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id) as total_tasks,
          (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id AND LOWER(t.status) IN ('done', 'completed')) as completed_tasks,
          (SELECT COALESCE(SUM(potential_points), 0) FROM tasks t WHERE t.sprint_id = s.id) as total_points,
          (SELECT COALESCE(SUM(potential_points), 0) FROM tasks t WHERE t.sprint_id = s.id AND LOWER(t.status) IN ('done', 'completed')) as completed_points
        FROM sprints s
        WHERE s.project_id = $1 AND s.status != 'completed'
        ORDER BY s.start_date ASC
        LIMIT 1
      `, [id])
    ]);

    const activeSprint = sprint.rows[0] || null;
    let sprintProgress = 0;
    if (activeSprint) {
      const totalTasks = Number(activeSprint.total_tasks) || 0;
      const completedTasks = Number(activeSprint.completed_tasks) || 0;
      sprintProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    }

    const modStats = modules.rows[0] || { total: 0, active: 0 };
    const taskStats = tasks.rows[0] || { active: 0, completed: 0, total: 0 };

    successResponse(res, {
      modules: {
        total: Number(modStats.total || 0),
        active: Number(modStats.active || 0)
      },
      tasks: {
        active: Number(taskStats.active || 0),
        completed: Number(taskStats.completed || 0),
        total: Number(taskStats.total || 0),
        progress: Number(taskStats.total || 0) > 0 ? Math.round((Number(taskStats.completed || 0) / Number(taskStats.total || 0)) * 100) : 0,
        total_points: Number(taskStats.total_points || 0),
        completed_points: Number(taskStats.completed_points || 0)
      },
      currentSprint: activeSprint ? {
        id: activeSprint.id,
        name: activeSprint.name,
        progress: sprintProgress
      } : null
    });
  } catch (err) {
    console.error("getProjectSummary error:", err);
    errorResponse(res, err.message);
  }
};

export const getMyProjects = async (req, res) => {
  try {
    const { userId, role } = req.user;

    let q = `
      SELECT p.*,
        COUNT(t.id) as total_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks
      FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id
      LEFT JOIN tasks t ON t.project_id = p.id
    `;

    const params = [];

    if (role === "Project Manager") {
      q += " WHERE p.manager_id = $1";
      params.push(userId);
    } else {
      q += " WHERE pm.user_id = $1";
      params.push(userId);
    }

    q += " GROUP BY p.id";

    const { rows } = await pool.query(q, params);
    successResponse(res, rows);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/* ================= GET PROJECT MEMBERS ================= */
export const getProjectMembers = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `
      SELECT u.id, u.full_name, u.role
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY u.full_name
      `,
      [id]
    );

    successResponse(res, rows);
  } catch (err) {
    console.error("getProjectMembers:", err);
    errorResponse(res, err.message);
  }
};

export const getProjectHierarchy = async (req, res) => {
  try {
    const { id } = req.params;

    const [projectRes, modulesRes, sprintsRes, tasksRes] = await Promise.all([
      pool.query("SELECT * FROM projects WHERE id = $1", [id]),
      pool.query("SELECT * FROM modules WHERE project_id = $1 ORDER BY module_serial", [id]),
      pool.query("SELECT * FROM sprints WHERE project_id = $1 ORDER BY sprint_number", [id]),
      pool.query(`
        SELECT t.id, t.title, t.module_id, t.sprint_id, t.status, t.assignee_id, u.full_name as assignee_name
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.project_id = $1
      `, [id])
    ]);

    if (!projectRes.rowCount) return errorResponse(res, "Project not found", 404);

    successResponse(res, {
      project: projectRes.rows[0],
      modules: modulesRes.rows,
      sprints: sprintsRes.rows,
      tasks: tasksRes.rows
    });
  } catch (err) {
    console.error("getProjectHierarchy:", err);
    errorResponse(res, err.message);
  }
};
