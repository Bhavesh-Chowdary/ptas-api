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
    console.log('[SavePlayerId] Request received');
    console.log('[SavePlayerId] User:', req.user);
    console.log('[SavePlayerId] Body:', req.body);

    const { userId } = req.user;
    const { playerId } = req.body;

    if (!userId) {
      console.error('[SavePlayerId] No userId found in request');
      return res.status(400).json({ success: false, error: "User ID not found" });
    }

    if (!playerId) {
      console.error('[SavePlayerId] No playerId provided');
      return res.status(400).json({ success: false, error: "Player ID not provided" });
    }

    console.log(`[SavePlayerId] Updating user ${userId} with player ID: ${playerId}`);

    const result = await db("users")
      .where({ id: userId })
      .update({ onesignal_player_id: playerId });

    console.log('[SavePlayerId] Update result:', result);

    // Verify the update
    const user = await db("users")
      .where({ id: userId })
      .select('id', 'full_name', 'onesignal_player_id')
      .first();

    console.log('[SavePlayerId] Updated user:', user);

    return res.json({ success: true, data: { playerId, user } });
  } catch (err) {
    console.error("[SavePlayerId] Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
};
