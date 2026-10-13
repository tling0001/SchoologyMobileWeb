'use strict';
const S = require('../../lib/schoology-server');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    await S.rateLimit(req, 'qr-login', 8, 900);
    const body = S.parseBody(req);
    const qrData = String(body.qrData || '').trim();
    if (!qrData || qrData.length > 4096) throw S.httpError(400, 'Scan a valid Schoology QR code and try again.');
    const session = await S.performLogin('', '', '', qrData);
    return S.send(res, 200, { authenticated: true, ...session });
  } catch (error) {
    return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) });
  }
};
