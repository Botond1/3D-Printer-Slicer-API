'use strict';

const SENTINEL_HOST = 'i6-egress-sentinel.validation';
const SENTINEL_IP = '192.0.2.2';

const ENCODED_EVAL = String.raw`
const source=Buffer.from(process.argv[1],'base64').toString('utf8');
process.argv.splice(1,1);
eval(source);
`;

const SENTINEL_LISTENER = String.raw`
const net=require('node:net'),dgram=require('node:dgram');
const host=process.argv[1],ip=process.argv[2],token='i6-sentinel-live';
const ipBytes=Buffer.from(ip.split('.').map(Number));
const fail=()=>process.exit(41);
const tcp=net.createServer(socket=>{socket.on('error',()=>{});socket.end(token);});
const udp=dgram.createSocket('udp4');
const dns=dgram.createSocket('udp4');
for(const server of [tcp,udp,dns])server.on('error',fail);
udp.on('message',(_,peer)=>udp.send(token,peer.port,peer.address));
dns.on('message',(query,peer)=>{
  if(query.length<17)return;
  let offset=12;
  const labels=[];
  while(offset<query.length&&query[offset]!==0){
    const length=query[offset++];
    if(length===0||length>63||offset+length>query.length)return;
    labels.push(query.subarray(offset,offset+length).toString('ascii'));
    offset+=length;
  }
  const questionEnd=offset+5;
  if(questionEnd>query.length)return;
  const matches=labels.join('.').toLowerCase()===host
    &&query.readUInt16BE(offset+1)===1&&query.readUInt16BE(offset+3)===1;
  const header=Buffer.alloc(12);
  query.copy(header,0,0,2);
  header.writeUInt16BE(matches?0x8180:0x8183,2);
  header.writeUInt16BE(1,4);
  header.writeUInt16BE(matches?1:0,6);
  const question=query.subarray(12,questionEnd);
  const answer=matches
    ?Buffer.concat([Buffer.from([0xc0,0x0c,0x00,0x01,0x00,0x01,0,0,0,0,0,4]),ipBytes])
    :Buffer.alloc(0);
  dns.send(Buffer.concat([header,question,answer]),peer.port,peer.address);
});
Promise.all([
  new Promise(resolve=>tcp.listen(41234,'0.0.0.0',resolve)),
  new Promise(resolve=>udp.bind(41235,'0.0.0.0',resolve)),
  new Promise(resolve=>dns.bind(53,'0.0.0.0',resolve))
]).then(()=>process.stdout.write('sentinel-ready\n'),fail);
`;

const NODE_TRANSPORT_PROBE = String.raw`
const dns=require('node:dns').promises,net=require('node:net'),dgram=require('node:dgram');
const host=process.argv[1],ip=process.argv[2];
const tcp=()=>new Promise(resolve=>{
  const socket=net.createConnection({host:ip,port:41234});
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};
  socket.setTimeout(1500,()=>finish(false));
  socket.once('connect',()=>finish(true));
  socket.once('error',()=>finish(false));
});
const udp=()=>new Promise(resolve=>{
  const socket=dgram.createSocket('udp4');
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);socket.close();resolve(value);};
  const timer=setTimeout(()=>finish(false),1500);
  socket.once('message',()=>finish(true));
  socket.send(Buffer.from('i6'),41235,ip,error=>{if(error)finish(false);});
});
void(async()=>{
  let dnsResult=false;
  try{dnsResult=(await dns.lookup(host)).address===ip;}catch{}
  process.stdout.write(JSON.stringify({dns:dnsResult,tcp:await tcp(),udp:await udp()}));
})().catch(()=>process.exit(41));
`;

const PYTHON_TRANSPORT_PROBE = `
import json,socket
r={"dns":False,"tcp":False,"udp":False}
try:
 r["dns"]=socket.getaddrinfo("${SENTINEL_HOST}",0)[0][4][0]=="${SENTINEL_IP}"
except OSError: pass
try:
 s=socket.create_connection(("${SENTINEL_IP}",41234),1.5); s.close(); r["tcp"]=True
except OSError: pass
try:
 s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(1.5)
 s.sendto(b"i6",("${SENTINEL_IP}",41235)); s.recvfrom(32); s.close(); r["udp"]=True
except OSError: pass
print(json.dumps(r,separators=(",",":")))
`;

const NATIVE_CHILD_WRAPPER = String.raw`
const {spawnSync}=require('node:child_process');
const source=Buffer.from(process.argv[1],'base64').toString('utf8');
const child=spawnSync('/usr/bin/python3',['-c',source],{
  encoding:'utf8',timeout:6000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}
});
if(child.error||child.signal||child.status!==0||child.stderr)process.exit(42);
process.stdout.write(child.stdout);
`;

