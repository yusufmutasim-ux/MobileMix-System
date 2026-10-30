'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base, cookie = '', app, lastRequest;
before(async () => {
  app = createApp(open(':memory:'));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());
async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('fake').toString('base64');

test('adding a product from a photo of its box', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  // No key on the server: the button explains how to set it up
  assert.equal((await call('GET', '/ai/status')).data.enabled, false);
  assert.equal((await call('POST', '/products/from-photo', { image: PHOTO })).status, 400);

  // A stand-in for Claude that answers like the real one
  app.locals.aiClient = { beta: { messages: { create: async (req) => {
    lastRequest = req;
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      name: 'ACEFAST C22-04 3A USB-A to Type-C Cable', brand: 'ace fast', brand_is_new: true,
      category: 'شواحن وكابلات', model: 'C22-04', confidence: 'high', notes: '' }) }] };
  } } } };
  assert.equal((await call('GET', '/ai/status')).data.enabled, true);
  assert.equal((await call('POST', '/products/from-photo', { image: 'not a photo' })).status, 400);

  await call('POST', '/brands', { name: 'ACEFAST' });
  let r = await call('POST', '/products/from-photo', { image: PHOTO });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.brand, 'ACEFAST'); // the shop's spelling
  assert.equal(r.data.brand_is_new, false);
  assert.ok(r.data.category_id);
  assert.deepEqual(r.data.matches, []);
  // What was sent: the photo, the shop's brands and sections, a schema limited to those sections
  assert.equal(lastRequest.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.match(lastRequest.messages[0].content[1].text, /ACEFAST/);
  assert.ok(lastRequest.output_config.format.schema.properties.category.enum.includes('شواحن وكابلات'));

  // Same box again once it's in stock: offered as an existing product
  await call('POST', '/products', { name: 'ACEFAST C22-04 Cable', brand: 'ACEFAST', sell_price: 150, initial_qty: 2 });
  r = await call('POST', '/products/from-photo', { image: PHOTO });
  assert.equal(r.data.matches.length, 1);
  assert.equal(r.data.matches[0].qty, 2);

  // A declined request is reported, not saved as junk
  app.locals.aiClient.beta.messages.create = async () => ({ stop_reason: 'refusal', content: [] });
  assert.equal((await call('POST', '/products/from-photo', { image: PHOTO })).status, 400);
  delete app.locals.aiClient;
  if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
});
