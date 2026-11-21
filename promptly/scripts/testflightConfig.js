/**
 * Prepares app.json / eas.json for a TestFlight build in CI (not committed back): sets the iOS
 * bundle identifier chosen by the founder and, for an upload, the App Store Connect app id.
 * Usage: node scripts/testflightConfig.js <bundleId> [ascAppId]
 */
const fs = require('fs');
const path = require('path');

/** Reverse-DNS, 2+ parts, letters/digits/hyphens, no placeholder. Apple's own rule is similar. */
function validBundleId(id) {
  return typeof id === 'string' && /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/.test(id) && !/placeholder/i.test(id);
}

/** App Store Connect app ids are numeric ("Apple ID" on the app's page). */
function validAscAppId(id) {
  return typeof id === 'string' && /^\d{6,}$/.test(id);
}

function applyTestflightConfig(appJson, easJson, bundleId, ascAppId) {
  if (!validBundleId(bundleId)) throw new Error(`invalid bundle id: ${bundleId}`);
  const app = JSON.parse(JSON.stringify(appJson));
  app.expo.ios = { ...app.expo.ios, bundleIdentifier: bundleId };
  const eas = JSON.parse(JSON.stringify(easJson));
  if (ascAppId) {
    if (!validAscAppId(ascAppId)) throw new Error(`invalid App Store Connect app id: ${ascAppId}`);
    eas.submit = eas.submit ?? {};
    eas.submit.testflight = eas.submit.testflight ?? {};
    eas.submit.testflight.ios = { ...eas.submit.testflight.ios, ascAppId };
  }
  return { app, eas };
}

module.exports = { applyTestflightConfig, validBundleId, validAscAppId };

if (require.main === module) {
  const [bundleId, ascAppId] = process.argv.slice(2);
  const root = path.resolve(__dirname, '..');
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  const { app, eas } = applyTestflightConfig(read('app.json'), read('eas.json'), bundleId, ascAppId || undefined);
  fs.writeFileSync(path.join(root, 'app.json'), `${JSON.stringify(app, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'eas.json'), `${JSON.stringify(eas, null, 2)}\n`);
  console.log(`bundle id: ${bundleId}${ascAppId ? `, ascAppId set` : ''}`);
}
