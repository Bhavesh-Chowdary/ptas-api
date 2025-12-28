import pool from "../config/db.js";
import { logChange } from "./changeLogController.js";

export const createSprint = async (req, res) => {
  try {
    const { project_id, start_date, end_date, notes } = req.body;
    const { role, userId } = req.user;

    if (!["ADMIN", "PROJECT_MANAGER"].includes(role)) {
      return res.status(403).json({ error: "Not allowed to create sprint" });
    }

    if (!project_id || !start_date || !end_date) {
      return res.status(400).json({
        error: "project_id, start_date and end_date are required",
      });
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

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createSprint:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getSprints = async (req, res) => {
  try {
    const { project_id } = req.query;

    let q = `
      SELECT
        s.*,
        p.name AS project_name
      FROM sprints s
      LEFT JOIN projects p ON p.id = s.project_id
    `;
    const params = [];

    if (project_id) {
      params.push(project_id);
      q += ` WHERE s.project_id = $1`;
    }

    q += ` ORDER BY s.sprint_number DESC`;

    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error("getSprints:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getSprintById = async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Sprint id is required" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        s.*,
        p.name AS project_name
      FROM sprints s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Sprint not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("getSprintById:", err);
    res.status(500).json({ error: err.message });
  }
};

export const updateSprint = async (req, res) => {
  try {
    const { id } = req.query;
    const { role, userId } = req.user;

    if (!["ADMIN", "PROJECT_MANAGER"].includes(role)) {
      return res.status(403).json({ error: "Not allowed to update sprint" });
    }

    if (!id) {
      return res.status(400).json({ error: "Sprint id is required" });
    }

    const beforeRes = await pool.query(
      "SELECT * FROM sprints WHERE id = $1",
      [id]
    );

    if (!beforeRes.rowCount) {
      return res.status(404).json({ error: "Sprint not found" });
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

    res.json(after);
  } catch (err) {
    console.error("updateSprint:", err);
    res.status(500).json({ error: err.message });
  }
};

export const deleteSprint = async (req, res) => {
  try {
    const { id } = req.query;
    const { role } = req.user;

    if (!["ADMIN", "PROJECT_MANAGER"].includes(role)) {
      return res.status(403).json({ error: "Not allowed to delete sprint" });
    }

    if (!id) {
      return res.status(400).json({ error: "Sprint id is required" });
    }

    const { rowCount } = await pool.query(
      "DELETE FROM sprints WHERE id = $1",
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ error: "Sprint not found" });
    }

    res.json({ message: "Sprint deleted successfully" });
  } catch (err) {
    console.error("deleteSprint:", err);
    res.status(500).json({ error: err.message });
  }
};
