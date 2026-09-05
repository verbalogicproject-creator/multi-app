
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installSessionHandling } from './services/session';
import './index.css';

/* Before anything renders, so no request can escape unwrapped. When the backend is
   enforcing authentication every `/api` route answers 401 until you sign in, and
   without this the app would render its shell and quietly fill with nothing. */
installSessionHandling();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
