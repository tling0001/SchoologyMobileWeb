'use strict';

const crypto = require('node:crypto');
const S = require('../../lib/schoology-server');

const LEGACY_ADMIN_SCHOOLOGY_USER_ID = '72720808';
function configuredAdminUserIds() {
  const configured = String(process.env.CLASSWIRE_ADMIN_SCHOOLOGY_USER_IDS || LEGACY_ADMIN_SCHOOLOGY_USER_ID);
  return new Set(configured.split(/[\s,;]+/).map(value => value.trim()).filter(value => /^\d{1,24}$/.test(value)));
}
function adminConfigurationKey(userId, id) { return KEY + 'admin:' + String(userId) + ':config:' + id; }
function adminConfigurationIndex(userId) { return KEY + 'admin:' + String(userId) + ':configurations'; }
const KEY = 'classwire:v1:';
const APP_ORIGIN = 'https://schoology-mobile-web.vercel.app';

function fail(status, message) { throw S.httpError(status, message); }
function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) fail(503, 'Shared ClassWire configuration storage is not configured.');
  return { url: url.replace(/\/$/, ''), token };
}
async function redis(command) {
  const { url, token } = redisConfig();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) fail(503, 'Shared ClassWire storage is temporarily unavailable.');
  const result = await response.json();
  if (result.error) fail(503, 'Shared ClassWire storage is temporarily unavailable.');
  return result.result;
}
function json(value) { return JSON.stringify(value); }
function randomId(prefix) { return prefix + '_' + crypto.randomBytes(12).toString('hex'); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function cleanText(value, label, max = 120) {
  const result = String(value || '').trim();
  if (!result || result.length > max) fail(400, label + ' is required and must be no longer than ' + max + ' characters.');
  return result;
}
function normalizeConfiguration(input, existing) {
  const name = cleanText(input.name ?? existing?.name, 'Configuration name', 80);
  const buttonsInput = Array.isArray(input.buttons) ? input.buttons : (existing?.buttons || []);
  if (!buttonsInput.length || buttonsInput.length > 101) fail(400, 'Select between 1 and 101 sign-in buttons.');
  const schoolsInput = Array.isArray(input.schools) ? input.schools : (existing?.schools || []);
  if (schoolsInput.length > 100) fail(400, 'A configuration can contain at most 100 schools.');
  const schools = schoolsInput.map((school, index) => {
    const id = cleanText(school.id || randomId('school'), 'School ' + (index + 1) + ' ID', 100);
    const schoolName = cleanText(school.name, 'School ' + (index + 1) + ' name', 120);
    const loginType = String(school.loginType || '').toLowerCase();
    if (!['schoology-account', 'schoology-oauth'].includes(loginType)) fail(400, 'Choose a supported sign-in method for ' + schoolName + '.');
    const domainValue = String(school.domain || school.loginUrl || '').trim();
    let domain = '';
    if (domainValue) {
      try {
        const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(domainValue) ? domainValue : 'https://' + domainValue);
        if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) throw new Error();
        domain = parsed.host.toLowerCase();
      } catch { fail(400, 'The sign-in domain for ' + schoolName + ' must be a valid HTTPS host.'); }
    }
    if (loginType === 'schoology-oauth' && !domain) fail(400, 'The school browser sign-in option requires a verified HTTPS sign-in domain.');
    const schoolId = school.schoolId == null ? '' : String(school.schoolId).trim();
    if (schoolId && !/^[A-Za-z0-9_-]{1,80}$/.test(schoolId)) fail(400, 'Invalid Schoology school ID.');
    return { id, name: schoolName, loginType, domain: domain || null, schoolId: schoolId || null };
  });
  const schoolIds = new Set(schools.map(s => s.id));
  const buttonIds = new Set();
  const buttons = buttonsInput.map((button, index) => {
    const id = cleanText(button.id || randomId('button'), 'Button ' + (index + 1) + ' ID', 100);
    if (buttonIds.has(id)) fail(400, 'Sign-in button IDs must be unique.');
    buttonIds.add(id);
    const type = String(button.type || '').toLowerCase();
    if (type === 'account' || type === 'qr' || type === 'school-picker') return { id, type, label: cleanText(button.label || (type === 'account' ? 'Sign in with my account' : type === 'qr' ? 'Sign in with a QR code' : 'Sign in through my school'), 'Button label', 80) };
    if (type !== 'school') fail(400, 'Unsupported sign-in button type.');
    const schoolId = cleanText(button.schoolId, 'School button selection', 100);
    if (!schoolIds.has(schoolId)) fail(400, 'Every school sign-in button must reference a configured school.');
    const school = schools.find(item => item.id === schoolId);
    return { id, type: 'school', schoolId, label: cleanText(button.label || ('Sign in with ' + school.name), 'Button label', 100) };
  });
  return {
    schemaVersion: 2,
    name,
    enabled: input.enabled === undefined ? (existing?.enabled ?? true) : input.enabled === true,
    buttons,
    schools,
    signOutOnLaunch: input.signOutOnLaunch === undefined ? (existing?.signOutOnLaunch === true) : input.signOutOnLaunch === true,
    updatedAt: new Date().toISOString()
  };
}
async function verifiedSchoologyUser(input) {
  const session = S.clientSession(input);
  const response = await S.schoologyRequest('GET', 'https://' + S.API_HOST + '/v1/users/me', {}, { sign: true, session, clientIdentity: true });
  if (response.status === 401 || response.status === 403) fail(401, 'Your Schoology sign-in has expired. Please sign in again.');
  if (response.status < 200 || response.status >= 300) fail(502, 'Could not verify your Schoology identity.');
  let profile;
  try { profile = JSON.parse(response.text); } catch { fail(502, 'Schoology returned an invalid user profile.'); }
  const user = S.safeUser(profile);
  return { session, user };
}
function installationId(input) {
  const value = cleanText(input.installationId, 'Installation ID', 128);
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(value)) fail(400, 'The installation ID is invalid.');
  return value;
}
async function requireAdmin(input) {
  const { session, user } = await verifiedSchoologyUser(input);
  if (!configuredAdminUserIds().has(String(user.id))) fail(403, 'This Schoology account is not authorized to manage ClassWire configurations.');
  const suppliedId = String(input.installationId || '');
  const install = /^[A-Za-z0-9_-]{20,128}$/.test(suppliedId) ? suppliedId : null;
  return { session, user, installationId: install };
}
async function readConfiguration(ownerId, id) {
  const key = adminConfigurationKey(ownerId, id);
  const value = await redis(['GET', key]);
  if (value) {
    try { return JSON.parse(value); } catch { return null; }
  }
  // Migrate configurations created by the original single-administrator
  // endpoint. The old endpoint only authorized Schoology user 72720808.
  if (String(ownerId) !== LEGACY_ADMIN_SCHOOLOGY_USER_ID) return null;
  const legacy = await redis(['GET', KEY + 'config:' + id]);
  if (!legacy) return null;
  try {
    const config = JSON.parse(legacy);
    if (config.createdBy != null && String(config.createdBy) !== String(ownerId)) return null;
    await redis(['SET', key, json(config)]);
    await redis(['SADD', adminConfigurationIndex(ownerId), id]);
    return config;
  } catch { return null; }
}
async function listConfigurations(ownerId) {
  const ids = new Set();
  const owned = await redis(['SMEMBERS', adminConfigurationIndex(ownerId)]);
  for (const id of Array.isArray(owned) ? owned : []) ids.add(String(id));
  if (String(ownerId) === LEGACY_ADMIN_SCHOOLOGY_USER_ID) {
    const legacy = await redis(['SMEMBERS', KEY + 'configurations']);
    for (const id of Array.isArray(legacy) ? legacy : []) ids.add(String(id));
  }
  const values = await Promise.all([...ids].map(id => readConfiguration(ownerId, id)));
  return values.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
async function publicConfigurations() {
  return (await listConfigurations()).filter(item => item.enabled).map(item => ({
    id: item.id, name: item.name, schemaVersion: item.schemaVersion,
    buttons: item.buttons, schools: item.schools, signOutOnLaunch: item.signOutOnLaunch,
    updatedAt: item.updatedAt
  }));
}
async function createEnrollmentToken(ownerId, configurationId, input) {
  const config = await readConfiguration(ownerId, configurationId);
  if (!config || !config.enabled) fail(404, 'The requested configuration is not available.');
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hash(token);
  const expiresIn = Math.min(7 * 24 * 60 * 60, Math.max(300, Number(input.expiresInSeconds) || 24 * 60 * 60));
  const maxUses = Math.min(500, Math.max(1, Number(input.maxUses) || 100));
  await redis(['SET', KEY + 'enrollment:' + tokenHash, json({ ownerId: String(ownerId), configurationId, expiresAt: Date.now() + expiresIn * 1000, maxUses, uses: 0, createdAt: new Date().toISOString() }), 'EX', String(expiresIn)]);
  const query = '?id=' + encodeURIComponent(configurationId) + '&token=' + encodeURIComponent(token);
  return { url: APP_ORIGIN + '/config/apply' + query, classwireUrl: 'classwire://config/apply' + query, token, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), maxUses };
}
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    const input = S.parseBody(req);
    const action = String(input.action || '');
    await S.rateLimit(req, 'classwire-config-' + (action || 'unknown'), action === 'redeem' ? 30 : 20, 900);

    // Configurations are not enumerable without admin authorization; enrollment
    // tokens redeem only the specific configuration tied to the opaque token.

    if (action === 'redeem') {
      const token = cleanText(input.token, 'Enrollment token', 128);
      const configId = cleanText(input.configurationId, 'Configuration ID', 100);
      const tokenHash = hash(token);
      const stored = await redis(['GET', KEY + 'enrollment:' + tokenHash]);
      let enrollment = null;
      let ownerId = LEGACY_ADMIN_SCHOOLOGY_USER_ID;
      if (stored) {
        try { enrollment = JSON.parse(stored); } catch { fail(410, 'This ClassWire configuration link is no longer valid.'); }
        ownerId = String(enrollment.ownerId || LEGACY_ADMIN_SCHOOLOGY_USER_ID);
      } else {
        const publication = await redis(['GET', KEY + 'published:' + tokenHash]);
        if (publication) {
          try {
            const value = JSON.parse(publication);
            if (String(value.configurationId) !== configId) fail(404, 'This ClassWire configuration link is invalid, expired, or revoked.');
            ownerId = String(value.ownerId);
          } catch (error) { if (error.statusCode) throw error; fail(404, 'This ClassWire configuration link is invalid, expired, or revoked.'); }
        }
      }
      const config = await readConfiguration(ownerId, configId);
      if (!config || !config.enabled) fail(404, 'This ClassWire configuration is no longer available.');
      if (stored) {
        if (enrollment.configurationId !== configId || enrollment.expiresAt <= Date.now() || enrollment.uses >= enrollment.maxUses) fail(410, 'This ClassWire configuration link has expired or reached its use limit.');
        const increment = "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; local o=cjson.decode(v); if o.expiresAt<=tonumber(ARGV[1]) or o.uses>=o.maxUses then return 0 end; o.uses=o.uses+1; redis.call('SET',KEYS[1],cjson.encode(o),'KEEPTTL'); return o.uses";
        const used = await redis(['EVAL', increment, '1', KEY + 'enrollment:' + tokenHash, String(Date.now())]);
        if (!Number(used)) fail(410, 'This ClassWire configuration link has expired or reached its use limit.');
      } else {
        const publishedHash = config.publication?.tokenHash;
        if (typeof publishedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(publishedHash) ||
            !crypto.timingSafeEqual(Buffer.from(publishedHash, 'hex'), Buffer.from(tokenHash, 'hex'))) {
          fail(404, 'This ClassWire configuration link is invalid, expired, or revoked.');
        }
      }
      return S.send(res, 200, { applied: true, configuration: { id: config.id, name: config.name, schemaVersion: config.schemaVersion, buttons: config.buttons, schools: config.schools, signOutOnLaunch: config.signOutOnLaunch, updatedAt: config.updatedAt } });
    }

    const admin = await requireAdmin(input);
    if (action === 'list') {
      const [configurations, installations] = await Promise.all([
        listConfigurations(admin.user.id),
        redis(['SMEMBERS', KEY + 'admin-installations'])
      ]);
      const adminInstallations = [];
      for (const id of Array.isArray(installations) ? installations : []) {
        const raw = await redis(['GET', KEY + 'admin-install:' + id]);
        try {
          const value = JSON.parse(raw || '{}');
          if (String(value.userId) !== String(admin.user.id)) continue;
          adminInstallations.push({ installationId: id, userId: value.userId, platform: value.platform, createdAt: value.createdAt, label: value.label });
        } catch {}
      }
      return S.send(res, 200, { configurations: configurations.map(({ publication, ...item }) => ({ ...item, publishedAt: publication?.publishedAt || null })), adminInstallations });
    }
    if (action === 'save') {
      const id = input.configurationId ? cleanText(input.configurationId, 'Configuration ID', 100) : randomId('cfg');
      const existing = await readConfiguration(admin.user.id, id);
      const configuration = normalizeConfiguration(input.configuration || {}, existing);
      const saved = { id, ...configuration, publication: existing?.publication || null, createdAt: existing?.createdAt || new Date().toISOString(), createdBy: admin.user.id };
      await redis(['SET', adminConfigurationKey(admin.user.id, id), json(saved)]);
      await redis(['SADD', adminConfigurationIndex(admin.user.id), id]);
      const { publication, ...clientConfiguration } = saved;
      return S.send(res, 200, { configuration: { ...clientConfiguration, publishedAt: publication?.publishedAt || null } });
    }
    if (action === 'delete') {
      const id = cleanText(input.configurationId, 'Configuration ID', 100);
      const existing = await readConfiguration(admin.user.id, id);
      if (!existing) fail(404, 'The requested configuration was not found.');
      if (existing.publication?.tokenHash) await redis(['DEL', KEY + 'published:' + existing.publication.tokenHash]);
      await redis(['DEL', adminConfigurationKey(admin.user.id, id)]);
      await redis(['SREM', adminConfigurationIndex(admin.user.id), id]);
      if (String(admin.user.id) === LEGACY_ADMIN_SCHOOLOGY_USER_ID) {
        await redis(['DEL', KEY + 'config:' + id]);
        await redis(['SREM', KEY + 'configurations', id]);
      }
      return S.send(res, 200, { deleted: true, configurationId: id });
    }
    if (action === 'create-link') {
      const id = cleanText(input.configurationId, 'Configuration ID', 100);
      return S.send(res, 200, await createEnrollmentToken(admin.user.id, id, input));
    }
    if (action === 'publish') {
      const id = cleanText(input.configurationId, 'Configuration ID', 100);
      const config = await readConfiguration(admin.user.id, id);
      if (!config || !config.enabled) fail(404, 'The requested configuration is not available.');
      if (config.publication?.tokenHash) await redis(['DEL', KEY + 'published:' + config.publication.tokenHash]);
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = hash(token);
      const publishedAt = new Date().toISOString();
      config.publication = { tokenHash, publishedAt };
      config.updatedAt = publishedAt;
      await redis(['SET', adminConfigurationKey(admin.user.id, id), json(config)]);
      await redis(['SET', KEY + 'published:' + tokenHash, json({ ownerId: String(admin.user.id), configurationId: id })]);
      const query = '?id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(token);
      const httpsUrl = APP_ORIGIN + '/config/apply' + query;
      return S.send(res, 200, { published: true, publishedAt, url: httpsUrl, httpsUrl, classwireUrl: 'classwire://config/apply' + query });
    }
    if (action === 'unpublish') {
      const id = cleanText(input.configurationId, 'Configuration ID', 100);
      const config = await readConfiguration(admin.user.id, id);
      if (!config) fail(404, 'The requested configuration was not found.');
      if (config.publication?.tokenHash) await redis(['DEL', KEY + 'published:' + config.publication.tokenHash]);
      config.publication = null;
      config.updatedAt = new Date().toISOString();
      await redis(['SET', adminConfigurationKey(admin.user.id, id), json(config)]);
      return S.send(res, 200, { published: false, configurationId: id });
    }
    if (action === 'revoke-link') {
      const token = cleanText(input.token, 'Enrollment token', 128);
      const tokenHash = hash(token);
      const raw = await redis(['GET', KEY + 'enrollment:' + tokenHash]);
      if (raw) {
        let record; try { record = JSON.parse(raw); } catch { record = null; }
        if (String(record?.ownerId || LEGACY_ADMIN_SCHOOLOGY_USER_ID) !== String(admin.user.id)) fail(404, 'The enrollment link was not found.');
        await redis(['DEL', KEY + 'enrollment:' + tokenHash]);
      } else {
        const published = await redis(['GET', KEY + 'published:' + tokenHash]);
        if (published) {
          let record; try { record = JSON.parse(published); } catch { record = null; }
          if (String(record?.ownerId) !== String(admin.user.id)) fail(404, 'The published link was not found.');
          await redis(['DEL', KEY + 'published:' + tokenHash]);
        }
      }
      return S.send(res, 200, { revoked: true });
    }
    if (action === 'authorize-installation') {
      const id = installationId({ installationId: input.targetInstallationId });
      const targetSecret = cleanText(input.targetInstallationSecret, 'Target installation secret', 128);
      if (targetSecret.length < 32) fail(400, 'The target installation secret must contain at least 32 characters.');
      await redis(['SADD', KEY + 'admin-installations', id]);
      await redis(['SET', KEY + 'admin-install:' + id, json({
        userId: admin.user.id,
        platform: String(input.platform || 'unknown').slice(0, 30),
        createdAt: new Date().toISOString(),
        label: String(input.installationName || '').slice(0, 80),
        secretHash: hash(targetSecret)
      })]);
      return S.send(res, 200, { authorized: true, installationId: id });
    }
    if (action === 'revoke-installation') {
      const id = installationId({ installationId: input.targetInstallationId });
      if (id === admin.installationId) fail(409, 'You cannot revoke the administrator installation currently in use.');
      const raw = await redis(['GET', KEY + 'admin-install:' + id]);
      let record; try { record = JSON.parse(raw || '{}'); } catch { record = null; }
      if (!record || String(record.userId) !== String(admin.user.id)) fail(404, 'The administrator installation was not found.');
      await redis(['SREM', KEY + 'admin-installations', id]);
      await redis(['DEL', KEY + 'admin-install:' + id]);
      return S.send(res, 200, { revoked: true, installationId: id });
    }
    return S.send(res, 400, { error: 'Unknown ClassWire configuration action.' });
  } catch (error) {
    return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) });
  }
};
