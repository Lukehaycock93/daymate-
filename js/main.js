/* DAYMATE — Part 2 entry point. Waits for the core app, then starts each feature module. */
import { initAuth } from './auth.js';
import { initMemory } from './memory.js';
import { initNotifications } from './notifications.js';
import { initConsent } from './consent.js';
import { initPlanner } from './planner.js';
import { initAssistant } from './assistant.js';
import { initBilling } from './billing.js';
import { initAds } from './ads.js';
import { initTheme } from './theme.js';
import { initDashboard } from './dashboard.js';
import { initWeather } from './weather.js';
import { initSettingsHub } from './settings.js';
import { initShopping } from './shopping.js';

const ready = () => (window.DAYMATE ? Promise.resolve(window.DAYMATE)
  : new Promise((resolve) => window.addEventListener('daymate:ready', () => resolve(window.DAYMATE), { once: true })));

ready().then((DM) => {
  try { initTheme(DM); } catch (err) { console.error('[DAYMATE] Appearance failed to start:', err); }
  try { initDashboard(DM); } catch (err) { console.error('[DAYMATE] Dashboard failed to start:', err); }
  try { initWeather(DM); } catch (err) { console.error('[DAYMATE] Weather failed to start:', err); }
  try { initPlanner(DM); } catch (err) { console.error('[DAYMATE] Planner failed to start:', err); }
  try { initAssistant(DM); } catch (err) { console.error('[DAYMATE] Assistant failed to start:', err); }
  try { initBilling(DM); } catch (err) { console.error('[DAYMATE] Premium screen failed to start:', err); }
  try { initAds(DM); } catch (err) { console.error('[DAYMATE] Ads failed to start:', err); }
  try { initMemory(DM); } catch (err) { console.error('[DAYMATE] Memory failed to start:', err); }
  try { initNotifications(DM); } catch (err) { console.error('[DAYMATE] Notifications failed to start:', err); }
  try { initConsent(DM); } catch (err) { console.error('[DAYMATE] Privacy choices failed to start:', err); }
  try { initSettingsHub(DM); } catch (err) { console.error('[DAYMATE] Settings hub failed to start:', err); }
  try { initShopping(DM); } catch (err) { console.error('[DAYMATE] Shopping upgrade failed to start:', err); }
  try { initAuth(DM); } catch (err) { console.error('[DAYMATE] Accounts failed to start:', err); }
}).catch((err) => console.error('[DAYMATE] Part 2 failed to start:', err));
