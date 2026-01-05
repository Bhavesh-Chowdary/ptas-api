import pool from "../config/db.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";

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
        await pool.query(query);
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

        const q = `
      SELECT 
        n.*, 
        u.full_name as sender_name,
        p.name as project_name,
        p.color as project_color
      FROM notifications n
      LEFT JOIN users u ON n.sender_id = u.id
      LEFT JOIN projects p ON n.project_id = p.id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT 50
    `;
        const { rows } = await pool.query(q, [userId]);
        successResponse(res, rows);
    } catch (err) {
        console.error("getNotifications error:", err);
        errorResponse(res, err.message);
    }
};

/**
 * Mark notification as read
 */
export const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.user;
        await pool.query(
            "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2",
            [id, userId]
        );
        successResponse(res, { message: "Notification marked as read" });
    } catch (err) {
        errorResponse(res, err.message);
    }
};

/**
 * Mark all notifications as read
 */
export const markAllAsRead = async (req, res) => {
    try {
        const { userId } = req.user;
        await pool.query(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = $1",
            [userId]
        );
        successResponse(res, { message: "All notifications marked as read" });
    } catch (err) {
        errorResponse(res, err.message);
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
            return errorResponse(res, "Only PMs or Admins can push reminders", 403);
        }

        if (!recipient_ids || !message) {
            return errorResponse(res, "Recipients and message are required", 400);
        }

        const recipients = Array.isArray(recipient_ids) ? recipient_ids : [recipient_ids];

        // Handle @everyone
        let finalRecipients = recipients;
        if (recipients.includes("everyone") || recipients.includes("@everyone")) {
            const allUsers = await pool.query("SELECT id FROM users WHERE is_active = true");
            finalRecipients = allUsers.rows.map(u => u.id);
        }

        for (const rid of finalRecipients) {
            if (!rid) continue;
            await pool.query(
                `INSERT INTO notifications (user_id, sender_id, project_id, type, title, message, data)
         VALUES ($1, $2, $3, 'tag', 'New Reminder', $4, $5)`,
                [rid, userId, project_id || null, message, JSON.stringify({ task_id })]
            );
        }

        successResponse(res, { message: "Reminders pushed successfully" });
    } catch (err) {
        errorResponse(res, err.message);
    }
};

/**
 * Refresh Overdue Task and Sprint End reminders
 */
const refreshAutomaticReminders = async (userId, role) => {
    const today = new Date().toISOString().split('T')[0];

    // 1. Overdue Task Reminders
    // Only for task owner and collaborators
    const overdueQuery = `
    SELECT t.id, t.title, t.project_id, t.end_date, p.name as project_name
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status != 'done' 
      AND t.end_date < $1
      AND (t.assignee_id = $2 OR EXISTS (
        SELECT 1 FROM task_collaborators tc WHERE tc.task_id = t.id AND tc.user_id = $2
      ))
  `;
    const { rows: overdueTasks } = await pool.query(overdueQuery, [today, userId]);

    for (const task of overdueTasks) {
        const title = "Task Overdue";
        const message = `${task.title} overdue please complete`;
        const type = "overdue_task";

        // Check if notification already exists for this task today to avoid spamming
        // We'll just check if an unread one exists for this task
        const exists = await pool.query(
            "SELECT 1 FROM notifications WHERE user_id = $1 AND type = $2 AND data->>'task_id' = $3 AND is_read = FALSE",
            [userId, type, task.id.toString()]
        );

        if (!exists.rowCount) {
            await pool.query(
                `INSERT INTO notifications (user_id, project_id, type, title, message, data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
                [userId, task.project_id, type, title, message, JSON.stringify({ task_id: task.id })]
            );
        }
    }

    // 2. Sprint End Reminders (for PMs)
    if (role === "Project Manager" || role === "admin") {
        // Sprint ends in 1 or 2 days
        const sprintQuery = `
      SELECT s.id, s.name, s.project_id, s.end_date, p.name as project_name
      FROM sprints s
      JOIN projects p ON s.project_id = p.id
      WHERE s.end_date >= $1 
        AND s.end_date <= ($1::date + interval '2 days')
        AND EXISTS (SELECT 1 FROM tasks t WHERE t.sprint_id = s.id AND t.status != 'done')
    `;
        const { rows: sprintsEnding } = await pool.query(sprintQuery, [today]);

        for (const sprint of sprintsEnding) {
            const title = "Sprint Ending Soon";
            const message = `Tasks pending in ${sprint.name}`;
            const type = "sprint_end";

            const exists = await pool.query(
                "SELECT 1 FROM notifications WHERE user_id = $1 AND type = $2 AND data->>'sprint_id' = $3 AND is_read = FALSE",
                [userId, type, sprint.id.toString()]
            );

            if (!exists.rowCount) {
                await pool.query(
                    `INSERT INTO notifications (user_id, project_id, type, title, message, data)
           VALUES ($1, $2, $3, $4, $5, $6)`,
                    [userId, sprint.project_id, type, title, message, JSON.stringify({ sprint_id: sprint.id })]
                );
            }
        }
    }
};
