'use strict';
const S = require('../../lib/schoology-server');
const E = require('../../lib/ios-profile-service');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    const session = await E.createSession(req);
    return S.send(res, 201, { profileUrl: session.profileUrl, token: session.token, expiresInSeconds: session.expiresInSeconds }, { 'Cache-Control': 'no-store' });
  } catch (e) {
    return S.send(res, e.statusCode || 503, { error: S.safeMessage(e) }, { 'Cache-Control': 'no-store' });
  }
};
