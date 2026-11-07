import {test,expect,type Browser} from '@playwright/test';
import {createApp} from '../server/src/app';
import {RoomStore} from '../server/src/store';
import {TrafficService} from '../server/src/traffic';
import {basename} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';

const evidence='artifacts/ux-fixes-2026-11-03';
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=','base64');
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true})});

async function setup(browser:Browser,{realTiles=false,tileFailure=false,withPlace=false}={}){
 const source={now:Date.now(),tileFailure};
 const provider:typeof fetch=async input=>new Response(JSON.stringify(String(input).includes('eventInfo')?{header:{resultCode:0},body:{items:[{linkId:'UX',eventType:'교통사고',roadName:'가상 시험 도로',message:'사용성 회귀 시험 · 실제 사고 아님',coordX:128.836,coordY:37.752}]}}:{response:{data:['가상 첫째 CCTV','가상 둘째 CCTV'].map((cctvname,i)=>({cctvname,coordx:128.836+i*.001,coordy:37.752,cctvtype:4,cctvformat:'HLS',cctvurl:'https://ux-test.invalid/road-test.m3u8'}))}}));
 const store=new RoomStore(),runtime=createApp(store,new TrafficService('fixture-only',provider,()=>source.now));
 await new Promise<void>(resolve=>runtime.http.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(runtime.http.address() as {port:number}).port}`;
 const host=await browser.newContext(),passenger=await browser.newContext({viewport:{width:390,height:844}});
 for(const context of [host,passenger]){
  if(!realTiles)await context.route('https://tile.openstreetmap.org/**',route=>source.tileFailure?route.abort():route.fulfill({contentType:'image/png',body:tile}));
  await context.route('https://ux-test.invalid/**',async route=>{const name=basename(new URL(route.request().url()).pathname);if(!/^road-test(?:-\d\d\.mpegts|\.m3u8)$/.test(name))return route.abort();await route.fulfill({body:await readFile(`tests/fixtures/${name}`),contentType:name.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t',headers:{'Access-Control-Allow-Origin':'*'}})});
 }
 const driver=await host.newPage(),phone=await passenger.newPage();
 await driver.goto(origin+'/vehicle');await driver.getByLabel('여행 이름').fill('사용성 개선 검증 · 가상 시험');await driver.getByLabel('내 이름').fill('가상 운전자');await driver.getByRole('button',{name:'여행방 만들기'}).click();
 const invite=new URL(await driver.getByLabel('초대 링크').inputValue());invite.host=new URL(origin).host;
 await phone.goto(invite.toString());await phone.getByLabel('내 이름').fill('가상 동승자');await phone.getByRole('button',{name:'여행방 참여'}).click();await expect(phone.locator('.connection')).toContainText('실시간 연결');
 const roomId=invite.pathname.split('/')[2],readRoom=()=>store.view(store.get(roomId).room);
 if(withPlace){await driver.getByRole('button',{name:'장소 제안',exact:true}).click();await driver.getByRole('button',{name:'경포호 호숫가를 따라 천천히 산책'}).click();await expect(phone.getByRole('heading',{name:'경포호',exact:true})).toBeVisible()}
 const road=phone.getByRole('region',{name:'앞길 확인'});
 const request=async()=>{
  await road.getByRole('button',{name:'확인 구간 지정',exact:true}).click();await phone.getByLabel('빠른 구간 선택').selectOption('강릉IC');await phone.getByRole('button',{name:'이 구간으로 지정'}).click();
  await road.getByRole('button',{name:'교통정보 확인',exact:true}).click();await expect(road.locator('.road-status')).toHaveText('교통정보 조회됨');await road.getByRole('button',{name:'크루에게 확인 요청',exact:true}).click();await expect(phone.getByLabel('함께 전할 말')).toBeVisible();
 };
 return {driver,phone,road,source,readRoom,request,close:async()=>{await host.close();await passenger.close();runtime.dispose()}};
}

test('메뉴 왕복 후 초안·의견·카메라·알림을 보존하고 영상은 멈추며 새 요청에는 초안을 섞지 않음',async({browser})=>{
 const s=await setup(browser);
 try{
  const {phone,road,driver}=s;await s.request();
  await road.getByRole('button',{name:'앞길 지도 열기'}).click();await road.locator('.camera-options button').filter({hasText:'가상 둘째 CCTV'}).click();
  await phone.getByLabel('새 사고 알림 받기').check();await phone.getByLabel('우회를 검토해요',{exact:true}).check();await phone.getByLabel('함께 전할 말').fill('공유 전 초안 · 방향 확인 필요');
  await road.getByRole('button',{name:'CCTV 영상 열기',exact:true}).click();await expect.poll(()=>phone.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(.3);
  await phone.getByRole('button',{name:'여행 기록',exact:true}).click();await expect(phone.locator('video')).toHaveCount(0);await expect(road).not.toBeVisible();
  await phone.getByRole('button',{name:'참여 정보',exact:true}).click();await phone.getByRole('button',{name:'장소·투표',exact:true}).click();
  await expect(phone.getByLabel('함께 전할 말')).toHaveValue('공유 전 초안 · 방향 확인 필요');await expect(phone.getByLabel('우회를 검토해요',{exact:true})).toBeChecked();await expect(phone.getByLabel('새 사고 알림 받기')).toBeChecked();
  await expect(road.locator('.camera-options button').filter({hasText:'가상 둘째 CCTV'})).toHaveAttribute('aria-pressed','true');await expect(road.getByRole('button',{name:'앞길 지도 접기'})).toBeVisible();await expect(phone.locator('video')).toHaveCount(0);expect(s.readRoom().road.request!.reports).toHaveLength(0);
  await phone.locator('.road-report').evaluate(el=>el.scrollIntoView({block:'start'}));await phone.screenshot({path:`${evidence}/draft-restored.png`});
  const hostRoad=driver.getByRole('region',{name:'앞길 확인'});await hostRoad.getByRole('button',{name:'크루 의견 보기'}).click();await hostRoad.getByRole('button',{name:'앞길 확인 마치기'}).click();await hostRoad.getByRole('button',{name:'크루에게 확인 요청',exact:true}).click();
  await expect(phone.getByLabel('함께 전할 말')).toHaveValue('');await expect(phone.getByLabel('상황을 확인하기 어려워요',{exact:true})).toBeChecked();
 }finally{await s.close()}
});

test('제안 창 열기·취소는 공유하지 않고 명시적 의견 공유와 실제 장소 제출만 반영함',async({browser})=>{
 const s=await setup(browser);
 try{
  const {phone,road}=s;await s.request();await phone.getByLabel('함께 전할 말').fill('창을 둘러보기 위한 미공유 초안');
  for(const collapsed of [false,true]){
   if(collapsed)await road.getByRole('button',{name:'상세 접기',exact:true}).click();
   await phone.getByRole('button',{name:'쉬어 갈 곳 제안',exact:true}).click();await expect(phone.getByRole('dialog')).toBeVisible();expect(s.readRoom().road.request!.reports).toHaveLength(0);
   await phone.getByRole('button',{name:'제안 닫기'}).click();expect(s.readRoom().places).toHaveLength(0);expect(s.readRoom().road.request!.reports).toHaveLength(0);
  }
  await road.getByRole('button',{name:'앞길 확인하기',exact:true}).click();await expect(phone.getByLabel('함께 전할 말')).toHaveValue('창을 둘러보기 위한 미공유 초안');
  await phone.getByLabel('쉬어 갈 곳을 찾아봐요',{exact:true}).check();await phone.getByRole('button',{name:'의견 공유',exact:true}).click();expect(s.readRoom().road.request!.reports).toHaveLength(1);expect(s.readRoom().road.request!.reports[0].note).toBe('창을 둘러보기 위한 미공유 초안');
  await phone.getByRole('button',{name:'쉬어 갈 곳 제안',exact:true}).click();await phone.getByRole('button',{name:'경포호 호숫가를 따라 천천히 산책'}).click();await expect(phone.getByRole('heading',{name:'경포호',exact:true})).toBeVisible();
  const room=s.readRoom();expect(room.places[0].roadReason).toBe('rest');expect(room.places[0].roadRequestId).toBe(room.road.request!.id);expect(room.road.request!.reports).toHaveLength(1);
 }finally{await s.close()}
});

test('실제 1분 자동 조회를 지연해도 입력·초점·투표를 유지하고 늦은 응답이 최신 의견·표를 덮지 않음',async({browser})=>{
 test.setTimeout(100_000);const s=await setup(browser,{withPlace:true});let release=()=>{};
 try{
  const {phone,road}=s;await s.request();s.source.now+=60_001;
  const gate=new Promise<void>(resolve=>release=resolve);let held=false;
  await phone.route('**/road/refresh',async route=>{const response=await route.fetch();const body=await response.body();held=true;await gate;await route.fulfill({response,body})});
  await phone.getByLabel('새 사고 알림 받기').check();await phone.getByLabel('함께 전할 말').fill('자동 조회 중에도 이어 쓰기');await phone.getByLabel('함께 전할 말').focus();
  await expect.poll(()=>held,{timeout:75_000}).toBe(true);await expect(road.getByRole('button',{name:'교통정보 갱신 중…',exact:true})).toBeDisabled();
  await expect(phone.getByLabel('함께 전할 말')).toBeEnabled();await expect(phone.getByRole('button',{name:'의견 공유',exact:true})).toBeEnabled();await expect(phone.getByRole('button',{name:'경포호 투표',exact:true})).toBeEnabled();await expect(phone.getByLabel('함께 전할 말')).toBeFocused();
  await phone.getByLabel('함께 전할 말').press('End');await phone.getByLabel('함께 전할 말').pressSequentially(' · 추가 입력');await phone.locator('.road-report').evaluate(el=>el.scrollIntoView({block:'start'}));await phone.screenshot({path:`${evidence}/background-input-enabled.png`});
  await phone.getByRole('button',{name:'경포호 투표',exact:true}).click();await phone.getByRole('button',{name:'의견 공유',exact:true}).click();expect(s.readRoom().places[0].votes).toHaveLength(1);expect(s.readRoom().road.request!.reports[0].note).toBe('자동 조회 중에도 이어 쓰기 · 추가 입력');
  release();await expect(road.getByRole('button',{name:'교통정보 확인',exact:true})).toBeEnabled();await expect(phone.getByRole('button',{name:'경포호 투표 취소',exact:true})).toHaveAttribute('aria-pressed','true');await expect(road.locator('.road-brief')).toContainText('가상 동승자');await phone.getByLabel('새 사고 알림 받기').uncheck();
 }finally{release();await s.close()}
});

test('다른 메뉴에서는 자동 조회를 쉬고 복귀 후 같은 알림 설정으로 조회를 이어감 (가상 시간)',async({browser})=>{
 const s=await setup(browser);
 try{
  const {phone}=s;await s.request();let calls=0;phone.on('request',request=>{if(request.url().endsWith('/road/refresh'))calls++});
  await phone.getByLabel('새 사고 알림 받기').check();await phone.getByRole('button',{name:'여행 기록',exact:true}).click();await phone.clock.setFixedTime(new Date(Date.now()+60_001));await phone.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));expect(calls).toBe(0);
  await phone.getByRole('button',{name:'장소·투표',exact:true}).click();await expect(phone.getByLabel('새 사고 알림 받기')).toBeChecked();await phone.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect.poll(()=>calls).toBe(1);
 }finally{await s.close()}
});

test('숫자 좌표 없이 지도 위치로 새 장소를 제출하고 운전자와 같은 위치를 공유함',async({browser})=>{
 const s=await setup(browser,{realTiles:true});
 try{
  const {phone,driver}=s;await phone.setViewportSize({width:360,height:780});await s.request();await phone.getByRole('button',{name:'쉬어 갈 곳 제안',exact:true}).click();await phone.getByRole('button',{name:'다른 장소 직접 제안'}).click();
  const dialog=phone.getByRole('dialog');await dialog.getByLabel('장소 이름',{exact:true}).fill('지도에서 고른 가상 카페');await dialog.getByLabel('함께 가고 싶은 이유').fill('숫자 좌표를 입력하지 않는 검증용 장소');await expect(dialog.locator('input[type=number]')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'지도 가운데를 장소로 선택',exact:true})).toBeEnabled();
  await dialog.locator('.place-picker-canvas').click({position:{x:100,y:100}});await expect(dialog.locator('.place-picker-selection')).toContainText('장소 위치를 선택했어요');
  // Real basemap requests for visual evidence; the traffic and proposed place are fictional.
  await expect.poll(()=>dialog.locator('.leaflet-tile-loaded').count(),{timeout:20_000}).toBeGreaterThan(0);
  for(const width of [360,390,768,1440]){
   await phone.setViewportSize({width,height:width<400?844:1000});await dialog.locator('.place-picker').scrollIntoViewIfNeeded();expect(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await phone.screenshot({path:`${evidence}/place-picker-${width}-dark.png`});
  }
  await phone.setViewportSize({width:390,height:844});await phone.evaluate(()=>document.documentElement.dataset.theme='light');await phone.screenshot({path:`${evidence}/place-picker-390-light.png`});
  await dialog.getByRole('button',{name:'이 장소 제안하기'}).click();await expect(phone.getByRole('heading',{name:'지도에서 고른 가상 카페',exact:true})).toBeVisible();await expect(driver.getByRole('heading',{name:'지도에서 고른 가상 카페',exact:true})).toBeVisible();
  const room=s.readRoom();expect(room.places[0].lat).toBeGreaterThan(33);expect(room.places[0].lon).toBeGreaterThan(124);expect(room.places[0].roadRequestId).toBe(room.road.request!.id);expect(room.road.request!.reports).toHaveLength(0);
 }finally{await s.close()}
});

test('장소 위치 누락 안내·키보드 선택·지도 재연결·제출 실패 재시도에서 작성 내용을 유지함',async({browser})=>{
 const s=await setup(browser,{tileFailure:true});
 try{
  const {phone}=s;await phone.getByRole('button',{name:'장소 제안',exact:true}).click();await phone.getByRole('button',{name:'다른 장소 직접 제안'}).click();const dialog=phone.getByRole('dialog');
  await dialog.getByLabel('장소 이름',{exact:true}).fill('키보드로 고른 가상 장소');await dialog.getByRole('button',{name:'이 장소 제안하기'}).click();await expect(dialog.getByRole('alert')).toContainText('위치를 선택해 주세요');expect(s.readRoom().places).toHaveLength(0);
  await expect(dialog.getByRole('button',{name:'장소 지도 다시 연결'})).toBeVisible();await dialog.locator('.place-picker-canvas').focus();await dialog.locator('.place-picker-canvas').press('ArrowRight');await dialog.getByRole('button',{name:'지도 가운데를 장소로 선택',exact:true}).click();await expect(dialog.locator('.place-picker-selection')).toContainText('장소 위치를 선택했어요');
  s.source.tileFailure=false;await dialog.getByRole('button',{name:'장소 지도 다시 연결'}).click();await expect.poll(()=>dialog.locator('.leaflet-tile-loaded').count()).toBeGreaterThan(0);await expect(dialog.locator('.leaflet-overlay-pane path')).toHaveCount(1);await expect(dialog.getByLabel('장소 이름',{exact:true})).toHaveValue('키보드로 고른 가상 장소');await expect(dialog.locator('.place-picker-selection')).toContainText('장소 위치를 선택했어요');
  await phone.route('**/suggest',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'모의 오류 · 한 번 다시 제출해 주세요.'})}));await dialog.getByRole('button',{name:'이 장소 제안하기'}).click();await expect(phone.getByRole('alert')).toContainText('모의 오류');await expect(dialog.getByLabel('장소 이름',{exact:true})).toHaveValue('키보드로 고른 가상 장소');await phone.unroute('**/suggest');
  await dialog.getByRole('button',{name:'이 장소 제안하기'}).click();await expect(phone.getByRole('heading',{name:'키보드로 고른 가상 장소',exact:true})).toBeVisible();expect(s.readRoom().places).toHaveLength(1);
 }finally{await s.close()}
});

test('가상 차량 D로 바뀌면 열려 있던 장소 지도를 닫고 제출을 차단함 (브라우저 상태 주입)',async({browser})=>{
 const s=await setup(browser);
 try{
  const {driver}=s;await driver.getByRole('button',{name:'장소 제안',exact:true}).click();await driver.getByRole('button',{name:'다른 장소 직접 제안'}).click();await expect(driver.getByRole('region',{name:'장소 위치 지도'})).toBeVisible();
  await driver.evaluate(()=>window.crewtripReceive?.({readings:[],restricted:true,restrictionReason:'가상 D 상태 · 실제 차량 시험 아님',source:'사용성 UI 시험',navStatus:'미연결'}));
  await expect(driver.getByRole('dialog')).toHaveCount(0);await expect(driver.getByRole('button',{name:'장소 제안',exact:true})).toHaveCount(0);expect(s.readRoom().places).toHaveLength(0);
 }finally{await s.close()}
});
