'use strict';
const { Anthropic } = require('@anthropic-ai/sdk');
const { requirePerm } = require('../auth');
const { bad } = require('../util');
const { BRAND_KEY, brandKey } = require('../stock-batches');

/**
 * Adding a product from a photo of its box: Claude reads the box and fills the name (in English),
 * the brand (spelled as in the shop's list when it's there), the section and the model code.
 * The person checks it and adds the quantity and price. Needs ANTHROPIC_API_KEY on the server.
 */
const MODEL = 'claude-opus-5-5';
const CONFIDENCE = ['high', 'medium', 'low'];

const SYSTEM = `You read photos of retail packaging in a mobile-phone accessories shop (chargers, cables, earphones, speakers, power banks, adapters, holders, cases, phones…) and turn them into a product entry for the shop's stock system.

Rules for the fields:
- name: English, the way a shop lists it: Brand + model code (when printed) + key spec (watts / mAh / amps) + product type + connector or variant, plus colour or plug type in brackets when that is what tells two boxes apart. Example: "Anker 60W USB-C to USB-C Braided Cable 3.3ft", "JBL GO 4 Portable Bluetooth Speaker (Camo)", "Apple 20W USB-C Power Adapter (UK 3-Pin)". Use only what the box shows or what the product clearly is; never invent a model code.
- brand: the maker printed on the box. If it matches one of the shop's brands (ignoring case and spaces), copy the shop's spelling exactly and set brand_is_new to false. Otherwise give the brand as printed and set brand_is_new to true. Empty string if no brand is visible.
- category: one of the shop's sections that fits best, copied exactly; empty string if none fits.
- model: the model code printed on the box (e.g. "C22-04", "OG02"), or empty string.
- confidence: high when the name, brand and type are all clearly readable; medium when you had to infer part of it; low when the photo is too unclear to be sure.
- notes: one short sentence in Egyptian Arabic saying what to double-check (e.g. which connector the cable has), or empty string when nothing is uncertain.`;

function schemaFor(categories) {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
      brand: { type: 'string' },
      brand_is_new: { type: 'boolean' },
      category: { type: 'string', enum: [...categories, ''] },
      model: { type: 'string' },
      confidence: { type: 'string', enum: CONFIDENCE },
      notes: { type: 'string' },
    },
    required: ['name', 'brand', 'brand_is_new', 'category', 'model', 'confidence', 'notes'],
    additionalProperties: false,
  };
}

module.exports = function aiRoutes(api, db) {
  const edit = requirePerm('products.edit');
  let client = null;
  // Tests hand in their own client through app.locals.aiClient
  const getClient = (req) => req.app.locals.aiClient || (process.env.ANTHROPIC_API_KEY ? (client ||= new Anthropic()) : null);

  api.get('/ai/status', edit, (req, res) => res.json({ enabled: !!getClient(req) }));

  api.post('/products/from-photo', edit, async (req, res) => {
    const ai = getClient(req);
    if (!ai) throw bad('ميزة التعرف من الصورة محتاجة مفتاح Claude على السيرفر (ANTHROPIC_API_KEY) — الخطوات في الصفحة');
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
    if (!m) throw bad('ابعت صورة (JPG أو PNG)');
    if (m[2].length > 5_000_000) throw bad('الصورة كبيرة أوي');

    const brands = db.prepare('SELECT name FROM brands ORDER BY name').all().map((b) => b.name);
    const categories = db.prepare('SELECT name FROM categories ORDER BY name').all().map((c) => c.name);

    let msg;
    try {
      msg = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // A declined request is answered by another model instead of failing
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: schemaFor(categories) } },
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
            { type: 'text', text: `The shop's brands: ${brands.length ? brands.join(', ') : '(none yet)'}\nThe shop's sections: ${categories.join(', ') || '(none)'}\n\nRead this box.` },
          ],
        }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw bad('مفتاح Claude (ANTHROPIC_API_KEY) غلط أو اتلغى');
      if (e instanceof Anthropic.RateLimitError) throw bad('طلبات كتير ورا بعض — استنى دقيقة وجرب تاني');
      if (e instanceof Anthropic.APIError) throw bad(`مقدرناش نقرا الصورة دلوقتي (${e.status || 'خطأ'}) — جرب تاني`);
      throw bad('مقدرناش نوصل لخدمة التعرف على الصور — اتأكد من النت وجرب تاني');
    }
    if (msg.stop_reason === 'refusal') throw bad('مقدرناش نقرا الصورة دي — جرب صورة تانية أو دخّله بإيدك');
    const text = msg.content.find((b) => b.type === 'text')?.text;
    let out;
    try { out = JSON.parse(text); } catch { throw bad('مقدرناش نقرا العلبة — صوّرها من قدام وفي نور كويس'); }

    // Brand spelled as in the list when it's there (any spacing / case)
    if (out.brand) {
      const known = db.prepare(`SELECT name FROM brands WHERE ${BRAND_KEY('name')} = ?`).get(brandKey(out.brand));
      out.brand_is_new = !known;
      if (known) out.brand = known.name;
    }
    const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(out.category);
    out.category_id = cat ? cat.id : null;
    // Already in stock? Then the person probably wants to add quantity to it instead
    const like = [out.name];
    if (out.model) like.push(`%${out.model}%`);
    out.matches = db.prepare(`SELECT id, name, qty, sell_price FROM products WHERE active = 1 AND (name = ? COLLATE NOCASE ${out.model ? 'OR name LIKE ?' : ''}) LIMIT 3`).all(...like);
    res.json(out);
  });
};
