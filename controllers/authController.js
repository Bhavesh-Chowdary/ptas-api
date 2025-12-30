import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../config/jwt.js';
import { successResponse, errorResponse } from "../utils/apiResponse.js";

const normalizeRole = (role) => {
  if (role === 'pm') return 'Project Manager';
  if (role === 'administrator') return 'admin';
  return role || 'developer';
};

export const register = async (req, res) => {
  try {
    const { full_name, email, password, role } = req.body;
    if (!email || !password || !full_name)
      return errorResponse(res, 'Missing fields', 400);

    const hashed = await bcrypt.hash(password, 10);
    const normalizedRole = normalizeRole(role);

    const q = `INSERT INTO users (full_name, email, password_hash, role)
               VALUES ($1,$2,$3,$4)
               RETURNING id, full_name, email, role`;
    const r = await pool.query(q, [full_name, email, hashed, normalizedRole]);
    successResponse(res, { user: r.rows[0] }, 201);
  } catch (err) {
    if (err.code === '23505')
      return errorResponse(res, 'Email already exists', 400);
    errorResponse(res, err.message);
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const q = `SELECT id, full_name, email, password_hash, role FROM users WHERE email = $1`;
    const r = await pool.query(q, [email]);
    if (r.rowCount === 0) return errorResponse(res, 'Invalid credentials', 401);

    const user = r.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return errorResponse(res, 'Invalid credentials', 401);

    const normalizedRole = normalizeRole(user.role);
    const payload = { userId: user.id, email: user.email, role: normalizedRole };
    const accessToken = await signAccessToken(payload);
    const refreshToken = await signRefreshToken({ userId: user.id });

    successResponse(res, {
      user: { id: user.id, full_name: user.full_name, email: user.email, role: normalizedRole },
      accessToken,
      refreshToken
    });
  } catch (err) {
    errorResponse(res, err.message);
  }
};

export const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return errorResponse(res, 'Refresh token required', 400);

    const decoded = await verifyRefreshToken(refreshToken);
    const userId = decoded.userId;

    const q = `SELECT id, email, role FROM users WHERE id = $1`;
    const r = await pool.query(q, [userId]);
    if (r.rowCount === 0) return errorResponse(res, 'User not found', 404);

    const user = r.rows[0];
    const normalizedRole = normalizeRole(user.role);
    const payload = { userId: user.id, email: user.email, role: normalizedRole };
    const newAccessToken = await signAccessToken(payload);
    const newRefreshToken = await signRefreshToken({ userId: user.id });

    successResponse(res, { accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    errorResponse(res, 'Invalid or expired refresh token', 401);
  }
};
