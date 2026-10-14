'use strict';
const S=require('../../lib/schoology-server');
const P=require('../../lib/push-server');
const webpush=require('web-push');
module.exports=async function handler(req,res){
 if(req.method!=='GET'&&req.method!=='POST')return S.send(res,405,{error:'Method not allowed.'},{Allow:'GET, POST'});
 const secret=process.env.PUSH_CRON_SECRET;
 if(!secret||req.headers.authorization!=='Bearer '+secret)return S.send(res,401,{error:'Unauthorized'});
 try{
  const vapid=P.vapid();webpush.setVapidDetails(vapid.subject,vapid.publicKey,vapid.privateKey);
  const keys=await P.redis(['KEYS','schoology-push:sub:*']);
  let checked=0,delivered=0,removed=0;
  for(const key of Array.isArray(keys)?keys:[]){
   let raw=await P.redis(['GET',key]);if(!raw)continue;
   let record;try{record=JSON.parse(raw)}catch{await P.redis(['DEL',key]);continue}
   checked++;
   try{
    const session=P.decryptSession(record.session);
    const data=await S.proxyApi(session,{path:'notifications',method:'GET',params:{}});
    const value=data?.notification??data?.notifications??data?.data?.notification??data?.data?.notifications??[];
    const notices=Array.isArray(value)?value:(value?.notification||value?.notifications||value?.items||[]);
    const newest=notices.map(n=>({n,id:String(n.id??n.notification_id??n.notificationId??'')})).filter(x=>x.id);
    const seen=new Set(record.seen||[]);
    if(!Array.isArray(record.seen)){
      record.seen=newest.map(x=>x.id).slice(0,100);
    }else{
      const fresh=newest.filter(x=>!seen.has(x.id)).reverse();
      for(const item of fresh){
       const n=item.n, body=String(n.body||n.message||n.title||'New Schoology activity').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,240);
       const payload={title:'Schoology',body:body||'You have new Schoology activity.',tag:'schoology-'+item.id,data:{url:'/'}};
       await webpush.sendNotification(record.subscription,JSON.stringify(payload),{TTL:3600});
       delivered++;
      }
      record.seen=[...new Set([...newest.map(x=>x.id),...(record.seen||[])])].slice(0,100);
    }
    record.updatedAt=Date.now();await P.redis(['SET',key,JSON.stringify(record),'EX','7776000']);
   }catch(error){
    if(error.statusCode===401||error.statusCode===403||error.statusCode===404||error.statusCode===410){await P.redis(['DEL',key]);removed++;}
    else console.error('[push-poll] subscription failed',error?.message||error);
   }
  }
  return S.send(res,200,{ok:true,checked,delivered,removed});
 }catch(error){console.error('[push-poll] failed',error);return S.send(res,error.statusCode||500,{error:S.safeMessage(error)});}
};
