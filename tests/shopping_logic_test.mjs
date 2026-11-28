import { guessCategory, parseQuantity, parseItem, groupItems, SHOP_CATEGORY_KEYS, describe } from '../js/shopping-logic.js';
let pass = 0, fail = 0;
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : (fail++, console.log('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b))); };

[['milk', 'dairy'], ['2 litres of milk', 'dairy'], ['Bananas', 'produce'], ['tomatoes', 'produce'], ['peanut butter', 'pantry'],
 ['oat milk', 'dairy'], ['orange juice', 'drinks'], ['toilet roll', 'household'], ['toothpaste', 'health'], ['ice cream', 'frozen'],
 ['chopped tomatoes', 'pantry'], ['sourdough bread', 'bakery'], ['chicken breast', 'meat'], ['bin bags', 'household'], ['sweetcorn', 'produce'],
 ['xyzzy', 'other'], ['', 'other'], ['Strawberries', 'produce'], ['eggs', 'dairy'], ['baked beans', 'pantry']
].forEach(([t, c]) => eq(guessCategory(t), c, `cat ${t}`));

[['2 litres of milk', 'milk', '2 litres'], ['500g mince', 'mince', '500g'], ['2kg potatoes', 'potatoes', '2kg'], ['2 x milk', 'milk', '2'],
 ['3 apples', 'apples', '3'], ['milk x2', 'milk', '2'], ['milk (2)', 'milk', '2'], ['7up', '7up', ''], ['milk', 'milk', ''],
 ['  bread  ', 'bread', ''], ['12 eggs', 'eggs', '12'], ['a dozen eggs', 'eggs', 'a dozen'], ['2 litres', '2 litres', '']
].forEach(([t, n, q]) => eq(parseQuantity(t), { name: n, quantity: q }, `qty ${t}`));

eq(parseItem('2 litres of milk'), { name: 'milk', quantity: '2 litres', category: 'dairy' }, 'parseItem');
eq(parseItem('x'.repeat(200)).name.length, 80, 'name cap');
eq(describe({ name: 'milk', quantity: '2' }), '2 × milk', 'describe');
eq(describe({ name: 'milk', quantity: '' }), 'milk', 'describe plain');

const items = [
  { id: 1, name: 'Milk', category: 'dairy', checked: false, createdAt: '2026-01-01' },
  { id: 2, name: 'Apples', category: 'produce', checked: false, createdAt: '2026-01-02' },
  { id: 3, name: 'Bananas', category: 'produce', checked: true, createdAt: '2026-01-03' },
  { id: 4, name: 'Mystery', category: 'bogus', checked: false, createdAt: '2026-01-04' },
  { id: 5, name: 'Avocado', category: 'produce', checked: false, createdAt: '2026-01-05' },
];
const g = groupItems(items, 'aisle');
eq(g.map((s) => s.key), ['produce', 'dairy', 'other', 'done'], 'aisle order');
eq(g[0].items.map((i) => i.name), ['Apples', 'Avocado'], 'sorted by name');
eq(g[3].label, 'In the trolley', 'done label');
const a = groupItems(items, 'added');
eq(a.map((s) => s.key), ['todo', 'done'], 'added groups');
eq(a[0].items.map((i) => i.id), [1, 2, 4, 5], 'added order');
eq(groupItems([], 'aisle'), [], 'empty');
eq(SHOP_CATEGORY_KEYS.length, 10, 'ten cats');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
