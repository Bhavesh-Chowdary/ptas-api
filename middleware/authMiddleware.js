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

    // Normalize Role Immediately to consistent Title Case for controllers
    let userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'pm' || userRole === 'project manager') {
      req.user.role = 'Project Manager';
    } else if (userRole === 'administrator' || userRole === 'admin') {
      req.user.role = 'admin';
    } else if (userRole === 'developer') {
      req.user.role = 'Developer';
    } else if (userRole === 'qa') {
      req.user.role = 'QA';
    } else {
      req.user.role = userRole.charAt(0).toUpperCase() + userRole.slice(1);
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized or expired token' });
  }
};
