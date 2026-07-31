'use strict';

const PEER_HOLD = String.raw`
process.on('SIGTERM',()=>process.exit(0));
setInterval(()=>{},60000);
`;

const PEER_READINESS_PROBE = String.raw`
'use strict';
const http=require('node:http');
const host=process.argv[1];
const mode=process.argv[2];
const request=(route,key)=>new Promise((resolve,reject)=>{
  const headers=key===undefined?{}:{'x-api-key':key};
  const req=http.get({host,port:3000,path:route,headers,timeout:2500},response=>{
    const chunks=[];let size=0;
    response.on('data',chunk=>{
      size+=chunk.length;
      if(size>32768){req.destroy(new Error('unbounded'));return;}
      chunks.push(chunk);
    });
    response.on('end',()=>{
      try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}
      catch(error){reject(error);}
    });
  });
  req.once('timeout',()=>req.destroy(new Error('timeout')));
  req.once('error',reject);
});
void(async()=>{
  const result={
    health:await request('/health'),
    ready:await request('/ready'),
    operations:await request('/operations/readiness',process.env.OPERATIONS_API_KEY),
    detailed:await request('/health/detailed',process.env.OPERATIONS_API_KEY)
  };
  if(mode==='healthy'){
    result.missing=await request('/operations/readiness');
    result.wrong=await request('/operations/readiness','i9-wrong-operations-key-260731-z9');
  }
  process.stdout.write(JSON.stringify(result));
})().catch(()=>process.exit(41));
`;

module.exports = Object.freeze({
    PEER_HOLD,
    PEER_READINESS_PROBE
});
