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
        // For the bot, we'll fetch data as an admin to see everything, OR user context if specific rules apply.
        // For simplicity in this demo, accessing all data to answer general questions.
        // In production, pass req.user.id to filter like dashboardController does.

        // 1. PROJECTS with status metrics (Adapted from dashboardController.getActiveProjects)
        const projectsRes = await pool.query(`
          SELECT p.id, p.name, p.status, p.start_date, p.end_date, 
            COUNT(t.id) as total_tasks,
            COUNT(t.id) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')) as completed_tasks,
            COALESCE(SUM(t.potential_points), 0) as total_points
          FROM projects p
          LEFT JOIN tasks t ON t.project_id = p.id
          WHERE p.status = 'active'
          GROUP BY p.id
        `);

        // 2. ACTIVE SPRINTS (Adapted from dashboardController.getActiveSprints)
        const sprintsRes = await pool.query(`
          SELECT s.name, s.status, s.start_date, s.end_date, p.name as project_name,
            (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id) as total_sprint_tasks,
            (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id = s.id AND LOWER(t.status) IN ('done', 'completed')) as completed_sprint_tasks
          FROM sprints s
          JOIN projects p ON p.id = s.project_id
          WHERE s.status = 'active'
        `);

        // 3. UPCOMING DEADLINES / RISKS (Adapted from dashboardController.getUpcomingDeadlines)
        const deadlinesRes = await pool.query(`
            SELECT t.title, t.priority, t.end_datetime, t.status, p.name as project_name, u.full_name as assignee
            FROM tasks t
            JOIN projects p ON p.id = t.project_id
            LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.end_datetime >= CURRENT_DATE AND t.end_datetime <= (CURRENT_DATE + INTERVAL '7 days')
            AND t.status != 'done'
            ORDER BY t.end_datetime ASC
            LIMIT 15
        `);

        // 4. TEAM UTILIZATION (New query mimicking timeline/workload logic)
        const teamRes = await pool.query(`
            SELECT u.full_name, u.role,
                COUNT(t.id) as active_tasks
            FROM users u
            LEFT JOIN tasks t ON t.assignee_id = u.id AND t.status NOT IN ('done', 'completed', 'cancelled')
            WHERE u.status = 'active'
            GROUP BY u.id
        `);

        // Assemble Context
        const contextData = {
            projects_summary: projectsRes.rows,
            active_sprints: sprintsRes.rows,
            urgent_tasks_this_week: deadlinesRes.rows,
            team_workload: teamRes.rows
        };

        const systemPrompt = `
You are ProjectBot, an advanced AI project manager for "RedSage".
You have "Read-Only" access to the entire project database.
Below is the real-time snapshot of the organization:

DATA SNAPSHOT:
${JSON.stringify(contextData)}

INSTRUCTIONS:
- Analyze the data to answer the user's question.
- If asked about "status", refer to project completion rates (tasks done / total).
- If asked about "risks", look for high priority tasks due soon or sprints with low completion.
- If asked about "workload", check team_members active task counts.
- Keep answers professional, concise, and insightful. 
- Do NOT hallucinate data not present in the snapshot.

User Query: ${query}
`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: query }
            ],
            model: "llama3-8b-8192",
            temperature: 0.1, // Very precise
            max_tokens: 512,
        });

        const answer = completion.choices[0]?.message?.content || "I couldn't generate an answer.";

        res.json({
            success: true,
            answer: answer
        });

    } catch (error) {
        console.error("Bot Logic Error:", error);
        res.status(500).json({
            success: false,
            error: "I encountered an error processing your request.",
            details: error.message
        });
    }
};
