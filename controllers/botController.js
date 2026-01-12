import Groq from "groq-sdk";
import db from '../config/knex.js';
import dotenv from 'dotenv';

dotenv.config();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

export const askBot = async (req, res) => {
    try {
        const { query } = req.body;

        // 1. PROJECTS with status metrics
        const projects = await db("projects as p")
            .leftJoin("tasks as t", "t.project_id", "p.id")
            .where("p.status", "active")
            .select(
                "p.id", "p.name", "p.status", "p.start_date", "p.end_date", "p.color",
                db.raw("COUNT(t.id) as total_tasks"),
                db.raw("COUNT(t.id) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')) as completed_tasks"),
                db.raw("COALESCE(SUM(t.potential_points), 0) as total_points"),
                db.raw("COALESCE(SUM(t.potential_points) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')), 0) as completed_points")
            )
            .groupBy("p.id")
            .orderBy("p.created_at", "desc");

        // 2. ACTIVE SPRINTS
        const sprints = await db("sprints as s")
            .join("projects as p", "p.id", "s.project_id")
            .leftJoin("tasks as t", "t.sprint_id", "s.id")
            .where("s.status", "active")
            .select(
                "s.id", "s.name", "s.status", "s.start_date", "s.end_date", "s.sprint_number",
                "p.name as project_name", "p.color as project_color",
                db.raw("COUNT(t.id) as total_tasks"),
                db.raw("COUNT(t.id) FILTER (WHERE LOWER(t.status) IN ('done', 'completed')) as completed_tasks"),
                db.raw("COALESCE(SUM(t.potential_points), 0) as total_points")
            )
            .groupBy("s.id", "p.name", "p.color")
            .orderBy("s.end_date", "asc");

        // 3. UPCOMING DEADLINES / RISKS
        const deadlines = await db("tasks as t")
            .join("projects as p", "p.id", "t.project_id")
            .leftJoin("users as u", "u.id", "t.assignee_id")
            .where(function () {
                this.where("t.end_datetime", ">=", db.fn.now()).orWhere("t.end_date", ">=", db.fn.now());
            })
            .whereNotIn(db.raw("LOWER(t.status)"), ["done", "completed"])
            .select(
                "t.id", "t.title", "t.priority", "t.end_datetime", "t.end_date", "t.status",
                "p.name as project_name", "u.full_name as assignee_name"
            )
            .orderByRaw("COALESCE(t.end_datetime, t.end_date::timestamp) ASC")
            .limit(15);

        // 4. TEAM UTILIZATION
        const team = await db("users as u")
            .leftJoin("tasks as t", function () {
                this.on("t.assignee_id", "=", "u.id").andOnNotIn(db.raw("LOWER(t.status)"), ["done", "completed", "cancelled"]);
            })
            .where("u.is_active", true)
            .whereNot("u.role", "Project Manager")
            .select(
                "u.id", "u.full_name", "u.role", "u.email",
                db.raw("COUNT(t.id) as active_tasks"),
                db.raw("COALESCE(SUM(t.potential_points), 0) as total_points")
            )
            .groupBy("u.id", "u.full_name", "u.role", "u.email")
            .orderBy("active_tasks", "desc");

        // Assemble Context
        const contextData = {
            projects_summary: projects,
            active_sprints: sprints,
            urgent_tasks_this_week: deadlines,
            team_workload: team
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
            temperature: 0.1,
            max_tokens: 1024,
        });

        let answer = completion.choices[0]?.message?.content || "I couldn't generate an answer.";

        // Post-process to remove any markdown formatting that slipped through
        answer = answer
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/`([^`]+)`/g, '$1');

        return res.status(200).json({ success: true, answer });

    } catch (error) {
        console.error("Bot Logic Error:", error);
        return res.status(500).json({ success: false, error: "I encountered an error processing your request: " + error.message });
    }
};
