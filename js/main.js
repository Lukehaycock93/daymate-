/* DAYMATE — Part 2 entry point. Waits for the core app, then starts each feature module. */
import { initAuth } from './auth.js';
import { initMemory } from './memory.js';
import { initNotifications } from './notifications.js';

const ready = () => (window.DAYMATE ? Promise.resolve(window.DAYMATE)
  : new Promise((resolve) => window.addEventListener('daymate:ready', () => resolve(window.DAYMATE), { once: true })));

ready().then((DM) => {
  try { initMemory(DM); } catch (err) { console.error('[DAYMATE] Memory failed to start:', err); }
  try { initNotifications(DM); } catch (err) { console.error('[DAYMATE] Notifications failed to start:', err); }
  try { initAuth(DM); } catch (err) { console.error('[DAYMATE] Accounts failed to start:', err); }
}).catch((err) => console.error('[DAYMATE] Part 2 failed to start:', err));
