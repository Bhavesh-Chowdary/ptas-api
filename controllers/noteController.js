import pool from '../config/db.js';

export const getNotes = async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM notes WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.userId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const createNote = async (req, res) => {
    try {
        const { content_html, color_id } = req.body;

        // Validate inputs
        if (!content_html) {
            return res.status(400).json({ error: 'Content is required' });
        }

        const { rows } = await pool.query(
            'INSERT INTO notes (user_id, content_html, color_id) VALUES ($1, $2, $3) RETURNING *',
            [req.user.userId, content_html, color_id || 'yellow']
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("createNote Error:", err);
        res.status(500).json({ error: err.message });
    }
};

export const updateNote = async (req, res) => {
    try {
        const { id } = req.params;
        const { content_html, color_id } = req.body;

        // We update fields dynamically or just update both if provided
        // For simplicity, we update both. If one is missing, we should ideally keep old one.
        // Let's do a simple COALESCE or dynamic query. 
        // Or simpler: frontend sends current state of both.

        // Using COALESCE to keep existing value if param is null (frontend should send desired state)
        const q = `
        UPDATE notes 
        SET content_html = COALESCE($1, content_html), 
            color_id = COALESCE($2, color_id),
            updated_at = NOW()
        WHERE id = $3 AND user_id = $4
        RETURNING *
    `;

        const { rows } = await pool.query(q, [content_html, color_id, id, req.user.userId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Note not found or unauthorized' });
        }

        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const deleteNote = async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await pool.query(
            'DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING *',
            [id, req.user.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Note not found or unauthorized' });
        }

        res.json({ message: 'Note deleted successfully', id: rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
