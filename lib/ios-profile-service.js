'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const S = require('./schoology-server');
const ASC = require('./ios-enrollment-server');
const TTL = 1800;
const INVITE_TTL = 7 * 24 * 60 * 60;
const INVITE_MAX_USES = 20;
const PREFIX = 'schoology-ios-enrollment:session:';
const INVITE_PREFIX = 'schoology-ios-enrollment:invite:';
const LOCK = 'schoology-ios-enrollment:callback-lock:';
const DEVICE_PREFIX = 'schoology-ios-enrollment:device:';
const DEVICE_TTL = 180 * 24 * 60 * 60;

function error(statusCode, message) { const e = new Error(message); e.statusCode = statusCode; return e; }
function requireAdmin(req) {
  const expected = process.env.IOS_ENROLLMENT_ADMIN_SECRET;
  const provided = String(req.headers?.['x-enrollment-admin'] || '');
  if (!expected || expected.length < 32) throw error(503, 'Enrollment administration is not configured. Set IOS_ENROLLMENT_ADMIN_SECRET in Vercel to a random secret of at least 32 characters.');
  const a = Buffer.from(expected), b = Buffer.from(provided);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw error(401, 'The administrator secret is invalid.');
}
async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw error(503, 'Enrollment storage is not configured. Add the Upstash Redis REST URL and token in Vercel.');
  const redisUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  const response = await fetch(redisUrl, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw error(503, 'Enrollment storage is temporarily unavailable.');
  const result = await response.json();
  if (result.error) throw error(503, 'Enrollment storage request failed.');
  return result.result;
}
function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function validToken(token) { return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token); }
function origin(req) {
  const configured = process.env.IOS_ENROLLMENT_BASE_URL;
  if (configured) { const u = new URL(configured); if (u.protocol !== 'https:') throw error(503, 'IOS_ENROLLMENT_BASE_URL must use HTTPS.'); return u.origin; }
  const host = String(req.headers?.host || '');
  if (!host || /[^a-zA-Z0-9.:-]/.test(host) || String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() !== 'https') throw error(400, 'Enrollment requires a valid HTTPS host.');
  return 'https://' + host;
}
async function createInvite(req) {
  const token = crypto.randomBytes(32).toString('hex');
  const key = INVITE_PREFIX + hash(token);
  const saved = await redis(['SET', key, '0', 'EX', String(INVITE_TTL), 'NX']);
  if (saved !== 'OK') throw error(503, 'Could not create an enrollment invitation. Try again.');
  return { inviteUrl: origin(req) + '/ios-enroll.html?invite=' + token, expiresInSeconds: INVITE_TTL, maxDevices: INVITE_MAX_USES };
}
async function consumeInvite(token) {
  if (!validToken(token)) throw error(401, 'This enrollment link is invalid. Ask the person who shared it for a new link.');
  const script = "local n=redis.call('GET',KEYS[1]); if not n then return -1 end; n=tonumber(n); if n>=tonumber(ARGV[1]) then return 0 end; return redis.call('INCR',KEYS[1])";
  const used = Number(await redis(['EVAL', script, '1', INVITE_PREFIX + hash(token), String(INVITE_MAX_USES)]));
  if (used === -1) throw error(410, 'This enrollment link has expired. Ask the person who shared it for a new link.');
  if (used === 0 || !Number.isFinite(used)) throw error(429, 'This enrollment link has reached its device limit. Ask the person who shared it for a new link.');
  return used;
}
async function getKnownDevice(deviceToken) {
  if (!validToken(deviceToken)) throw error(404, 'This browser has no saved iPhone enrollment.');
  const raw = await redis(['GET', DEVICE_PREFIX + hash(deviceToken)]);
  if (!raw) throw error(404, 'This browser has no saved iPhone enrollment.');
  let record;
  try { record = JSON.parse(raw); } catch { throw error(503, 'Saved device enrollment data is invalid.'); }
  const enrolled = await ASC.isDeviceIncludedInActiveProfile(record.deviceId, record.profileId, record.profileUUID);
  return { enrolled, buildRequestedAt: record.buildRequestedAt, profileUUID: record.profileUUID };
}
async function getSession(token) {
  if (!validToken(token)) throw error(404, 'Enrollment session not found or expired.');
  const key = PREFIX + hash(token);
  const raw = await redis(['GET', key]);
  if (!raw) throw error(404, 'Enrollment session not found or expired.');
  try { return { key, session: JSON.parse(raw) }; } catch { throw error(503, 'Enrollment session data is invalid.'); }
}
async function createSession(req, inviteToken) {
  await consumeInvite(inviteToken);
  const token = crypto.randomBytes(32).toString('hex');
  const challenge = crypto.randomBytes(32).toString('hex');
  const session = { challenge, status: 'waiting', createdAt: Date.now(), updatedAt: Date.now() };
  const saved = await redis(['SET', PREFIX + hash(token), JSON.stringify(session), 'EX', String(TTL), 'NX']);
  if (saved !== 'OK') throw error(503, 'Could not create an enrollment session. Try again.');
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
    PayloadDescription: 'Temporary registration profile: sends this iPhone identifier to Apple so Schoology can be installed. This is not an MDM or management profile. After installing, return to Safari to watch registration and build progress. iOS does not let this registration-only profile uninstall itself; if it remains listed after registration, remove it in Settings > General > VPN & Device Management.',
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
  // Vercel secrets are sometimes pasted with literal \\n sequences instead of real newlines.
  // Normalize both forms before passing the PEM to OpenSSL.
  const ca = String(process.env.APPLE_DEVICE_CA_PEM || '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim() + '\n';
  if (!ca || !ca.includes('BEGIN CERTIFICATE')) throw error(503,'Apple device-response verification is not configured. Set APPLE_DEVICE_CA_PEM in Vercel to the trusted Apple device CA certificate.');
  if (!cms || cms.length < 100 || cms.length > 1024*1024) throw error(400,'Invalid Apple device response.');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'schoology-ios-cms-'));
  try {
    const input=path.join(dir,'response.der'), output=path.join(dir,'response.plist'), caFile=path.join(dir,'apple-device-ca.pem');
    fs.writeFileSync(input,cms,{mode:0o600}); fs.writeFileSync(caFile,ca,{mode:0o600});
    // Serverless runtimes may export LD_LIBRARY_PATH entries that make the system
    // OpenSSL executable load incompatible libssl/libcrypto versions. Let the
    // dynamic loader use its standard system paths for these OpenSSL subprocesses.
    const opensslEnv = { ...process.env };
    delete opensslEnv.LD_LIBRARY_PATH;
    // Fail with a configuration error if the supplied PEM is not a readable certificate.
    execFileSync('openssl',['x509','-in',caFile,'-noout'],{stdio:['ignore','ignore','pipe'],timeout:5000,env:opensslEnv});
    execFileSync('openssl',['cms','-verify','-binary','-inform','DER','-in',input,'-CAfile',caFile,'-partial_chain','-no_check_time','-purpose','any','-out',output],{stdio:['ignore','ignore','pipe'],timeout:5000,env:opensslEnv});
    return fs.readFileSync(output,'utf8');
  } catch (e) {
    if(e.statusCode) throw e;
    // Keep device identifiers, signed payloads, and tokens out of logs and responses.
    console.error('[ios-enrollment] Apple Profile Service CMS verification failed:', String(e.stderr || e.message || 'OpenSSL verification error').split('\n')[0].slice(0, 240));
    throw error(400,'Apple device signature could not be verified. Check the Vercel APPLE_DEVICE_CA_PEM value is the current Apple iPhone Device CA certificate in PEM format.');
  }
  finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
