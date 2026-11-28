/* ==========================================================================
   DAYMATE — shopping list logic (pure: no DOM, no network; unit-tested in tests/shopping_logic_test.mjs)
     • categories (the "aisles"), in the order you walk round a shop
     • guessCategory("2 litres of milk") → "dairy"
     • parseQuantity("2 litres of milk") → { name: "milk", quantity: "2 litres" }
     • groupItems(items, mode) → sections for the list
   ========================================================================== */

export const SHOP_CATEGORIES = [
  { key: 'produce',   label: 'Fruit & veg',     color: '#4fd6a0' },
  { key: 'dairy',     label: 'Dairy & eggs',    color: '#5fd6ff' },
  { key: 'bakery',    label: 'Bakery',          color: '#ffb54d' },
  { key: 'meat',      label: 'Meat & fish',     color: '#ff8fa3' },
  { key: 'frozen',    label: 'Frozen',          color: '#8ec5ff' },
  { key: 'pantry',    label: 'Cupboard',        color: '#d9a066' },
  { key: 'drinks',    label: 'Drinks',          color: '#a99bff' },
  { key: 'household', label: 'Household',       color: '#7fa6ff' },
  { key: 'health',    label: 'Health & beauty', color: '#f08bd6' },
  { key: 'other',     label: 'Other',           color: '#9aa8cf' },
];
export const SHOP_CATEGORY_KEYS = SHOP_CATEGORIES.map((c) => c.key);
export const catLabel = (k) => (SHOP_CATEGORIES.find((c) => c.key === k) || SHOP_CATEGORIES[SHOP_CATEGORIES.length - 1]).label;

/* ---- category guessing ---- */
// Phrases first: they beat single words ("peanut butter" is a cupboard item, not dairy).
const PHRASES = [
  [/\b(peanut|nut|almond) butter\b/, 'pantry'],
  [/\b(ice cream|frozen|fish fingers?|fish cakes?|ice lollies|oven chips|waffles?)\b/, 'frozen'],
  [/\b(chopped tomato(es)?|tinned|canned|baked beans|passata|tomato pur[eé]e|tomato paste)\b/, 'pantry'],
  [/\b(toilet (roll|paper|tissue)|kitchen (roll|towel)|bin bags?|washing (up )?(liquid|powder|tablets?|pods?)|dishwasher|fabric (softener|conditioner)|bleach|cling ?film|tin ?foil|aluminium foil|sponges?|bin liners?|light ?bulbs?|batteries|nappies|baby wipes|cat (food|litter)|dog (food|treats)|air freshener|laundry|detergent|surface (spray|cleaner)|dishwasher tablets?)\b/, 'household'],
  [/\b(tooth ?paste|tooth ?brush|shampoo|conditioner|deodorant|shower gel|body wash|soap|razors?|plasters?|paracetamol|ibuprofen|vitamins?|tampons?|sanitary|sun ?(cream|screen)|moisturi[sz]er|hand (gel|wash|cream)|mouth ?wash|cotton (wool|buds|pads)|lip balm)\b/, 'health'],
  [/\b(orange|apple|grape(fruit)?|cranberry|tomato|pineapple) (juice|squash)\b/, 'drinks'],
  [/\bsweet ?corn\b/, 'produce'],
  [/\b(coconut|almond|oat|soya?) milk\b/, 'dairy'],
];
const WORDS = {
  produce: 'apple banana orange lemon lime grape strawberry blueberry raspberry blackberry berry melon watermelon pear peach plum nectarine mango pineapple avocado tomato potato onion garlic carrot broccoli cauliflower cucumber lettuce spinach pepper mushroom courgette aubergine cabbage celery leek salad herb basil parsley coriander mint ginger veg vegetable veggie fruit satsuma clementine tangerine kiwi cherry beetroot parsnip swede pumpkin squash rocket chilli spring-onion radish asparagus kale sprout fennel rhubarb',
  dairy: 'milk cheese butter yoghurt yogurt cream egg cheddar mozzarella feta halloumi parmesan margarine custard creme fraiche brie camembert skyr kefir',
  bakery: 'bread loaf roll bun bagel croissant baguette wrap tortilla pitta pita crumpet muffin cake pastry scone naan sourdough brioche doughnut flatbread bap',
  meat: 'chicken beef pork lamb mince sausage bacon ham turkey steak salmon cod fish tuna prawn haddock gammon burger meatball fillet duck chorizo salami trout mackerel sardine',
  frozen: 'pizza sorbet lolly lollies',
  pantry: 'pasta rice flour sugar oil vinegar sauce ketchup mayo mayonnaise mustard cereal oats porridge beans lentils chickpea soup stock salt spice noodle jam honey marmalade biscuit crisp chocolate snack nuts syrup gravy curry paste cracker raisin sweetener yeast cornflour cous couscous quinoa tahini hummus pickle olive popcorn sweets cookie',
  drinks: 'water juice squash cola coke lemonade tea coffee wine beer lager cider gin vodka prosecco whisky smoothie soda fizz pepsi sparkling rum champagne ale tonic',
  household: 'foil bags candle napkin tissue tissues',
  health: 'medicine toothpaste',
};
const LOOKUP = new Map();
Object.entries(WORDS).forEach(([cat, list]) => list.split(/\s+/).forEach((w) => { if (!LOOKUP.has(w)) LOOKUP.set(w, cat); }));
const singular = (w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('oes') ? w.slice(0, -2) : w.endsWith('es') ? w.slice(0, -2) : w.endsWith('s') ? w.slice(0, -1) : w);

