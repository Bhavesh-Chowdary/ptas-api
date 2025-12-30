import pool from "../config/db.js";
import { logChange } from "./changeLogController.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";

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
    successResponse(res, rows);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/* ---------------- CREATE ---------------- */

export const createModule = async (req, res) => {
  try {
    const { role, userId } = req.user;
    if (!allowed(role))
      return errorResponse(res, "Locked", 403);

    const { project_id, name } = req.body;
    if (!project_id || !name || !name.trim())
      return errorResponse(res, "Invalid module", 400);

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

    /* ---- CHANGE LOG ---- */

    successResponse(res, rows[0], 201);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/* ---------------- UPDATE ---------------- */

export const updateModule = async (req, res) => {
  try {
    const { role, userId } = req.user;
    if (!allowed(role))
      return errorResponse(res, "Locked", 403);

    const id = req.params.id || req.query.id;
    const { name } = req.body;

    if (!name || !name.trim())
      return errorResponse(res, "Invalid name", 400);

    /* ---- BEFORE ---- */
    const beforeRes = await pool.query(
      `SELECT * FROM modules WHERE id=$1`,
      [id]
    );
    if (!beforeRes.rowCount)
      return errorResponse(res, "Module not found", 404);

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

    /* ---- CHANGE LOG ---- */

    successResponse(res, rows[0]);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/* ---------------- DELETE ---------------- */

export const deleteModule = async (req, res) => {
  try {
    const { role, userId } = req.user;
    if (!allowed(role))
      return errorResponse(res, "Locked", 403);

    const id = req.params.id || req.query.id;

    /* ---- BEFORE ---- */
    const beforeRes = await pool.query(
      `SELECT * FROM modules WHERE id=$1`,
      [id]
    );
    if (!beforeRes.rowCount)
      return errorResponse(res, "Module not found", 404);

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

    /* ---- CHANGE LOG ---- */

    successResponse(res, { message: "Deleted" });
  } catch (err) {
    errorResponse(res, err.message);
  }
};

/* ---------------- GET BY ID ---------------- */

export const getModuleById = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const q = `
      SELECT m.*, p.name AS project_name
      FROM modules m
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.id = $1
    `;
    const result = await pool.query(q, [id]);

    if (result.rowCount === 0)
      return errorResponse(res, "Module not found", 404);

    successResponse(res, result.rows[0]);
  } catch (err) {
    errorResponse(res, err.message);
  }
};