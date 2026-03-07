import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ProjectProvider } from './store/ProjectContext';
import { ChatProvider } from './store/ChatContext';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProjectProvider>
      <ChatProvider>
        <App />
      </ChatProvider>
    </ProjectProvider>
  </React.StrictMode>
);
