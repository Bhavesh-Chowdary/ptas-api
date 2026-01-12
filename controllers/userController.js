import db from "../config/knex.js";

export const getUsers = async (req, res) => {
  try {
    const users = await db('users')
      .select('id', 'full_name', 'email', 'role', 'is_active', 'created_at')
      .orderBy('full_name');
    return res.status(200).json({ success: true, data: users });
  } catch (err) {
    console.error("Get Users Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getAssignableUsers = async (req, res) => {
  try {
    const users = await db('users')
      .select('id', 'full_name', 'email', 'role')
      .whereIn('role', ['developer', 'qa'])
      .andWhere({ is_active: true })
      .orderBy('full_name');
    return res.status(200).json({ success: true, data: users });
  } catch (err) {
    console.error("Get Assignable Users Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getSupervisors = async (req, res) => {
  try {
    const users = await db('users')
      .select('id', 'full_name', 'email', 'role')
      .whereIn('role', ['admin', 'Project Manager'])
      .andWhere({ is_active: true })
      .orderBy('full_name');
    return res.status(200).json({ success: true, data: users });
  } catch (err) {
    console.error("Get Supervisors Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const savePlayerId = async (req, res) => {
  try {
    const { userId } = req.user;
    const { playerId } = req.body;

    await db("users")
      .where({ id: userId })
      .update({ onesignal_player_id: playerId });

    return res.json({ success: true });
  } catch (err) {
    console.error("Save Player ID Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
