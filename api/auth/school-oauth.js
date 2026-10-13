'use strict';
const S = require('../../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    await S.rateLimit(req, 'school-oauth', 10, 900);
    const body = S.parseBody(req);
    let domain = String(body.domain || '').trim();
    if (!domain || domain.length > 253) throw S.httpError(400, 'Select a school with a valid login domain.');
    try {
      const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(domain) ? domain : 'https://' + domain);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || !/(^|\.)schoology\.com$/i.test(parsed.hostname) && !parsed.hostname.includes('.')) throw new Error();
      domain = parsed.host.toLowerCase();
    } catch { throw S.httpError(400, 'This school did not provide a valid sign-in domain.'); }
    await S.schoologyRequest('GET', 'https://api.schoology.com/v1/oauth/request_token', {}, { sign: true }).then(response => {
      if (response.status < 200 || response.status >= 300) throw S.httpError(502, 'Schoology could not start school sign-in.');
      const token = new URLSearchParams(response.text);
      const oauthToken = token.get('oauth_token');
      if (!oauthToken || !token.get('oauth_token_secret')) throw S.httpError(502, 'Schoology returned an invalid sign-in token.');
      const callback = 'https://' + domain + '/mobile_login_success?os=android&os_version=34&app_version=600000477';
      const authorizeQuery = 'oauth_token=' + oauthToken + '&oauth_callback=' + encodeURIComponent(callback);
      const landing = 'oauth/authorize?' + authorizeQuery;
      const url = 'https://' + domain + '/oauth/authorize?oauth_token=' + encodeURIComponent(oauthToken) + '&oauth_callback=' + encodeURIComponent(callback) + '&login_landing_dest=' + encodeURIComponent(landing);
      return S.send(res, 200, { url });
    });
  } catch (error) { if (!res.headersSent) return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
};
