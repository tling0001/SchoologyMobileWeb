'use strict';
const S = require('../../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    await S.rateLimit(req, 'login', 8, 900);
    const body = S.parseBody(req);
    const user = String(body.user || '').trim();
    const password = String(body.password || '');
    const schoolId = body.schoolId == null ? '' : String(body.schoolId).trim();
    if (!user || user.length > 254 || !password || password.length > 1024) throw S.httpError(400, 'Enter a valid username and password.');
    if (schoolId && !/^\d{1,20}$/.test(schoolId)) throw S.httpError(400, 'Invalid school selection.');
    const session = await S.performLogin(user, password, schoolId);
    return S.send(res, 200, { authenticated: true, ...session });
  } catch (error) {
    return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) });
  }
};
