import { randomBytes, randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { hash, problem } from './ledger.mjs';
export const OFFER_NAMES = Object.freeze({ 'plus.month': ['plus', 'subscription', 'Monthly'], 'plus.year': ['plus', 'subscription', 'Yearly'], 'plus.prepaid': ['plus', 'payment', '30 days · no renewal'], 'pro.month': ['pro', 'subscription', 'Monthly'], 'pro.year': ['pro', 'subscription', 'Yearly'], 'pro.prepaid': ['pro', 'payment', '30 days · no renewal'] });
const objectId = value => typeof value === 'string' ? value : value?.id;
export class Billing {
  constructor({ ledger, secret, webhookSecret, prices = {}, origin, stripe }) { this.ledger = ledger; this.stripe = stripe || (secret ? new Stripe(secret, { maxNetworkRetries: 2, timeout: 15000 }) : null); this.webhookSecret = webhookSecret; this.prices = prices; this.origin = origin; }
  get enabled() { return Boolean(this.stripe && this.webhookSecret && Object.keys(this.prices).length); }
  async catalog() {
    if (!this.enabled) return [];
    const offers = [];
    for (const [id, priceId] of Object.entries(this.prices)) {
      if (!OFFER_NAMES[id] || typeof priceId !== 'string' || !priceId.startsWith('price_')) continue;
      const price = await this.stripe.prices.retrieve(priceId), [plan, mode, label] = OFFER_NAMES[id];
      if (!price.active || price.unit_amount === null || (mode === 'subscription' ? price.recurring?.interval !== (id.endsWith('.year') ? 'year' : 'month') || price.recurring?.interval_count !== 1 : Boolean(price.recurring))) continue;
      offers.push({ id, plan, label, amount: price.unit_amount, currency: price.currency, renewal: mode === 'subscription' });
    }
    return offers;
  }
  async checkout(offer, deviceId) {
    if (!this.enabled || !(await this.catalog()).some(o => o.id === offer)) throw problem('This purchase option is not configured yet.', 503);
    if (typeof deviceId !== 'string' || deviceId.length > 100 || !deviceId) throw problem('Invalid installation.');
    const [plan, mode] = OFFER_NAMES[offer], orderId = randomUUID(), token = randomBytes(32).toString('hex');
    const license = this.ledger.create({ plan, days: mode === 'payment' ? 30 : null, label: `Purchase · ${offer}`, maxActivations: plan === 'pro' ? 2 : 1 });
    this.ledger.db.prepare('UPDATE licenses SET billingBlocked=1 WHERE id=?').run(license.id);
    this.ledger.db.prepare('INSERT INTO orders(id,tokenHash,deviceId,offer,licenseId,encryptedKey,status,createdAt) VALUES(?,?,?,?,?,?,?,?)').run(orderId, hash(token), deviceId, offer, license.id, this.ledger.seal(license.key), 'pending', this.ledger.now());
    const metadata = { orbitOrderId: orderId };
    const session = await this.stripe.checkout.sessions.create({ mode, line_items: [{ price: this.prices[offer], quantity: 1 }], client_reference_id: orderId, metadata, ...(mode === 'subscription' ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }), success_url: `${this.origin}/purchase-complete`, cancel_url: `${this.origin}/purchase-cancelled` }, { idempotencyKey: `orbit-${orderId}` });
    this.ledger.db.prepare('UPDATE orders SET sessionId=? WHERE id=?').run(session.id, orderId);
    return { id: orderId, token, url: session.url };
  }
  collect(id, token) {
    const row = this.ledger.db.prepare('SELECT * FROM orders WHERE id=? AND tokenHash=?').get(id, hash(token || ''));
    if (!row) throw problem('Purchase not found.', 404);
    return row.status === 'paid' ? { paid: true, key: this.ledger.unseal(row.encryptedKey) } : { paid: false, cancelled: row.status === 'cancelled' };
  }
  async cancel(id, token) {
    const order = this.ledger.db.prepare('SELECT * FROM orders WHERE id=? AND tokenHash=?').get(id, hash(token || ''));
    if (!order) throw problem('Purchase not found.', 404);
    if (order.status === 'paid') return this.collect(id, token);
    const session = await this.stripe.checkout.sessions.retrieve(order.sessionId);
    if (session.status === 'complete') { await this.completeSession(session.id); const result = this.collect(id, token); if (result.paid) return result; throw problem('Payment is still processing. Check the purchase again shortly.'); }
    if (session.status === 'open') await this.stripe.checkout.sessions.expire(session.id);
    this.ledger.db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(id);
    return { paid: false, cancelled: true };
  }
  async syncSubscription(subscriptionId) {
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
    const order = this.ledger.db.prepare('SELECT * FROM orders WHERE id=?').get(sub.metadata?.orbitOrderId || '');
    if (!order || !order.sessionId) return;
    // Confirm the subscription came from our Checkout session, not user metadata.
    const session = await this.stripe.checkout.sessions.retrieve(order.sessionId);
    if (objectId(session.subscription) !== sub.id) return;
    const row = this.ledger.db.prepare('SELECT * FROM licenses WHERE id=?').get(order.licenseId);
    if (sub.status === 'active' && sub.latest_invoice) {
      const invoice = typeof sub.latest_invoice === 'string' ? await this.stripe.invoices.retrieve(sub.latest_invoice) : sub.latest_invoice;
      if (invoice.status !== 'paid') return;
      const expected = this.prices[order.offer];
      if (sub.items?.data?.length !== 1 || sub.items.data[0].price?.id !== expected) throw problem('Subscription price does not match the purchase.');
      const expires = (sub.items.data[0].current_period_end ?? sub.current_period_end) * 1000;
      if (!Number.isSafeInteger(expires) || expires <= this.ledger.now()) throw problem('Invalid subscription billing period.');
      // An explicit admin/risk block must not be undone by a later renewal event.
      const paidPreviously = order.status === 'paid';
      this.ledger.db.prepare('UPDATE licenses SET expiresAt=?,customerId=?,subscriptionId=?,billingBlocked=? WHERE id=?').run(expires, objectId(sub.customer), sub.id, paidPreviously ? row.billingBlocked : 0, order.licenseId);
      this.ledger.db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(order.id);
    } else if (['canceled', 'unpaid', 'incomplete_expired', 'paused'].includes(sub.status)) {
      this.ledger.db.prepare('UPDATE licenses SET expiresAt=? WHERE id=?').run(this.ledger.now(), order.licenseId);
    }
  }
  async completeSession(sessionId) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    const order = this.ledger.db.prepare('SELECT * FROM orders WHERE sessionId=?').get(session.id);
    if (!order || session.client_reference_id !== order.id || session.status !== 'complete') return;
    if (session.mode === 'subscription') { if (session.subscription) await this.syncSubscription(objectId(session.subscription)); return; }
    if (session.payment_status !== 'paid') return;
    const items = await this.stripe.checkout.sessions.listLineItems(session.id);
    if (items.data.length !== 1 || items.data[0].price?.id !== this.prices[order.offer] || items.data[0].quantity !== 1) throw problem('Payment price does not match the purchase.');
    this.ledger.transaction(() => {
      if (this.ledger.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status === 'paid') return;
      this.ledger.db.prepare('UPDATE licenses SET billingBlocked=0,customerId=? WHERE id=?').run(objectId(session.customer) || null, order.licenseId);
      this.ledger.db.prepare("UPDATE orders SET status='paid',paymentIntent=? WHERE id=?").run(objectId(session.payment_intent) || null, order.id);
      this.ledger.audit('payment', order.licenseId);
    });
  }
  async risk(chargeId) {
    const charge = await this.stripe.charges.retrieve(chargeId);
    const direct = this.ledger.db.prepare('SELECT licenseId FROM orders WHERE paymentIntent=?').get(objectId(charge.payment_intent) || '');
    let licenseId = direct?.licenseId;
    if (!licenseId && charge.invoice) {
      const invoice = await this.stripe.invoices.retrieve(objectId(charge.invoice));
      const subscription = objectId(invoice.parent?.subscription_details?.subscription || invoice.subscription);
      licenseId = this.ledger.db.prepare('SELECT id FROM licenses WHERE subscriptionId=?').get(subscription || '')?.id;
    }
    if (licenseId) { this.ledger.db.prepare('UPDATE licenses SET billingBlocked=1 WHERE id=?').run(licenseId); this.ledger.audit('billing-hold', licenseId); }
  }
  async webhook(raw, signature) {
    if (!this.enabled) throw problem('Billing is not configured.', 503);
    let event;
    try { event = this.stripe.webhooks.constructEvent(raw, signature, this.webhookSecret); } catch { throw problem('Invalid payment webhook signature.', 400); }
    if (this.ledger.db.prepare('SELECT 1 FROM events WHERE id=?').get(event.id)) return { received: true };
    const value = event.data.object;
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) await this.completeSession(value.id);
    else if (event.type === 'invoice.paid') { const subscription = objectId(value.parent?.subscription_details?.subscription || value.subscription); if (subscription) await this.syncSubscription(subscription); }
    else if (event.type.startsWith('customer.subscription.')) await this.syncSubscription(value.id);
    else if (event.type === 'charge.refunded' && value.refunded) await this.risk(value.id);
    else if (event.type === 'charge.dispute.created') await this.risk(objectId(value.charge));
    this.ledger.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?)').run(event.id, this.ledger.now());
    return { received: true };
  }
  async portal(key) { if (!this.enabled) throw problem('Billing is not configured.', 503); const row = this.ledger.findKey(key, true); if (!row.customerId) throw problem('This license has no billing account.'); return this.stripe.billingPortal.sessions.create({ customer: row.customerId, return_url: `${this.origin}/purchase-complete` }); }
}
