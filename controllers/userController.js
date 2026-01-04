import pool from '../config/db.js';
import { successResponse, errorResponse } from "../utils/apiResponse.js";

export const getUsers = async (req, res) => {
  try {
    let q = `
      SELECT id, full_name, email, role, is_active, created_at
      FROM users
      ORDER BY full_name
    `;
    const result = await pool.query(q);
    successResponse(res, result.rows);
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const getAssignableUsers = async (req, res) => {
  try {
    const q = `
      SELECT id, full_name, email, role
      FROM users
      WHERE role IN ('developer','qa')
        AND is_active=true
      ORDER BY full_name
    `;
    const { rows } = await pool.query(q);
    successResponse(res, rows);
  } catch (err) {
    errorResponse(res, err.message);
  }
};
export const getSupervisors = async (req, res) => {
  try {
    const q = `
      SELECT id, full_name, email, role
      FROM users
      WHERE role IN ('admin', 'Project Manager')
        AND is_active=true
      ORDER BY full_name
    `;
    const { rows } = await pool.query(q);
    successResponse(res, rows);
  } catch (err) {
    errorResponse(res, err.message);
  }
};
