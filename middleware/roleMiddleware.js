// Canonical Roles: 'admin', 'Project Manager', 'developer', 'qa'
export const permit = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Normalize user role from legacy values if not already normal
    let userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'pm' || userRole === 'project manager') userRole = 'Project Manager';
    else if (userRole === 'administrator' || userRole === 'admin') userRole = 'admin';
    else if (userRole === 'developer') userRole = 'Developer';
    else if (userRole === 'qa') userRole = 'QA';
    else userRole = userRole.charAt(0).toUpperCase() + userRole.slice(1);

    const normalizedAllowed = allowedRoles.map(r => {
      const low = r.toLowerCase();
      if (low === 'pm' || low === 'project manager') return 'Project Manager';
      if (low === 'developer') return 'Developer';
      if (low === 'admin') return 'admin';
      if (low === 'qa') return 'QA';
      return r;
    });

    if (!normalizedAllowed.includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
};
