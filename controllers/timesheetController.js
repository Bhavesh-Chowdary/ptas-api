import db from "../config/knex.js";
import { logChange } from './changeLogController.js';

export const createTimesheet = async (req, res) => {
  try {
    const { task_id, minutes_logged, notes, log_date } = req.body;
    const user_id = req.user.userId;

    if (!minutes_logged || minutes_logged <= 0) {
      return res.status(400).json({ success: false, error: 'minutes_logged must be greater than 0' });
    }

    const [timesheet] = await db('timesheets').insert({
      user_id,
      task_id: task_id || null,
      log_date: log_date || new Date(),
      minutes_logged,
      source: 'manual',
      notes: notes || null
    }).returning('*');

    return res.status(201).json({ success: true, data: timesheet });
  } catch (err) {
    console.error("Create Timesheet Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
};

export const autoLogTime = async (task_id, user_id, minutes, note) => {
  try {
    await db('timesheets').insert({
      user_id,
      task_id,
      log_date: db.fn.now(),
      minutes_logged: minutes,
      source: 'auto',
      notes: note
    });
  } catch (err) {
    console.error('Auto-log error:', err.message);
  }
};

export const getTimesheets = async (req, res) => {
  try {
    const { user_id, week_start, week_end } = req.query;

    let query = db('timesheets as t')
      .leftJoin('users as u', 'u.id', 't.user_id')
      .leftJoin('tasks as ts', 'ts.id', 't.task_id')
      .leftJoin('projects as p', 'p.id', 'ts.project_id')
      .select('t.*', 'u.full_name AS user_name', 'ts.title AS task_title', 'p.name AS project_name')
      .orderBy('t.log_date', 'desc');

    if (user_id) query = query.where('t.user_id', user_id);
    if (week_start && week_end) query = query.whereBetween('t.log_date', [week_start, week_end]);

    const timesheets = await query;
    return res.status(200).json({ success: true, data: timesheets });
  } catch (err) {
    console.error("Get Timesheets Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const approveTimesheet = async (req, res) => {
  try {
    const { id } = req.params;
    const approved_by = req.user.userId;

    const before = await db('timesheets').where({ id }).first();
    if (!before) {
      return res.status(404).json({ success: false, error: "Timesheet not found" });
    }

    const [after] = await db('timesheets').where({ id }).update({ approved_by }).returning('*');

    await logChange('timesheet', id, 'approve', before, after, approved_by);
    return res.status(200).json({ success: true, data: after });
  } catch (err) {
    console.error("Approve Timesheet Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getWeeklySummary = async (req, res) => {
  try {
    const { week_start, week_end } = req.query;
    if (!week_start || !week_end) {
      return res.status(400).json({ success: false, error: "week_start and week_end are required" });
    }

    const summary = await db('timesheets as t')
      .join('users as u', 'u.id', 't.user_id')
      .whereBetween('t.log_date', [week_start, week_end])
      .select('u.full_name')
      .sum('t.minutes_logged as total_minutes')
      .countDistinct('t.task_id as tasks_worked')
      .groupBy('u.full_name')
      .orderBy('total_minutes', 'desc');

    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    console.error("Get Weekly Summary Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getGeneratedTimesheetPreview = async (req, res) => {
  try {
    const { project_id, user_id, start_date, end_date } = req.query;

    if (!user_id || !start_date || !end_date) {
      return res.status(400).json({ success: false, error: "user_id, start_date, and end_date are required" });
    }

    const user = await db('users').select('id', 'full_name', 'role', 'Emp_id').where({ id: user_id }).first();
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const project = project_id ? await db('projects').select('id', 'name', 'project_code').where({ id: project_id }).first() : { name: 'N/A' };

    let logQuery = db('timesheets as t')
      .leftJoin('tasks as ts', 'ts.id', 't.task_id')
      .where('t.user_id', user_id)
      .whereBetween('t.log_date', [start_date, end_date])
      .select('t.*', 'ts.task_code', 'ts.title AS task_title')
      .orderBy('t.log_date', 'asc');

    if (project_id) logQuery = logQuery.where('ts.project_id', project_id);
    const logs = await logQuery;

    const assignedTasks = await db('tasks')
      .where({ assignee_id: user_id, project_id })
      .select('task_code', 'start_date', 'end_date');

    const dailyData = [];
    const start = new Date(start_date + 'T00:00:00.000Z');
    const end = new Date(end_date + 'T00:00:00.000Z');
    let curr = new Date(start);

    while (curr <= end) {
      const dateStr = curr.toISOString().split('T')[0];
      const dayStrDisplay = curr.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });

      const dayLogs = logs.filter(l => new Date(l.log_date).toISOString().split('T')[0] === dateStr);

      if (dayLogs.length > 0) {
        dayLogs.forEach(l => {
          const totalMins = l.minutes_logged;
          const regularHours = Math.min(8, totalMins / 60);
          const overtimeHours = Math.max(0, (totalMins / 60) - 8);
          dailyData.push({
            date: dateStr, day: dayStrDisplay, task_id: l.task_code || 'N/A',
            start_time: '10:00', end_time: '18:00', regular_hrs: regularHours.toFixed(2),
            overtime_hrs: overtimeHours.toFixed(2), sick_hrs: '0.00', vacation_hrs: '0.00',
            holiday_hrs: '0.00', other_hrs: '0.00', total_hrs: (totalMins / 60).toFixed(2)
          });
        });
      } else {
        const tasksForDay = assignedTasks.filter(t => {
          if (!t.start_date) return false;
          const sDate = new Date(t.start_date).toISOString().split('T')[0];
          const eDate = t.end_date ? new Date(t.end_date).toISOString().split('T')[0] : sDate;
          return dateStr >= sDate && dateStr <= eDate;
        });

        if (tasksForDay.length > 0) {
          tasksForDay.forEach(t => {
            dailyData.push({
              date: dateStr, day: dayStrDisplay, task_id: t.task_code || 'N/A',
              start_time: '10:00', end_time: '18:00', regular_hrs: '8.00',
              overtime_hrs: '0.00', sick_hrs: '0.00', vacation_hrs: '0.00',
              holiday_hrs: '0.00', other_hrs: '0.00', total_hrs: '8.00'
            });
          });
        } else {
          dailyData.push({
            date: dateStr, day: dayStrDisplay, task_id: 'N/A',
            start_time: '', end_time: '', regular_hrs: '0.00',
            overtime_hrs: '0.00', sick_hrs: '0.00', vacation_hrs: '0.00',
            holiday_hrs: '0.00', other_hrs: '0.00', total_hrs: '0.00'
          });
        }
      }
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    const totalHours = dailyData.reduce((acc, d) => acc + parseFloat(d.total_hrs), 0).toFixed(2);

    return res.status(200).json({
      success: true,
      data: {
        employee: { id: user.id, name: user.full_name, emp_id: user.Emp_id },
        project: { id: project.id, name: project.name },
        start_date, end_date, daily_data: dailyData,
        assigned_tasks: assignedTasks, total_hours: totalHours
      }
    });
  } catch (err) {
    console.error("Get Generated Timesheet Preview Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
};

export const saveTimesheet = async (req, res) => {
  try {
    const { project_id, user_id, supervisor_id, start_date, end_date, daily_data, total_hours, status } = req.body;

    const [timesheet] = await db('weekly_timesheets').insert({
      project_id: project_id || null,
      user_id,
      supervisor_id: supervisor_id || null,
      week_start: start_date,
      week_end: end_date,
      daily_data: JSON.stringify(daily_data),
      total_hours,
      status: status || 'draft'
    }).returning('*');

    return res.status(201).json({ success: true, data: timesheet });
  } catch (err) {
    console.error("Save Timesheet Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
};

export const getTimesheetHistory = async (req, res) => {
  try {
    const { role, userId } = req.user;
    let query = db('weekly_timesheets as wt')
      .leftJoin('users as u', 'u.id', 'wt.user_id')
      .leftJoin('users as s', 's.id', 'wt.supervisor_id')
      .leftJoin('projects as p', 'p.id', 'wt.project_id')
      .select('wt.*', 'u.full_name AS employee_name', 's.full_name AS supervisor_name', 'p.name AS project_name')
      .orderBy('wt.created_at', 'desc');

    if (role === 'developer' || role === 'qa') {
      query = query.where('wt.user_id', userId);
    }

    const history = await query;
    return res.status(200).json({ success: true, data: history });
  } catch (err) {
    console.error("Get Timesheet History Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

export const getTimesheetById = async (req, res) => {
  try {
    const { id } = req.params;
    const timesheet = await db('weekly_timesheets as wt')
      .leftJoin('users as u', 'u.id', 'wt.user_id')
      .leftJoin('users as s', 's.id', 'wt.supervisor_id')
      .leftJoin('projects as p', 'p.id', 'wt.project_id')
      .where('wt.id', id)
      .select('wt.*', 'u.full_name AS employee_name', 'u.Emp_id AS emp_id', 's.full_name AS supervisor_name', 'p.name AS project_name')
      .first();

    if (!timesheet) {
      return res.status(404).json({ success: false, error: "Timesheet not found" });
    }

    return res.status(200).json({ success: true, data: timesheet });
  } catch (err) {
    console.error("Get Timesheet By ID Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
