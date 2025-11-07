import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import pool from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import moduleRoutes from './routes/moduleRoutes.js';
import sprintRoutes from './routes/sprintRoutes.js';
import timesheetRoutes from './routes/timesheetRoutes.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/sprints', sprintRoutes);
app.use('/api/timesheets', timesheetRoutes);

// Health check
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', db_time: r.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
