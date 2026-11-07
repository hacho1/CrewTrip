import {test,expect,type Browser,type BrowserContext} from '@playwright/test';
import {createApp} from '../server/src/app';
import {RoomStore} from '../server/src/store';
import {TrafficService} from '../server/src/traffic';
import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';

const event=(roadName:string,coordX:number,coordY:number)=>({linkId:roadName,eventType:'교통사고',roadName,message:'자동 시험용 모의 사고 · 실제 교통정보 아님',coordX,coordY,startDate:'20261102090000'});
const cameraRows=[{cctvname:'시험 A카메라',coordx:128.836,coordy:37.752,cctvtype:4,cctvformat:'HLS',cctvurl:'https://road-test.invalid/road-test.m3u8'},{cctvname:'시험 B카메라',coordx:128.911,coordy:37.791,cctvtype:4,cctvformat:'HLS',cctvurl:'https://road-test.invalid/road-test.m3u8'}];
async function setup(browser:Browser,{tileFailure=false,noCameras=false,denyLocation=false,denseCameras=false,manyCameras=false}={}){
 const source={now:Date.now(),events:[event('시험 A도로',128.836,37.752),event('시험 B도로',128.91,37.79)],calls:0};
 const rows=manyCameras?[...cameraRows,...Array.from({length:10},(_,i)=>({...cameraRows[0],cctvname:`추가 카메라${i}`,coordx:128.84+i*.001,coordy:37.754}))]:denseCameras?[...cameraRows,{...cameraRows[1],cctvname:'시험 B 두 번째 카메라'}]:cameraRows;
 const provider:typeof fetch=async input=>{source.calls++;return new Response(JSON.stringify(String(input).includes('eventInfo')?{header:{resultCode:0},body:{items:source.events}}:{response:{data:noCameras?[]:rows}}))};
 const runtime=createApp(new RoomStore(),new TrafficService('fixture-only',provider,()=>source.now));
 await new Promise<void>(resolve=>runtime.http.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(runtime.http.address() as {port:number}).port}`;
 const hostContext=await browser.newContext(),phoneContext=await browser.newContext({viewport:{width:390,height:844},geolocation:{latitude:37.7513,longitude:128.8355,accuracy:20},permissions:['geolocation']});
 for(const context of [hostContext,phoneContext])await context.route('https://tile.openstreetmap.org/**',async route=>{
  if(tileFailure)return route.abort();
  // Synthetic transparent tile: functional tests do not claim real basemap rendering.
  await route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=','base64')});
 });
 await phoneContext.route('https://road-test.invalid/**',async route=>{const name=basename(new URL(route.request().url()).pathname);if(!/^road-test(?:-\d\d\.mpegts|\.m3u8)$/.test(name))return route.abort();await route.fulfill({body:await readFile(`tests/fixtures/${name}`),contentType:name.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t',headers:{'Access-Control-Allow-Origin':'*'}})});
 if(denyLocation)await phoneContext.addInitScript(()=>{navigator.geolocation.getCurrentPosition=(_ok,error)=>error?.({code:1,message:'MOCK ONLY · permission denied'} as GeolocationPositionError)});
 const driver=await hostContext.newPage(),phone=await phoneContext.newPage();
 await driver.goto(origin+'/vehicle');await driver.getByLabel('내 이름').fill('지도 시험 운전자');await driver.getByRole('button',{name:'여행방 만들기'}).click();
 const invite=new URL(await driver.getByLabel('초대 링크').inputValue());invite.host=new URL(origin).host;
 await phone.goto(invite.toString());await phone.getByLabel('내 이름').fill('지도 시험 동승자');await phone.getByRole('button',{name:'여행방 참여'}).click();
 const session=await phone.evaluate(()=>JSON.parse(localStorage.getItem(`crewtrip-passenger-${location.pathname.split('/')[2]}`)!));
 const readRoom=async()=>(await phone.request.get(origin+`/api/rooms/${session.roomId}`,{headers:{Authorization:`Bearer ${session.token}`}})).json();
 const close=async()=>{await hostContext.close();await phoneContext.close();runtime.dispose()};
 return {runtime,source,origin,driver,phone,phoneContext,session,readRoom,close};
}

test('내 위치→두 번째 사고 선택→그 지점 CCTV·의견 공유, 차량 D 차단 (모의 위치·교통·영상)',async({browser})=>{
 const s=await setup(browser);
 try{
  const {phone,driver}=s,road=phone.getByRole('region',{name:'앞길 확인'});
  await road.getByRole('button',{name:'앞길 지도 열기'}).click();
  const map=road.getByRole('region',{name:'앞길 지도',exact:true});
  await map.getByRole('button',{name:'내 위치 찾기',exact:true}).click();await expect(map).toContainText('오차 약 20m');
  expect((await s.readRoom()).road.area).toBeNull();
  await map.getByRole('button',{name:'이 위치 주변 조회'}).click();await expect(road.locator('.road-status')).toHaveText('교통정보 조회됨');
  expect((await s.readRoom()).road.area.label).toBe('내 위치 주변');
  await road.locator('.incident-picks button').filter({hasText:'시험 B도로'}).click();
  await expect(road.locator('.selected-incident')).toContainText('CCTV 1곳');
  await expect(map.getByRole('button',{name:'시험 A카메라 CCTV 보기'})).toHaveCount(0);
  await road.getByRole('button',{name:'이 돌발정보 함께 확인'}).click();await expect(road.getByRole('heading',{name:'크루에게 의견 전하기'})).toBeVisible();
  let room=await s.readRoom();expect(room.road.request.incidentId).toBe(room.road.feed.incidents.find((x:any)=>x.roadName==='시험 B도로').id);
  await map.getByRole('button',{name:'시험 B카메라 CCTV 보기'}).click();
  await expect.poll(()=>phone.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime),{timeout:15_000}).toBeGreaterThan(.3);
  await expect(map.getByRole('button',{name:'이 위치 주변 조회'})).toBeDisabled();
  await road.getByLabel('함께 전할 말').fill('모의 영상 확인 · 실제 사고 판단 아님');await road.getByRole('button',{name:'의견 공유',exact:true}).click();
  room=await s.readRoom();expect(room.road.request.reports[0].cameraId).toBe(room.road.feed.cameras.find((x:any)=>x.name==='시험 B카메라').id);
  await expect(phone.locator('video')).toHaveCount(0);
  await driver.getByRole('button',{name:'앞길 지도 열기'}).click();
  await driver.evaluate(()=>window.crewtripReceive?.({readings:[],restricted:true,restrictionReason:'MOCK ONLY · D',source:'UI 시험',navStatus:'미연결'}));
  await expect(driver.getByRole('button',{name:'지도 확대'})).toBeDisabled();await expect(driver.getByRole('button',{name:'이 위치 주변 조회'})).toBeDisabled();await expect(driver.locator('video')).toHaveCount(0);
 }finally{await s.close()}
});

test('위치 권한·HTTP·지도 장애에도 지점 선택과 사고 목록·CCTV 없음 안내 유지 (모의 오류)',async({browser})=>{
 const s=await setup(browser,{tileFailure:true,noCameras:true,denyLocation:true});
 try{
  const {phone}=s,road=phone.getByRole('region',{name:'앞길 확인'});
  await road.getByRole('button',{name:'앞길 지도 열기'}).click();const map=road.getByRole('region',{name:'앞길 지도',exact:true});
  await map.getByRole('button',{name:'내 위치 찾기'}).click();await expect(map).toContainText('위치 권한이 허용되지 않았어요');
  await phone.evaluate(()=>Object.defineProperty(window,'isSecureContext',{value:false,configurable:true}));await map.getByRole('button',{name:'내 위치 찾기'}).click();await expect(map).toContainText('HTTPS 연결');
  await expect(map.locator('.road-map-failure')).toBeVisible();
  await map.evaluate(el=>el.scrollIntoView({block:'start'}));await phone.screenshot({path:'artifacts/maps-2026-11-02/map-error-MOCK.png'});
  await map.locator('.road-map-canvas').click({position:{x:45,y:30}});await expect(map.locator('.road-map-query')).toContainText('지도에서 선택한 지점');
  await map.getByRole('button',{name:'이 위치 주변 조회'}).click();await expect(road.locator('.road-status')).toHaveText('교통정보 조회됨');
  await road.locator('.incident-picks button').filter({hasText:'시험 B도로'}).click();await expect(road.locator('.selected-incident')).toContainText('CCTV가 없어요');await expect(road.getByRole('button',{name:'가까운 CCTV 보기'})).toBeDisabled();
  await road.locator('.selected-incident').scrollIntoViewIfNeeded();await phone.screenshot({path:'artifacts/maps-2026-11-02/no-nearby-camera-MOCK.png'});
  await expect(phone.locator('video')).toHaveCount(0);
 }finally{await s.close()}
});

test('겹친 CCTV는 묶고 선택한 사고 표식·이름을 유지하며 목록에서 각 카메라를 열 수 있음 (모의 지도)',async({browser})=>{
 const s=await setup(browser,{denseCameras:true});
 try{
  const road=s.phone.getByRole('region',{name:'앞길 확인'});
  await road.getByRole('button',{name:'앞길 지도 열기'}).click();await s.phone.getByRole('button',{name:'이 위치 주변 조회'}).click();await expect(road.locator('.road-status')).toHaveText('교통정보 조회됨');
  await road.locator('.incident-picks button').filter({hasText:'시험 B도로'}).click();
  const map=road.getByRole('region',{name:'앞길 지도',exact:true});
  await expect(map.locator('.selected-incident-label')).toContainText('시험 B도로');
  const labelBounds=await map.locator('.selected-incident-label').boundingBox();expect(labelBounds!.width).toBeGreaterThan(80);expect(labelBounds!.height).toBeLessThan(90);
  await expect(map.locator('.selected-incident')).toContainText('CCTV 2곳');
  await map.getByRole('button',{name:'겹친 CCTV 2곳 목록 보기'}).click();
  await road.locator('.camera-options button').filter({hasText:'시험 B 두 번째 카메라'}).click();await road.getByRole('button',{name:'CCTV 영상 열기',exact:true}).click();
  await expect.poll(()=>s.phone.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime),{timeout:15_000}).toBeGreaterThan(.3);
 }finally{await s.close()}
});

test('긴 돌발 라벨과 지도 확대·축소 버튼이 좁은 화면에서도 겹치지 않음 (모의 지도)',async({browser})=>{
 const s=await setup(browser);
 try{
  const roadName='동해선(삼척-속초) 강릉분기점에서 주문진나들목 사이';
  s.source.events[1]=event(roadName,128.91,37.79);
  const road=s.phone.getByRole('region',{name:'앞길 확인'});
  await road.getByRole('button',{name:'앞길 지도 열기'}).click();
  const map=road.getByRole('region',{name:'앞길 지도',exact:true});
  await map.getByRole('button',{name:'이 위치 주변 조회'}).click();
  await road.locator('.incident-picks button').filter({hasText:roadName}).click();
  const label=map.locator('.selected-incident-label');
  const canvas=map.locator('.road-map-canvas');
  const zoom=map.getByRole('group',{name:'지도 크기 조절'});
  for(const width of [360,390,768,1440]){
   await s.phone.setViewportSize({width,height:900});
   await expect(label).toHaveText(`${roadName} · 교통사고 위치`);
   await expect(label).toBeVisible();
   await expect.poll(async()=>{
    const [canvasBounds,zoomBounds]=await Promise.all([canvas.boundingBox(),zoom.boundingBox()]);
    return zoomBounds!.y-(canvasBounds!.y+canvasBounds!.height);
   }).toBeGreaterThanOrEqual(0);
  }
  await zoom.getByRole('button',{name:'지도 축소'}).click();
  await expect(label).toBeVisible();
 }finally{await s.close()}
});

test('사고 미선택 지도에서 기본 6곳 밖의 카메라도 그룹 목록과 개별 표식으로 열 수 있음 (모의 CCTV)',async({browser})=>{
 const s=await setup(browser,{manyCameras:true});
 s.phone.setDefaultTimeout(15_000);
 try{
  const road=s.phone.getByRole('region',{name:'앞길 확인'});
  await road.getByRole('button',{name:'앞길 지도 열기'}).click();await s.phone.getByRole('button',{name:'이 위치 주변 조회'}).click();await expect(road.locator('.road-status')).toHaveText('교통정보 조회됨');
  const map=road.getByRole('region',{name:'앞길 지도',exact:true});
  await map.getByRole('button',{name:'겹친 CCTV 11곳 목록 보기'}).click();
  await expect(road.locator('.camera-options button')).toHaveCount(11);await road.locator('.camera-options button').filter({hasText:'추가 카메라9'}).click();await road.getByRole('button',{name:'CCTV 영상 열기',exact:true}).click();
  await expect.poll(()=>s.phone.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime),{timeout:15_000}).toBeGreaterThan(.3);await road.getByRole('button',{name:'영상 닫기',exact:true}).click();
  await map.getByRole('button',{name:'지도 축소',exact:true}).click();
  await map.locator('.road-map-canvas').focus();await map.locator('.road-map-canvas').press('ArrowRight');
  await map.getByRole('button',{name:'시험 B카메라 CCTV 보기'}).click();
  await expect(road.locator('.camera-caption')).toContainText('시험 B카메라');await expect.poll(()=>s.phone.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime),{timeout:15_000}).toBeGreaterThan(.3);
 }finally{await s.close()}
});

test('화면을 보는 동안 1분 자동 조회→새 사고 알림→지도 선택, 설명 갱신은 재알림하지 않음 (모의 ITS)',async({browser})=>{
 test.setTimeout(100_000);
 const s=await setup(browser);
 try{
  const {phone}=s,road=phone.getByRole('region',{name:'앞길 확인'});
  await road.getByRole('button',{name:'앞길 지도 열기'}).click();await phone.getByRole('button',{name:'이 위치 주변 조회'}).click();await expect(road.locator('.road-status')).toHaveText('교통정보 조회됨');
  await road.getByLabel('새 사고 알림 받기').check();await expect(road.locator('.incident-alert')).toHaveCount(0);
  s.source.now+=60_001;s.source.events.push(event('새 시험 C도로',128.845,37.76));
  await expect(road.locator('.incident-alert')).toContainText('새로 확인한 사고 정보 1건',{timeout:75_000});
  await road.getByRole('button',{name:'지도에서 확인',exact:true}).click();await expect(road.locator('.selected-incident')).toContainText('새 시험 C도로');await expect(road.locator('.incident-alert')).toHaveCount(0);
  s.source.now+=60_001;s.source.events[2].message='설명만 갱신한 모의 사고';
  await road.getByRole('button',{name:'교통정보 확인',exact:true}).click();await expect(road.locator('.selected-incident')).toContainText('설명만 갱신');await expect(road.locator('.incident-alert')).toHaveCount(0);
  await road.getByLabel('새 사고 알림 받기').uncheck();
 }finally{await s.close()}
});
