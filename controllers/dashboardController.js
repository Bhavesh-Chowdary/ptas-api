import db from "../config/knex.js";

/**
 * GET /dashboard/active-projects
 */
export const getActiveProjects = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        let query = db("projects as p")
            .leftJoin("tasks as t", "t.project_id", "p.id")
            .where("p.status", "active")
            .select(
                "p.*",
                db.raw("COUNT(t.id) as total_tasks"),
                db.raw("COUNT(t.id) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')) as completed_tasks"),
                db.raw("COALESCE(SUM(t.potential_points), 0) as total_points"),
                db.raw("COALESCE(SUM(t.potential_points) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')), 0) as completed_points")
            )
            .groupBy("p.id")
            .orderBy("p.created_at", "desc");

        if (!isAdmin) {
            query = query.whereExists(function () {
                this.select(db.raw(1)).from("project_members as pm").whereRaw("pm.project_id = p.id").where("pm.user_id", userId);
            });
        }

        const projects = await query;
        return res.status(200).json({ success: true, data: projects });
    } catch (err) {
        console.error("Get Active Projects Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};

/**
 * GET /dashboard/active-sprints
 */
export const getActiveSprints = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        let query = db("sprints as s")
            .join("projects as p", "p.id", "s.project_id")
            .where("s.status", "active")
            .select(
                "s.*", "p.name as project_name", "p.color as project_color",
                db.raw("(SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id) as total_tasks"),
                db.raw("(SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id AND LOWER(t.status) IN ('done', 'completed')) as completed_tasks"),
                db.raw("(SELECT COALESCE(SUM(potential_points), 0) FROM tasks t WHERE t.sprint_id = s.id) as total_points"),
                db.raw("(SELECT COALESCE(SUM(potential_points), 0) FROM tasks t WHERE t.sprint_id = s.id AND LOWER(t.status) IN ('done', 'completed')) as completed_points")
            )
            .orderBy("s.end_date", "asc");

        if (!isAdmin) {
            query = query.whereExists(function () {
                this.select(db.raw(1)).from("project_members as pm").whereRaw("pm.project_id = p.id").where("pm.user_id", userId);
            });
        }

        const sprints = await query;
        return res.status(200).json({ success: true, data: sprints });
    } catch (err) {
        console.error("Get Active Sprints Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};

/**
 * GET /dashboard/upcoming-deadlines
 */
export const getUpcomingDeadlines = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        let query = db("tasks as t")
            .join("projects as p", "p.id", "t.project_id")
            .leftJoin("users as u", "u.id", "t.assignee_id")
            .where("t.end_datetime", ">=", db.fn.now())
            .whereNot("t.status", "done")
            .select("t.*", "p.name as project_name", "u.full_name as assignee_name")
            .orderByRaw("t.end_datetime ASC NULLS LAST")
            .limit(10);

        if (!isAdmin) {
            query = query.where(function () {
                this.where("t.assignee_id", userId).orWhereExists(function () {
                    this.select(db.raw(1)).from("task_collaborators as tc").whereRaw("tc.task_id = t.id").where("tc.user_id", userId);
                });
            });
        }

        const deadlines = await query;
        return res.status(200).json({ success: true, data: deadlines });
    } catch (err) {
        console.error("Get Upcoming Deadlines Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};

/**
 * GET /dashboard/timeline
 */
export const getTimelineData = async (req, res) => {
    try {
        const { userId, role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        let usersQuery = db("users").select("id", "full_name");
        if (!isAdmin) usersQuery = usersQuery.where({ id: userId });
        const users = await usersQuery;

        const timeline = await Promise.all(users.map(async (u) => {
            const tasks = await db("tasks")
                .where({ assignee_id: u.id })
                .where(function () {
                    this.where("status", "in_progress").orWhere("status", "done").orWhere(function () {
                        this.whereNotNull("start_datetime").andWhereNotNull("end_datetime");
                    });
                })
                .select("id as task_id", "title", db.raw("COALESCE(in_progress_at, start_datetime, created_at) as start"), db.raw("COALESCE(completed_at, end_datetime) as end"), "status", "task_code")
                .orderBy("start", "asc");

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

        const filteredTimeline = isAdmin ? timeline.filter(item => item.tasks.length > 0) : timeline;
        return res.status(200).json({ success: true, data: isAdmin ? filteredTimeline : filteredTimeline[0] });
    } catch (err) {
        console.error("Get Timeline Data Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};

/**
 * GET /dashboard/weekly-stats
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
            let totalQuery = db("tasks").whereRaw("created_at::date <= ?", [date]).count("* as count").first();
            let completedQuery = db("tasks").where({ status: "done" }).whereRaw("completed_at::date = ?", [date]).count("* as count").first();

            if (!isAdmin) {
                const sub = function () {
                    this.select(db.raw(1)).from("task_collaborators as tc").whereRaw("tc.task_id = tasks.id").where("tc.user_id", userId);
                };
                totalQuery = totalQuery.where(function () { this.where("assignee_id", userId).orWhereExists(sub); });
                completedQuery = completedQuery.where(function () { this.where("assignee_id", userId).orWhereExists(sub); });
            }

            const [tRes, cRes] = await Promise.all([totalQuery, completedQuery]);

            return {
                day: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
                date,
                today: parseInt(tRes.count),
                completed: parseInt(cRes.count)
            };
        }));

        return res.status(200).json({ success: true, data: stats });
    } catch (err) {
        console.error("Get Weekly Stats Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};

/**
 * GET /dashboard/team-workload
 */
export const getTeamWorkload = async (req, res) => {
    try {
        const { role } = req.user;
        const isAdmin = ["admin", "Project Manager"].includes(role);

        if (!isAdmin) {
            return res.status(403).json({ success: false, error: "Access denied. Only Project Managers and Admins can view team workload." });
        }

        const rows = await db("users as u")
            .leftJoin("tasks as t", function () {
                this.on("t.assignee_id", "=", "u.id").andOnNotIn(db.raw("LOWER(t.status)"), ["done", "completed", "cancelled"]);
            })
            .where("u.is_active", true)
            .whereNot("u.role", "Project Manager")
            .select("u.id", "u.full_name as name", "u.role", "u.email", db.raw("COUNT(t.id) as active_tasks"), db.raw("COALESCE(SUM(t.potential_points), 0) as total_points"))
            .groupBy("u.id", "u.full_name", "u.role", "u.email")
            .orderByRaw("active_tasks DESC, total_points DESC");

        const workloadData = rows.map(member => {
            let workloadStatus = 'balanced';
            if (member.active_tasks >= 4 || member.total_points >= 12) workloadStatus = 'overloaded';
            else if (member.active_tasks === 0) workloadStatus = 'underutilized';
            return { ...member, workload_status: workloadStatus };
        });

        return res.status(200).json({ success: true, data: workloadData });
    } catch (err) {
        console.error("Get Team Workload Error:", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};
