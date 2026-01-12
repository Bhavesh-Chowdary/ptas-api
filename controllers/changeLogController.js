import db from "../config/knex.js";
import { generateActivityMessage } from "../utils/activityHelper.js";

/* ================= WRITE LOG ================= */

export const logChange = async (
  entity_type,
  entity_id,
  action,
  beforeData,
  afterData,
  user_id
) => {
  try {
    await db('change_logs').insert({
      entity_type,
      entity_id,
      action,
      before_data: JSON.stringify(beforeData),
      after_data: JSON.stringify(afterData),
      changed_by: user_id
    });
  } catch (err) {
    console.error("Change log failed:", err.message);
  }
};

/* ================= READ LOGS ================= */

const formatLog = (log) => {
  const meta = {};
  if (log.entity_type === 'task' && log.action === 'updated') {
    if (log.before_data?.status !== log.after_data?.status) {
      meta.from_status = log.before_data?.status;
      meta.to_status = log.after_data?.status;
    }
  }

  return {
    id: log.id,
    type: log.entity_type,
    action: log.action,
    entity_id: log.after_data?.task_code || log.after_data?.project_code || log.entity_id,
    message: generateActivityMessage(log),
    user_name: log.user_name || "Unknown User",
    user_id: log.changed_by,
    user: {
      id: log.changed_by,
      name: log.user_name || "Unknown User"
    },
    project_name: log.after_data?.project_name || log.before_data?.project_name || null,
    module_name: log.after_data?.module_name || log.before_data?.module_name || null,
    meta: Object.keys(meta).length > 0 ? meta : (log.after_data || {}),
    changed_at: log.changed_at,
    created_at: log.changed_at
  };
};

