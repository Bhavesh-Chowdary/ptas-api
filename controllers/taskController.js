import db from "../config/knex.js";
import { autoLogTime } from "./timesheetController.js";
import { logChange } from "./changeLogController.js";

// Helper to extract ID from user object if needed
const getUserId = (user) => (typeof user === "object" ? user.id : user);

/*
  TASK CODE GENERATOR
*/
const generateTaskCode = async (project_id, sprint_id, module_id, assignee_id) => {
  const uid = getUserId(assignee_id);

  const [p, s, m, u, c] = await Promise.all([
    db("projects").select("org_code", "project_code", "name", "version").where({ id: project_id }).first(),
    db("sprints").select("sprint_number").where({ id: sprint_id }).first(),
    db("modules").select("module_serial").where({ id: module_id }).first(),
    uid ? db("users").select("resource_serial").where({ id: uid }).first() : null,
    db("tasks").where({ project_id }).count("* as count").first(),
  ]);

  if (!p) throw new Error("PROJECT_NOT_FOUND");

  const proj = p;
  const sprNum = s?.sprint_number || "0";
  const modSerial = m?.module_serial || "1";
  const resSerial = u?.resource_serial || "0";
  const serial = Number(c.count) + 1;

  const org = (proj.org_code || "RS").toUpperCase();
  const projId = (proj.project_code || "PROJ").split("/")[0].toUpperCase();
  const resourcePart = "R" + String(resSerial);

  let version = String(proj.version || "1").toUpperCase();
  if (!version.startsWith("V")) version = "V" + version;

  const sprint = `S${sprNum}`;
  const projLetters = projId.substring(0, 2);
  const moduleId = `${projLetters}${modSerial}`;
  const taskSerial = String(serial).padStart(3, "0");

  return [org, projId, resourcePart, version, sprint, moduleId, taskSerial].join("/");
};

const POTENTIAL_MAP = {
  "Very Small": { points: 1, hours: 2 },
  Small: { points: 2, hours: 4 },
  Medium: { points: 3, hours: 6 },
  Large: { points: 5, hours: 10 },
  "Very Large": { points: 8, hours: 18 },
};

const checkDeveloperLoad = async (assignee_id, sprint_id, current_task_id = null) => {
  if (!assignee_id || !sprint_id) return { points: 0, hours: 0 };

  const result = await db("tasks")
    .where({ assignee_id, sprint_id })
    .whereNot({ id: current_task_id || -1 }) // Handle null current_task_id
    .sum("potential_points as total_points")
    .sum("target_hours as total_hours")
    .first();

  return {
    points: parseInt(result.total_points || 0),
    hours: parseFloat(result.total_hours || 0),
  };
};

/*
  CREATE TASK
*/
export const createTask = async (req, res) => {
  try {
    const {
      project_id, sprint_id, module_id, assignee_id, title, description,
      est_hours, status, priority = "Medium", start_date, end_date,
      collaborators, goal_index, potential,
    } = req.body;

    const { userId, role } = req.user;
    const normalRole = (role || "").toLowerCase();
    const canBypassMembership = normalRole === "admin" || normalRole === "project manager";

    if (normalRole === "developer" && String(assignee_id) !== String(userId)) {
      return res.status(403).json({ success: false, error: "Developers can only create tasks assigned to themselves" });
    }

    const isMember = await db("project_members").where({ project_id, user_id: userId }).first();
    if (!isMember && !canBypassMembership) {
      return res.status(403).json({ success: false, error: "Project membership required" });
    }

    let task_code;
    try {
      task_code = await generateTaskCode(project_id, sprint_id, module_id, assignee_id);
    } catch (e) {
      if (e.message === "PROJECT_NOT_FOUND") {
        return res.status(404).json({ success: false, error: "Project not found" });
      }
      throw e;
    }

    if (assignee_id && sprint_id && potential && POTENTIAL_MAP[potential]) {
      const load = await checkDeveloperLoad(assignee_id, sprint_id);
      const newTaskLoad = POTENTIAL_MAP[potential];
      if (load.points + newTaskLoad.points > 20 || load.hours + newTaskLoad.hours > 40) {
        return res.status(400).json({ success: false, error: `Assignee has exceeded workload limit (Max: 20 pts / 40 hrs). Current: ${load.points} pts / ${load.hours} hrs` });
      }
    }

    const potData = potential ? POTENTIAL_MAP[potential] : { points: null, hours: null };

    const finalTask = await db.transaction(async (trx) => {
      const taskCount = await trx("tasks").where({ project_id }).count("* as count").first();
      const [newTask] = await trx("tasks").insert({
        task_code,
        task_key: task_code,
        task_serial: Number(taskCount.count) + 1,
        title,
        description: description || null,
        project_id,
        sprint_id,
        module_id,
        assignee_id: getUserId(assignee_id),
        created_by: userId,
        est_hours: est_hours || null,
        status: status || "todo",
        priority,
        start_date: start_date || null,
        end_date: end_date || null,
        goal_index: goal_index !== undefined ? goal_index : null,
        potential: potential || null,
        potential_points: potData.points,
        target_hours: potData.hours,
      }).returning("*");

      if (Array.isArray(collaborators) && collaborators.length > 0) {
        const collabData = collaborators.map((item) => {
          const uid = getUserId(item);
          return uid ? { task_id: newTask.id, user_id: uid } : null;
        }).filter(Boolean);

        if (collabData.length > 0) {
          await trx("task_collaborators").insert(collabData).onConflict(["task_id", "user_id"]).ignore();
        }
      }

      return await trx("tasks as t")
        .join("projects as p", "p.id", "t.project_id")
        .leftJoin("modules as m", "m.id", "t.module_id")
        .leftJoin("users as u", "u.id", "t.assignee_id")
        .leftJoin("users as c", "c.id", "t.created_by")
        .where("t.id", newTask.id)
        .select(
          "t.*", "p.name as project_name", "p.color as project_color",
          "m.name as module_name", "u.full_name as assignee_name", "c.full_name as created_by_name",
          db.raw(`(SELECT COALESCE(json_agg(json_build_object('id', uc.id, 'name', uc.full_name)), '[]'::json) FROM task_collaborators tc JOIN users uc ON uc.id = tc.user_id WHERE tc.task_id = t.id) AS collaborators`)
        ).first();
    });

    await logChange("task", finalTask.id, "created", null, finalTask, userId);
    return res.status(201).json({ success: true, data: finalTask });
  } catch (error) {
    console.error("Create Task Error:", error);
    return res.status(500).json({ success: false, error: error.message || "Internal server error" });
  }
};

