'use strict';

const { Readable } = require('node:stream');
const Busboy = require('busboy');
const S = require('../../lib/schoology-server');

const MAX_FILE_BYTES = 3 * 1024 * 1024;

function fail(status, message) { throw S.httpError(status, message); }

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { fail(400, 'Invalid JSON request body.'); }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) fail(413, 'The file-download request is too large.');
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'Invalid JSON request body.'); }
}

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { files: 1, fields: 6, fileSize: MAX_FILE_BYTES } }); }
    catch { reject(S.httpError(400, 'Choose a file to upload.')); return; }
    const fields = {};
    let file = null, filename = '', mime = 'application/octet-stream', tooLarge = false, failed = false;
    bb.on('field', (name, value) => { fields[name] = String(value).slice(0, 300); });
    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || file) { stream.resume(); return; }
      filename = String(info.filename || 'upload.bin').replace(/[\\/\r\n"]/g, '_').slice(0, 180) || 'upload.bin';
      mime = String(info.mimeType || 'application/octet-stream').slice(0, 120);
      const chunks = [];
      stream.on('limit', () => { tooLarge = true; });
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('error', err => { failed = true; reject(err); });
      stream.on('end', () => { if (!tooLarge && !failed) file = Buffer.concat(chunks); });
    });
    bb.on('error', reject);
    bb.on('close', () => {
      if (tooLarge) return reject(S.httpError(413, 'Files must be 3 MB or smaller in this first browser-upload stage.'));
      if (!file) return reject(S.httpError(400, 'Choose a file to upload.'));
      resolve({ fields, file, filename, mime });
    });
    req.pipe(bb);
  });
}

async function download(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    const input = await readJsonBody(req);
    const session = S.clientSession(input);
    const raw = String(input.url || '');
    if (!raw || raw.length > 4096) fail(400, 'A valid Schoology file URL is required.');
    let url;
    try { url = new URL(raw); } catch { fail(400, 'Invalid Schoology file URL.'); }
    const isSchoologyHost = host => host === 'schoology.com' || host.endsWith('.schoology.com');
    const schoolDomainRaw = String(input.schoolDomain || '').trim();
    let schoolDomain = '';
    if (schoolDomainRaw) {
      try {
        const parsedDomain = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(schoolDomainRaw) ? schoolDomainRaw : 'https://' + schoolDomainRaw);
        if (parsedDomain.protocol !== 'https:' || !parsedDomain.hostname) throw new Error();
        schoolDomain = parsedDomain.hostname.toLowerCase();
      } catch { fail(400, 'Invalid school domain for file download.'); }
    }
    const isSchoolHost = host => !!schoolDomain && (host === schoolDomain || host.endsWith('.' + schoolDomain));
    const isTrustedFileHost = host => isSchoologyHost(host) || isSchoolHost(host) || host === 'amazonaws.com' || host.endsWith('.amazonaws.com') || host === 'cloudfront.net' || host.endsWith('.cloudfront.net');
    if (url.protocol !== 'https:' || !isTrustedFileHost(url.hostname.toLowerCase())) fail(400, 'Only HTTPS Schoology, selected-school, or signed Schoology storage links can be downloaded.');
    let response = null;
    for (let depth = 0; depth <= 5; depth++) {
      const currentHost = url.hostname.toLowerCase();
      const schoologyTarget = isSchoologyHost(currentHost) || isSchoolHost(currentHost);
      const headers = { 'User-Agent': 'okhttp/4.8.0', Accept: '*/*' };
      if (schoologyTarget) {
        headers.Cookie = S.MOBILE_COOKIE;
        const authorization = S.getDownloadAuthorization(session, url.toString());
        if (authorization) headers.Authorization = authorization;
      }
      response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(60000) });
      if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.get('location')) break;
      const next = new URL(response.headers.get('location'), url);
      if (next.protocol !== 'https:' || !isTrustedFileHost(next.hostname.toLowerCase())) fail(502, 'Schoology redirected to an unsupported file host.');
      url = next;
    }
    if (!response || response.status < 200 || response.status >= 300 || !response.body) fail(502, 'Schoology file download failed.');
    const name = String(input.filename || url.pathname.split('/').pop() || 'Schoology-file').replace(/[\\/\r\n"]/g, '_').slice(0, 180) || 'Schoology-file';
    res.statusCode = 200;
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name.replace(/"/g, '') + '"');
    res.setHeader('Cache-Control', 'no-store, private');
    const length = response.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    return Readable.fromWeb(response.body).pipe(res);
  } catch (error) { return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
}

async function upload(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    const { fields, file, filename, mime } = await parseMultipart(req);
    const session = S.clientSession(fields);
    const fileId = await S.uploadSchoologyFile(session, file, filename, mime);
    if (fields.purpose === 'assignment') {
      const sectionId = String(fields.sectionId || ''), assignmentId = String(fields.assignmentId || '');
      if (!/^\d{1,20}$/.test(sectionId) || !/^\d{1,20}$/.test(assignmentId)) fail(400, 'Assignment information is missing or invalid.');
      const result = await S.schoologyRequest('POST', 'https://' + S.API_HOST + '/v1/section/' + sectionId + '/assignment/' + assignmentId + '/submission', { files: [{ id: String(fileId) }] }, { sign: true, session, clientIdentity: true, json: true });
      if (result.status < 200 || result.status >= 300) fail(502, 'The file uploaded, but Schoology could not submit it to the assignment.');
      return S.send(res, 200, { ok: true });
    }
    return S.send(res, 200, { fileId: String(fileId), filename });
  } catch (error) { return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
}

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || '');
  if (action === 'download') return download(req, res);
  if (action === 'upload') return upload(req, res);
  return S.send(res, 404, { error: 'Unknown Schoology file action.' });
};

// One dynamic entry point handles both /api/schoology/download and /upload.
// Disable Vercel's JSON parser so multipart uploads remain streamed; download()
// reads its small JSON body explicitly.
module.exports.config = { api: { bodyParser: false }, maxDuration: 60 };
