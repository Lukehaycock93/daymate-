/* DAYMATE — Part 2 entry point. Waits for the core app, then starts each feature module. */
import { initAuth } from './auth.js';
import { initMemory } from './memory.js';
import { initNotifications } from './notifications.js';
import { initConsent } from './consent.js';
import { initPlanner } from './planner.js';

const ready = () => (window.DAYMATE ? Promise.resolve(window.DAYMATE)
  : new Promise((resolve) => window.addEventListener('daymate:ready', () => resolve(window.DAYMATE), { once: true })));

ready().then((DM) => {
  try { initPlanner(DM); } catch (err) { console.error('[DAYMATE] Planner failed to start:', err); }
  try { initMemory(DM); } catch (err) { console.error('[DAYMATE] Memory failed to start:', err); }
  try { initNotifications(DM); } catch (err) { console.error('[DAYMATE] Notifications failed to start:', err); }
  try { initConsent(DM); } catch (err) { console.error('[DAYMATE] Privacy choices failed to start:', err); }
  try { initAuth(DM); } catch (err) { console.error('[DAYMATE] Accounts failed to start:', err); }
}).catch((err) => console.error('[DAYMATE] Part 2 failed to start:', err));
