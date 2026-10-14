'use strict';
const S = require('../../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    if (req.query?.mode === 'logout') return S.send(res, 200, { ok: true });
    const session = S.clientSession(S.parseBody(req));
    const response = await S.schoologyRequest('GET', 'https://' + S.API_HOST + '/v1/users/me', {}, { sign: true, session, clientIdentity: true });
    if (response.status === 401 || response.status === 403) throw S.httpError(401, 'Your Schoology sign-in has expired. Please sign in again.');
    if (response.status < 200 || response.status >= 300) throw S.httpError(502, 'Could not verify your Schoology session.');
    let profile;
    try { profile = JSON.parse(response.text); } catch { throw S.httpError(502, 'Schoology returned an invalid user profile.'); }
    const user = S.safeUser(profile);
    return S.send(res, 200, { authenticated: true, oauth_token: session.oauth_token, oauth_token_secret: session.oauth_token_secret, user, userId: user.id });
  } catch (error) { return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
};
