'use strict';
const S = require('../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
  try {
    await S.rateLimit(req, 'school-search', 40, 60);
    const query = String(req.query?.q || '').trim().slice(0, 120);
    if (!query) return S.send(res, 200, { schools: [] });
    const response = await S.schoologyRequest('GET', 'https://' + S.API_HOST + '/v1/login/school_search', { query }, { clientIdentity: true });
    if (response.status < 200 || response.status >= 300) throw S.httpError(502, 'School search is temporarily unavailable.');
    let data; try { data = JSON.parse(response.text); } catch { throw S.httpError(502, 'School search returned invalid data.'); }
    return S.send(res, 200, { schools: Array.isArray(data.school) ? data.school : [] });
  } catch (error) { return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
};
