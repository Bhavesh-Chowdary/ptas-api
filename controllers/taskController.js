import pool from "../config/db.js";
import { autoLogTime } from "./timesheetController.js";
import { logChange } from "./changeLogController.js";

/*
  TASK CODE GENERATOR
*/
const generateTaskCode = async (
  project_id,
  sprint_id,
  module_id,
  assignee_id
) => {
  const [p, s, m, u, c] = await Promise.all([
    pool.query("SELECT org_code, project_code, version FROM projects WHERE id=$1", [project_id]),
    pool.query("SELECT sprint_number FROM sprints WHERE id=$1", [sprint_id]),
    pool.query("SELECT module_code, module_serial FROM modules WHERE id=$1", [module_id]),
    pool.query("SELECT resource_serial FROM users WHERE id=$1", [assignee_id]),
    pool.query("SELECT COUNT(*) FROM tasks WHERE project_id=$1", [project_id])
  ]);

  const serial = Number(c.rows[0].count) + 1;

  return `${p.rows[0].org_code}/` +
         `${p.rows[0].project_code}${String(p.rows[0].version).padStart(3,'0')}/` +
         `R${u.rows[0].resource_serial}/` +
         `S${s.rows[0].sprint_number}/` +
         `${m.rows[0].module_code}${m.rows[0].module_serial}/` +
         `${String(serial).padStart(3,'0')}`;
};

/*
  CREATE TASK
*/
export const createTask = async (req, res) => {
  try {
    const {
      project_id,
      sprint_id,
      module_id,
      assignee_id,
      title,
      description,
      est_hours
    } = req.body;

    const { userId, role } = req.user;

    if (!["ADMIN", "PROJECT_MANAGER"].includes(role))
      return res.status(403).json({ error: "Not allowed" });

    const task_code = await generateTaskCode(
      project_id,
      sprint_id,
      module_id,
      assignee_id
    );

    const { rows } = await pool.query(
      `
      INSERT INTO tasks
      (task_code,task_serial,title,description,project_id,
       sprint_id,module_id,assignee_id,created_by,est_hours)
      VALUES ($1,
        (SELECT COUNT(*)+1 FROM tasks WHERE project_id=$2),
        $3,$4,$2,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        task_code,
        project_id,
        title,
        description || null,
        sprint_id,
        module_id,
        assignee_id,
        userId,
        est_hours || null
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

export const getTasks = async (req, res) => {
  try {
    const { role, id: userId } = req.user;

    let query = `
      SELECT
        t.*,
        p.name AS project_name,
        u.full_name AS assignee_name,
        c.full_name AS created_by_name,
        COALESCE(col.collaborators, '[]'::json) AS collaborators
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN users c ON c.id = t.created_by
      LEFT JOIN (
        SELECT
          tc.task_id,
          json_agg(
            json_build_object(
              'id', u.id,
              'name', u.full_name
            )
          ) AS collaborators
        FROM task_collaborators tc
        JOIN users u ON u.id = tc.user_id
        GROUP BY tc.task_id
      ) col ON col.task_id = t.id
    `;

    const params = [];

    if (role === "DEVELOPER") {
      query += `
        WHERE t.assignee_id = $1
           OR EXISTS (
             SELECT 1
             FROM task_collaborators tc
             WHERE tc.task_id = t.id
               AND tc.user_id = $1
           )
      `;
      params.push(userId);
    }

    if (role === "PROJECT_MANAGER") {
      query += `
        WHERE p.manager_id = $1
      `;
      params.push(userId);
    }

    query += " ORDER BY t.created_at DESC";

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("getTasks:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getTaskById = async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Task id is required" });
    }

    const q = `
      SELECT t.*, p.name AS project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = $1
    `;

    const { rows } = await pool.query(q, [id]);
    if (!rows.length) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("getTaskById:", err);
    res.status(500).json({ error: err.message });
  }
};

export const updateTask = async (req, res) => {
  try {
    const { id } = req.query;
    const { role, id: userId } = req.user;

    if (!id) {
      return res.status(400).json({ error: "Task id is required" });
    }

    const beforeRes = await pool.query(
      "SELECT * FROM tasks WHERE id = $1",
      [id]
    );
    if (!beforeRes.rowCount) {
      return res.status(404).json({ error: "Task not found" });
    }

    const before = beforeRes.rows[0];

    if (role === "DEVELOPER" && before.assignee_id !== userId) {
      return res.status(403).json({ error: "Not allowed to edit this task" });
    }

    const {
      title,
      description,
      module_name,
      assignee_id,
      status,
      start_datetime,
      end_datetime,
      est_hours,
      actual_hours,
      collaborators,
    } = req.body;

    const updateQ = `
      UPDATE tasks
      SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        module_name = COALESCE($3, module_name),
        assignee_id = COALESCE($4, assignee_id),
        status = COALESCE($5, status),
        start_datetime = COALESCE($6, start_datetime),
        end_datetime = COALESCE($7, end_datetime),
        est_hours = COALESCE($8, est_hours),
        actual_hours = COALESCE($9, actual_hours),
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `;

    const { rows } = await pool.query(updateQ, [
      title,
      description,
      module_name,
      assignee_id,
      status,
      start_datetime,
      end_datetime,
      est_hours,
      actual_hours,
      id,
    ]);

    const after = rows[0];

    if (Array.isArray(collaborators)) {
      await pool.query("DELETE FROM task_collaborators WHERE task_id = $1", [id]);
      for (const uid of collaborators) {
        await pool.query(
          `INSERT INTO task_collaborators (task_id, user_id)
           VALUES ($1,$2)`,
          [id, uid]
        );
      }
    }

    await logChange("task", id, "update", before, after, userId);

    if (status === "In Progress") {
      await autoLogTime(id, userId, 30, "Auto-log: Task started");
    }
    if (status === "Done") {
      await autoLogTime(id, userId, 60, "Auto-log: Task completed");
    }

    res.json(after);
  } catch (err) {
    console.error("updateTask:", err);
    res.status(500).json({ error: err.message });
  }
};

export const deleteTask = async (req, res) => {
  try {
    const { id } = req.query;
    const { role } = req.user;

    if (!id) {
      return res.status(400).json({ error: "Task id is required" });
    }

    if (!["ADMIN", "PROJECT_MANAGER"].includes(role)) {
      return res.status(403).json({ error: "Not allowed to delete tasks" });
    }

    const { rowCount } = await pool.query(
      "DELETE FROM tasks WHERE id = $1",
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("deleteTask:", err);
    res.status(500).json({ error: err.message });
  }
};
