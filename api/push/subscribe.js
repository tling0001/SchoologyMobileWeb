'use strict';
const S=require('../../lib/schoology-server');
const P=require('../../lib/push-server');
module.exports=async function handler(req,res){
 if(req.method==='GET'&&req.query?.mode==='public-key'){
  try{const {publicKey}=P.vapid();return S.send(res,200,{publicKey},{'Cache-Control':'public, max-age=300'});}
  catch(e){return S.send(res,e.statusCode||503,{error:S.safeMessage(e)});}
 }
 if(req.method!=='POST'&&req.method!=='DELETE')return S.send(res,405,{error:'Method not allowed.'},{Allow:'GET, POST, DELETE'});
 try{
  S.checkOrigin(req);
  const input=S.parseBody(req),session=S.clientSession(input),uid=Number(session.userId||session.user?.id);
  if(!Number.isSafeInteger(uid)||uid<=0)throw S.httpError(401,'Sign in to Schoology before enabling background notifications.');
  const subscription=input.subscription;
  if(!subscription||typeof subscription.endpoint!=='string'||subscription.endpoint.length>4096||!subscription.endpoint.startsWith('https://'))throw S.httpError(400,'A valid browser push subscription is required.');
  const key=P.subscriptionKey(uid,subscription.endpoint);
  if(req.method==='DELETE'){await P.redis(['DEL',key]);return S.send(res,200,{ok:true});}
  P.vapid();
  const notices=await S.proxyApi(session,{path:'notifications/notifications',method:'GET',params:{}});
  const raw=notices?.notification??notices?.notifications??notices?.data?.notification??notices?.data?.notifications??[];
  const arr=Array.isArray(raw)?raw:(raw?.notification||raw?.notifications||raw?.items||[]);
  const seen=[...new Set(arr.map(n=>String(n.id??n.notification_id??n.notificationId??'')).filter(Boolean))].slice(0,100);
  const record={subscription,uid,session:P.encryptSession(session),seen,updatedAt:Date.now()};
  await P.redis(['SET',key,JSON.stringify(record),'EX','7776000']);
  return S.send(res,200,{ok:true});
 }catch(e){return S.send(res,e.statusCode||502,{error:S.safeMessage(e)});}
};
