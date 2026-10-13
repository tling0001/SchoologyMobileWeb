'use strict';
const S = require('../../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
  try {
    const session = S.getSession(req);
    if (!session) { S.clearSessionCookie(res); return S.send(res, 200, { authenticated: false, user: null }); }
    return S.send(res, 200, { authenticated: true, user: session.user || null });
  } catch (error) {
    return S.send(res, error.statusCode || 503, { error: S.safeMessage(error) });
  }
};
