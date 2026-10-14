'use strict';
const { Readable } = require('node:stream');
const S = require('../../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    const input = S.parseBody(req);
    const session = S.clientSession(input);
    const raw = String(input.url || '');
    if (!raw || raw.length > 4096) throw S.httpError(400, 'A valid Schoology file URL is required.');
    let url;
    try { url = new URL(raw); } catch { throw S.httpError(400, 'Invalid Schoology file URL.'); }
    const isSchoologyHost = host => host === 'schoology.com' || host.endsWith('.schoology.com');
    const schoolDomainRaw = String(input.schoolDomain || '').trim();
    let schoolDomain = '';
    if (schoolDomainRaw) {
      try {
        const parsedDomain = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(schoolDomainRaw) ? schoolDomainRaw : 'https://' + schoolDomainRaw);
        if (parsedDomain.protocol !== 'https:' || !parsedDomain.hostname) throw new Error();
        schoolDomain = parsedDomain.hostname.toLowerCase();
      } catch { throw S.httpError(400, 'Invalid school domain for file download.'); }
    }
    const isSchoolHost = host => !!schoolDomain && (host === schoolDomain || host.endsWith('.' + schoolDomain));
    const isTrustedFileHost = host => isSchoologyHost(host) || isSchoolHost(host) || host === 'amazonaws.com' || host.endsWith('.amazonaws.com') || host === 'cloudfront.net' || host.endsWith('.cloudfront.net');
    if (url.protocol !== 'https:' || !(isSchoologyHost(url.hostname.toLowerCase()) || isSchoolHost(url.hostname.toLowerCase()))) throw S.httpError(400, 'Only HTTPS Schoology or selected-school file links can be downloaded.');
    let response = null;
    for (let depth = 0; depth <= 5; depth++) {
      const currentHost=url.hostname.toLowerCase();
      const schoologyTarget=isSchoologyHost(currentHost)||isSchoolHost(currentHost);
      const headers = { 'User-Agent': 'okhttp/4.8.0', Accept: '*/*' };
      if(schoologyTarget){headers.Cookie=S.MOBILE_COOKIE;const authorization=S.getDownloadAuthorization(session,url.toString());if(authorization)headers.Authorization=authorization;}
      response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(60000) });
      if (![301,302,303,307,308].includes(response.status) || !response.headers.get('location')) break;
      const next = new URL(response.headers.get('location'), url);
      if (next.protocol !== 'https:' || !isTrustedFileHost(next.hostname.toLowerCase())) throw S.httpError(502, 'Schoology redirected to an unsupported file host.');
      // Never forward OAuth authorization to third-party signed storage URLs.
      if (!isSchoologyHost(next.hostname.toLowerCase()) && !isSchoolHost(next.hostname.toLowerCase())) {
        // Subsequent requests are made without Schoology cookies or OAuth headers.
      }
      url = next;
    }
    if (!response || response.status < 200 || response.status >= 300 || !response.body) throw S.httpError(502, 'Schoology file download failed.');
    const name = String(input.filename || url.pathname.split('/').pop() || 'Schoology-file').replace(/[\\/\r\n"]/g, '_').slice(0, 180) || 'Schoology-file';
    res.statusCode = 200;
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name.replace(/"/g, '') + '"');
    res.setHeader('Cache-Control', 'no-store, private');
    const length = response.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) { return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
};
