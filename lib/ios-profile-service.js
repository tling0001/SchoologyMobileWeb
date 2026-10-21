'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const S = require('./schoology-server');
const ASC = require('./ios-enrollment-server');
const TTL = 1800;
const PREFIX = 'schoology-ios-enrollment:session:';
const LOCK = 'schoology-ios-enrollment:callback-lock:';

function error(statusCode, message) { const e = new Error(message); e.statusCode = statusCode; return e; }
function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function validToken(token) { return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token); }
function origin(req) {
  const configured = process.env.IOS_ENROLLMENT_BASE_URL;
  if (configured) { const u = new URL(configured); if (u.protocol !== 'https:') throw error(503, 'IOS_ENROLLMENT_BASE_URL must use HTTPS.'); return u.origin; }
  const host = String(req.headers?.host || '');
  if (!host || /[^a-zA-Z0-9.:-]/.test(host) || String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() !== 'https') throw error(400, 'Enrollment requires a valid HTTPS host.');
  return 'https://' + host;
}
async function getSession(token) {
  if (!validToken(token)) throw error(404, 'Enrollment session not found or expired.');
  const key = PREFIX + hash(token);
  const raw = await S.redis(['GET', key]);
  if (!raw) throw error(404, 'Enrollment session not found or expired.');
  try { return { key, session: JSON.parse(raw) }; } catch { throw error(503, 'Enrollment session data is invalid.'); }
}
async function createSession(req) {
  const token = crypto.randomBytes(32).toString('hex');
  const challenge = crypto.randomBytes(32).toString('hex');
  const session = { challenge, status: 'waiting', createdAt: Date.now(), updatedAt: Date.now() };
  await S.redis(['SET', PREFIX + hash(token), JSON.stringify(session), 'EX', String(TTL), 'NX']);
  return { token, challenge, profileUrl: origin(req) + '/api/ios-enrollment/profile?token=' + token, expiresInSeconds: TTL };
}
function mobileconfig(req, token, challenge) {
  const callback = origin(req) + '/api/ios-enrollment/profile?token=' + token;
  const xml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const payload = {
    PayloadType: 'Profile Service', PayloadVersion: 1,
    PayloadIdentifier: 'com.schoology.mobileweb.ios-enrollment',
    PayloadUUID: crypto.randomUUID().toUpperCase(),
    PayloadDisplayName: 'Register iPhone for Schoology',
    PayloadDescription: 'Securely register this iPhone for QR-based Schoology installation.',
    PayloadOrganization: 'Schoology',
    PayloadContent: { URL: callback, DeviceAttributes: ['UDID', 'VERSION'], Challenge: challenge }
  };
  function dict(obj) {
    return Object.entries(obj).map(([k,v]) => {
      const key = '<key>' + xml(k) + '</key>';
      if (Array.isArray(v)) return key + '<array>' + v.map(x => '<string>' + xml(x) + '</string>').join('') + '</array>';
      if (v && typeof v === 'object') return key + '<dict>' + dict(v) + '</dict>';
      if (typeof v === 'number') return key + '<integer>' + v + '</integer>';
      return key + '<string>' + xml(v) + '</string>';
    }).join('');
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>' + dict(payload) + '</dict></plist>';
}
function readRaw(req) {
  return new Promise((resolve,reject) => {
    const chunks=[]; let size=0, done=false;
    req.on('data', chunk => { if (done) return; size += chunk.length; if (size > 1024*1024) { done=true; reject(error(413,'Apple device response is too large.')); return; } chunks.push(Buffer.from(chunk)); });
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks)); });
    req.on('error', () => { if (!done) reject(error(400,'Could not read Apple device response.')); });
  });
}
function verifyCms(cms) {
  const ca = process.env.APPLE_DEVICE_CA_PEM;
  if (!ca || !ca.includes('BEGIN CERTIFICATE')) throw error(503,'Apple device-response verification is not configured. Set APPLE_DEVICE_CA_PEM in Vercel to the trusted Apple Profile Service device CA certificate.');
  if (!cms || cms.length < 100 || cms.length > 1024*1024) throw error(400,'Invalid Apple device response.');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'schoology-ios-cms-'));
  try {
    const input=path.join(dir,'response.der'), output=path.join(dir,'response.plist'), caFile=path.join(dir,'apple-device-ca.pem');
    fs.writeFileSync(input,cms,{mode:0o600}); fs.writeFileSync(caFile,ca,{mode:0o600});
    execFileSync('openssl',['cms','-verify','-binary','-inform','DER','-in',input,'-CAfile',caFile,'-partial_chain','-no_check_time','-purpose','any','-out',output],{stdio:['ignore','ignore','pipe'],timeout:5000});
    return fs.readFileSync(output,'utf8');
  } catch (e) { if(e.statusCode) throw e; throw error(400,'Apple device signature could not be verified against the configured Apple device CA.'); }
  finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
function plistString(xml,key) {
  const match=xml.match(new RegExp('<key>\\s*'+key+'\\s*</key>\\s*<string>([^<]{1,512})</string>','i'));
  return match ? match[1].trim() : '';
}
async function processResponse(req,token,cms) {
  const {key,session}=await getSession(token);
  const lockKey=LOCK+hash(token);
  if(!await S.redis(['SET',lockKey,'1','NX','EX','60'])) throw error(409,'This enrollment response has already been submitted.');
  try {
    if(session.status!=='waiting'||Date.now()-session.createdAt>TTL*1000) throw error(410,'This enrollment session has expired or has already been used.');
    const xml=verifyCms(cms);
    const udid=plistString(xml,'UDID').toUpperCase();
    const challenge=plistString(xml,'CHALLENGE');
    if(!/^[A-F0-9-]{20,40}$/.test(udid)) throw error(400,'Apple did not return a valid iPhone UDID.');
    if(!challenge||challenge.length!==session.challenge.length||!crypto.timingSafeEqual(Buffer.from(challenge),Buffer.from(session.challenge))) throw error(403,'Apple device response did not match the enrollment challenge.');
    session.status='registering'; session.updatedAt=Date.now();
    await S.redis(['SET',key,JSON.stringify(session),'EX',String(TTL)]);
    const result=await ASC.registerVerifiedDeviceAndCreateProfile(udid);
    session.status='building'; session.profileUUID=result.profileUUID; session.updatedAt=Date.now();
    await S.redis(['SET',key,JSON.stringify(session),'EX',String(TTL)]);
    await ASC.dispatchAdHocBuild(result.profileUUID);
    session.status='complete'; session.updatedAt=Date.now();
    await S.redis(['SET',key,JSON.stringify(session),'EX',String(TTL)]);
    return session;
  } catch(e) {
    session.status='error'; session.error=e.statusCode?e.message:'Enrollment could not be completed. Check server configuration and try again.'; session.updatedAt=Date.now();
    await S.redis(['SET',key,JSON.stringify(session),'EX',String(TTL)]).catch(()=>{});
    throw e;
  } finally { await S.redis(['DEL',lockKey]).catch(()=>{}); }
}
module.exports={createSession,getSession,origin,mobileconfig,readRaw,processResponse,error,TTL};
