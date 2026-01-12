import db from "../config/knex.js";
import { logChange } from "./changeLogController.js";

const allowed = (role) => ["admin", "Project Manager"].includes(role);

/* ---------------- READ ---------------- */

export const getModules = async (req, res) => {
  try {
    const { project_id } = req.query;
    let query = db("modules").orderBy("module_serial");
    if (project_id) query = query.where({ project_id });
    const modules = await query;
    return res.status(200).json({ success: true, data: modules });
  } catch (err) {
    console.error("Get Modules Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ---------------- CREATE ---------------- */

export const createModule = async (req, res) => {
  try {
    const { role, userId } = req.user;
    if (!allowed(role)) {
      return res.status(403).json({ success: false, error: "Insufficient permissions" });
    }

    const { project_id, name, description } = req.body;
    if (!project_id || !name || !name.trim()) {
      return res.status(400).json({ success: false, error: "Project ID and Name are required" });
    }

    const project = await db("projects").where({ id: project_id }).select("project_code").first();
    if (!project) {
      return res.status(404).json({ success: false, error: "Project not found" });
    }

    const countRes = await db("modules").where({ project_id }).count("* as count").first();
    const serial = Number(countRes.count) + 1;
    const moduleCode = `${project.project_code}M${serial}`;

    const [newModule] = await db("modules").insert({
      project_id,
      name: name.trim(),
      module_code: moduleCode,
      module_serial: serial,
      description: description || null
    }).returning("*");

    await logChange("module", newModule.id, "created", null, newModule, userId);
    return res.status(201).json({ success: true, data: newModule });
  } catch (err) {
    console.error("Create Module Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ---------------- UPDATE ---------------- */

export const updateModule = async (req, res) => {
  try {
    const { role, userId } = req.user;
    if (!allowed(role)) {
      return res.status(403).json({ success: false, error: "Insufficient permissions" });
    }

    const id = req.params.id || req.query.id;
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: "Name is required" });
    }

    const before = await db("modules").where({ id }).first();
    if (!before) {
      return res.status(404).json({ success: false, error: "Module not found" });
    }

    const [updatedModule] = await db("modules").where({ id }).update({
      name: name.trim(),
      description: description || null,
      updated_at: db.fn.now()
    }).returning("*");

    await logChange("module", id, "updated", before, updatedModule, userId);
    return res.status(200).json({ success: true, data: updatedModule });
  } catch (err) {
    console.error("Update Module Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ---------------- DELETE ---------------- */

export const deleteModule = async (req, res) => {
  try {
    const { role, userId } = req.user;
    if (!allowed(role)) {
      return res.status(403).json({ success: false, error: "Insufficient permissions" });
    }

    const id = req.params.id || req.query.id;
    const before = await db("modules").where({ id }).first();
    if (!before) {
      return res.status(404).json({ success: false, error: "Module not found" });
    }

    await db("modules").where({ id }).del();
    await logChange("module", id, "deleted", before, null, userId);

    return res.status(200).json({ success: true, data: { message: "Deleted" } });
  } catch (err) {
    console.error("Delete Module Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

/* ---------------- GET BY ID ---------------- */

export const getModuleById = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    const module = await db("modules as m")
      .leftJoin("projects as p", "p.id", "m.project_id")
      .where("m.id", id)
      .select("m.*", "p.name AS project_name")
      .first();

    if (!module) {
      return res.status(404).json({ success: false, error: "Module not found" });
    }

    return res.status(200).json({ success: true, data: module });
  } catch (err) {
    console.error("Get Module By ID Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
