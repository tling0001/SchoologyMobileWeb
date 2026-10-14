'use strict';
const crypto = require('node:crypto');
const S = require('./schoology-server');
function redisConfig() {
  const url=process.env.UPSTASH_REDIS_REST_URL, token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token) throw S.httpError(503,'Push storage is not configured. Configure Upstash Redis in Vercel.');
  return {url:url.replace(/\/$/,''),token};
}
async function redis(command) {
  const c=redisConfig();
  const r=await fetch(c.url,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw S.httpError(503,'Push storage is temporarily unavailable.');
  const j=await r.json(); if(j.error) throw S.httpError(503,'Push storage request failed.');
  return j.result;
}
function encryptionKey() {
  const raw=process.env.PUSH_SESSION_ENCRYPTION_KEY;
  if(!raw) throw S.httpError(503,'Background notifications are not configured. Set PUSH_SESSION_ENCRYPTION_KEY in Vercel.');
  if(/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw,'hex');
  return crypto.createHash('sha256').update(raw).digest();
}
function encryptSession(session) {
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(session),'utf8'),cipher.final()]);
  return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
}
function decryptSession(value) {
  try { const d=JSON.parse(value),dec=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(d.iv,'base64'));dec.setAuthTag(Buffer.from(d.tag,'base64'));return JSON.parse(Buffer.concat([dec.update(Buffer.from(d.data,'base64')),dec.final()]).toString('utf8')); }
  catch { throw S.httpError(500,'Could not decrypt a saved notification session. Re-enable background notifications.'); }
}
function vapid() {
  const publicKey=process.env.VAPID_PUBLIC_KEY, privateKey=process.env.VAPID_PRIVATE_KEY;
  if(!publicKey||!privateKey) throw S.httpError(503,'Push delivery is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel.');
  return {publicKey,privateKey,subject:process.env.VAPID_SUBJECT||'mailto:admin@example.com'};
}
function subscriptionKey(userId, endpoint) {
  return 'schoology-push:sub:'+crypto.createHash('sha256').update(String(userId)+':'+String(endpoint)).digest('hex');
}
module.exports={redis,encryptSession,decryptSession,vapid,subscriptionKey};
