import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { registerServiceWorker, requestNotificationPermission } from './lib/offline';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

registerServiceWorker();
if (typeof window !== 'undefined') {
  setTimeout(() => { requestNotificationPermission(); }, 3000);
}
