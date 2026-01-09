import pool from "../config/db.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";

/**
 * GET /dashboard/active-projects
 * Rules: PM/Admin -> all projects; Developer -> projects he belongs to
 */
export const getActiveProjects = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        let q = `
      SELECT p.*, 
        COUNT(t.id) as total_tasks,
        COUNT(t.id) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')) as completed_tasks,
        COALESCE(SUM(t.potential_points), 0) as total_points,
        COALESCE(SUM(t.potential_points) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')), 0) as completed_points
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.status = 'active'
    `;
        const params = [];

        if (!isAdmin) {
            q += ` AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1)`;
            params.push(userId);
        }

        q += ` GROUP BY p.id ORDER BY p.created_at DESC`;

        const { rows } = await pool.query(q, params);
        successResponse(res, rows);
    } catch (err) {
        errorResponse(res, err.message);
    }
};

/**
 * GET /dashboard/active-sprints
 * Rules: PM/Admin -> all active sprints; Developer -> sprints of his projects
 */
export const getActiveSprints = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        let q = `
      SELECT s.*, p.name as project_name, p.color as project_color,
        (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id) as total_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id AND LOWER(t.status) IN ('done', 'completed')) as completed_tasks,
        (SELECT COALESCE(SUM(potential_points), 0) FROM tasks t WHERE t.sprint_id = s.id) as total_points,
        (SELECT COALESCE(SUM(potential_points), 0) FROM tasks t WHERE t.sprint_id = s.id AND LOWER(t.status) IN ('done', 'completed')) as completed_points
      FROM sprints s
      JOIN projects p ON p.id = s.project_id
      WHERE s.status = 'active'
    `;
        const params = [];

        if (!isAdmin) {
            q += ` AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1)`;
            params.push(userId);
        }

        q += ` ORDER BY s.end_date ASC`;

        const { rows } = await pool.query(q, params);
        successResponse(res, rows);
    } catch (err) {
        errorResponse(res, err.message);
    }
};

/**
 * GET /dashboard/upcoming-deadlines
 * Rules: Tasks with end_date >= today, sorted ascending, limit 10
 */
export const getUpcomingDeadlines = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        let q = `
      SELECT t.*, p.name as project_name, u.full_name as assignee_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.end_datetime >= CURRENT_DATE
      AND t.status != 'done'
    `;
        const params = [];

        if (!isAdmin) {
            q += ` AND (t.assignee_id = $1 OR EXISTS (SELECT 1 FROM task_collaborators tc WHERE tc.task_id = t.id AND tc.user_id = $1))`;
            params.push(userId);
        }

        q += ` ORDER BY t.end_datetime ASC NULLS LAST LIMIT 10`;

        const { rows } = await pool.query(q, params);
        successResponse(res, rows);
    } catch (err) {
        errorResponse(res, err.message);
    }
};

/**
 * GET /dashboard/timeline
 * PM/Admin: All developers, their tasks
 * Developer: Only his own tasks
 */
export const getTimelineData = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        let userQuery = `SELECT id, full_name FROM users`;
        const userParams = [];

        if (!isAdmin) {
            userQuery += ` WHERE id = $1`;
            userParams.push(userId);
        }

        const { rows: users } = await pool.query(userQuery, userParams);

        const timeline = await Promise.all(users.map(async (u) => {
            const { rows: tasks } = await pool.query(`
        SELECT 
          id as task_id, 
          title, 
          COALESCE(in_progress_at, start_datetime, created_at) as start,
          COALESCE(completed_at, end_datetime) as end,
          status,
          task_code
        FROM tasks
        WHERE assignee_id = $1
        AND (status = 'in_progress' OR status = 'done' OR (start_datetime IS NOT NULL AND end_datetime IS NOT NULL))
        ORDER BY start ASC
      `, [u.id]);

            return {
                user: u.full_name,
                tasks: tasks.map(t => ({
                    task_id: t.task_code || t.task_id,
                    title: t.title,
                    start: t.start,
                    end: t.status === 'in_progress' ? null : t.end,
                    status: t.status
                }))
            };
        }));

        // Filter out users with no relevant tasks for cleaner Gantt if PM
        const filteredTimeline = isAdmin ? timeline.filter(item => item.tasks.length > 0) : timeline;

        successResponse(res, isAdmin ? filteredTimeline : filteredTimeline[0]);
    } catch (err) {
        console.error("getTimelineData error:", err);
        errorResponse(res, err.message);
    }
};
/**
 * GET /dashboard/weekly-stats
 * Returns total vs completed tasks for the last 7 days
 */
export const getWeeklyStats = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toISOString().split('T')[0]);
        }

        const stats = await Promise.all(days.map(async (date) => {
            let totalQ = `SELECT COUNT(*) FROM tasks WHERE created_at::date <= $1`;
            let completedQ = `SELECT COUNT(*) FROM tasks WHERE status = 'done' AND completed_at::date = $1`;
            const params = [date];

            if (!isAdmin) {
                totalQ += ` AND (assignee_id = $2 OR EXISTS (SELECT 1 FROM task_collaborators tc WHERE tc.task_id = tasks.id AND tc.user_id = $2))`;
                completedQ += ` AND (assignee_id = $2 OR EXISTS (SELECT 1 FROM task_collaborators tc WHERE tc.task_id = tasks.id AND tc.user_id = $2))`;
                params.push(userId);
            }

            const { rows: tRows } = await pool.query(totalQ, params);
            const { rows: cRows } = await pool.query(completedQ, params);

            return {
                day: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
                date,
                today: parseInt(tRows[0].count),
                completed: parseInt(cRows[0].count)
            };
        }));

        successResponse(res, stats);
    } catch (err) {
        console.error("getWeeklyStats error:", err);
        errorResponse(res, err.message);
    }
};

/**
 * GET /dashboard/team-workload
 * Returns team workload balance - active tasks and points per team member
 * Note: Project Managers are excluded from task assignments as they manage projects
 */
export const getTeamWorkload = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        // Only PM/Admin can view team workload
        if (!isAdmin) {
            return errorResponse(res, "Access denied. Only Project Managers and Admins can view team workload.", 403);
        }

        const q = `
            SELECT 
                u.id, 
                u.full_name as name, 
                u.role, 
                u.email,
                COUNT(t.id) as active_tasks,
                COALESCE(SUM(t.potential_points), 0) as total_points
            FROM users u
            LEFT JOIN tasks t ON t.assignee_id = u.id 
                AND LOWER(t.status) NOT IN ('done', 'completed', 'cancelled')
            WHERE u.is_active = true 
                AND u.role != 'Project Manager'
            GROUP BY u.id, u.full_name, u.role, u.email
            ORDER BY active_tasks DESC, total_points DESC
        `;

        const { rows } = await pool.query(q);

        // Add workload classification
        const workloadData = rows.map(member => {
            let workloadStatus = 'balanced';
            if (member.active_tasks >= 4 || member.total_points >= 12) {
                workloadStatus = 'overloaded';
            } else if (member.active_tasks === 0) {
                workloadStatus = 'underutilized';
            }

            return {
                ...member,
                workload_status: workloadStatus
            };
        });

        successResponse(res, workloadData);
    } catch (err) {
        console.error("getTeamWorkload error:", err);
        errorResponse(res, err.message);
    }
};
