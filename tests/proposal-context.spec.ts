import {test,expect,type Browser,type Locator} from '@playwright/test';
import {createApp} from '../server/src/app';
import {RoomStore} from '../server/src/store';
import {TrafficService} from '../server/src/traffic';
import {mkdir,writeFile} from 'node:fs/promises';

const evidence='artifacts/ux-final-2026-11-04';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true})});
async function setup(browser:Browser){
 const provider:typeof fetch=async input=>new Response(JSON.stringify(String(input).includes('eventInfo')?{header:{resultCode:0},body:{items:[{linkId:'A',eventType:'교통사고',roadName:'가상 A도로',message:'모의 사고 · 실제 상황 아님',coordX:128.837,coordY:37.752},{linkId:'B',eventType:'교통사고',roadName:'가상 B도로',message:'다른 모의 사고 · 실제 상황 아님',coordX:128.841,coordY:37.755}]}}:{response:{data:[{cctvname:'가상 CCTV',coordx:128.837,coordy:37.752,cctvtype:4,cctvformat:'HLS',cctvurl:'https://proposal-test.invalid/test.m3u8'}]}}));
 const store=new RoomStore(),runtime=createApp(store,new TrafficService('fixture-only',provider));await new Promise<void>(resolve=>runtime.http.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(runtime.http.address() as {port:number}).port}`,host=await browser.newContext(),guest=await browser.newContext({viewport:{width:390,height:844}}),other=await browser.newContext({viewport:{width:360,height:780}});
 for(const context of [host,guest,other])await context.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=','base64')}));
 const driver=await host.newPage(),phone=await guest.newPage(),crew=await other.newPage();await driver.goto(origin+'/vehicle');await driver.getByLabel('내 이름').fill('가상 운전자');await driver.getByRole('button',{name:'여행방 만들기'}).click();
 const invite=new URL(await driver.getByLabel('초대 링크').inputValue());invite.host=new URL(origin).host;
 for(const [page,name]of [[phone,'가상 민지'],[crew,'가상 준호']] as const){await page.goto(invite.toString());await page.getByLabel('내 이름').fill(name);await page.getByRole('button',{name:'여행방 참여'}).click();await expect(page.locator('.connection')).toContainText('실시간 연결')}
 const hostRoad=driver.getByRole('region',{name:'앞길 확인'});await hostRoad.getByRole('button',{name:'확인 구간 지정',exact:true}).click();await driver.getByLabel('빠른 구간 선택').selectOption('강릉IC');await driver.getByRole('button',{name:'이 구간으로 지정'}).click();await hostRoad.getByRole('button',{name:'교통정보 확인',exact:true}).click();await expect(hostRoad.locator('.road-status')).toHaveText('교통정보 조회됨');
 await hostRoad.getByRole('button',{name:'앞길 지도 열기'}).click();await hostRoad.locator('.incident-picks button').filter({hasText:'가상 B도로'}).click();await hostRoad.getByRole('button',{name:'이 돌발정보 함께 확인'}).click();await expect(phone.getByLabel('함께 전할 말')).toBeVisible();
 const rid=invite.pathname.split('/')[2],readRoom=()=>store.view(store.get(rid).room);
 const finish=async()=>{const toggle=hostRoad.getByRole('button',{name:'크루 의견 보기'});if(await toggle.count())await toggle.click();await hostRoad.getByRole('button',{name:'앞길 확인 마치기'}).click()};
 const replace=async()=>{await finish();await hostRoad.locator('.incident-picks button').filter({hasText:'가상 A도로'}).click();await hostRoad.getByRole('button',{name:'이 돌발정보 함께 확인'}).click();await expect(phone.locator('.road-summary h3')).toContainText('가상 A도로')};
 return {driver,phone,crew,readRoom,finish,replace,close:async()=>{await host.close();await guest.close();await other.close();runtime.dispose()}};
}
async function direct(page:any,rest=true){await page.getByRole('button',{name:rest?'쉬어 갈 곳 제안':'장소 제안',exact:true}).click();await page.getByRole('button',{name:'다른 장소 직접 제안'}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('장소 이름',{exact:true}).fill('작성 중인 가상 카페');await dialog.getByLabel('함께 가고 싶은 이유').fill('유지해야 하는 가상 제안 이유');await expect(dialog.getByRole('button',{name:'지도 가운데를 장소로 선택',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'지도 가운데를 장소로 선택',exact:true}).click();return dialog as Locator}
async function expectDraft(dialog:Locator){await expect(dialog.getByLabel('장소 이름',{exact:true})).toHaveValue('작성 중인 가상 카페');await expect(dialog.getByLabel('함께 가고 싶은 이유')).toHaveValue('유지해야 하는 가상 제안 이유');await expect(dialog.locator('.leaflet-overlay-pane path')).toHaveCount(1)}

test('제안 작성의 B대상을 고정하고 A로 바뀌면 제출 차단, 명시적 대상 변경 뒤에만 A에 연결',async({browser})=>{
 const s=await setup(browser);
 try{
  const dialog=await direct(s.phone),oldId=s.readRoom().road.request!.id;await expect(dialog.locator('.suggest-context')).toContainText('가상 B도로');await s.replace();
  const nextId=s.readRoom().road.request!.id;expect(nextId).not.toBe(oldId);await expect(dialog.locator('.suggest-context')).toContainText('가상 B도로');await expect(dialog.locator('.suggest-context-change')).toContainText('가상 A도로');await expect(dialog.getByRole('button',{name:'이 장소 제안하기'})).toBeDisabled();expect(s.readRoom().places).toHaveLength(0);await expectDraft(dialog);
  await dialog.getByRole('button',{name:'예시 장소로 돌아가기'}).click();await expect(dialog.getByRole('button',{name:'경포호 호숫가를 따라 천천히 산책'})).toBeDisabled();await dialog.getByRole('button',{name:'다른 장소 직접 제안'}).click();await expectDraft(dialog);await dialog.locator('.suggest-context-change').scrollIntoViewIfNeeded();await s.phone.screenshot({path:`${evidence}/context-changed-390.png`});
  await dialog.getByRole('button',{name:'새 확인 대상으로 변경'}).click();await expect(dialog.locator('.suggest-context')).toContainText('가상 A도로');await dialog.getByRole('button',{name:'이 장소 제안하기'}).click();await expect(s.phone.getByRole('heading',{name:'작성 중인 가상 카페',exact:true})).toBeVisible();expect(s.readRoom().places[0].roadRequestId).toBe(nextId);
 }finally{await s.close()}
});

test('확인이 끝나도 초안을 유지하고 일반 장소로 전환하기 전에는 연결을 조용히 제거하지 않음',async({browser})=>{
 const s=await setup(browser);
 try{
  const dialog=await direct(s.phone);await s.finish();await expect(dialog.locator('.suggest-context-change')).toContainText('진행 중인 확인 요청 없음');await expect(dialog.getByRole('button',{name:'이 장소 제안하기'})).toBeDisabled();await expectDraft(dialog);
  await dialog.getByRole('button',{name:'일반 장소 제안으로 전환'}).click();await expect(dialog.locator('.suggest-context')).toHaveCount(0);await expectDraft(dialog);await dialog.getByRole('button',{name:'이 장소 제안하기'}).click();await expect(s.phone.getByRole('heading',{name:'작성 중인 가상 카페',exact:true})).toBeVisible();expect(s.readRoom().places[0].roadRequestId).toBeUndefined();expect(s.readRoom().places[0].roadReason).toBeUndefined();
 }finally{await s.close()}
});

test('제출 요청이 출발한 뒤 대상이 바뀌어도 기존 ID를 보내고 서버409를 창 안에 표시하며 재검토 가능',async({browser})=>{
 const s=await setup(browser);let release=()=>{};
 try{
  const dialog=await direct(s.phone),oldId=s.readRoom().road.request!.id;let heldResolve=()=>{},payload:any;const held=new Promise<void>(resolve=>heldResolve=resolve),gate=new Promise<void>(resolve=>release=resolve);
  await s.phone.route('**/suggest',async route=>{if(!payload){payload=route.request().postDataJSON();heldResolve();await gate}await route.continue()});
  const response=s.phone.waitForResponse(r=>r.url().endsWith('/suggest'));await dialog.getByRole('button',{name:'이 장소 제안하기'}).click();await held;await s.replace();release();expect((await response).status()).toBe(409);expect(payload.roadRequestId).toBe(oldId);expect(s.readRoom().places).toHaveLength(0);await expect(dialog.locator('.suggest-submit-error')).toContainText('앞길 확인 요청이 변경');await expectDraft(dialog);
  await dialog.getByRole('button',{name:'새 확인 대상으로 변경'}).click();await dialog.getByRole('button',{name:'이 장소 제안하기'}).click();await expect(s.phone.getByRole('heading',{name:'작성 중인 가상 카페',exact:true})).toBeVisible();expect(s.readRoom().places[0].roadRequestId).toBe(s.readRoom().road.request!.id);
 }finally{release();await s.close()}
});

test('동시 중복 제안409를 작성 창 안에서 보고 오류 초점·키보드 탈출·8개 화면 조합을 유지',async({browser})=>{
 const s=await setup(browser);
 try{
  // Produce an earlier success notice, then verify opening/submitting a new form clears it.
  await s.phone.getByRole('button',{name:'장소 제안',exact:true}).click();await s.phone.getByRole('button',{name:'안목해변 바다를 보며 잠깐 쉬어 가기'}).click();await expect(s.phone.locator('.toast')).toBeVisible();
  const dialog=await direct(s.phone,false);await expect(s.phone.locator('.toast')).toHaveCount(0);const crewDialog=await direct(s.crew,false);await crewDialog.getByRole('button',{name:'이 장소 제안하기'}).click();await expect(s.crew.getByRole('heading',{name:'작성 중인 가상 카페',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'이 장소 제안하기'}).click();const error=dialog.locator('.suggest-submit-error');await expect(error).toContainText('이미 제안된 장소');await expect(error).toBeFocused();await expect(s.phone.locator('.app>.message.error')).toHaveCount(0);await expect(s.phone.locator('.toast')).toHaveCount(0);await expectDraft(dialog);expect(s.readRoom().places.filter(p=>p.name==='작성 중인 가상 카페')).toHaveLength(1);
  const metrics=[];const luminance=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  for(const theme of ['dark','light'])for(const width of [360,390,768,1440]){
   await s.phone.setViewportSize({width,height:width<400?844:1000});await s.phone.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await error.scrollIntoViewIfNeeded();
   const measured=await error.evaluate(el=>{const r=el.getBoundingClientRect(),dialog=el.closest('[role=dialog]')!,outer=dialog.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),style=getComputedStyle(el);return {centerHitsError:!!hit&&el.contains(hit),insideDialog:r.top>=outer.top&&r.bottom<=outer.bottom,color:style.color,background:getComputedStyle(dialog).backgroundColor,pageOverflow:document.documentElement.scrollWidth>innerWidth,dialogOverflow:dialog.scrollWidth>dialog.clientWidth+1,fontSize:style.fontSize}});
   const a=luminance(measured.color),b=luminance(measured.background),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);expect(measured.centerHitsError).toBe(true);expect(measured.insideDialog).toBe(true);expect(measured.pageOverflow||measured.dialogOverflow).toBe(false);expect(contrast).toBeGreaterThanOrEqual(4.5);metrics.push({theme,width,contrast,...measured});await s.phone.screenshot({path:`${evidence}/error-${width}-${theme}.png`});
  }
  await writeFile(`${evidence}/error-visibility.json`,JSON.stringify(metrics,null,2));await error.focus();await error.press('Tab');await expect(dialog.getByRole('button',{name:'제안 닫기'})).toBeFocused();await dialog.getByRole('button',{name:'제안 닫기'}).press('Shift+Tab');await expect(dialog.getByRole('button',{name:'이 장소 제안하기'})).toBeFocused();await dialog.press('Escape');await expect(s.phone.getByRole('dialog')).toHaveCount(0);
 }finally{await s.close()}
});

test('직접·예시 왕복을 반복해도 이름·이유·지도 위치를 보존하고 명시적 취소 후 새 제안은 초기화',async({browser})=>{
 const s=await setup(browser);
 try{
  const dialog=await direct(s.phone);for(let i=0;i<3;i++){await dialog.getByRole('button',{name:'예시 장소로 돌아가기'}).click();await dialog.getByRole('button',{name:'다른 장소 직접 제안'}).click();await expectDraft(dialog)}
  await dialog.getByLabel('장소 이름',{exact:true}).scrollIntoViewIfNeeded();await s.phone.screenshot({path:`${evidence}/draft-retained.png`});await dialog.getByRole('button',{name:'제안 닫기'}).click();expect(s.readRoom().places).toHaveLength(0);expect(s.readRoom().road.request!.reports).toHaveLength(0);
  await s.phone.getByRole('button',{name:'쉬어 갈 곳 제안',exact:true}).click();await s.phone.getByRole('button',{name:'다른 장소 직접 제안'}).click();const fresh=s.phone.getByRole('dialog');await expect(fresh.getByLabel('장소 이름',{exact:true})).toHaveValue('');await expect(fresh.getByLabel('함께 가고 싶은 이유')).toHaveValue('');await expect(fresh.locator('.leaflet-overlay-pane path')).toHaveCount(0);
 }finally{await s.close()}
});
