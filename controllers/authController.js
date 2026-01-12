import db from '../config/knex.js';
import bcrypt from 'bcrypt';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../config/jwt.js';

export const register = async (req, res) => {
  try {
    const { full_name, email, password, role } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const hashed = await bcrypt.hash(password, 10);
    // Use role directly or fallback to 'developer'
    const finalRole = role || 'developer';

    const [user] = await db('users').insert({
      full_name,
      email,
      password_hash: hashed,
      role: finalRole
    }).returning(['id', 'full_name', 'email', 'role']);

    return res.status(201).json({ success: true, data: { user } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ success: false, error: 'Email already exists' });
    }
    console.error("Register Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const user = await db('users').where({ email }).first();

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const role = user.role;
    const payload = { userId: user.id, email: user.email, role };
    const accessToken = await signAccessToken(payload);
    const refreshToken = await signRefreshToken({ userId: user.id });

    return res.status(200).json({
      success: true,
      data: {
        user: { id: user.id, full_name: user.full_name, email: user.email, role },
        accessToken,
        refreshToken
      }
    });
  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Refresh token required' });
    }

    const decoded = await verifyRefreshToken(refreshToken);
    const userId = decoded.userId;

    const user = await db('users').where({ id: userId }).first();
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const role = user.role;
    const payload = { userId: user.id, email: user.email, role };
    const newAccessToken = await signAccessToken(payload);
    const newRefreshToken = await signRefreshToken({ userId: user.id });

    return res.status(200).json({ success: true, data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    console.error("Refresh Token Error:", err);
    return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
  }
};