export function guessCategory(text) {
  const t = String(text || '').toLowerCase();
  for (const [re, cat] of PHRASES) if (re.test(t)) return cat;
  const words = t.match(/[a-z]+(?:-[a-z]+)?/g) || [];
  for (const w of words) {
    const hit = LOOKUP.get(w) || LOOKUP.get(singular(w)) || LOOKUP.get(`${singular(w)}e`);
    if (hit) return hit;
  }
  return 'other';
}

/* ---- quantity parsing ---- */
const UNIT = '(?:kg|kilos?|g|grams?|l|litres?|liters?|ml|cl|pints?|packs?|packets?|tins?|cans?|bottles?|boxes|box|bags?|loaves|loaf|dozen|pcs|pieces|bunch(?:es)?|jars?|cartons?|rolls?)';
const NUM = '(\\d+(?:[.,]\\d+)?|\\d+\\/\\d+|a dozen|half a dozen)';
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function parseQuantity(input) {
  const text = clean(input);
  if (!text) return { name: '', quantity: '' };
  let m;
  // a bare "2 litres" is just a name, not a quantity of nothing
  if (new RegExp(`^${NUM}\\s*${UNIT}$`, 'i').test(text)) return { name: text, quantity: '' };
  // "a dozen eggs", "half a dozen eggs"
  if ((m = /^(half a dozen|a dozen)\s+(?:of\s+)?(.+)$/i.exec(text)) && clean(m[2])) return { name: clean(m[2]), quantity: m[1].toLowerCase() };
  // "2 litres of milk", "500g mince", "2kg potatoes"
  if ((m = new RegExp(`^${NUM}\\s*(${UNIT})\\b\\s*(?:of\\s+)?(.+)$`, 'i').exec(text)) && clean(m[3])) return { name: clean(m[3]), quantity: clean(`${m[1]} ${m[2]}`.replace(/(\d)\s+(kg|g|ml|cl|l)$/i, '$1$2')) };
  // "2 x milk", "2x milk", "2 × milk"
  if ((m = /^(\d+(?:[.,]\d+)?)\s*[x×]\s*(.+)$/i.exec(text)) && clean(m[2])) return { name: clean(m[2]), quantity: m[1] };
  // "2 milk" (a number, a space, then the item). "7up" and "3-bean salad" are left alone.
  if ((m = /^(\d{1,3})\s+([^\d].*)$/.exec(text)) && clean(m[2])) return { name: clean(m[2]), quantity: m[1] };
  // "milk x2", "milk (2)"
  if ((m = /^(.+?)\s*(?:[x×]\s*(\d{1,3})|\((\d{1,3})\))$/i.exec(text)) && clean(m[1])) return { name: clean(m[1]), quantity: m[2] || m[3] };
  return { name: text, quantity: '' };
}

/** Everything the add box and the AI need: clean name, quantity and category in one go. */
export function parseItem(input) {
  const { name, quantity } = parseQuantity(input);
  const n = name.slice(0, 80).trim();
  return { name: n, quantity: quantity.slice(0, 30), category: guessCategory(n) };
}

/* ---- grouping for the list ---- */
export const SORT_MODES = ['aisle', 'added'];
export const DONE_LABEL = 'In the trolley';
/** mode "aisle": to-buy items under their category (walk-round order), ticked items last.
 *  mode "added": one list in the order added, ticked items last. */
export function groupItems(items, mode = 'aisle') {
  const todo = items.filter((i) => !i.checked), done = items.filter((i) => i.checked);
  const byAdded = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || byAdded(a, b);
  const out = [];
  if (mode === 'added') {
    if (todo.length) out.push({ key: 'todo', label: '', items: [...todo].sort(byAdded) });
  } else {
    SHOP_CATEGORIES.forEach((c) => {
      const rs = todo.filter((i) => (SHOP_CATEGORY_KEYS.includes(i.category) ? i.category : 'other') === c.key);
      if (rs.length) out.push({ key: c.key, label: c.label, color: c.color, items: rs.sort(byName) });
    });
  }
  if (done.length) out.push({ key: 'done', label: DONE_LABEL, items: [...done].sort(byAdded) });
  return out;
}

/** "2 × milk" style text for toasts and the live preview. */
export const describe = ({ name, quantity }) => (quantity ? `${quantity} × ${name}` : name);
