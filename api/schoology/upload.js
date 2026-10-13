'use strict';
const Busboy = require('busboy');
const S = require('../../lib/schoology-server');
const MAX_FILE_BYTES = 3 * 1024 * 1024;
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { files: 1, fields: 4, fileSize: MAX_FILE_BYTES } }); }
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
async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    const session = S.getSession(req);
    if (!session) { S.clearSessionCookie(res); throw S.httpError(401, 'Please sign in to Schoology first.'); }
    const { fields, file, filename, mime } = await parseMultipart(req);
    const fileId = await S.uploadSchoologyFile(session, file, filename, mime);
    if (fields.purpose === 'assignment') {
      const sectionId = String(fields.sectionId || ''), assignmentId = String(fields.assignmentId || '');
      if (!/^\d{1,20}$/.test(sectionId) || !/^\d{1,20}$/.test(assignmentId)) throw S.httpError(400, 'Assignment information is missing or invalid.');
      const result = await S.schoologyRequest('POST', 'https://' + S.API_HOST + '/v1/section/' + sectionId + '/assignment/' + assignmentId + '/submission', { files: [{ id: String(fileId) }] }, { sign: true, session, clientIdentity: true, json: true });
      if (result.status < 200 || result.status >= 300) throw S.httpError(502, 'The file uploaded, but Schoology could not submit it to the assignment.');
      return S.send(res, 200, { ok: true });
    }
    return S.send(res, 200, { fileId: String(fileId), filename });
  } catch (error) {
    if (error.statusCode === 401) S.clearSessionCookie(res);
    return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) });
  }
}
module.exports = handler;
module.exports.config = { api: { bodyParser: false }, maxDuration: 60 };
