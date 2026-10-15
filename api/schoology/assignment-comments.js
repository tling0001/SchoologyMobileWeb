'use strict';
const S = require('../../lib/schoology-server');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    const input = S.parseBody(req);
    const session = S.clientSession(input);
    const sectionId = Number(input.sectionId);
    const assignmentId = Number(input.assignmentId);
    const parentId = Number(input.parentId || 0);
    const method = String(input.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw S.httpError(405, 'This assignment-comment method is not allowed.');
    if (!Number.isSafeInteger(sectionId) || sectionId < 1 || !Number.isSafeInteger(assignmentId) || assignmentId < 1 || !Number.isSafeInteger(parentId) || parentId < 0) throw S.httpError(400, 'A valid course and assignment are required.');
    const path = '/course/' + sectionId + '/materials/assignments/' + assignmentId + (method === 'GET' ? '/comments' : parentId ? '/create_reply/' + parentId : '/create_comment');
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const response = await S.schoologyRequest(method, 'https://' + S.WEB_HOST + path, params, { sign: true, session, clientIdentity: true, json: false });
    if (response.status === 401) throw S.httpError(401, 'Your Schoology session has expired. Please sign in again.');
    if (response.status === 403) throw S.httpError(403, 'Schoology denied this assignment-comment request.');
    if (response.status < 200 || response.status >= 300) throw S.httpError(response.status >= 400 && response.status < 500 ? response.status : 502, 'Schoology assignment-comment request failed (HTTP ' + response.status + ').');
    let data;
    try { data = JSON.parse(response.text); } catch { data = response.text; }
    return S.send(res, 200, { data });
  } catch (error) { return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
};
