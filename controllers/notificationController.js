import db from "../config/knex.js";

/**
 * Initialize Notifications Table
 */
export const initNotificationsTable = async () => {
    const query = `
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    -- Handle schema change from INTEGER to UUID
    DO $$ 
    BEGIN 
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'user_id' AND data_type = 'integer') THEN
        DROP TABLE notifications;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      title VARCHAR(255),
      message TEXT,
      data JSONB,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
    try {
        await db.raw(query);
        console.log("Notifications table ensured.");
    } catch (err) {
        console.error("Error creating notifications table:", err);
    }
};

/**
 * Get notifications for a user
 * Also refreshes automatic reminders
 */
export const getNotifications = async (req, res) => {
    try {
        const { userId, role } = req.user;

        // Refresh automatic reminders before fetching
        await refreshAutomaticReminders(userId, role);

        const rows = await db("notifications as n")
            .leftJoin("users as u", "n.sender_id", "u.id")
            .leftJoin("projects as p", "n.project_id", "p.id")
            .where("n.user_id", userId)
            .select("n.*", "u.full_name as sender_name", "p.name as project_name", "p.color as project_color")
            .orderBy("n.created_at", "desc")
            .limit(50);

        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error("Get Notifications Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};

/**
 * Mark notification as read
 */
export const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.user;
        await db("notifications").where({ id, user_id: userId }).update({ is_read: true });
        return res.status(200).json({ success: true, data: { message: "Notification marked as read" } });
    } catch (err) {
        console.error("Mark As Read Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};

/**
 * Mark all notifications as read
 */
export const markAllAsRead = async (req, res) => {
    try {
        const { userId } = req.user;
        await db("notifications").where({ user_id: userId }).update({ is_read: true });
        return res.status(200).json({ success: true, data: { message: "All notifications marked as read" } });
    } catch (err) {
        console.error("Mark All As Read Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};

/**
 * Push a manual reminder
 */
export const pushReminder = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const { recipient_ids, message, project_id, task_id } = req.body;

        if (!["admin", "Project Manager"].includes(role)) {
            return res.status(403).json({ success: false, error: "Only PMs or Admins can push reminders" });
        }

        if (!recipient_ids || !message) {
            return res.status(400).json({ success: false, error: "Recipients and message are required" });
        }

        const recipients = Array.isArray(recipient_ids) ? recipient_ids : [recipient_ids];
        let finalRecipients = recipients;

        if (recipients.includes("everyone") || recipients.includes("@everyone")) {
            const allUsers = await db("users").select("id").where({ is_active: true });
            finalRecipients = allUsers.map(u => u.id);
        }

        const notifications = finalRecipients.filter(rid => rid).map(rid => ({
            user_id: rid,
            sender_id: userId,
            project_id: project_id || null,
            type: 'tag',
            title: 'New Reminder',
            message: message,
            data: JSON.stringify({ task_id })
        }));

        if (notifications.length > 0) {
            await db("notifications").insert(notifications);
        }

        return res.status(200).json({ success: true, data: { message: "Reminders pushed successfully" } });
    } catch (err) {
        console.error("Push Reminder Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};

/**
 * Refresh Overdue Task and Sprint End reminders
 */
const refreshAutomaticReminders = async (userId, role) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // 1. Overdue Task Reminders
        // Only for task owner and collaborators
        const overdueTasks = await db("tasks as t")
            .join("projects as p", "t.project_id", "p.id")
            .whereNot("t.status", "done")
            .andWhere("t.end_date", "<", today)
            .andWhere(function () {
                this.where("t.assignee_id", userId).orWhereExists(function () {
                    this.select(db.raw(1)).from("task_collaborators as tc").whereRaw("tc.task_id = t.id").andWhere("tc.user_id", userId);
                });
            })
            .select("t.id", "t.title", "t.project_id", "t.end_date", "p.name as project_name");

        for (const task of overdueTasks) {
            const type = "overdue_task";

            const exists = await db("notifications")
                .where({ user_id: userId, type, is_read: false })
                .andWhere(db.raw("data->>'task_id' = ?", [task.id.toString()]))
                .first();

            if (!exists) {
                await db("notifications").insert({
                    user_id: userId,
                    project_id: task.project_id,
                    type,
                    title: "Task Overdue",
                    message: `${task.title} overdue please complete`,
                    data: JSON.stringify({ task_id: task.id })
                });
            }
        }

        // 2. Sprint End Reminders (for PMs)
        if (role === "Project Manager" || role === "admin") {
            const sprintsEnding = await db("sprints as s")
                .join("projects as p", "s.project_id", "p.id")
                .where("s.end_date", ">=", today)
                .andWhere("s.end_date", "<=", db.raw("(?::date + interval '2 days')", [today]))
                .whereExists(function () {
                    this.select(db.raw(1)).from("tasks as t").whereRaw("t.sprint_id = s.id").andWhereNot("t.status", "done");
                })
                .select("s.id", "s.name", "s.project_id", "s.end_date", "p.name as project_name");

            for (const sprint of sprintsEnding) {
                const type = "sprint_end";

                const exists = await db("notifications")
                    .where({ user_id: userId, type, is_read: false })
                    .andWhere(db.raw("data->>'sprint_id' = ?", [sprint.id.toString()]))
                    .first();

                if (!exists) {
                    await db("notifications").insert({
                        user_id: userId,
                        project_id: sprint.project_id,
                        type,
                        title: "Sprint Ending Soon",
                        message: `Tasks pending in ${sprint.name}`,
                        data: JSON.stringify({ sprint_id: sprint.id })
                    });
                }
            }
        }
    } catch (err) {
        console.error("refreshAutomaticReminders error:", err);
    }
};
