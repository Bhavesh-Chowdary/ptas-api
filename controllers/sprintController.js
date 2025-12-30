import pool from "../config/db.js";
import { logChange } from "./changeLogController.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";

export const createSprint = async (req, res) => {
  try {
    const { project_id, start_date, end_date, notes, modules } = req.body;
    const { role, userId } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return errorResponse(res, "Not allowed to create sprint", 403);
    }

    if (!project_id || !start_date || !end_date) {
      return errorResponse(res, "project_id, start_date and end_date are required", 400);
    }

    const count = await pool.query(
      "SELECT COUNT(*) FROM sprints WHERE project_id = $1",
      [project_id]
    );

    const sprint_number = Number(count.rows[0].count) + 1;

    const { rows } = await pool.query(
      `
      INSERT INTO sprints
      (project_id, name, start_date, end_date, status, notes, sprint_number)
      VALUES ($1, $2, $3, $4, 'planned', $5, $6)
      RETURNING *
      `,
      [
        project_id,
        `Sprint ${sprint_number}`,
        start_date,
        end_date,
        notes || null,
        sprint_number,
      ]
    );

    const sprint = rows[0];

    // Handle module associations (Optimized Batch Insert)
    if (Array.isArray(modules) && modules.length > 0) {
      const values = modules.map((_, i) => `($1, $${i + 2})`).join(",");
      await pool.query(
        `
        INSERT INTO sprint_modules (sprint_id, module_id)
        VALUES ${values}
        ON CONFLICT DO NOTHING
        `,
        [sprint.id, ...modules]
      );
    }

    /* ---- CHANGE LOG ---- */

    successResponse(res, sprint, 201);
  } catch (err) {
    console.error("createSprint:", err);
    errorResponse(res, err.message);
  }
};

export const getSprints = async (req, res) => {
  try {
    const { project_id } = req.query;

    let q = `
      SELECT
        s.*,
        p.name AS project_name,
        COUNT(t.id) as total_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks
      FROM sprints s
      LEFT JOIN projects p ON p.id = s.project_id
      LEFT JOIN tasks t ON t.sprint_id = s.id
    `;
    const params = [];

    if (project_id) {
      params.push(project_id);
      q += ` WHERE s.project_id = $1`;
    }

    q += ` GROUP BY s.id, p.name ORDER BY s.sprint_number DESC`;

    const { rows } = await pool.query(q, params);
    successResponse(res, rows);
  } catch (err) {
    console.error("getSprints:", err);
    errorResponse(res, err.message);
  }
};

export const getSprintById = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;

    if (!id) {
      return errorResponse(res, "Sprint id is required", 400);
    }

    const { rows } = await pool.query(
      `
      SELECT
        s.*,
        p.name AS project_name,
        COUNT(t.id) as total_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks
      FROM sprints s
      LEFT JOIN projects p ON p.id = s.project_id
      LEFT JOIN tasks t ON t.sprint_id = s.id
      WHERE s.id = $1
      GROUP BY s.id, p.name
      `,
      [id]
    );

    if (!rows.length) {
      return errorResponse(res, "Sprint not found", 404);
    }

    successResponse(res, rows[0]);
  } catch (err) {
    console.error("getSprintById:", err);
    errorResponse(res, err.message);
  }
};

export const updateSprint = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role, userId } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return errorResponse(res, "Not allowed to update sprint", 403);
    }

    if (!id) {
      return errorResponse(res, "Sprint id is required", 400);
    }

    const beforeRes = await pool.query(
      "SELECT * FROM sprints WHERE id = $1",
      [id]
    );

    if (!beforeRes.rowCount) {
      return errorResponse(res, "Sprint not found", 404);
    }

    const before = beforeRes.rows[0];

    const { name, start_date, end_date, status, notes } = req.body;

    const { rows } = await pool.query(
      `
      UPDATE sprints
      SET
        name = COALESCE($1, name),
        start_date = COALESCE($2, start_date),
        end_date = COALESCE($3, end_date),
        status = COALESCE($4, status),
        notes = COALESCE($5, notes),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
      `,
      [name, start_date, end_date, status, notes, id]
    );

    const after = rows[0];

    await logChange("sprint", id, "update", before, after, userId);

    /* ---- CHANGE LOG ---- */

    successResponse(res, after);
  } catch (err) {
    console.error("updateSprint:", err);
    errorResponse(res, err.message);
  }
};

export const deleteSprint = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return errorResponse(res, "Not allowed to delete sprint", 403);
    }

    if (!id) {
      return errorResponse(res, "Sprint id is required", 400);
    }

    const { rowCount } = await pool.query(
      "DELETE FROM sprints WHERE id = $1",
      [id]
    );

    if (!rowCount) {
      return errorResponse(res, "Sprint not found", 404);
    }

    /* ---- CHANGE LOG ---- */

    successResponse(res, { message: "Sprint deleted successfully" });
  } catch (err) {
    console.error("deleteSprint:", err);
    errorResponse(res, err.message);
  }
};
