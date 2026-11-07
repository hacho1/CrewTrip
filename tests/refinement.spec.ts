import {test,expect} from '@playwright/test';
import {createApp} from '../server/src/app';
import {RoomStore} from '../server/src/store';
import {TrafficService} from '../server/src/traffic';

test('동승자 시작→구간 선택→의견·제안, D 차량 제한과 방 소멸 안내 (UI 시뮬레이션)',async({browser})=>{
 const fixture:typeof fetch=async input=>new Response(JSON.stringify(String(input).includes('eventInfo')?{header:{resultCode:0},body:{items:[]}}:{response:{data:[{cctvname:'검증용 CCTV · 모의 응답',coordx:128.836,coordy:37.752,cctvtype:'4',cctvformat:'HLS',cctvurl:'https://road-test.invalid/video.m3u8'}]}}));
 const store=new RoomStore(),runtime=createApp(store,new TrafficService('fixture-only',fixture));await new Promise<void>(r=>runtime.http.listen(0,'127.0.0.1',r));const {port}=runtime.http.address() as {port:number},origin=`http://127.0.0.1:${port}`;
 const context=await browser.newContext(),phone=await browser.newContext({viewport:{width:390,height:844}});
 try{
  const driver=await context.newPage();await driver.goto(origin+'/vehicle');await driver.getByLabel('내 이름').fill('운전자');await driver.getByRole('button',{name:'여행방 만들기'}).click();
  const invite=new URL(await driver.getByLabel('초대 링크').inputValue());invite.host=`127.0.0.1:${port}`;
  const passenger=await phone.newPage();await passenger.goto(invite.toString());await passenger.getByLabel('내 이름').fill('동승자');await passenger.getByRole('button',{name:'여행방 참여'}).click();
  await driver.evaluate(()=>window.crewtripReceive?.({readings:[],restricted:true,restrictionReason:'MOCK ONLY · D 상태',source:'UI 시뮬레이션',navStatus:'미연결'}));
  const road=passenger.getByRole('region',{name:'앞길 확인'});await road.getByRole('button',{name:'확인 구간 지정',exact:true}).click();await passenger.getByLabel('빠른 구간 선택').selectOption('강릉IC');
  await expect(passenger.getByLabel('구간 위도')).toHaveValue('37.7513');await passenger.getByRole('button',{name:'이 구간으로 지정'}).click();await road.getByRole('button',{name:'교통정보 확인',exact:true}).click();await expect(road.locator('.road-status')).toHaveText('교통정보 조회됨');
  await road.getByRole('button',{name:'크루에게 확인 요청'}).click();await expect(road.getByRole('heading',{name:'크루에게 의견 전하기'})).toBeVisible();await expect(passenger.getByRole('img',{name:/도로 연결과 진행 방향은 미확인/})).toBeVisible();
  await expect(road.getByRole('button',{name:'확인 구간 변경'})).toBeDisabled();await expect(driver.getByRole('button',{name:'교통정보 확인',exact:true})).toBeDisabled();
  await passenger.screenshot({path:'artifacts/refine-passenger-390.png',fullPage:true});
  await passenger.getByLabel('함께 전할 말').fill('촬영 시각과 방향을 확인할 수 없어요.');await passenger.getByRole('button',{name:'쉬어 갈 곳 제안',exact:true}).click();await passenger.getByRole('button',{name:'경포호 호숫가를 따라 천천히 산책'}).click();await expect(driver.locator('.place-row')).toContainText('경포호');
  // Emulate an actual missing in-memory room on the next reconnect, not a successful reconnect.
  store.rooms.clear();await phone.setOffline(true);await phone.setOffline(false);
  await expect(passenger.getByRole('alert')).toContainText('서버 재시작으로 사라졌어요');await expect(passenger.getByRole('heading',{name:'새 초대가 필요해요'})).toBeVisible();
 }finally{await context.close();await phone.close();runtime.dispose()}
});

test('여행방 확정과 내비 좌표 확인을 구별하고 요청 중 중복 버튼 차단 (UI 시뮬레이션)',async({page})=>{
 await page.addInitScript(()=>{window.CrewTripNative={refresh(){window.crewtripReceive?.({readings:[],restricted:false,restrictionReason:'MOCK ONLY · 정차',source:'UI 시뮬레이션',navStatus:'미연결',navigation:{state:'idle',targetName:null,lat:null,lon:null,waypoint:false,confirmedAt:null}})},confirmPlace(){},navigate(){},navigationInfo(){},prepareNavigation(){}}});
 // Use a browser host to confirm through the normal server, then attach the native UI stub.
 await page.goto('/vehicle');await page.getByLabel('내 이름').fill('내비 화면 시험');await page.getByRole('button',{name:'여행방 만들기'}).click();await page.getByRole('button',{name:'장소 제안',exact:true}).click();await page.getByRole('button',{name:'안목해변 바다를 보며 잠깐 쉬어 가기'}).click();
 const session=await page.evaluate(()=>JSON.parse(localStorage.getItem('crewtrip-vehicle-session')!));const response=await page.request.get(`/api/rooms/${session.roomId}`,{headers:{Authorization:`Bearer ${session.token}`}});const room=await response.json();await page.request.post(`/api/rooms/${session.roomId}/confirm`,{headers:{Authorization:`Bearer ${session.token}`},data:{placeId:room.places[0].id}});
 await expect(page.locator('.nav-confirmation')).toContainText('차량 내비 반영은 별도');
 await expect(page.locator('.nav-state')).toContainText('차량 내비에 연결해 주세요');
 await page.evaluate(()=>window.crewtripReceive?.({readings:[],restricted:false,restrictionReason:'MOCK ONLY',source:'UI',navStatus:'내비 지도가 준비되면 CrewTrip으로 돌아와 연결해 주세요.',navigation:{state:'idle',targetName:null,lat:null,lon:null,waypoint:false,confirmedAt:null}}));
 await expect(page.locator('.nav-state')).toContainText('내비 지도가 준비되면');
 await page.evaluate(()=>window.crewtripReceive?.({readings:[],restricted:false,restrictionReason:'MOCK ONLY',source:'UI',navStatus:'요청 중',navigation:{state:'pending',targetName:'안목해변',lat:37.7712,lon:128.9487,waypoint:false,confirmedAt:null}}));
 await expect(page.getByRole('button',{name:'차량 내비게이션에 연결',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'연결 결과 다시 확인'})).toBeEnabled();
 await page.evaluate(()=>window.crewtripReceive?.({readings:[],restricted:false,restrictionReason:'MOCK ONLY',source:'UI',navStatus:'경유지 반영 미확인 · 추가 요청 보류',navigation:{state:'unconfirmed',targetName:'안목해변',lat:37.7712,lon:128.9487,waypoint:true,confirmedAt:null,verificationIssue:'coordinates_unavailable'}}));
 await expect(page.locator('.nav-help')).toContainText('경유지 위치 정보가 없어');
 await expect(page.getByRole('button',{name:'기존 경로에 경유지 추가',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'연결 결과 다시 확인'})).toBeEnabled();
 await expect(page.getByRole('button',{name:'차량 내비게이션에 연결',exact:true})).toBeEnabled();
});
