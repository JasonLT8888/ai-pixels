import express from 'express';
import cors from 'cors';
import projectsRouter from './routes/projects.js';
import configRouter from './routes/config.js';
import conversationsRouter from './routes/conversations.js';
import { projectChatsRouter, chatsRouter } from './routes/chats.js';
import llmRouter from './routes/llm.js';

const app = express();
const PORT = 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/projects', projectsRouter);
app.use('/api/config', configRouter);
app.use('/api/projects', conversationsRouter);
app.use('/api/projects', projectChatsRouter);  // /api/projects/:id/chats
app.use('/api/chats', chatsRouter);            // /api/chats/:chatId, /api/chats/:chatId/messages
app.use('/api/llm', llmRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
