'use strict';
const S=require('../../lib/schoology-server');
const P=require('../../lib/push-server');
module.exports=async function handler(req,res){
 if(req.method!=='GET')return S.send(res,405,{error:'Method not allowed.'},{Allow:'GET'});
 try{const {publicKey}=P.vapid();return S.send(res,200,{publicKey},{'Cache-Control':'public, max-age=300'});}
 catch(e){return S.send(res,e.statusCode||503,{error:S.safeMessage(e)});}
};
