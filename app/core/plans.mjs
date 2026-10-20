export const PLAN_NAMES = Object.freeze({ free: 'Free', plus: 'Plus', pro: 'Pro' });
export const FEATURE_NAMES = Object.freeze({ remoteControl: 'Multi-PC control', advancedSchedules: 'Recurring schedules', workflows: 'Saved workflows', extendedHistory: 'Extended history', alerts: 'Desktop alerts', crossMachineBulk: 'Bulk actions across PCs' });
export const PLANS = Object.freeze({
  free: { maxDevices: 0, features: { remoteControl: false, advancedSchedules: false, workflows: false, extendedHistory: false, alerts: false, crossMachineBulk: false } },
  plus: { maxDevices: 2, features: { remoteControl: true, advancedSchedules: true, workflows: true, extendedHistory: true, alerts: true, crossMachineBulk: false } },
  pro: { maxDevices: 5, features: { remoteControl: true, advancedSchedules: true, workflows: true, extendedHistory: true, alerts: true, crossMachineBulk: true } }
});
export function entitlements(plan, overrides = {}, maxDevices) {
  if (!Object.hasOwn(PLANS, plan)) throw new Error('Unknown plan.');
  const result = { plan, features: { ...PLANS[plan].features }, maxDevices: maxDevices ?? PLANS[plan].maxDevices };
  if (!Number.isInteger(result.maxDevices) || result.maxDevices < 0 || result.maxDevices > 100) throw new Error('Invalid PC limit.');
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(FEATURE_NAMES, key) || typeof value !== 'boolean') throw new Error('Invalid feature permission.');
    result.features[key] = value;
  }
  return result;
}
export function requireFeature(license, feature) {
  if (!license?.features?.[feature]) throw new Error(`${FEATURE_NAMES[feature] || 'This feature'} needs an active Plus or Pro license. Open Account & License.`);
}
export function requireRemote(license, peerIndex) {
  requireFeature(license, 'remoteControl');
  if (!Number.isInteger(peerIndex) || peerIndex < 0 || peerIndex >= license.maxDevices) throw new Error(`Your license supports ${license.maxDevices} managed PCs. Unpair an unused PC or upgrade.`);
}
export function requireBulk(license, ids) {
  const machines = new Set(ids.map(id => id.includes(':') ? id.split(':')[0] : 'local'));
  if (machines.size > 1) requireFeature(license, 'crossMachineBulk');
}
