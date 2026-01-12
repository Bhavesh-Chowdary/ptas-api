import { verifyAccessToken } from '../config/jwt.js';

export const authMiddleware = async (req, res, next) => {
  try {
    let token = null;
    const header = req.headers.authorization;

    if (header && header.startsWith('Bearer ')) {
      token = header.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token)
      return res.status(401).json({ error: 'Missing or invalid Authorization header or token param' });

    const payload = await verifyAccessToken(token);

    req.user = payload; // { userId, email, role }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized or expired token' });
  }
};
