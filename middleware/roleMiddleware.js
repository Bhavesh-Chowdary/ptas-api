// Canonical Roles: 'admin', 'Project Manager', 'developer', 'qa'
export const permit = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Normalize user role from legacy values if not already normal
    let userRole = req.user.role;
    if (userRole === 'pm') userRole = 'Project Manager';
    if (userRole === 'administrator') userRole = 'admin';

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
};
