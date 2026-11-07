import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TrafficService,parseIncidents,parseCameras,decodeIts,safeMediaUrl,itsDate,demoRoadFeed} from '../src/traffic';
import {RoomStore} from '../src/store';
import {createApp} from '../src/app';

const now=Date.parse('2026-10-29T12:00:00+09:00');
const area={id:'area',label:'강릉IC 주변',lat:37.7513,lon:128.8355};
const incidents=`<response><header><resultCode>0</resultCode></header><body><items><item><eventType>교통사고</eventType><roadName>시험 도로</roadName><message>공식 응답 형식 검증용 사건</message><coordX>128.836</coordX><coordY>37.752</coordY><startDate>20261029115500</startDate><endDate>20261029130000</endDate><linkId>1</linkId></item><item><message>범위 밖 사건</message><coordX>127.1</coordX><coordY>37.4</coordY></item><item><message>종료된 사건</message><coordX>128.836</coordX><coordY>37.752</coordY><endDate>20261029110000</endDate></item></items></body></response>`;
const cameras=`<response><data><cctvname>검증용 CCTV</cctvname><coordx>128.836</coordx><coordy>37.752</coordy><cctvtype>4</cctvtype><cctvformat>HLS</cctvformat><cctvurl>https://media.example.org/camera.m3u8?a=1&amp;b=2</cctvurl><filecreatetime/></data><data><cctvname>HTTP 영상</cctvname><coordx>128.84</coordx><coordy>37.75</coordy><cctvurl>http://media.example.org/file.mp4</cctvurl><cctvtype>2</cctvtype></data><data><cctvname>범위 밖</cctvname><coordx>127.1</coordx><coordy>37.4</coordy></data></response>`;

test('ITS XML/JSON 정규화, 범위·종료 필터와 영상·촬영시각 검증',()=>{
 const events=parseIncidents(incidents,area,now);assert.equal(events.length,1);assert.equal(events[0].direction,null);assert.equal(events[0].startedAt,now-5*60_000);
 const cams=parseCameras(cameras,area);assert.equal(cams.length,2);assert.equal(cams[0].format,'hls');assert.equal(cams[0].recordedAt,null);assert.equal(cams[0].direction,null);assert.equal(cams[0].mediaUrl,'https://media.example.org/camera.m3u8?a=1&b=2');assert.equal(cams[1].mediaUrl,null);
 const json=JSON.stringify({response:{header:{resultCode:'0'},body:{items:[{message:'JSON 시험',coordX:128.836,coordY:37.752}]}}});assert.equal(parseIncidents(json,area,now).length,1);
 const liveJson=JSON.stringify({header:{resultCode:0,resultMsg:'SUCCESS'},body:{totalCount:1,items:[{message:'실제 응답 구조 검증',coordX:128.836,coordY:37.752}]}});assert.equal(parseIncidents(liveJson,area,now).length,1);
 assert.equal(parseIncidents(JSON.stringify({header:{resultCode:0},body:{totalCount:0,items:[]}}),area,now).length,0);
 assert.throws(()=>decodeIts(JSON.stringify({header:{resultCode:4005},body:{totalCount:0,items:[]}})));
 for(const url of ['javascript:alert(1)','https://localhost/a','https://127.0.0.1/a','https://10.0.0.1/a','https://[::1]/a','https://a:b@media.example.org/a','https://media.example.org:4310/a'])assert.equal(safeMediaUrl(url),null);
 assert.equal(itsDate(''),null);assert.throws(()=>decodeIts('<!DOCTYPE r [<!ENTITY e SYSTEM "file:///secret">]><response/>'));
 assert.throws(()=>decodeIts('<response><header><resultCode>4005</resultCode></header></response>'));
});

test('정식키 없거나 공개 샘플키면 실시간으로 표시하지 않고, 제공기관 실패·캐시를 구분',async()=>{
 let calls=0;const request:typeof fetch=async(input)=>{calls++;return new Response(String(input).includes('eventInfo')?incidents:cameras)};
 assert.equal((await new TrafficService('',request,()=>now).read(area)).status,'unconfigured');
 assert.equal((await new TrafficService('test',request,()=>now).read(area)).status,'unconfigured');assert.equal(calls,0);
 const provider=new TrafficService('not-a-real-key',request,()=>now);const [a,b]=await Promise.all([provider.read(area),provider.read(area)]);assert.equal(calls,3);assert.deepEqual(a,b);assert.equal(a.mode,'live');assert.equal(a.incidents.length,1);await provider.read(area);assert.equal(calls,3);
 const fail:typeof fetch=async()=>{throw new Error('network error with private details')};const f=await new TrafficService('not-a-real-key',fail,()=>now).read(area);assert.equal(f.status,'error');assert.ok(!JSON.stringify(f).includes('private details'));
});