export const getChangeLogs = async (req, res) => {
  try {
    const { entity_type, entity_id, project_id, sprint_id, member_id, start_date, end_date } = req.query;

    let query = db('change_logs as c')
      .leftJoin('users as u', 'u.id', 'c.changed_by')
      .select('c.*', 'u.full_name AS user_name')
      .orderBy('c.changed_at', 'desc');

    if (entity_type) query = query.where('c.entity_type', entity_type);
    if (entity_id) query = query.where('c.entity_id', entity_id);
    if (member_id && member_id !== 'all') query = query.where('c.changed_by', member_id);

    if (project_id && project_id !== 'all') {
      query = query.where(function () {
        this.where(function () {
          this.where('c.entity_type', 'project').andWhere('c.entity_id', project_id);
        }).orWhere(db.raw("c.after_data->>'project_id' = ?", [project_id]))
          .orWhere(db.raw("c.before_data->>'project_id' = ?", [project_id]));
      });
    }

    if (sprint_id && sprint_id !== 'all') {
      query = query.where(function () {
        this.where(function () {
          this.where('c.entity_type', 'sprint').andWhere('c.entity_id', sprint_id);
        }).orWhere(db.raw("c.after_data->>'sprint_id' = ?", [sprint_id]))
          .orWhere(db.raw("c.before_data->>'sprint_id' = ?", [sprint_id]));
      });
    }

    if (start_date) query = query.where('c.changed_at', '>=', start_date);
    if (end_date) query = query.where('c.changed_at', '<=', end_date);

    const logs = await query;
    return res.status(200).json({ success: true, data: logs.map(formatLog) });
  } catch (err) {
    console.error("Get Change Logs Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/**
 * 1️⃣ Project-Scoped Activity
 */
export const getProjectActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.user;
    const isAdmin = ["admin", "Project Manager"].includes(role);

    let query = db('change_logs as cl')
      .leftJoin('users as u', 'u.id', 'cl.changed_by')
      .where(function () {
        this.where(function () {
          this.where('cl.entity_type', 'project').andWhere('cl.entity_id', id);
        }).orWhere(function () {
          this.whereIn('cl.entity_type', ['task', 'module', 'sprint'])
            .andWhere(function () {
              this.whereRaw("(cl.before_data->>'project_id')::uuid = ?", [id])
                .orWhereRaw("(cl.after_data->>'project_id')::uuid = ?", [id]);
            });
        });
      })
      .where('cl.changed_at', '>=', db.raw("NOW() - INTERVAL '2 days'"))
      .select('cl.*', 'u.full_name AS user_name', 'u.role AS user_role')
      .orderBy('cl.changed_at', 'desc')
      .limit(20);

    if (!isAdmin) {
      query = query.where(function () {
        this.whereNull('u.role').orWhereNotIn('u.role', ['admin', 'Project Manager']);
      });
    }

    const rows = await query;
    return res.status(200).json({ success: true, data: rows.map(formatLog) });
  } catch (err) {
    console.error("Get Project Activity Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/**
 * 2️⃣ Global Activity
 */
export const getGlobalActivity = async (req, res) => {
  try {
    const { userId, role } = req.user;
    const isAdmin = ["admin", "Project Manager"].includes(role);

    let query = db('change_logs as cl')
      .leftJoin('users as u', 'u.id', 'cl.changed_by')
      .where('cl.changed_at', '>=', db.raw("NOW() - INTERVAL '2 days'"))
      .select('cl.*', 'u.full_name AS user_name', 'u.role AS user_role')
      .orderBy('cl.changed_at', 'desc')
      .limit(50);

    if (!isAdmin) {
      query = query.whereNotIn('u.role', ['admin', 'Project Manager']).andWhere(function () {
        this.where('cl.changed_by', userId)
          .orWhere(function () {
            this.where('cl.entity_type', 'task')
              .andWhere(function () {
                this.whereRaw("cl.after_data->>'assignee_id' = ?", [userId])
                  .orWhereRaw("cl.before_data->>'assignee_id' = ?", [userId]);
              });
          })
          .orWhere(function () {
            this.where('cl.entity_type', 'project').whereIn('cl.entity_id', db('project_members').select('project_id').where('user_id', userId));
          })
          .orWhere(function () {
            this.whereIn('cl.entity_type', ['task', 'module', 'sprint'])
              .whereIn(db.raw("(cl.after_data->>'project_id')::uuid"), db('project_members').select('project_id').where('user_id', userId))
              .orWhereIn(db.raw("(cl.before_data->>'project_id')::uuid"), db('project_members').select('project_id').where('user_id', userId));
          });
      });
    }

    const rows = await query;
    return res.status(200).json({ success: true, data: rows.map(formatLog) });
  } catch (err) {
    console.error("Get Global Activity Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/**
 * 3️⃣ Sprint-Scoped Activity
 */
export const getSprintActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.user;
    const isAdmin = ["admin", "Project Manager"].includes(role);

    let query = db('change_logs as cl')
      .leftJoin('users as u', 'u.id', 'cl.changed_by')
      .where(function () {
        this.where(function () {
          this.where('cl.entity_type', 'sprint').andWhere('cl.entity_id', id);
        }).orWhere(function () {
          this.where('cl.entity_type', 'task')
            .andWhere(function () {
              this.whereRaw("(cl.before_data->>'sprint_id')::uuid = ?", [id])
                .orWhereRaw("(cl.after_data->>'sprint_id')::uuid = ?", [id]);
            });
        });
      })
      .where('cl.changed_at', '>=', db.raw("NOW() - INTERVAL '2 days'"))
      .select('cl.*', 'u.full_name AS user_name', 'u.role AS user_role')
      .orderBy('cl.changed_at', 'desc')
      .limit(20);

    if (!isAdmin) {
      query = query.where(function () {
        this.whereNull('u.role').orWhereNotIn('u.role', ['admin', 'Project Manager']);
      });
    }

    const rows = await query;
    return res.status(200).json({ success: true, data: rows.map(formatLog) });
  } catch (err) {
    console.error("Get Sprint Activity Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
