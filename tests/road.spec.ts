import {test,expect} from '@playwright/test';
import {createApp} from '../server/src/app';
import {RoomStore} from '../server/src/store';
import {TrafficService} from '../server/src/traffic';
import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';

test('앞길 요청 → 동승자 의견·장소 제안 → 기존 투표·확정으로 계획 변경 (시연 데이터)',async({browser,page})=>{
 await page.goto('/vehicle');await page.getByLabel('내 이름').fill('운전자');await page.getByRole('button',{name:'여행방 만들기'}).click();
 await page.getByRole('button',{name:'장소 제안',exact:true}).click();await page.getByRole('button',{name:'안목해변 바다를 보며 잠깐 쉬어 가기'}).click();await page.getByRole('button',{name:'경유지 확정',exact:true}).click();await page.getByRole('button',{name:'이 장소로 확정'}).click();
 const invite=new URL(await page.getByLabel('초대 링크').inputValue());invite.host='127.0.0.1:4310';
 const contexts=await Promise.all([browser.newContext({viewport:{width:390,height:844}}),browser.newContext({viewport:{width:390,height:844}})]);
 const passengers=await Promise.all(contexts.map(x=>x.newPage()));
 for(let i=0;i<passengers.length;i++){await passengers[i].goto(invite.toString());await passengers[i].getByLabel('내 이름').fill(i===0?'민지':'준호');await passengers[i].getByRole('button',{name:'여행방 참여'}).click()}
 const a=passengers[0],b=passengers[1],road=page.getByRole('region',{name:'앞길 확인'});
 await road.getByRole('button',{name:'협업 흐름 시연',exact:true}).click();await expect(road.getByText('시연 상황 · 실제 사고 아님',{exact:true})).toBeVisible();
 await road.getByRole('button',{name:'크루에게 확인 요청'}).click();
 await expect(a.getByRole('heading',{name:'크루에게 의견 전하기'})).toBeVisible();await expect(b.getByRole('heading',{name:'크루에게 의견 전하기'})).toBeVisible();
 await a.getByLabel('상황을 확인하기 어려워요',{exact:true}).check();await a.getByLabel('함께 전할 말').fill('영상이 없어서 현장은 확인하지 못했어요.');await a.getByRole('button',{name:'의견 공유',exact:true}).click();
 await road.getByRole('button',{name:'크루 의견 보기'}).click();await expect(road.locator('.road-reports')).toContainText('영상이 없어서 현장은 확인하지 못했어요.');
 await b.getByRole('button',{name:'쉬어 갈 곳 제안',exact:true}).click();await expect(b.getByRole('dialog')).toContainText('앞길 확인 후 · 쉬어 갈 곳 제안');await b.getByRole('button',{name:'경포호 호숫가를 따라 천천히 산책'}).click();
 await expect(page.locator('.place-row').filter({hasText:'경포호'})).toContainText('앞길 확인 후 제안');
 await expect(b.getByRole('button',{name:'경포호 투표',exact:true})).toBeDisabled();
 await road.getByRole('button',{name:'계획 변경 투표 열기'}).click();
 await a.getByRole('button',{name:'경포호 투표',exact:true}).click();await b.getByRole('button',{name:'경포호 투표',exact:true}).click();await expect(page.locator('.place-row').filter({hasText:'경포호'})).toContainText('2표');
 await expect(page.locator('video')).toHaveCount(0);await expect(a.locator('video')).toHaveCount(0);
 await page.screenshot({path:'artifacts/road-driver.png',fullPage:true});
 for(const width of [390,768,1440]){await a.setViewportSize({width,height:900});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await a.screenshot({path:`artifacts/road-passenger-${width}.png`,fullPage:true});}
 await a.getByRole('button',{name:'테마 전환'}).click();await a.setViewportSize({width:390,height:844});await a.screenshot({path:'artifacts/road-passenger-light.png',fullPage:true});
 await page.locator('.place-row').filter({hasText:'경포호'}).getByRole('button',{name:'경유지 확정'}).click();await page.getByRole('button',{name:'이 장소로 확정'}).click();
 await expect(a.getByRole('heading',{name:'크루에게 의견 전하기'})).toHaveCount(0);await page.getByRole('button',{name:'여행 기록',exact:true}).click();await expect(page.locator('.history-panel')).toContainText('앞길 확인 후 계획 변경');
 await Promise.all(contexts.map(x=>x.close()));
});

test('실제 구간 지정 시 미연결을 사고 없음으로 표시하지 않음',async({page})=>{
 const runtime=createApp(new RoomStore(),new TrafficService(''));await new Promise<void>(resolve=>runtime.http.listen(0,'127.0.0.1',resolve));const {port}=runtime.http.address() as {port:number};
 try{
 await page.goto(`http://127.0.0.1:${port}/vehicle`);await page.getByLabel('내 이름').fill('구간 확인');await page.getByRole('button',{name:'여행방 만들기'}).click();
 const road=page.getByRole('region',{name:'앞길 확인'});await road.getByRole('button',{name:'확인 구간 지정',exact:true}).click();await page.getByLabel('확인할 구간 이름').fill('다음에 지날 IC');await page.getByLabel('구간 위도').fill('37.7513');await page.getByLabel('구간 경도').fill('128.8355');await page.getByRole('button',{name:'이 구간으로 지정'}).click();
 await road.getByRole('button',{name:'교통정보 확인',exact:true}).click();await expect(road.getByText('연결 준비 중',{exact:true})).toBeVisible();await expect(road).not.toContainText('제공된 주변 돌발정보가 없어요');await expect(road.getByRole('button',{name:'크루에게 확인 요청'})).toHaveCount(0);
 await road.getByRole('button',{name:'크루 의견 보기'}).click();await road.getByRole('button',{name:'확인 구간 변경'}).click();
 await page.evaluate(()=>window.crewtripReceive?.({restricted:true,restrictionReason:'MOCK ONLY · 주행 제한',source:'MOCK ONLY',navStatus:'미연결',readings:[]}));
 await expect(page.getByLabel('확인할 구간 이름')).toBeDisabled();await expect(page.getByLabel('구간 위도')).toBeDisabled();await expect(page.getByRole('button',{name:'이 구간으로 지정'})).toBeDisabled();
 }finally{await page.goto('about:blank');runtime.dispose()}
});

