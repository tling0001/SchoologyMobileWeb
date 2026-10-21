'use strict';
const S = require('../../lib/schoology-server');
const E = require('../../lib/ios-profile-service');

function sendProfile(res, xml) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-apple-aspen-config');
  res.setHeader('Cache-Control', 'no-store');
  res.end(xml);
}

module.exports = async function handler(req, res) {
  const token = String(req.query?.token || '');
  try {
    if (req.method === 'GET') {
      const { session } = await E.getSession(token);
      if (session.status !== 'waiting' || Date.now() - session.createdAt > E.TTL * 1000) throw E.error(410, 'This enrollment session has expired or has already been used.');
      return sendProfile(res, E.mobileconfig(req, token, session.challenge));
    }
    if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/x-apple-aspen-deviceinfo') && !contentType.includes('application/pkcs7-mime') && !contentType.includes('application/octet-stream')) {
      throw E.error(415, 'Unexpected Apple device-response content type.');
    }
    const body = await E.readRaw(req);
    await E.processResponse(req, token, body);
    const complete = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>com.schoology.mobileweb.ios-enrollment.complete</string><key>PayloadUUID</key><string>2F4A2E6B-8B64-4C0D-9F9A-3EED2AA004C1</string><key>PayloadDisplayName</key><string>Schoology iPhone Enrollment Complete</string><key>PayloadContent</key><array/></dict></plist>';
    return sendProfile(res, complete);
  } catch (e) {
    if (e.statusCode) return S.send(res, e.statusCode, { error: S.safeMessage(e) }, { 'Cache-Control': 'no-store' });
    return S.send(res, 503, { error: 'iPhone enrollment could not be completed. Check server configuration and try again.' }, { 'Cache-Control': 'no-store' });
  }
};

module.exports.config = { api: { bodyParser: false } };
