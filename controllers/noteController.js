import db from "../config/knex.js";

export const getNotes = async (req, res) => {
    try {
        const notes = await db("notes")
            .where({ user_id: req.user.userId })
            .orderBy("created_at", "desc");
        return res.status(200).json({ success: true, data: notes });
    } catch (err) {
        console.error("Get Notes Error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const createNote = async (req, res) => {
    try {
        const { content_html, color_id } = req.body;

        if (!content_html) {
            return res.status(400).json({ success: false, error: "Content is required" });
        }

        const [note] = await db("notes").insert({
            user_id: req.user.userId,
            content_html,
            color_id: color_id || 'yellow'
        }).returning("*");

        return res.status(201).json({ success: true, data: note });
    } catch (err) {
        console.error("Create Note Error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const updateNote = async (req, res) => {
    try {
        const { id } = req.params;
        const { content_html, color_id } = req.body;

        const [updated] = await db("notes")
            .where({ id, user_id: req.user.userId })
            .update({
                content_html: db.raw("COALESCE(?, content_html)", [content_html]),
                color_id: db.raw("COALESCE(?, color_id)", [color_id]),
                updated_at: db.fn.now()
            })
            .returning("*");

        if (!updated) {
            return res.status(404).json({ success: false, error: "Note not found or unauthorized" });
        }

        return res.status(200).json({ success: true, data: updated });
    } catch (err) {
        console.error("Update Note Error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const deleteNote = async (req, res) => {
    try {
        const { id } = req.params;
        const [deleted] = await db("notes")
            .where({ id, user_id: req.user.userId })
            .delete()
            .returning("*");

        if (!deleted) {
            return res.status(404).json({ success: false, error: "Note not found or unauthorized" });
        }

        return res.status(200).json({ success: true, data: { message: "Note deleted successfully", id: deleted.id } });
    } catch (err) {
        console.error("Delete Note Error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
};
