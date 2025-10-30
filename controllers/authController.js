import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../config/jwt.js';

export const register = async (req, res) => {
  try {
    const { full_name, email, password, role } = req.body;
    if (!email || !password || !full_name)
      return res.status(400).json({ error: 'Missing fields' });

    const hashed = await bcrypt.hash(password, 10);
    const q = `INSERT INTO users (full_name, email, password_hash, role)
               VALUES ($1,$2,$3,$4)
               RETURNING id, full_name, email, role`;
    const r = await pool.query(q, [full_name, email, hashed, role || 'developer']);
    res.status(201).json({ user: r.rows[0] });
  } catch (err) {
    if (err.code === '23505')
      return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const q = `SELECT id, full_name, email, password_hash, role FROM users WHERE email = $1`;
    const r = await pool.query(q, [email]);
    if (r.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = r.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const payload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = await signAccessToken(payload);
    const refreshToken = await signRefreshToken({ userId: user.id });

    res.json({
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
      accessToken,
      refreshToken
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const decoded = await verifyRefreshToken(refreshToken);
    const userId = decoded.userId;

    const q = `SELECT id, email, role FROM users WHERE id = $1`;
    const r = await pool.query(q, [userId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'User not found' });

    const user = r.rows[0];
    const payload = { userId: user.id, email: user.email, role: user.role };
    const newAccessToken = await signAccessToken(payload);
    const newRefreshToken = await signRefreshToken({ userId: user.id });

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
};
