import express from 'express';
import { getNotes, createNote, updateNote, deleteNote } from '../controllers/noteController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', getNotes);
router.post('/', createNote);
router.put('/:id', updateNote); // Update content or color
router.delete('/:id', deleteNote);

export default router;
