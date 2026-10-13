'use strict';
const S = require('../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    const input = S.parseBody(req);
    const session = S.clientSession(input);
    const result = await S.proxyApi(session, input);
    return S.send(res, 200, { data: result });
  } catch (error) { return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
};
