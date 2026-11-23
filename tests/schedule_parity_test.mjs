import { computeNotifications, leadBody, activeLeads } from '../js/schedule.js';
import { fingerprint, toRow, fromRow, isUuid } from '../js/mapping.js';
let pass = 0, fail = 0; const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (c ? '' : ' | ' + d)); };
const prefs = { tasks: true, appointments: true, reminders: true, bills: true, leadMinutes: [0, 15, 60], defaultTime: '09:00' };
const D = '2026-11-23';
const at = (hh, mm) => new Date(2026, 10, 23, hh, mm, 10);       // local time, 23 Nov 2026
const task = { id: 't1', title: 'Task', date: D, time: '09:30', completed: false };
const run = (now, premium, extra = {}) => computeNotifications({ now, tasks: [task], reminders: [], prefs: { ...prefs, ...extra }, premium, existingKeys: [] });
// same cases the SQL tests assert
ok('due at 09:30 -> one "Due now" (free uses first lead only)', run(at(9, 30), false).length === 1 && run(at(9, 30), false)[0].body === 'Due now');
ok('not due at 09:20', run(at(9, 20), false).length === 0);
ok('premium 15-min lead fires at 09:15 with key L15', run(at(9, 15), true).some((n) => n.dedupeKey === 'task:t1:L15:2026-11-23T09:30' && n.body === 'Due in 15 min'));
ok('premium 60-min lead fires at 08:30', run(at(8, 30), true).some((n) => n.dedupeKey.endsWith(':L60:2026-11-23T09:30') && n.body === 'Due in 1 h'));
ok('free user never gets extra leads', run(at(9, 15), false).length === 0);
ok('dedupe key format matches server (source:id:L<lead>:<local due>)', run(at(9, 30), false)[0].dedupeKey === 'task:t1:L0:2026-11-23T09:30');
ok('existing key suppresses a repeat', computeNotifications({ now: at(9, 30), tasks: [task], reminders: [], prefs, premium: false, existingKeys: ['task:t1:L0:2026-11-23T09:30'] }).length === 0);
ok('completed task ignored', computeNotifications({ now: at(9, 30), tasks: [{ ...task, completed: true }], reminders: [], prefs, premium: false, existingKeys: [] }).length === 0);
ok('category off suppresses', run(at(9, 30), false, { tasks: false }).length === 0);
const bill = { id: 'b1', title: 'Energy', kind: 'bill', date: D, time: '', note: '', done: false };
const billRun = (now) => computeNotifications({ now, tasks: [], reminders: [bill], prefs, premium: false, existingKeys: [] });
ok('date-only bill uses default time 09:00 and type bill', billRun(at(9, 0))[0].type === 'bill' && billRun(at(9, 0))[0].dedupeKey === 'reminder:b1:L0:2026-11-23T09:00');
ok('bill 70 min late -> "missed" (not "due now")', billRun(at(10, 10)).length === 1 && billRun(at(10, 10))[0].type === 'missed');
ok('missed has its own stable key', billRun(at(10, 10))[0].dedupeKey === 'missed:reminder:b1:2026-11-23T09:00');
ok('missed ignored after 7 days', computeNotifications({ now: new Date(2026, 11, 5, 9, 0), tasks: [], reminders: [bill], prefs, premium: false, existingKeys: [] }).length === 0);
ok('tasks are never "missed" (they show as Overdue on Home)', computeNotifications({ now: at(15, 0), tasks: [task], reminders: [], prefs, premium: false, existingKeys: [] }).every((n) => n.type !== 'missed'));
const flood = Array.from({ length: 60 }, (_, i) => ({ id: 'r' + i, title: 'x' + i, kind: 'reminder', date: D, time: '08:00', note: '', done: false }));
ok('never floods the inbox (cap 25)', computeNotifications({ now: at(9, 30), tasks: [], reminders: flood, prefs, premium: false, existingKeys: [] }).length === 25);
ok('leadBody matches SQL wording', leadBody(0, '') === 'Due now' && leadBody(5, 'n') === 'Due in 5 min · n' && leadBody(1440, '') === 'Due in 24 h');
// mapping round trips
const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rem = { id: crypto.randomUUID(), title: 'Dentist', kind: 'event', date: D, time: '14:30', note: 'card', done: false, createdAt: '2026-11-22T10:00:00.000Z', updatedAt: '2026-11-22T10:00:00.000Z' };
const row = toRow('reminders', rem, uid);
const back = fromRow('appointments', { ...row, appt_time: '14:30:00' });
ok('appointment round-trips through cloud shape', back.title === 'Dentist' && back.time === '14:30' && back.kind === 'event' && back.tbl === 'appointments' && back.updatedAt === rem.updatedAt);
ok('fingerprint ignores case/whitespace', fingerprint('tasks', { title: ' Buy  Milk ', date: D, time: '' }) === fingerprint('tasks', { title: 'buy milk', date: D, time: '' }));
ok('isUuid rejects legacy ids', !isUuid('id-123-abc') && isUuid(crypto.randomUUID()));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