test('앞길 요청·동승자 의견·새 장소·다음 투표와 확정, 권한·만료·경쟁 상태',()=>{
 let clock=now;const store=new RoomStore(()=>clock);const h=store.create('강릉','운전자'),rid=h.room.id,p=store.join(rid,h.session.inviteToken!,'동승자');
 const host=(a:string,d:any={})=>store.mutate(rid,h.session.token,a,d),pass=(a:string,d:any={})=>store.mutate(rid,p.session.token,a,d);
 assert.throws(()=>pass('road-demo'),(e:any)=>e.status===403);host('road-demo');assert.equal(store.get(rid).room.road.feed!.mode,'demo');
 let r=host('road-request',{incidentId:'demo-incident'}),request=r.road.request!;
 assert.throws(()=>host('road-request'),(e:any)=>e.status===409);
 assert.throws(()=>host('road-report',{requestId:request.id,choice:'rest',note:''}),(e:any)=>e.status===403);
 pass('road-report',{requestId:request.id,choice:'rest',note:'쉬어 가요',cameraId:'demo-camera'});
 r=pass('road-report',{requestId:request.id,choice:'unclear',note:'영상은 연결되지 않았어요',cameraId:null});assert.equal(r.road.request!.reports.length,1);assert.equal(r.road.request!.reports[0].choice,'unclear');
 r=pass('suggest',{name:'함께 쉬어 갈 곳',description:'장소 제안 시험',category:'직접 제안',lat:37.75,lon:128.83,roadRequestId:request.id,roadReason:'rest'});const place=r.places[0];
 pass('vote',{placeId:place.id});r=host('confirm',{placeId:place.id});assert.equal(r.road.request!.resolvedAt,clock);assert.equal(r.history[0].roadRequestId,request.id);
 assert.throws(()=>pass('road-report',{requestId:request.id,choice:'rest',note:''}),(e:any)=>e.status===409);
 r=host('road-area',{label:area.label,lat:area.lat,lon:area.lon});const oldId=r.road.area!.id;
 r=host('road-area',{label:'다른 구간',lat:37.8,lon:128.8});assert.throws(()=>store.setRoadFeed(rid,h.session.token,oldId,demoRoadFeed(clock)),(e:any)=>e.status===409);
 const live={...demoRoadFeed(clock),mode:'live' as const};store.setRoadFeed(rid,h.session.token,r.road.area!.id,live);clock+=180_001;assert.throws(()=>host('road-request'),(e:any)=>e.status===409);
 host('close');assert.throws(()=>host('road-demo'),(e:any)=>e.status===409);
});

test('앞길 HTTP 접근 제어·엄격한 입력·refresh 연결 상태',async()=>{
 const runtime=createApp(new RoomStore(),new TrafficService(''));await new Promise<void>(resolve=>runtime.http.listen(0,'127.0.0.1',resolve));const {port}=runtime.http.address() as {port:number};
 const post=(path:string,body:unknown,key?:string)=>fetch(`http://127.0.0.1:${port}/api${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(body)});
 try{let response=await post('/rooms',{title:'앞길 HTTP 검증',nickname:'운전자'});const h=await response.json();response=await post(`/rooms/${h.room.id}/join`,{nickname:'동승자',inviteToken:h.session.inviteToken});const p=await response.json();const base=`/rooms/${h.room.id}`;
  assert.equal((await post(`${base}/road-demo`,{})).status,401);
  assert.equal((await post(`${base}/road-area`,{...area,extra:true},h.session.token)).status,400);
  assert.equal((await post(`${base}/road-area`,{label:'구간',lat:37.75,lon:128.83},p.session.token)).status,200);
  assert.equal((await post(`${base}/road-report`,{requestId:'x'.repeat(20),choice:'fake',note:''},p.session.token)).status,400);
  assert.equal((await post(`${base}/road-area`,{label:'구간',lat:37.75,lon:128.83},h.session.token)).status,200);
  assert.equal((await post(`${base}/road/refresh`,{},p.session.token)).status,200);
  response=await post(`${base}/road/refresh`,{},h.session.token);assert.equal(response.status,200);assert.equal((await response.json()).road.feed.status,'unconfigured');
 }finally{runtime.dispose()}
});

test('같은 IP에서 교통정보 조회 한도는 인증된 여행방 참여자별로 적용된다',async()=>{
 const store=new RoomStore(),a=store.create('A 여행','운전자'),b=store.create('B 여행','운전자');
 const passenger=store.join(a.room.id,a.session.inviteToken!,'동승자');
 const {label,lat,lon}=area;
 for(const {session} of [a,b])store.mutate(session.roomId,session.token,'road-area',{label,lat,lon});
 const runtime=createApp(store,new TrafficService(''));
 await new Promise<void>(resolve=>runtime.http.listen(0,'127.0.0.1',resolve));
 const {port}=runtime.http.address() as {port:number};
 const refresh=async(roomId:string,token:string)=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/rooms/${roomId}/road/refresh`,{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:'{}'
  });
  await response.json();
  return response;
 };
 try{
  assert.equal((await refresh(a.room.id,b.session.token)).status,401);
  for(let i=0;i<6;i++)assert.equal((await refresh(a.room.id,a.session.token)).status,200);
  const limited=await refresh(a.room.id,a.session.token);
  assert.equal(limited.status,429);
  assert.ok(Number(limited.headers.get('Retry-After'))>0);
  assert.equal((await refresh(b.room.id,b.session.token)).status,200);
  assert.equal((await refresh(a.room.id,passenger.session.token)).status,200);
 }finally{runtime.dispose()}
});
