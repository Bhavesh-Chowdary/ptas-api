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
          SELECT p.id, p.name, p.status, p.start_date, p.end_date, p.color,
            COUNT(t.id) as total_tasks,
            COUNT(t.id) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')) as completed_tasks,
            COALESCE(SUM(t.potential_points), 0) as total_points,
            COALESCE(SUM(t.potential_points) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')), 0) as completed_points
          FROM projects p
          LEFT JOIN tasks t ON t.project_id = p.id
          WHERE p.status = 'active'
          GROUP BY p.id
          ORDER BY p.created_at DESC
        `);

        // 2. ACTIVE SPRINTS (Adapted from dashboardController.getActiveSprints)
        const sprintsRes = await pool.query(`
          SELECT s.id, s.name, s.status, s.start_date, s.end_date, s.sprint_number,
            p.name as project_name, p.color as project_color,
            COUNT(t.id) as total_tasks,
            COUNT(t.id) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')) as completed_tasks,
            COALESCE(SUM(t.potential_points), 0) as total_points
          FROM sprints s
          JOIN projects p ON p.id = s.project_id
          LEFT JOIN tasks t ON t.sprint_id = s.id
          WHERE s.status = 'active'
          GROUP BY s.id, p.name, p.color
          ORDER BY s.end_date ASC
        `);

        // 3. UPCOMING DEADLINES / RISKS (Adapted from dashboardController.getUpcomingDeadlines)
        const deadlinesRes = await pool.query(`
            SELECT t.id, t.title, t.priority, t.end_datetime, t.end_date, t.status, 
                   p.name as project_name, u.full_name as assignee_name
            FROM tasks t
            JOIN projects p ON p.id = t.project_id
            LEFT JOIN users u ON u.id = t.assignee_id
            WHERE (t.end_datetime >= CURRENT_DATE OR t.end_date >= CURRENT_DATE)
            AND LOWER(t.status) NOT IN ('done', 'completed')
            ORDER BY COALESCE(t.end_datetime, t.end_date::timestamp) ASC
            LIMIT 15
        `);

        // 4. TEAM UTILIZATION - Exclude Project Managers (they manage, not execute tasks)
        const teamRes = await pool.query(`
            SELECT u.id, u.full_name, u.role, u.email,
                COUNT(t.id) as active_tasks,
                COALESCE(SUM(t.potential_points), 0) as total_points
            FROM users u
            LEFT JOIN tasks t ON t.assignee_id = u.id 
                AND LOWER(t.status) NOT IN ('done', 'completed', 'cancelled')
            WHERE u.is_active = true 
                AND u.role != 'Project Manager'
            GROUP BY u.id, u.full_name, u.role, u.email
            ORDER BY active_tasks DESC
        `);

        // Assemble Context
        const contextData = {
            projects_summary: projectsRes.rows,
            active_sprints: sprintsRes.rows,
            urgent_tasks_this_week: deadlinesRes.rows,
            team_workload: teamRes.rows
        };

        const systemPrompt = `
You are ProjectBot, an advanced AI project management assistant for "RedSage PTAS".
You have read-only access to the entire project database and can provide insights about projects, sprints, tasks, and team workload.

CURRENT DATA SNAPSHOT:
${JSON.stringify(contextData, null, 2)}

INSTRUCTIONS:
- Analyze the data snapshot to answer the user's question accurately.
- For PROJECT STATUS: Calculate completion as (completed_tasks / total_tasks * 100). Also mention completed_points vs total_points if relevant.
- For SPRINT STATUS: Use total_tasks and completed_tasks. Mention sprint_number and dates.
- For RISKS/BLOCKERS: Look for high priority tasks with approaching deadlines, or sprints/projects with low completion rates.
- For TEAM WORKLOAD: Check active_tasks count and total_points per team member. Identify overloaded (4+ tasks or 12+ points) or underutilized (0 tasks) members. Note: Project Managers are excluded from task assignments.
- For DEADLINES: Reference the urgent_tasks_this_week array for upcoming tasks.
- Keep answers concise, professional, and data-driven.
- If data is missing or insufficient, acknowledge it clearly.
- DO NOT hallucinate or make up data not present in the snapshot.

CRITICAL FORMATTING REQUIREMENTS - YOU MUST FOLLOW THESE EXACTLY:
- NEVER use ** or __ for bold text
- NEVER use * or _ for italic text
- NEVER use # for headers
- NEVER use any markdown formatting symbols
- Write in PLAIN TEXT ONLY
- For emphasis, use CAPITAL LETTERS or write the word normally
- For lists, use simple dashes (-) or numbers (1., 2., 3.)
- For sections, use simple text labels followed by a colon (:)

CORRECT FORMAT EXAMPLES:
✓ "Project Status: HRMS is active"
✓ "Completion Rate: 0%"
✓ "Sprint Status: Sprint 1 is active"
✓ "Team Workload Analysis:"
✓ "- Overloaded: Bhavesh (5 tasks, 15 points)"
✓ "- Underutilized: Sai Tejas (0 tasks)"

INCORRECT FORMAT EXAMPLES (DO NOT USE):
✗ "**Project Status:** HRMS is active"
✗ "**Completion Rate:** 0%"
✗ "## Sprint Status"
✗ "*Sprint 1* is active"

User Question: ${query}
`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: query }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.1, // Very precise
            max_tokens: 1024,
        });

        let answer = completion.choices[0]?.message?.content || "I couldn't generate an answer.";

        // Post-process to remove any markdown formatting that slipped through
        answer = answer
            .replace(/\*\*([^*]+)\*\*/g, '$1')  // Remove **bold**
            .replace(/\*([^*]+)\*/g, '$1')      // Remove *italic*
            .replace(/__([^_]+)__/g, '$1')      // Remove __bold__
            .replace(/_([^_]+)_/g, '$1')        // Remove _italic_
            .replace(/^#{1,6}\s+/gm, '')        // Remove # headers
            .replace(/`([^`]+)`/g, '$1');       // Remove `code`

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