/*
  GET TASKS
*/
export const getTasks = async (req, res) => {
  try {
    const { role, userId } = req.user;
    const { project_id, sprint_id } = req.query;

    let query = db("tasks as t")
      .join("projects as p", "p.id", "t.project_id")
      .leftJoin("modules as m", "m.id", "t.module_id")
      .leftJoin("users as u", "u.id", "t.assignee_id")
      .leftJoin("users as c", "c.id", "t.created_by")
      .select(
        "t.*", "p.name as project_name", "p.color as project_color",
        "m.name as module_name", "u.full_name as assignee_name", "c.full_name as created_by_name",
        db.raw(`(SELECT COALESCE(json_agg(json_build_object('id', uc.id, 'name', uc.full_name)), '[]'::json) FROM task_collaborators tc JOIN users uc ON uc.id = tc.user_id WHERE tc.task_id = t.id) AS collaborators`)
      );

    const userRole = (role || "").toLowerCase();
    if (userRole === "developer") {
      query = query.where((builder) => {
        builder.where("t.assignee_id", userId).orWhereExists(function () {
          this.select(db.raw(1)).from("task_collaborators as tc").whereRaw("tc.task_id = t.id").where("tc.user_id", userId);
        });
      });
    }

    if (project_id) query = query.where("t.project_id", project_id);
    if (sprint_id) query = query.where("t.sprint_id", sprint_id);

    const tasks = await query.orderBy("t.created_at", "desc");
    return res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    console.error("Get Tasks Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/*
  GET TASK BY ID
*/
export const getTaskById = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    if (!id) {
      return res.status(400).json({ success: false, error: "Task id is required" });
    }

    const task = await db("tasks as t").join("projects as p", "p.id", "t.project_id").where("t.id", id).select("t.*", "p.name as project_name").first();
    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    console.error("Get Task By ID Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/*
  UPDATE TASK
*/
export const updateTask = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role, userId } = req.user;
    if (!id) {
      return res.status(400).json({ success: false, error: "Task id is required" });
    }

    const before = await db("tasks").where({ id }).first();
    if (!before) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    const userRole = (role || "").toLowerCase();
    if (userRole === "developer" && String(before.assignee_id) !== String(userId)) {
      return res.status(403).json({ success: false, error: "Developers can only edit tasks assigned to themselves" });
    }

    const {
      title, description, module_id, assignee_id, sprint_id, status,
      start_datetime, end_datetime, start_date, end_date, est_hours,
      actual_hours, collaborators, priority, goal_index, potential,
    } = req.body;

    if (userRole === "developer" && assignee_id && String(assignee_id) !== String(userId)) {
      return res.status(403).json({ success: false, error: "Developers cannot reassign tasks to others" });
    }

    const targetAssignee = assignee_id || before.assignee_id;
    const targetSprint = sprint_id || before.sprint_id;
    const targetPotential = potential || before.potential;

    if (targetAssignee && targetSprint && targetPotential && POTENTIAL_MAP[targetPotential]) {
      const load = await checkDeveloperLoad(targetAssignee, targetSprint, id);
      const newTaskLoad = POTENTIAL_MAP[targetPotential];
      if (load.points + newTaskLoad.points > 20 || load.hours + newTaskLoad.hours > 40) {
        return res.status(400).json({ success: false, error: `Load limit exceeded (Max: 20 pts / 40 hrs). Sprint load would become: ${load.points + newTaskLoad.points} pts / ${load.hours + newTaskLoad.hours} hrs` });
      }
    }

    const potData = potential ? POTENTIAL_MAP[potential] : null;

    let in_progress_at = before.in_progress_at;
    let completed_at = before.completed_at;
    let duration = before.task_duration_minutes || 0;
    let current_period_start = before.current_period_start;

    if (status && status !== before.status) {
      const normalizedStatus = status.toLowerCase().replace(/\s+/g, "_");
      const normalizedBefore = (before.status || "").toLowerCase().replace(/\s+/g, "_");

      if (normalizedStatus !== normalizedBefore) {
        if (normalizedStatus === "in_progress") {
          current_period_start = new Date();
          if (!in_progress_at) in_progress_at = current_period_start;
        } else if (normalizedBefore === "in_progress") {
          if (current_period_start) {
            const diff = new Date() - new Date(current_period_start);
            duration = Number(duration) + Math.round(diff / (1000 * 60));
            current_period_start = null;
          }
        }
        if (normalizedStatus === "done") completed_at = new Date();
      }
    }

    const updatedTask = await db.transaction(async (trx) => {
      const updateData = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (module_id !== undefined) updateData.module_id = module_id;
      if (assignee_id !== undefined) updateData.assignee_id = getUserId(assignee_id);
      if (status !== undefined) updateData.status = status;
      if (start_datetime !== undefined) updateData.start_datetime = start_datetime;
      if (end_datetime !== undefined) updateData.end_datetime = end_datetime;
      if (est_hours !== undefined) updateData.est_hours = est_hours;
      if (actual_hours !== undefined) updateData.actual_hours = actual_hours;
      if (priority !== undefined) updateData.priority = priority;
      if (start_date !== undefined) updateData.start_date = start_date;
      if (end_date !== undefined) updateData.end_date = end_date;
      if (goal_index !== undefined) updateData.goal_index = goal_index;
      if (potential !== undefined) updateData.potential = potential;
      if (potData) {
        updateData.potential_points = potData.points;
        updateData.target_hours = potData.hours;
      }
      updateData.in_progress_at = in_progress_at;
      updateData.completed_at = completed_at;
      updateData.task_duration_minutes = duration;
      updateData.current_period_start = current_period_start;
      updateData.updated_at = db.fn.now();

      await trx("tasks").where({ id }).update(updateData);

      if (Array.isArray(collaborators)) {
        await trx("task_collaborators").where({ task_id: id }).del();
        const collabData = collaborators.map((item) => {
          const uid = getUserId(item);
          return uid ? { task_id: id, user_id: uid } : null;
        }).filter(Boolean);

        if (collabData.length > 0) {
          await trx("task_collaborators").insert(collabData).onConflict(["task_id", "user_id"]).ignore();
        }
      }

      return await trx("tasks as t")
        .join("projects as p", "p.id", "t.project_id")
        .leftJoin("modules as m", "m.id", "t.module_id")
        .leftJoin("users as u", "u.id", "t.assignee_id")
        .leftJoin("users as c", "c.id", "t.created_by")
        .where("t.id", id)
        .select(
          "t.*", "p.name as project_name", "p.color as project_color",
          "m.name as module_name", "u.full_name as assignee_name", "c.full_name as created_by_name",
          db.raw(`(SELECT COALESCE(json_agg(json_build_object('id', uc.id, 'name', uc.full_name)), '[]'::json) FROM task_collaborators tc JOIN users uc ON uc.id = tc.user_id WHERE tc.task_id = t.id) AS collaborators`)
        ).first();
    });

    await logChange("task", id, "updated", before, updatedTask, userId);
    if (status === "in_progress" && before.status !== "in_progress") {
      await autoLogTime(id, userId, 30, "Auto-log: Task started");
    }
    if (status === "done" && before.status !== "done") {
      await autoLogTime(id, userId, 60, "Auto-log: Task completed");
    }

    return res.status(200).json({ success: true, data: updatedTask });
  } catch (error) {
    console.error("Update Task Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/*
  DELETE TASK
*/
export const deleteTask = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const { role, userId } = req.user;
    if (!id) {
      return res.status(400).json({ success: false, error: "Task id is required" });
    }

    const userRole = (role || "").toLowerCase();
    if (!["admin", "project manager", "developer"].includes(userRole)) {
      return res.status(403).json({ success: false, error: "Not allowed to delete tasks" });
    }

    const before = await db("tasks").where({ id }).first();
    if (!before) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    await db("tasks").where({ id }).del();
    await logChange("task", id, "deleted", before, null, userId);

    return res.status(200).json({ success: true, data: { message: "Task deleted successfully" } });
  } catch (error) {
    console.error("Delete Task Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