function plistString(xml,key) {
  const match=xml.match(new RegExp('<key>\\s*'+key+'\\s*</key>\\s*<string>([^<]{1,512})</string>','i'));
  return match ? match[1].trim() : '';
}
async function processResponse(req,token,cms) {
  const {key,session}=await getSession(token);
  const lockKey=LOCK+hash(token);
  if(!await redis(['SET',lockKey,'1','NX','EX','60'])) throw error(409,'This enrollment response has already been submitted.');
  let phase='validate enrollment session';
  try {
    if(session.status!=='waiting'||Date.now()-session.createdAt>TTL*1000) throw error(410,'This enrollment session has expired or has already been used.');
    phase='verify Apple CMS signature';
    const xml=verifyCms(cms);
    phase='parse Apple device response';
    const udid=plistString(xml,'UDID').toUpperCase();
    const challenge=plistString(xml,'CHALLENGE');
    if(!/^[A-F0-9-]{20,40}$/.test(udid)) throw error(400,'Apple did not return a valid iPhone UDID.');
    phase='validate enrollment challenge';
    if(!challenge||challenge.length!==session.challenge.length||!crypto.timingSafeEqual(Buffer.from(challenge),Buffer.from(session.challenge))) throw error(403,'Apple device response did not match the enrollment challenge.');
    phase='register device with App Store Connect';
    session.status='registering'; session.updatedAt=Date.now();
    await redis(['SET',key,JSON.stringify(session),'EX',String(TTL)]);
    const result=await ASC.registerVerifiedDeviceAndCreateProfile(udid);
    session.status='building'; session.profileUUID=result.profileUUID; session.deviceId=result.deviceId; session.profileId=result.profileId; session.deviceToken=crypto.randomBytes(32).toString('hex'); session.buildRequestedAt=Date.now(); session.updatedAt=Date.now();
    await redis(['SET',key,JSON.stringify(session),'EX',String(TTL)]);
    await redis(['SET',DEVICE_PREFIX + hash(session.deviceToken),JSON.stringify({deviceId:result.deviceId,profileId:result.profileId,profileUUID:result.profileUUID,buildRequestedAt:session.buildRequestedAt}),'EX',String(DEVICE_TTL)]);
    phase='dispatch iOS build workflow';
    await ASC.dispatchAdHocBuild(result.profileUUID);
    session.status='complete'; session.updatedAt=Date.now();
    await redis(['SET',key,JSON.stringify(session),'EX',String(TTL)]);
    return session;
  } catch(e) {
    console.error('[ios-enrollment] Profile Service POST failed at ' + phase + ': status=' + (e.statusCode || 500) + '; ' + String(e.message || 'Unknown error').split('\n')[0].slice(0, 200));
    session.status='error'; session.error=e.statusCode?e.message:'Enrollment could not be completed. Check server configuration and try again.'; session.updatedAt=Date.now();
    await redis(['SET',key,JSON.stringify(session),'EX',String(TTL)]).catch(()=>{});
    throw e;
  } finally { await redis(['DEL',lockKey]).catch(()=>{}); }
}
module.exports={createSession,createInvite,getSession,getKnownDevice,origin,mobileconfig,readRaw,processResponse,error,requireAdmin,TTL,INVITE_TTL,INVITE_MAX_USES};
