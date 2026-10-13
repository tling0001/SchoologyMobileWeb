'use strict';
const S = require('../../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    // OAuth tokens are client-held; the browser bridge removes them from localStorage.
    return S.send(res, 200, { ok: true });
  } catch (error) { return S.send(res, error.statusCode || 403, { error: S.safeMessage(error) }); }
};
