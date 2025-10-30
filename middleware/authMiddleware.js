import { verifyAccessToken } from '../config/jwt.js';

export const authMiddleware = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer '))
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });

    const token = header.split(' ')[1];
    const payload = await verifyAccessToken(token);

    req.user = payload; // { userId, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized or expired token' });
  }
};
