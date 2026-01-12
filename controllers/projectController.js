import db from "../config/knex.js";
import { logChange } from "./changeLogController.js";

/* ================= CREATE PROJECT ================= */

export const createProject = async (req, res) => {
  try {
    const { userId, role } = req.user;
    const isPM = role === "Project Manager";

    if (!["admin"].includes(role) && !isPM) {
      return res.status(403).json({ success: false, error: "Only admins and project managers can create projects" });
    }

    const {
      name,
      description,
      start_date,
      end_date,
      status = "active",
      color,
    } = req.body;

    const members = typeof req.body.members === "string" ? JSON.parse(req.body.members) : req.body.members || [];
    const modules = typeof req.body.modules === "string" ? JSON.parse(req.body.modules) : req.body.modules || [];

    if (!name) {
      return res.status(400).json({ success: false, error: "Project name is required" });
    }

    /* ---- PROJECT CODE ---- */
    const generateUniqueProjectCode = async (projectName) => {
      let alphaOnly = projectName.trim().toUpperCase().replace(/[^A-Z]/g, "");
      let baseCode = alphaOnly.substring(0, 4);
      if (baseCode.length < 3) baseCode = (baseCode + "PRJ").substring(0, 3);

      let code = baseCode;
      let attempt = 0;
      while (attempt < 20) {
        const existing = await db('projects').where({ project_code: code }).first();
        if (!existing) return code;

        attempt++;
        if (alphaOnly.length >= 4 + attempt) {
          code = alphaOnly.substring(attempt, attempt + 4);
        } else {
          code = baseCode.substring(0, 3) + String.fromCharCode(64 + attempt);
        }
      }
      return baseCode + Math.floor(Math.random() * 100);
    };

    const projectCode = await generateUniqueProjectCode(name);

    let version = 1;
    const versionMatch = name.match(/-(\d+)$/);
    if (versionMatch) version = parseInt(versionMatch[1]);

    let document = null, document_name = null, document_type = null;
    if (req.file) {
      document = req.file.buffer;
      document_name = req.file.originalname;
      document_type = req.file.mimetype;
    }

    const project = await db.transaction(async (trx) => {
      const [newProject] = await trx('projects').insert({
        name,
        description: description || null,
        start_date: start_date || null,
        end_date: end_date || null,
        status,
        created_by: userId,
        manager_id: userId,
        project_code: projectCode,
        version,
        document,
        document_name,
        document_type,
        color: color || "#4F7DFF",
      }).returning('*');

      const allMembers = Array.from(new Set([...members, userId]));
      if (allMembers.length > 0) {
        await trx('project_members').insert(
          allMembers.map(uid => ({ project_id: newProject.id, user_id: uid }))
        ).onConflict(['project_id', 'user_id']).ignore();
      }

      if (modules.length > 0) {
        let serial = 1;
        const moduleData = modules
          .filter(m => m.name?.trim())
          .map(m => ({
            project_id: newProject.id,
            name: m.name.trim(),
            module_code: `${projectCode}M${serial}`,
            module_serial: serial++,
            description: m.description || null,
          }));

        if (moduleData.length > 0) await trx('modules').insert(moduleData);
      }

      return newProject;
    });

    await logChange("project", project.id, "created", null, project, userId);
    return res.status(201).json({ success: true, data: project });
  } catch (error) {
    console.error("Create Project Error:", error);
    return res.status(500).json({ success: false, error: error.message || "Internal server error" });
  }
};

/* ================= GET PROJECTS ================= */

