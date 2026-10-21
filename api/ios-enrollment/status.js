'use strict';
const S = require('../../lib/schoology-server');
const E = require('../../lib/ios-profile-service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
  try {
    const { session } = await E.getSession(String(req.query?.token || ''));
    return S.send(res, 200, { status: session.status, error: session.status === 'error' ? session.error : undefined }, { 'Cache-Control': 'no-store, private' });
  } catch (e) {
    return S.send(res, e.statusCode || 503, { error: S.safeMessage(e) }, { 'Cache-Control': 'no-store, private' });
  }
};
