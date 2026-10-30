// Reading a product's box from a photo, for free, on the device itself (Tesseract, English).
// It finds the brand (from the shop's list, or well-known accessory brands), the model code,
// the specs (W, mAh, A, length) and the product type, and suggests a name the person can fix.

let workerP = null;
function loadScript(src) {
  return new Promise((ok, fail) => {
    if (window.Tesseract) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error('مقدرناش نحمّل قارئ الصور — اتأكد من النت أول مرة'));
    document.head.append(s);
  });
}
async function worker() {
  workerP ||= (async () => {
    await loadScript('/vendor/tesseract/tesseract.min.js');
    return window.Tesseract.createWorker('eng', 1, {
      workerPath: '/vendor/tesseract/worker.min.js',
      corePath: '/vendor/tesseract-core',
      langPath: '/vendor/tesseract-lang',
    });
  })();
  try { return await workerP; } catch (e) { workerP = null; throw e; }
}

// Well-known accessory brands, so a brand that isn't in the shop's list yet is still recognised
const KNOWN_BRANDS = ['Anker', 'soundcore', 'Baseus', 'UGREEN', 'JOYROOM', 'ACEFAST', 'VIDVIE', 'Apple', 'Samsung', 'Xiaomi', 'Redmi',
  'JBL', 'Belkin', 'Momax', 'mophie', 'Remax', 'HOCO', 'Borofone', 'XO', 'Earldom', 'LDNIO', 'oraimo', 'Lenovo', 'Huawei', 'Honor',
  'Infinix', 'realme', 'OPPO', 'vivo', 'Green Lion', 'Porodo', 'Powerology', 'AUKEY', 'SENDEM', 'iLock', 'PLOXAMA', 'inkax', 'RECCI',
  'WiWU', 'ROCK', 'USAMS', 'Yesido', 'Spigen', 'ESR', 'TORRAS', 'Mcdodo', 'ESSAGER', 'ROMOSS', 'Energizer', 'Philips', 'Sony',
  'Marshall', 'Beats', 'Nothing', 'OnePlus', 'Google', 'Motorola', 'Nokia', 'TECNO', 'itel', 'POCO', 'Haylou', 'QCY', 'Havit',
  'Kingston', 'SanDisk', 'Lexar', 'Transcend', 'Logitech', 'Riversong', 'Dux Ducis', 'Kakusiga', 'Awei', 'Lenyes', 'Sendem'];

// Product type words -> how it's named, and which section it goes to
const TYPES = [
  [/power\s*bank/i, 'Power Bank', 'acc'],
  [/car\s*charger/i, 'Car Charger', 'charge'],
  [/charger\s*kit/i, 'Charger Kit', 'charge'],
  [/(wall|travel|fast|power)\s*(charger|adapter)|charger/i, 'Charger', 'charge'],
  [/aux/i, 'Aux Cable', 'charge'],
  [/(data|charging|charge)?\s*cable/i, 'Cable', 'charge'],
  [/earbuds|tws/i, 'Wireless Earbuds', 'audio'],
  [/neckband/i, 'Neckband Earphones', 'audio'],
  [/head\s*phones?/i, 'Headphones', 'audio'],
  [/head\s*set|ear\s*phones?|earpods|in-?ear/i, 'Headset', 'audio'],
  [/speaker/i, 'Bluetooth Speaker', 'audio'],
  [/otg/i, 'OTG Adapter', 'acc'],
  [/holder|bracket|stand|mount/i, 'Holder', 'acc'],
  [/stylus|pen\b/i, 'Stylus Pen', 'acc'],
  [/led|light/i, 'LED Light', 'acc'],
  [/adapter/i, 'Adapter', 'acc'],
];
const SECTION_WORDS = { charge: /شاحن|كابل/, audio: /سماع|صوت/, acc: /اكسسوار|إكسسوار/ };

const key = (s) => String(s).replace(/[\s.-]/g, '').toLowerCase();
const title = (s) => s.replace(/\b([a-z])([a-z]*)/gi, (m, a, b) => (m === m.toUpperCase() && m.length <= 5 ? m : a.toUpperCase() + b.toLowerCase()));

