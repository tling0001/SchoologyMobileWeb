'use strict';
const S = require('../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (!['GET','POST','PUT','PATCH','DELETE'].includes(req.method)) return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST, PUT, PATCH, DELETE' });
  try {
    if (req.method !== 'GET') S.checkOrigin(req);
    const session = S.getSession(req);
    if (!session) { S.clearSessionCookie(res); throw S.httpError(401, 'Please sign in to Schoology first.'); }
    const input = req.method === 'GET' ? { path: req.query?.path, method: req.query?.method || 'GET', params: {} } : S.parseBody(req);
    const result = await S.proxyApi(session, input);
    return S.send(res, 200, { data: result });
  } catch (error) {
    if (error.statusCode === 401) S.clearSessionCookie(res);
    return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) });
  }
};
