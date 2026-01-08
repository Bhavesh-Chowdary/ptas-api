import Groq from "groq-sdk";
import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

export const askBot = async (req, res) => {
    try {
        const { query } = req.body;

        // Fetch context data
        // For a demo, we'll strip down the data to essential fields to save tokens

        // 1. Projects
        const projectsRes = await pool.query(`
            SELECT id, name, status, start_date, end_date, progress, budget 
            FROM projects
        `);

        // 2. Tasks (limit to recent or active to avoid huge payload, or just all for small demo DB)
        const tasksRes = await pool.query(`
            SELECT t.id, t.title, t.status, t.priority, t.start_date, t.end_date, 
                   u.name as assignee_name, p.name as project_name
            FROM tasks t
            LEFT JOIN users u ON t.assignee_id = u.id
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.status != 'Done' OR t.updated_at > NOW() - INTERVAL '30 days'
        `);

        // 3. Sprints
        const sprintsRes = await pool.query(`
            SELECT s.id, s.name, s.status, s.start_date, s.end_date, p.name as project_name
            FROM sprints s
            LEFT JOIN projects p ON s.project_id = p.id
        `);

        // 4. Users/Utilization (Mocking utilization for now based on task count)
        const usersRes = await pool.query(`
            SELECT id, name, role, email FROM users
        `);

        // Construct Context
        const contextData = {
            projects: projectsRes.rows,
            active_tasks: tasksRes.rows,
            sprints: sprintsRes.rows,
            team_members: usersRes.rows
        };

        const systemPrompt = `
You are ProjectBot, an intelligent and helpful project management assistant for the "RedSage" team.
You have access to the current real-time data of the project management system provided below in JSON format.

CONTEXT DATA:
${JSON.stringify(contextData)}

YOUR ROLE:
- Answer questions about project status, tasks, deadlines, team workload, and sprints.
- Provide summaries and insights.
- Be concise, professional, and friendly.
- If you don't know the answer based on the data, say "I don't have that information right now."
- If the user asks for "at-risk" projects, look for projects with low progress but close deadlines or past deadlines.
- If user asks about "utilization", estimate based on assigned tasks (e.g. 0-2 tasks is low, 3-5 is medium, 5+ is high).

Answer the following user query based on the context above.
        `;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: query }
            ],
            model: "llama3-8b-8192", // Faster, lightweight model
            temperature: 0.3,
            max_tokens: 512,
        });

        const answer = completion.choices[0]?.message?.content || "I couldn't process your request.";

        res.json({
            success: true,
            answer: answer
        });

    } catch (error) {
        console.error("Bot Error:", error);
        res.status(500).json({
            success: false,
            error: error.message || "Failed to get response from bot.",
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};
