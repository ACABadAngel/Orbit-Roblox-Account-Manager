import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import Stripe from 'stripe';
import { Ledger } from '../licensing/ledger.mjs';
import { Billing } from '../licensing/billing.mjs';
function fixture() {
  const ledger = new Ledger({ privateKey: generateKeyPairSync('ed25519').privateKey });
  let session, subscription, invoice, priceOverride, sequence = 0;
  const fake = {
    prices: { retrieve: async id => ({ id, active: true, unit_amount: 500, currency: 'eur', ...(id.includes('month') ? { recurring: { interval: 'month', interval_count: 1 } } : {}) }) },
    checkout: { sessions: { create: async args => { session = { id: `cs_test_${++sequence}`, status: 'open', mode: args.mode, payment_status: 'unpaid', client_reference_id: args.client_reference_id, metadata: args.metadata, url: 'https://checkout.stripe.com/c/pay/test', payment_intent: 'pi_test_one', customer: 'cus_one' }; return session; }, retrieve: async () => session, expire: async () => { session.status = 'expired'; return session; }, listLineItems: async () => ({ data: [{ price: { id: priceOverride || 'price_prepaid' }, quantity: 1 }] }) } },
    subscriptions: { retrieve: async () => subscription }, invoices: { retrieve: async () => invoice }, charges: { retrieve: async () => ({ id: 'ch_one', payment_intent: 'pi_test_one' }) },
    webhooks: new Stripe('sk_test_not_real').webhooks
  };
  const billing = new Billing({ ledger, stripe: fake, webhookSecret: 'whsec_test_only', prices: { 'plus.prepaid': 'price_prepaid', 'plus.month': 'price_month' }, origin: 'https://licenses.example.com' });
  const event = async (id, type, value) => { const raw = JSON.stringify({ id, type, data: { object: value } }); const signature = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret: 'whsec_test_only' }); return billing.webhook(Buffer.from(raw), signature); };
  return { ledger, billing, event, session: () => session, setPrice: value => { priceOverride = value; }, subscription: value => { subscription = value; }, invoice: value => { invoice = value; } };
}
test('checkout cannot unlock a license until a verified paid event, rejects a wrong price, and fulfills only once', async () => {
  const f = fixture();
  try {
    const order = await f.billing.checkout('plus.prepaid', 'device-one');
    assert.equal(f.billing.collect(order.id, order.token).paid, false);
    await f.event('evt_unpaid', 'checkout.session.completed', { id: f.session().id }); assert.equal(f.billing.collect(order.id, order.token).paid, false);
    f.session().status = 'complete'; f.session().payment_status = 'paid';
    f.setPrice('price_wrong'); await assert.rejects(f.event('evt_wrong', 'checkout.session.completed', { id: f.session().id }), /price/); assert.equal(f.billing.collect(order.id, order.token).paid, false);
    f.setPrice('price_prepaid'); await f.event('evt_paid', 'checkout.session.completed', { id: f.session().id });
    const result = f.billing.collect(order.id, order.token); assert.equal(result.paid, true); f.ledger.activate(result.key, 'device-one');
    const expiry = f.ledger.findKey(result.key).expiresAt;
    await f.event('evt_paid', 'checkout.session.completed', { id: f.session().id }); await f.event('evt_paid_again', 'checkout.session.completed', { id: f.session().id }); assert.equal(f.ledger.findKey(result.key).expiresAt, expiry);
    assert.throws(() => f.billing.collect(order.id, 'wrong'), /not found/);
    await assert.rejects(f.billing.webhook(Buffer.from('{}'), 'invalid'), /signature/);
    await f.event('evt_refund', 'charge.refunded', { id: 'ch_one', refunded: true }); assert.throws(() => f.ledger.findKey(result.key), /awaiting payment/);
  } finally { f.ledger.close(); }
});
test('subscription access follows a paid invoice period and does not extend on an unpaid renewal or undo a billing hold', async () => {
  const f = fixture();
  try {
    const order = await f.billing.checkout('plus.month', 'one');
    f.session().status = 'complete'; f.session().subscription = 'sub_one';
    const expires = Math.floor(Date.now() / 1000) + 86400;
    const sub = { id: 'sub_one', status: 'active', latest_invoice: 'in_one', metadata: { orbitOrderId: order.id }, customer: 'cus_one', items: { data: [{ price: { id: 'price_month' }, current_period_end: expires }] } };
    f.subscription(sub); f.invoice({ status: 'open' });
    await f.event('evt_start_open', 'checkout.session.completed', { id: f.session().id }); assert.equal(f.billing.collect(order.id, order.token).paid, false);
    f.invoice({ status: 'paid' }); await f.event('evt_start_paid', 'invoice.paid', { parent: { subscription_details: { subscription: 'sub_one' } } });
    const key = f.billing.collect(order.id, order.token).key; assert.equal(f.ledger.findKey(key).expiresAt, expires * 1000);
    sub.items.data[0].current_period_end += 86400; f.invoice({ status: 'open' }); await f.event('evt_open_renewal', 'customer.subscription.updated', { id: 'sub_one' }); assert.equal(f.ledger.findKey(key).expiresAt, expires * 1000);
    f.ledger.db.prepare('UPDATE licenses SET billingBlocked=1 WHERE id=?').run(f.ledger.findKey(key).id);
    f.invoice({ status: 'paid' }); await f.event('evt_later_paid', 'invoice.paid', { subscription: 'sub_one' }); assert.throws(() => f.ledger.findKey(key));
  } finally { f.ledger.close(); }
});

test('pending checkout can be expired but a completed payment is fulfilled instead of discarded', async () => {
  const f = fixture();
  try {
    const first = await f.billing.checkout('plus.prepaid', 'one');
    await f.billing.cancel(first.id, first.token); assert.equal(f.session().status, 'expired'); assert.equal(f.billing.collect(first.id, first.token).cancelled, true);
    const second = await f.billing.checkout('plus.prepaid', 'one'); f.session().status = 'complete'; f.session().payment_status = 'paid';
    const result = await f.billing.cancel(second.id, second.token); assert.equal(result.paid, true); assert.ok(result.key);
  } finally { f.ledger.close(); }
});
