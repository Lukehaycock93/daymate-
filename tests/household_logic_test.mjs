import * as H from '../js/household-logic.js';
let pass = 0, fail = 0;
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : (fail++, console.log('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b))); };
eq(H.addMonths('2026-01-31', 1), '2026-02-28', 'clamp feb'); eq(H.addMonths('2028-01-31', 1), '2028-02-29', 'leap'); eq(H.addMonths('2026-12-15', 1), '2027-01-15', 'year roll');
eq(H.daysBetween('2026-11-28', '2026-12-01'), 3, 'days'); eq(H.daysBetween('2026-03-28', '2026-03-30'), 2, 'dst-safe'); eq(H.daysBetween('2026-11-28', '2026-11-26'), -2, 'neg');
eq(H.isDate('2026-02-30'), false, 'bad date'); eq(H.isDate('2026-02-28'), true, 'ok date');
// encode/decode
const note = { kind: 'note', title: 'Wifi', text: 'Name: Home\nPass: abc' }; eq(H.decode('note', H.encode(note)).text, 'Name: Home\nPass: abc', 'note round trip');
const d = { kind: 'date', title: 'Car MOT', date: '2027-03-01', repeat: 'yearly', text: 'Garage on Otley Rd' }; eq(H.decode('date', H.encode(d)), { date: '2027-03-01', repeat: 'yearly', text: 'Garage on Otley Rd' }, 'date round trip');
const c = { kind: 'chore', title: 'Bins', every: 'weekly', due: '2026-12-01', lastDone: '2026-11-24', done: false, text: '' }; eq(H.decode('chore', H.encode(c)), { every: 'weekly', due: '2026-12-01', lastDone: '2026-11-24', done: false, text: '' }, 'chore round trip');
eq(H.encode({ kind: 'chore', title: 'x', every: 'weekly', due: '2026-12-01', text: 'z'.repeat(400) }).length <= 500, true, 'fits 500');
eq(H.encode({ kind: 'note', title: 'x', text: 'n'.repeat(900) }).length, 500, 'note cap');
eq(H.decode('chore', 'not json').text, 'not json', 'bad json kept as text'); eq(H.decode('date', '{"d":"zzz","r":"hourly"}'), { date: '', repeat: '', text: '' }, 'bad fields');
// normalise
eq(H.normalise({ kind: 'bogus', title: 'x' }), null, 'bad kind'); eq(H.normalise({ kind: 'note', title: '  ' }), null, 'no title'); eq(H.normalise({ kind: 'date', title: 'x', date: 'nope' }), null, 'date needs date');
eq(H.normalise({ kind: 'chore', title: 'x', every: 'weekly', done: true }).done, false, 'repeating chore never "done"'); eq(H.normalise({ kind: 'chore', title: 'x', done: true }).done, true, 'one-off done');
eq(H.normalise({ kind: 'note', title: 'a'.repeat(200), text: 'b' }).title.length, 80, 'title cap');
// dates
const T = '2026-11-28';
eq(H.nextOccurrence({ date: '2020-12-25', repeat: 'yearly' }, T), '2026-12-25', 'yearly future this year'); eq(H.nextOccurrence({ date: '2020-11-01', repeat: 'yearly' }, T), '2027-11-01', 'yearly next year');
eq(H.nextOccurrence({ date: '2020-11-28', repeat: 'yearly' }, T), '2026-11-28', 'yearly today'); eq(H.nextOccurrence({ date: '2024-02-29', repeat: 'yearly' }, '2026-11-28'), '2027-02-28', 'leap birthday');
eq(H.nextOccurrence({ date: '2026-01-31', repeat: 'monthly' }, T), '2026-11-30', 'monthly (clamped to 30 Nov)'); eq(H.nextOccurrence({ date: '2026-01-01', repeat: '' }, T), '', 'past one-off');
eq(H.dateInfo({ date: '2026-12-01', repeat: '' }, T), { next: '2026-12-01', days: 3, state: 'soon' }, 'soon'); eq(H.dateInfo({ date: '2026-11-28' }, T).state, 'today', 'today');
eq(H.sortDates([{ title: 'old', date: '2020-01-01', repeat: '' }, { title: 'b', date: '2027-01-01', repeat: '' }, { title: 'a', date: '2026-12-01', repeat: '' }], T).map((x) => x.title), ['a', 'b', 'old'], 'date sort');
// chores
eq(H.completeChore({ every: 'weekly', due: '2026-11-28' }, T), { done: false, lastDone: T, due: '2026-12-05' }, 'weekly due today');
eq(H.completeChore({ every: 'weekly', due: '2026-11-10' }, T), { done: false, lastDone: T, due: '2026-12-01' }, 'overdue rolls past today');
eq(H.completeChore({ every: 'weekly', due: '2026-11-30' }, T), { done: false, lastDone: T, due: '2026-12-07' }, 'early completion');
eq(H.completeChore({ every: 'daily', due: '2026-11-20' }, T).due, '2026-11-29', 'daily'); eq(H.completeChore({ every: 'monthly', due: '2026-10-31' }, T).due, '2026-11-30', 'monthly roll');
eq(H.completeChore({ every: '', due: '' }, T), { done: true, lastDone: T }, 'one-off');
eq(H.completeChore({ every: 'weekly', due: '' }, T).due, '2026-12-05', 'no due date');
eq(H.choreStatus({ due: '2026-11-27' }, T).state, 'overdue', 'overdue'); eq(H.choreStatus({ due: T }, T).state, 'today', 'today'); eq(H.choreStatus({ due: '2026-11-30' }, T).state, 'soon', 'soon'); eq(H.choreStatus({ due: '2026-12-20' }, T).state, 'later', 'later'); eq(H.choreStatus({ due: '' }, T).state, 'anytime', 'anytime'); eq(H.choreStatus({ done: true, due: T }, T).state, 'done', 'done');
eq(H.sortChores([{ title: 'z', done: true }, { title: 'b', due: '2026-12-20' }, { title: 'a', due: '2026-11-20' }, { title: 'c' }], T).map((x) => x.title), ['a', 'b', 'c', 'z'], 'chore sort');
eq(H.whenLabel(3), 'In 3 days', 'label'); eq(H.whenLabel(-3), '3 days overdue', 'label od'); eq(H.whenLabel(0), 'Today', 'label today');
// overview
const items = [{ kind: 'chore', title: 'a', due: '2026-11-20' }, { kind: 'chore', title: 'b', due: T }, { kind: 'chore', title: 'c', done: true }, { kind: 'date', title: 'd', date: '2026-12-02', repeat: '' }, { kind: 'date', title: 'e', date: '2026-02-01', repeat: '' }, { kind: 'note', title: 'n' }];
const o = H.overview(items, T, 4); eq([o.overdue, o.dueToday, o.open, o.doneChores, o.datesSoon, o.notes, o.shoppingLeft, o.nextDate.d.title, o.empty], [1, 1, 2, 1, 1, 1, 4, 'd', false], 'overview');
eq(H.overview([], T).empty, true, 'empty overview');
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