const API_RUNTIME_PROBE = String.raw`
const fs=require('node:fs');
const text=fs.readFileSync('/proc/net/route','utf8');
if(Buffer.byteLength(text,'utf8')>32768)process.exit(41);
const externalDefaultRoute=text.split('\n').slice(1).some(line=>{
  const fields=line.trim().split(/\s+/);
  if(fields.length<8)return false;
  const flags=Number.parseInt(fields[3],16);
  return fields[1]==='00000000'&&fields[7]==='00000000'
    &&Number.isSafeInteger(flags)&&(flags&1)===1;
});
process.stdout.write(JSON.stringify({
  uid:process.getuid(),gid:process.getgid(),externalDefaultRoute
}));
`;

const PEER_HOLD = String.raw`
process.on('SIGTERM',()=>process.exit(0));
setInterval(()=>{},60000);
`;

const PEER_HTTP_PROBE = String.raw`
const http=require('node:http');
const host=process.argv[1],port=Number(process.argv[2]);
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const request=(route,key)=>new Promise((resolve,reject)=>{
  const headers=key===undefined?{}:{'x-api-key':key};
  const req=http.get({host,port,path:route,headers,timeout:1500},response=>{
    const chunks=[];
    let size=0;
    response.on('data',chunk=>{
      size+=chunk.length;
      if(size>32768){req.destroy();reject(new Error('unbounded'));return;}
      chunks.push(chunk);
    });
    response.on('end',()=>{
      try{
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve({status:response.statusCode,body});
      }catch(error){reject(error);}
    });
  });
  req.once('timeout',()=>req.destroy(new Error('timeout')));
  req.once('error',reject);
});
const validHealth=value=>value.status===200
  &&exactKeys(value.body,['status','uptime'])
  &&value.body.status==='OK'&&Number.isFinite(value.body.uptime)&&value.body.uptime>=0;
const validReady=value=>value.status===200
  &&exactKeys(value.body,['status'])&&value.body.status==='READY';
const validOperations=value=>{
  const body=value.body;
  if(value.status!==200
    ||!exactKeys(body,['checkedAt','ready','admissionOpen','probes','reasonCodes','queue','legacyMigration'])
    ||typeof body.checkedAt!=='string'||body.checkedAt.length>64
    ||Number.isNaN(Date.parse(body.checkedAt))||body.ready!==true||body.admissionOpen!==true
    ||!exactKeys(body.probes,['queue','native','storage','retention','pricing','config'])
    ||Object.values(body.probes).some(item=>typeof item!=='boolean')
    ||!Array.isArray(body.reasonCodes)||body.reasonCodes.length!==0
    ||!exactKeys(body.queue,[
      'queueLength','activeJobs','maxConcurrent','maxQueueLength','maxQueuePerClient','acceptingJobs'
    ])
    ||!Object.entries(body.queue).every(([key,item])=>
      key==='acceptingJobs'?item===true:Number.isSafeInteger(item)&&item>=0)
    ||!exactKeys(body.legacyMigration,['enabled','audience','expiresAt'])
    ||typeof body.legacyMigration.enabled!=='boolean'
    ||(body.legacyMigration.enabled===false
      ?body.legacyMigration.audience!==null||body.legacyMigration.expiresAt!==null
      :body.legacyMigration.audience!=='operations'
        ||typeof body.legacyMigration.expiresAt!=='string'
        ||Number.isNaN(Date.parse(body.legacyMigration.expiresAt))))return false;
  return true;
};
const validRejection=value=>value.status===401
  &&exactKeys(value.body,['success','error','errorCode'])
  &&value.body.success===false
  &&value.body.error==='Operations authentication is required.'
  &&value.body.errorCode==='OPERATIONS_AUTH_REQUIRED';
void(async()=>{
  const result={
    privatePeerIngress:false,
    authenticatedReadiness:false,
    authRejectionProof:false
  };
  try{
    const health=await request('/health');
    const ready=await request('/ready');
    result.privatePeerIngress=validHealth(health)&&validReady(ready);
    if(result.privatePeerIngress){
      const authenticated=await request('/operations/readiness',process.env.OPERATIONS_API_KEY);
      result.authenticatedReadiness=validOperations(authenticated);
      const missing=await request('/operations/readiness');
      const wrong=await request('/operations/readiness','i6-wrong-operations-key-260725-z9');
      result.authRejectionProof=validRejection(missing)&&validRejection(wrong);
    }
  }catch{}
  process.stdout.write(JSON.stringify(result));
})().catch(()=>process.exit(41));
`;

module.exports = {
    API_RUNTIME_PROBE,
    ENCODED_EVAL,
    NATIVE_CHILD_WRAPPER,
    NODE_TRANSPORT_PROBE,
    PEER_HOLD,
    PEER_HTTP_PROBE,
    PYTHON_TRANSPORT_PROBE,
    SENTINEL_HOST,
    SENTINEL_IP,
    SENTINEL_LISTENER
};