/** Read the photo (a data URL) and suggest a product. brands / cats come from the shop. */
export async function readBox(photo, { brands = [], cats = [] } = {}) {
  const w = await worker();
  const { data } = await w.recognize(photo);
  const lines = (data.lines || [])
    .filter((l) => l.confidence > 50)
    .map((l) => ({ text: l.text.replace(/[^\w\s.+/&()'"-]/g, ' ').replace(/\s+/g, ' ').trim(), h: l.bbox.y1 - l.bbox.y0 }))
    .filter((l) => /[a-z]{2}/i.test(l.text));
  const all = lines.map((l) => l.text).join(' \n ');
  const flat = key(all);

  // Brand: the shop's own list first (its spelling), then well-known ones
  const shop = brands.map((b) => b.name);
  let brand = shop.filter((b) => key(b).length >= 2 && flat.includes(key(b))).sort((a, b) => key(b).length - key(a).length)[0] || '';
  let brandIsNew = false;
  if (!brand) {
    brand = KNOWN_BRANDS.filter((b) => flat.includes(key(b))).sort((a, b) => key(b).length - key(a).length)[0] || '';
    brandIsNew = !!brand;
  }

  // Specs
  const spec = (re) => (all.match(re) || [])[0]?.replace(/\s+/g, '') || '';
  const watts = spec(/\b\d{1,3}(\.\d)?\s?W\b/i).toUpperCase();
  const mah = spec(/\b\d{4,5}\s?mAh\b/i).replace(/mah/i, 'mAh');
  const amps = watts ? '' : spec(/\b\d(\.\d)?\s?A\b/);
  const length = spec(/\b\d(\.\d)?\s?(m|ft)\b/i);
  const connectors = [];
  if (/type-?\s?c|usb-?\s?c/i.test(all)) connectors.push('Type-C');
  if (/lightning|iphone/i.test(all)) connectors.push('Lightning');
  if (/micro|v8/i.test(all)) connectors.push('Micro');

  // Model code: letters + digits like C22-04, OG02, HS662, U160 (not 20W / 3A / 5000mAh)
  const model = (all.match(/\b[A-Z]{1,4}-?\d{1,4}(-\d{1,3})?[A-Z]{0,3}\b/g) || [])
    .find((m) => !/^\d+(W|A|MAH|V)$/i.test(m) && !/^(USB|PD|QC|TYPE)/i.test(m)) || '';

  // Type and section
  const type = TYPES.find(([re]) => re.test(all));
  const section = type ? cats.find((c) => SECTION_WORDS[type[2]].test(c.name)) : null;

  // The biggest line that isn't just the brand: usually the product's name on the box
  const headline = [...lines].sort((a, b) => b.h - a.h)
    .find((l) => key(l.text) !== key(brand) && l.text.length >= 6 && /[a-z]{3}/i.test(l.text))?.text || '';

  const parts = [brand, model, watts || mah, amps];
  let name;
  if (headline && type && type[0].test(headline)) name = [...parts, title(headline)];
  else name = [...parts, type ? type[1] : title(headline)];
  if (connectors.length && !connectors.some((c) => name.join(' ').toLowerCase().includes(c.toLowerCase()))) name.push(`(${connectors.join(' / ')})`);
  if (length && /cable/i.test(name.join(' '))) name.splice(name.length - (connectors.length ? 1 : 0), 0, length);
  name = name.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  // Words that repeat (brand written twice etc.)
  name = name.split(' ').filter((w, i, a) => a.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i).join(' ');

  const found = [brand, type, model || watts || mah].filter(Boolean).length;
  return {
    name, brand, brand_is_new: brandIsNew, model,
    category_id: section ? section.id : null,
    confidence: found >= 3 ? 'high' : found === 2 ? 'medium' : 'low',
    notes: found < 3 ? 'السيستم قرا جزء من الكلام بس — راجع الاسم، وتقدر تدوس على أي سطر تحت تضيفه' : '',
    lines: lines.map((l) => l.text).slice(0, 14),
  };
}
