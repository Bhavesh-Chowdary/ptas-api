import db from "../config/knex.js";
import { logChange } from "./changeLogController.js";

export const createSprint = async (req, res) => {
  try {
    const { project_id, start_date, end_date, goal, status } = req.body;
    const { role, userId } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return res.status(403).json({ success: false, error: "Not allowed to create sprint" });
    }

    if (!project_id || !start_date || !end_date) {
      return res.status(400).json({ success: false, error: "project_id, start_date and end_date are required" });
    }

    const maxResult = await db("sprints").where({ project_id }).max("sprint_number as max_num").first();
    const sprint_number = (maxResult?.max_num || 0) + 1;

    const [sprint] = await db("sprints").insert({
      project_id,
      name: `Sprint ${sprint_number}`,
      start_date,
      end_date,
      status: status || 'active',
      goal: goal || null,
      sprint_number,
    }).returning("*");

    await logChange("sprint", sprint.id, "created", null, sprint, userId);
    return res.status(201).json({ success: true, data: sprint });
  } catch (err) {
    console.error("createSprint:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
};

export const getNextSprintNumber = async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) {
      return res.status(400).json({ success: false, error: "project_id is required" });
    }

    const maxResult = await db("sprints").where({ project_id }).max("sprint_number as max_num").first();
    const nextNum = (maxResult?.max_num || 0) + 1;

    return res.status(200).json({ success: true, data: { next_number: nextNum } });
  } catch (err) {
    console.error("getNextSprintNumber:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getSprints = async (req, res) => {
  try {
    const { project_id } = req.query;

    let query = db("sprints as s")
      .leftJoin("projects as p", "p.id", "s.project_id")
      .leftJoin("tasks as t", "t.sprint_id", "s.id")
      .select(
        "s.*",
        "p.name AS project_name",
        "p.color AS project_color",
        db.raw("COUNT(DISTINCT t.id) as total_tasks"),
        db.raw("COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done') as completed_tasks"),
        db.raw(`(
          SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name))
          FROM (
            SELECT DISTINCT u.id, u.full_name
            FROM tasks t2
            JOIN users u ON u.id = t2.assignee_id
            WHERE t2.sprint_id = s.id
          ) u
        ) as members`)
      )
      .groupBy("s.id", "p.name", "p.color")
      .orderBy("s.sprint_number", "desc");

    if (project_id) query = query.where("s.project_id", project_id);

    const sprints = await query;
    return res.status(200).json({ success: true, data: sprints });
  } catch (err) {
    console.error("getSprints error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getSprintById = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    if (!id) {
      return res.status(400).json({ success: false, error: "Sprint id is required" });
    }

    const sprint = await db("sprints as s")
      .leftJoin("projects as p", "p.id", "s.project_id")
      .leftJoin("tasks as t", "t.sprint_id", "s.id")
      .where("s.id", id)
      .select(
        "s.*",
        "p.name AS project_name",
        "p.color AS project_color",
        db.raw("COUNT(t.id) as total_tasks"),
        db.raw("COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks")
      )
      .groupBy("s.id", "p.name", "p.color")
      .first();

    if (!sprint) {
      return res.status(404).json({ success: false, error: "Sprint not found" });
    }

    return res.status(200).json({ success: true, data: sprint });
  } catch (err) {
    console.error("getSprintById:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const updateSprint = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role, userId } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return res.status(403).json({ success: false, error: "Not allowed to update sprint" });
    }

    if (!id) {
      return res.status(400).json({ success: false, error: "Sprint id is required" });
    }

    const before = await db("sprints").where({ id }).first();
    if (!before) {
      return res.status(404).json({ success: false, error: "Sprint not found" });
    }

    const { name, start_date, end_date, status, goal } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (start_date !== undefined) updateData.start_date = start_date;
    if (end_date !== undefined) updateData.end_date = end_date;
    if (status !== undefined) updateData.status = status;
    if (goal !== undefined) updateData.goal = goal;
    updateData.updated_at = db.fn.now();

    const [after] = await db("sprints").where({ id }).update(updateData).returning("*");

    await logChange("sprint", id, "updated", before, after, userId);
    return res.status(200).json({ success: true, data: after });
  } catch (err) {
    console.error("updateSprint:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const deleteSprint = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role, userId } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return res.status(403).json({ success: false, error: "Not allowed to delete sprint" });
    }

    if (!id) {
      return res.status(400).json({ success: false, error: "Sprint id is required" });
    }

    const before = await db("sprints").where({ id }).first();
    if (!before) {
      return res.status(404).json({ success: false, error: "Sprint not found" });
    }

    await db("sprints").where({ id }).del();
    await logChange("sprint", id, "deleted", before, null, userId);

    return res.status(200).json({ success: true, data: { message: "Sprint deleted successfully" } });
  } catch (err) {
    console.error("deleteSprint:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getSprintHierarchy = async (req, res) => {
  try {
    const { id } = req.params;

    const sprint = await db("sprints as s")
      .join("projects as p", "p.id", "s.project_id")
      .where("s.id", id)
      .select("s.*", "p.name as project_name", "p.color as project_color")
      .first();

    if (!sprint) {
      return res.status(404).json({ success: false, error: "Sprint not found" });
    }

    const modules = await db("modules as m")
      .whereIn("m.id", function () {
        this.select("module_id").from("sprint_modules").where({ sprint_id: id })
          .union(function () {
            this.select("module_id").from("tasks").where({ sprint_id: id }).whereNotNull("module_id");
          });
      })
      .orderBy("m.module_serial");

    const tasks = await db("tasks as t")
      .leftJoin("users as u", "u.id", "t.assignee_id")
      .where("t.sprint_id", id)
      .select("t.*", "u.full_name as assignee_name");

    const hierarchy = modules.map(m => ({
      ...m,
      tasks: tasks.filter(t => t.module_id === m.id)
    }));

    const orphanTasks = tasks.filter(t => !t.module_id);
    if (orphanTasks.length > 0) {
      hierarchy.push({ id: 'orphans', name: 'General Tasks', tasks: orphanTasks });
    }

    return res.status(200).json({ success: true, data: { sprint, modules: hierarchy, tasks } });
  } catch (err) {
    console.error("getSprintHierarchy:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getSprintBurndown = async (req, res) => {
  try {
    const { id } = req.params;

    const sprint = await db("sprints").where({ id }).select("start_date", "end_date").first();
    if (!sprint) {
      return res.status(404).json({ success: false, error: "Sprint not found" });
    }

    const tasks = await db("tasks").where({ sprint_id: id }).select(
      db.raw("COALESCE(est_hours, target_hours, 0) as estimate"),
      "completed_at", "status"
    );

    const dailyLogs = await db("timesheets")
      .whereIn("task_id", db("tasks").where({ sprint_id: id }).select("id"))
      .select(db.raw("log_date::date as date"), db.raw("SUM(minutes_logged) / 60.0 as hours_logged"))
      .groupByRaw("log_date::date")
      .orderByRaw("log_date::date ASC");

    const start = new Date(sprint.start_date);
    const end = new Date(sprint.end_date);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const chartData = [];
    let current = new Date(start);
    const totalEst = tasks.reduce((sum, t) => sum + Number(t.estimate), 0);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    const step = totalEst / (totalDays || 1);

    let dayIndex = 0;
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const completedUntilNow = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at) <= current);
      const completedEst = completedUntilNow.reduce((sum, t) => sum + Number(t.estimate), 0);
      const remainingEst = Math.max(0, totalEst - completedEst);

      const logsUntilNow = dailyLogs.filter(l => new Date(l.date) <= current);
      const totalLogged = logsUntilNow.reduce((sum, l) => sum + Number(l.hours_logged), 0);
      const remainingActual = Math.max(0, totalEst - totalLogged);

      const ideal = Math.max(0, totalEst - (step * dayIndex));
      const isFuture = current > today;

      chartData.push({
        date: dateStr,
        displayDate: current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        ideal: Number(ideal.toFixed(1)),
        remainingEst: isFuture ? null : Number(remainingEst.toFixed(1)),
        remainingActual: isFuture ? null : Number(remainingActual.toFixed(1))
      });
      current.setDate(current.getDate() + 1);
      dayIndex++;
    }

    return res.status(200).json({ success: true, data: chartData });
  } catch (err) {
    console.error("getSprintBurndown:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
