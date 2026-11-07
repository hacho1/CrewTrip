import {test} from 'node:test';import assert from 'node:assert/strict';import {createApp} from '../src/app';import {io as client} from 'socket.io-client';
test('HTTP 입력 검증·권한 분리·WebSocket 인증·요청 제한',async()=>{
 const runtime=createApp();await new Promise<void>(r=>runtime.http.listen(0,'127.0.0.1',r));const address=runtime.http.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
 const post=(path:string,body:unknown,token?:string)=>fetch(base+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 try{
  let res=await post('/rooms',{title:'',nickname:'a'});assert.equal(res.status,400);
  res=await post('/rooms',{title:'테스트',nickname:'운전자'});assert.equal(res.status,201);const host=await res.json();
  assert.equal((await fetch(base+`/api/rooms/${host.room.id}`)).status,401);
  assert.equal((await post(`/rooms/${host.room.id}/join`,{nickname:'a',inviteToken:'a'.repeat(43)})).status,403);
  res=await post(`/rooms/${host.room.id}/join`,{nickname:'동승자',inviteToken:host.session.inviteToken});const passenger=await res.json();
  assert.equal((await post(`/rooms/${host.room.id}/close`,{},passenger.session.token)).status,403);
  assert.equal((await post(`/rooms/${host.room.id}/suggest`,{name:'장소',description:'',category:'직접',lat:91,lon:10},passenger.session.token)).status,400);
  const socket=client(base,{auth:{roomId:host.room.id,token:'wrong'},reconnection:false});
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('무인증 socket이 거절되지 않음')),3000);socket.on('connect_error',()=>{clearTimeout(timeout);socket.close();resolve()});socket.on('connect',()=>reject(new Error('무인증 socket 연결됨')))});
  let throttled=false;for(let i=0;i<35;i++){const r=await post('/rooms',{title:'rate',nickname:'a'});if(r.status===429){throttled=true;break;}}assert.ok(throttled);
  const headers=(await fetch(base+'/api/health')).headers;
  assert.equal(headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.match(headers.get('content-security-policy')!,/img-src 'self' data: https:\/\/tile\.openstreetmap\.org/);
 }finally{runtime.dispose()}
});