test('동승자 HLS 재생·연결 실패·재시도·종료, 차량 영상 금지 (합성 영상·API 응답 주입)',async({browser})=>{
 const request:typeof fetch=async input=>new Response(JSON.stringify({response:String(input).includes('eventInfo')?{header:{resultCode:'0'},body:{items:[{eventType:'시험 사건',roadName:'시험 도로',message:'API 응답 주입 · 실제 사고 아님',coordX:128.836,coordY:37.752}]}}:{data:[{cctvname:'합성 테스트 영상 · 실제 교통 아님',coordx:128.836,coordy:37.752,cctvtype:'4',cctvformat:'HLS',cctvurl:'https://road-test.invalid/road-test.m3u8'}]}}));
 const runtime=createApp(new RoomStore(),new TrafficService('fixture-only',request));await new Promise<void>(resolve=>runtime.http.listen(0,'127.0.0.1',resolve));const {port}=runtime.http.address() as {port:number};
 const hostContext=await browser.newContext(),passengerContext=await browser.newContext({viewport:{width:390,height:844}});let fail=false;
 await passengerContext.route('https://road-test.invalid/**',async route=>{
  if(fail){await route.abort();return}
  const name=basename(new URL(route.request().url()).pathname);
  if(!/^road-test(?:-\d\d\.mpegts|\.m3u8)$/.test(name)){await route.abort();return}
  await route.fulfill({body:await readFile(`tests/fixtures/${name}`),contentType:name.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t',headers:{'Access-Control-Allow-Origin':'*'}});
 });
 try{
  const driver=await hostContext.newPage(),passenger=await passengerContext.newPage();await driver.goto(`http://127.0.0.1:${port}/vehicle`);await driver.getByLabel('내 이름').fill('영상 검증 운전자');await driver.getByRole('button',{name:'여행방 만들기'}).click();
  const road=driver.getByRole('region',{name:'앞길 확인'});await road.getByRole('button',{name:'확인 구간 지정',exact:true}).click();await driver.getByLabel('확인할 구간 이름').fill('API 응답 시험 구간');await driver.getByLabel('구간 위도').fill('37.7513');await driver.getByLabel('구간 경도').fill('128.8355');await driver.getByRole('button',{name:'이 구간으로 지정'}).click();await road.getByRole('button',{name:'교통정보 확인',exact:true}).click();await expect(road.getByText('교통정보 조회됨',{exact:true})).toBeVisible();await road.getByRole('button',{name:'크루에게 확인 요청'}).click();
  const invite=new URL(await driver.getByLabel('초대 링크').inputValue());invite.host=`127.0.0.1:${port}`;await passenger.goto(invite.toString());await passenger.getByLabel('내 이름').fill('영상 검증 동승자');await passenger.getByRole('button',{name:'여행방 참여'}).click();
  await passenger.getByRole('button',{name:'CCTV 영상 열기'}).click();const video=passenger.locator('video');await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime),{timeout:15_000}).toBeGreaterThan(.3);await expect(passenger.locator('.player-state')).toContainText('영상 연결됨');
  await passenger.screenshot({path:'artifacts/road-player-MOCK-ONLY.png',fullPage:true});await road.getByRole('button',{name:'크루 의견 보기'}).click();await expect(driver.locator('video')).toHaveCount(0);await expect(road.getByRole('button',{name:'CCTV 영상 열기'})).toHaveCount(0);
  await passenger.getByRole('button',{name:'영상 닫기',exact:true}).click();await expect(video).toHaveCount(0);fail=true;await passenger.getByRole('button',{name:'CCTV 영상 열기'}).click();await expect(passenger.getByText('영상을 연결하지 못했어요.',{exact:false})).toBeVisible({timeout:15_000});
  fail=false;await passenger.getByRole('button',{name:'영상 다시 연결'}).click();await expect.poll(()=>passenger.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime),{timeout:15_000}).toBeGreaterThan(.3);
  await passenger.getByRole('button',{name:'상세 접기',exact:true}).click();await expect(passenger.locator('video')).toHaveCount(0);
  await driver.evaluate(()=>window.crewtripReceive?.({restricted:true,restrictionReason:'MOCK ONLY',source:'MOCK ONLY',navStatus:'미연결',readings:[]}));await expect(road.getByRole('button',{name:'교통정보 확인',exact:true})).toBeDisabled();
 }finally{await hostContext.close();await passengerContext.close();runtime.dispose()}
});
