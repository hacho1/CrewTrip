import {test,expect} from '@playwright/test';
test('운전자 1명과 동승자 2명 실시간 여행방',async({browser,page})=>{
 await page.goto('/vehicle');await page.getByLabel('내 이름').fill('운전자');await page.getByRole('button',{name:'여행방 만들기'}).click();
 await expect(page.getByRole('heading',{name:'크루의 목적지 후보'})).toBeVisible();
 const restored=await page.context().newPage();await restored.goto('/vehicle');await expect(restored.getByRole('heading',{name:'크루의 목적지 후보'})).toBeVisible();await restored.close();
 const invite=await page.getByLabel('초대 링크').inputValue();const url=new URL(invite);url.host='127.0.0.1:4310';
 const aContext=await browser.newContext({viewport:{width:390,height:844}}),bContext=await browser.newContext({viewport:{width:390,height:844}});
 const a=await aContext.newPage(),b=await bContext.newPage();
 await a.goto(url.toString());await a.getByLabel('내 이름').fill('민지');await a.getByRole('button',{name:'여행방 참여'}).click();
 await b.goto(url.toString());await b.getByLabel('내 이름').fill('준호');await b.getByRole('button',{name:'여행방 참여'}).click();
 await a.getByRole('button',{name:'장소 제안',exact:true}).click();await a.getByRole('button',{name:'안목해변 바다를 보며 잠깐 쉬어 가기'}).click();
 await b.getByRole('button',{name:'장소 제안',exact:true}).click();await b.getByRole('button',{name:'경포호 호숫가를 따라 천천히 산책'}).click();
 await expect(page.getByRole('heading',{name:'안목해변',exact:true})).toBeVisible();
 await a.getByRole('button',{name:'안목해변 투표',exact:true}).click();await b.getByRole('button',{name:'안목해변 투표',exact:true}).click();
 await expect(page.locator('.vote-summary')).toContainText('2명 투표');await expect(page.locator('.place-row').filter({hasText:'안목해변'})).toContainText('2표');
 await expect(a.getByRole('button',{name:'경유지 확정',exact:true})).toHaveCount(0);
 await page.screenshot({path:'artifacts/vehicle-voting.png',fullPage:true});await a.screenshot({path:'artifacts/passenger-voting.png',fullPage:true});
 for(const width of [390,768,1440]){await a.setViewportSize({width,height:900});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await a.screenshot({path:`artifacts/passenger-${width}.png`,fullPage:true});}
 await page.locator('.place-row').filter({hasText:'안목해변'}).getByRole('button',{name:'경유지 확정'}).click();await page.getByRole('button',{name:'이 장소로 확정'}).click();
 await expect(a.getByText('경유지 확정',{exact:true})).toBeVisible();await expect(b.getByText('경유지 확정',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'여행 기록',exact:true}).click();await expect(page.locator('.history-panel')).toContainText('안목해변');
 await page.getByRole('button',{name:'다음 목적지 투표 열기'}).click();await expect(a.locator('.vote-summary')).toContainText('0명 투표');
 await a.getByRole('button',{name:'참여 정보',exact:true}).click();await a.getByRole('button',{name:'여행방 나가기'}).click();await expect(page.locator('.members')).not.toContainText('민지');
 await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('button',{name:'여행방 종료',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'여행방 종료',exact:true}).click();
 await expect(b.getByText('종료된 여행',{exact:false})).toBeVisible();await aContext.close();await bContext.close();
});
test('차량 두 설명 모드에서 미확인 상태와 경고 중요도 유지 (UI 시뮬레이션)',async({page})=>{
 await page.goto('/vehicle');await page.getByLabel('내 이름').fill('모드검증');await page.getByRole('button',{name:'여행방 만들기'}).click();await page.getByRole('button',{name:'차량 상태',exact:true}).click();
 await expect(page.getByText('미확인',{exact:true})).toHaveCount(3);
 await page.evaluate(()=>window.crewtripReceive?.({restricted:false,restrictionReason:'MOCK ONLY',source:'MOCK ONLY',navStatus:'미연결',readings:[{key:'TPMS',title:'타이어 주의',state:'available',value:'주의 알림',unit:'',source:'MOCK ONLY',updatedAt:Date.now(),severity:'warning',detail:'타이어 관련 주의 정보가 확인되었어요.'}]}));
 await expect(page.locator('.reading.warning')).toHaveCount(1);await page.getByRole('button',{name:'상세 정보',exact:true}).click();await expect(page.locator('.reading.warning')).toHaveCount(1);await expect(page.getByText('TPMS',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.crewtripReceive?.({restricted:true,restrictionReason:'MOCK ONLY · 주행 제한',source:'MOCK ONLY',navStatus:'미연결',readings:[]}));
 await page.getByRole('button',{name:'함께 계획',exact:true}).click();await expect(page.getByRole('button',{name:'장소 제안',exact:true})).toHaveCount(0);await expect(page.getByText('지금은 여행 정보를 확인해 주세요.')).toBeVisible();
});
