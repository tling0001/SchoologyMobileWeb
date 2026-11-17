'use strict';

const crypto = require('node:crypto');
const S = require('../../lib/schoology-server');

const ADMIN_SCHOOLOGY_USER_ID = 72720808;
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
  if (user.id !== ADMIN_SCHOOLOGY_USER_ID) fail(403, 'This Schoology account is not authorized to manage ClassWire configurations.');
  return { session, user };
}
function installationId(input) {
  const value = cleanText(input.installationId, 'Installation ID', 128);
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(value)) fail(400, 'The installation ID is invalid.');
  return value;
}
async function requireAdmin(input) {
  const { session, user } = await verifiedSchoologyUser(input);
  const install = installationId(input);
  const authorized = await redis(['SISMEMBER', KEY + 'admin-installations', install]);
  if (Number(authorized) !== 1) fail(403, 'This installation has not been approved for administrator settings.');
  const raw = await redis(['GET', KEY + 'admin-install:' + install]);
  let record;
  try { record = JSON.parse(raw || '{}'); } catch { record = null; }
  const presented = String(input.installationSecret || '');
  if (!record?.secretHash || !/^[a-f0-9]{64}$/i.test(record.secretHash) ||
      presented.length < 32 || presented.length > 128 ||
      !crypto.timingSafeEqual(Buffer.from(hash(presented), 'hex'), Buffer.from(record.secretHash, 'hex'))) {
    fail(403, 'This installation is not securely enrolled for administrator settings. Re-authorize this installation.');
  }
  return { session, user, installationId: install };
}
async function readConfiguration(id) {
  const value = await redis(['GET', KEY + 'config:' + id]);
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
async function listConfigurations() {
  const ids = await redis(['SMEMBERS', KEY + 'configurations']);
  const values = await Promise.all((Array.isArray(ids) ? ids : []).map(readConfiguration));
  return values.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
async function publicConfigurations() {
  return (await listConfigurations()).filter(item => item.enabled).map(item => ({
    id: item.id, name: item.name, schemaVersion: item.schemaVersion,
    buttons: item.buttons, schools: item.schools, signOutOnLaunch: item.signOutOnLaunch,
    updatedAt: item.updatedAt
  }));
}
async function createEnrollmentToken(configurationId, input) {
  const config = await readConfiguration(configurationId);
  if (!config || !config.enabled) fail(404, 'The requested configuration is not available.');
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hash(token);
  const expiresIn = Math.min(7 * 24 * 60 * 60, Math.max(300, Number(input.expiresInSeconds) || 24 * 60 * 60));
  const maxUses = Math.min(500, Math.max(1, Number(input.maxUses) || 100));
  await redis(['SET', KEY + 'enrollment:' + tokenHash, json({ configurationId, expiresAt: Date.now() + expiresIn * 1000, maxUses, uses: 0, createdAt: new Date().toISOString() }), 'EX', String(expiresIn)]);
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
      const config = await readConfiguration(configId);
      if (!config || !config.enabled) fail(404, 'This ClassWire configuration is no longer available.');
      if (stored) {
        let enrollment;
        try { enrollment = JSON.parse(stored); } catch { fail(410, 'This ClassWire configuration link is no longer valid.'); }
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

    if (action === 'bootstrap') {
      const bootstrap = String(input.bootstrapToken || '');
      const expected = String(process.env.CLASSWIRE_ADMIN_BOOTSTRAP_TOKEN || '');
      if (!expected || bootstrap.length < 32 || !crypto.timingSafeEqual(Buffer.from(hash(bootstrap), 'hex'), Buffer.from(hash(expected), 'hex'))) fail(403, 'The initial administrator enrollment token is not configured or is invalid.');
      const { user } = await verifiedSchoologyUser(input);
      const install = installationId(input);
      const installationSecret = cleanText(input.installationSecret, 'Installation secret', 128);
      if (installationSecret.length < 32) fail(400, 'The installation secret must contain at least 32 characters.');
      const existing = await redis(['SCARD', KEY + 'admin-installations']);
      const prior = await redis(['GET', KEY + 'admin-install:' + install]);
      let priorRecord = null;
      try { priorRecord = JSON.parse(prior || '{}'); } catch {}
      // Permit one secure claim of an old pre-secret installation record, but
      // never replace a previously provisioned installation secret via bootstrap.
      const alreadyMember = Number(await redis(['SISMEMBER', KEY + 'admin-installations', install])) === 1;
      if (priorRecord?.secretHash || (Number(existing) > 0 && !alreadyMember)) {
        fail(409, 'Administrator installation enrollment has already been initialized.');
      }
      await redis(['SADD', KEY + 'admin-installations', install]);
      await redis(['SET', KEY + 'admin-install:' + install, json({
        userId: user.id,
        platform: String(input.platform || 'unknown').slice(0, 30),
        createdAt: priorRecord?.createdAt || new Date().toISOString(),
        label: String(input.installationName || '').slice(0, 80),
        secretHash: hash(installationSecret)
      })]);
      return S.send(res, 200, { authorized: true, installationId: install });
    }

    const admin = await requireAdmin(input);
    if (action === 'list') {
      const [configurations, installations] = await Promise.all([
        listConfigurations(),
        redis(['SMEMBERS', KEY + 'admin-installations'])
      ]);
      const adminInstallations = await Promise.all((Array.isArray(installations) ? installations : []).map(async id => {
        const raw = await redis(['GET', KEY + 'admin-install:' + id]);
        try {
          const value = JSON.parse(raw || '{}');
          // Installation secrets are never returned to clients, including their hashes.
          return { installationId: id, userId: value.userId, platform: value.platform, createdAt: value.createdAt, label: value.label };
        } catch { return { installationId: id }; }
      }));
      return S.send(res, 200, { configurations: configurations.map(({ publication, ...item }) => ({ ...item, publishedAt: publication?.publishedAt || null })), adminInstallations });
    }
    if (action === 'save') {
      const id = input.configurationId ? cleanText(input.configurationId, 'Configuration ID', 100) : randomId('cfg');
      const existing = await readConfiguration(id);
      const configuration = normalizeConfiguration(input.configuration || {}, existing);
      const saved = { id, ...configuration, publication: existing?.publication || null, createdAt: existing?.createdAt || new Date().toISOString(), createdBy: admin.user.id };
      await redis(['SET', KEY + 'config:' + id, json(saved)]);
      await redis(['SADD', KEY + 'configurations', id]);
      const { publication, ...clientConfiguration } = saved;
      return S.send(res, 200, { configuration: { ...clientConfiguration, publishedAt: publication?.publishedAt || null } });
    }
    if (action === 'delete') {
      const id = cleanText(input.configurationId, 'Configuration ID', 100);
      await redis(['DEL', KEY + 'config:' + id]);
      await redis(['SREM', KEY + 'configurations', id]);
      return S.send(res, 200, { deleted: true, configurationId: id });
    }
    if (action === 'create-link') {
      const id = cleanText(input.configurationId, 'Configuration ID', 100);
      return S.send(res, 200, await createEnrollmentToken(id, input));
    }
    if (action === 'publish') {
      const id = cleanText(input.configurationId, 'Configuration ID', 100);
      const config = await readConfiguration(id);
      if (!config || !config.enabled) fail(404, 'The requested configuration is not available.');
      const token = crypto.randomBytes(32).toString('base64url');
      const publishedAt = new Date().toISOString();
      config.publication = { tokenHash: hash(token), publishedAt };
      config.updatedAt = publishedAt;
      await redis(['SET', KEY + 'config:' + id, json(config)]);
      const query = '?id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(token);
      const httpsUrl = APP_ORIGIN + '/config/apply' + query;
      return S.send(res, 200, { published: true, publishedAt, url: httpsUrl, httpsUrl, classwireUrl: 'classwire://config/apply' + query });
    }
    if (action === 'unpublish') {
      const id = cleanText(input.configurationId, 'Configuration ID', 100);
      const config = await readConfiguration(id);
      if (!config) fail(404, 'The requested configuration was not found.');
      config.publication = null;
      config.updatedAt = new Date().toISOString();
      await redis(['SET', KEY + 'config:' + id, json(config)]);
      return S.send(res, 200, { published: false, configurationId: id });
    }
    if (action === 'revoke-link') {
      const token = cleanText(input.token, 'Enrollment token', 128);
      await redis(['DEL', KEY + 'enrollment:' + hash(token)]);
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
      await redis(['SREM', KEY + 'admin-installations', id]);
      await redis(['DEL', KEY + 'admin-install:' + id]);
      return S.send(res, 200, { revoked: true, installationId: id });
    }
    return S.send(res, 400, { error: 'Unknown ClassWire configuration action.' });
  } catch (error) {
    return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) });
  }
};