export const getProjects = async (req, res) => {
  try {
    const { userId, role } = req.user;
    const isPM = role === "Project Manager";

    let query = db('projects as p')
      .select(
        'p.*',
        db.raw('COUNT(DISTINCT t.id) as total_tasks'),
        db.raw("COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done') as completed_tasks"),
        db.raw(`(
          SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name))
          FROM project_members pm
          JOIN users u ON u.id = pm.user_id
          WHERE pm.project_id = p.id
        ) as members`)
      )
      .leftJoin('tasks as t', 't.project_id', 'p.id')
      .groupBy('p.id')
      .orderBy('p.created_at', 'desc');

    if (role !== "admin" && !isPM) {
      query = query.innerJoin('project_members as pm', 'pm.project_id', 'p.id').where('pm.user_id', userId);
    }

    const projects = await query;
    return res.status(200).json({ success: true, data: projects });
  } catch (error) {
    console.error("Get Projects Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ================= GET PROJECT BY ID ================= */

export const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user;
    const isPM = role === "Project Manager";

    let query = db('projects as p')
      .select(
        'p.*',
        db.raw('COUNT(t.id) as total_tasks'),
        db.raw("COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks")
      )
      .leftJoin('tasks as t', 't.project_id', 'p.id')
      .where('p.id', id)
      .groupBy('p.id');

    if (role !== "admin" && !isPM) {
      query = query.innerJoin('project_members as pm', 'pm.project_id', 'p.id').where('pm.user_id', userId);
    }

    const project = await query.first();
    if (!project) {
      return res.status(404).json({ success: false, error: "Project not found or access denied" });
    }

    return res.status(200).json({ success: true, data: project });
  } catch (error) {
    console.error("Get Project By ID Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ================= UPDATE PROJECT ================= */

export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return res.status(403).json({ success: false, error: "Insufficient permissions" });
    }

    const { name, description, start_date, end_date, status, color } = req.body;
    const members = typeof req.body.members === "string" ? JSON.parse(req.body.members) : req.body.members || [];
    const modules = typeof req.body.modules === "string" ? JSON.parse(req.body.modules) : req.body.modules || [];

    const before = await db('projects').where({ id }).first();
    if (!before) {
      return res.status(404).json({ success: false, error: "Project not found" });
    }

    const updated = await db.transaction(async (trx) => {
      if (req.file) {
        await trx('projects').where({ id }).update({
          document: req.file.buffer,
          document_name: req.file.originalname,
          document_type: req.file.mimetype,
        });
      }

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (start_date !== undefined) updateData.start_date = start_date;
      if (end_date !== undefined) updateData.end_date = end_date;
      if (status !== undefined) updateData.status = status;
      if (color !== undefined) updateData.color = color;
      updateData.updated_at = db.fn.now();

      const [updatedProject] = await trx('projects').where({ id }).update(updateData).returning('*');

      if (req.body.members !== undefined) {
        await trx('project_members').where({ project_id: id }).del();
        if (members.length > 0) {
          await trx('project_members').insert(members.map(uid => ({ project_id: id, user_id: uid })));
        }
      }

      if (req.body.modules !== undefined) {
        const validModules = modules.filter(m => m.name?.trim());
        if (validModules.length > 0) {
          const maxSerial = await trx('modules').where({ project_id: id }).max('module_serial as max').first();
          let serial = (maxSerial?.max || 0) + 1;

          await trx('modules').insert(validModules.map(m => ({
            project_id: id,
            name: m.name.trim(),
            module_code: `${updatedProject.project_code}M${serial}`,
            module_serial: serial++,
            description: m.description || null,
          })));
        }
      }

      return updatedProject;
    });

    await logChange("project", id, "updated", before, updated, userId);
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("Update Project Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ================= DELETE PROJECT ================= */

export const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user;

    if (!["admin", "Project Manager"].includes(role)) {
      return res.status(403).json({ success: false, error: "Insufficient permissions" });
    }

    const before = await db('projects').where({ id }).first();
    if (!before) {
      return res.status(404).json({ success: false, error: "Project not found" });
    }

    await db.transaction(async (trx) => {
      const taskIds = await trx('tasks').where({ project_id: id }).pluck('id');
      if (taskIds.length > 0) {
        await trx('timesheets').whereIn('task_id', taskIds).del();
        await trx('task_collaborators').whereIn('task_id', taskIds).del();
      }
      await trx('tasks').where({ project_id: id }).del();
      await trx('modules').where({ project_id: id }).del();
      await trx('sprints').where({ project_id: id }).del();
      await trx('project_members').where({ project_id: id }).del();
      await trx('projects').where({ id }).del();
    });

    await logChange("project", id, "deleted", before, null, userId);
    return res.status(200).json({ success: true, data: { message: "Project and all related data deleted successfully" } });
  } catch (error) {
    console.error("Delete Project Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ================= DOWNLOAD DOCUMENT ================= */

export const downloadDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await db('projects').select('document', 'document_name', 'document_type').where({ id }).first();

    if (!file) {
      return res.status(404).json({ success: false, error: "Project not found" });
    }
    if (!file.document) {
      return res.status(404).json({ success: false, error: "No document uploaded for this project" });
    }

    res.setHeader("Content-Disposition", `inline; filename="${file.document_name}"`);
    res.setHeader("Content-Type", file.document_type || 'application/octet-stream');
    return res.send(file.document);
  } catch (error) {
    console.error("Download Document Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ================= GET PROJECT SUMMARY ================= */

export const getProjectSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const [modulesStats, tasksStats, activeSprint] = await Promise.all([
      db('modules').where({ project_id: id }).select(
        db.raw('COUNT(*) as total'),
        db.raw(`COUNT(*) FILTER (WHERE id IN (SELECT module_id FROM tasks WHERE project_id = ? AND LOWER(status) != 'done')) as active`, [id])
      ).first(),

      db('tasks').where({ project_id: id }).select(
        db.raw("COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('done', 'completed')) AS active"),
        db.raw("COUNT(*) FILTER (WHERE LOWER(status) IN ('done', 'completed')) AS completed"),
        db.raw('COUNT(*) AS total'),
        db.raw('COALESCE(SUM(potential_points), 0) as total_points'),
        db.raw("COALESCE(SUM(potential_points) FILTER (WHERE LOWER(status) IN ('done', 'completed')), 0) as completed_points")
      ).first(),

      db('sprints as s').where({ 's.project_id': id }).whereNot({ 's.status': 'completed' }).select(
        's.*',
        db.raw('(SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id) as total_tasks'),
        db.raw("(SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id AND LOWER(t.status) IN ('done', 'completed')) as completed_tasks"),
        db.raw('(SELECT COALESCE(SUM(potential_points), 0) FROM tasks t WHERE t.sprint_id = s.id) as total_points'),
        db.raw("(SELECT COALESCE(SUM(potential_points), 0) FROM tasks t WHERE t.sprint_id = s.id AND LOWER(t.status) IN ('done', 'completed')) as completed_points")
      ).orderBy('s.start_date', 'asc').first(),
    ]);

    let sprintProgress = 0;
    if (activeSprint) {
      const totalTasks = Number(activeSprint.total_tasks) || 0;
      const completedTasks = Number(activeSprint.completed_tasks) || 0;
      sprintProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    }

    return res.status(200).json({
      success: true,
      data: {
        modules: { total: Number(modulesStats?.total || 0), active: Number(modulesStats?.active || 0) },
        tasks: {
          active: Number(tasksStats?.active || 0),
          completed: Number(tasksStats?.completed || 0),
          total: Number(tasksStats?.total || 0),
          progress: Number(tasksStats?.total || 0) > 0 ? Math.round((Number(tasksStats?.completed || 0) / Number(tasksStats?.total || 0)) * 100) : 0,
          total_points: Number(tasksStats?.total_points || 0),
          completed_points: Number(tasksStats?.completed_points || 0)
        },
        currentSprint: activeSprint ? { id: activeSprint.id, name: activeSprint.name, progress: sprintProgress } : null
      }
    });
  } catch (error) {
    console.error("Get Project Summary Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ================= GET MY PROJECTS ================= */

export const getMyProjects = async (req, res) => {
  try {
    const { userId, role } = req.user;
    let query = db('projects as p').select('p.*', db.raw('COUNT(t.id) as total_tasks'), db.raw("COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks")).leftJoin('tasks as t', 't.project_id', 'p.id').groupBy('p.id');

    if (role === "Project Manager") {
      query = query.where('p.manager_id', userId);
    } else {
      query = query.leftJoin('project_members as pm', 'pm.project_id', 'p.id').where('pm.user_id', userId);
    }

    const projects = await query;
    return res.status(200).json({ success: true, data: projects });
  } catch (error) {
    console.error("Get My Projects Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ================= GET PROJECT MEMBERS ================= */

export const getProjectMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const members = await db('project_members as pm').join('users as u', 'u.id', 'pm.user_id').where('pm.project_id', id).select('u.id', 'u.full_name', 'u.role').orderBy('u.full_name');
    return res.status(200).json({ success: true, data: members });
  } catch (error) {
    console.error("Get Project Members Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ================= GET PROJECT HIERARCHY ================= */

export const getProjectHierarchy = async (req, res) => {
  try {
    const { id } = req.params;
    const [project, modules, sprints, tasks] = await Promise.all([
      db('projects').where({ id }).first(),
      db('modules').where({ project_id: id }).orderBy('module_serial'),
      db('sprints').where({ project_id: id }).orderBy('sprint_number'),
      db('tasks as t').leftJoin('users as u', 'u.id', 't.assignee_id').where('t.project_id', id).select('t.id', 't.title', 't.module_id', 't.sprint_id', 't.status', 't.assignee_id', 'u.full_name as assignee_name'),
    ]);

    if (!project) {
      return res.status(404).json({ success: false, error: "Project not found" });
    }

    return res.status(200).json({ success: true, data: { project, modules, sprints, tasks } });
  } catch (error) {
    console.error("Get Project Hierarchy Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
