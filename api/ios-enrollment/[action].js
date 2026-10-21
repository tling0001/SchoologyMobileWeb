'use strict';
const S = require('../../lib/schoology-server');
const E = require('../../lib/ios-profile-service');

function sendProfile(res, xml) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-apple-aspen-config');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(xml);
}

async function invite(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    E.requireAdmin(req);
    await S.rateLimit(req, 'ios-enrollment-invite', 3, 300);
    const result = await E.createInvite(req);
    return S.send(res, 201, result, { 'Cache-Control': 'no-store' });
  } catch (e) {
    return S.send(res, e.statusCode || 503, { error: S.safeMessage(e) }, { 'Cache-Control': 'no-store' });
  }
}

async function start(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    await S.rateLimit(req, 'ios-enrollment-start', 5, 300);
    const session = await E.createSession(req, String(req.query?.invite || ''));
    return S.send(res, 201, { profileUrl: session.profileUrl, token: session.token, expiresInSeconds: session.expiresInSeconds }, { 'Cache-Control': 'no-store' });
  } catch (e) {
    return S.send(res, e.statusCode || 503, { error: S.safeMessage(e) }, { 'Cache-Control': 'no-store' });
  }
}

async function status(req, res) {
  if (req.method !== 'GET') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
  try {
    const { session } = await E.getSession(String(req.query?.token || ''));
    return S.send(res, 200, { status: session.status, error: session.status === 'error' ? session.error : undefined }, { 'Cache-Control': 'no-store, private' });
  } catch (e) {
    return S.send(res, e.statusCode || 503, { error: S.safeMessage(e) }, { 'Cache-Control': 'no-store, private' });
  }
}

async function profile(req, res) {
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
}

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || '');
  if (action === 'invite') return invite(req, res);
  if (action === 'start') return start(req, res);
  if (action === 'status') return status(req, res);
  if (action === 'profile') return profile(req, res);
  return S.send(res, 404, { error: 'Unknown iOS enrollment endpoint.' });
};

module.exports.config = { api: { bodyParser: false } };
