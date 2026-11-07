import {test} from 'node:test';import assert from 'node:assert/strict';import {RoomStore,ApiError} from '../src/store';
const sample={name:'안목해변',description:'바다',category:'바다',lat:37.77,lon:128.94};
test('초대 접근 통제, 한 사람 한 표, 운전자 확정, 퇴장과 종료',()=>{
 const s=new RoomStore();const h=s.create('강릉 여행','운전자'),id=h.room.id;
 assert.throws(()=>s.join(id,'잘못된 토큰','민지'),(e:any)=>e.status===403);
 const a=s.join(id,h.session.inviteToken!,'민지'),b=s.join(id,h.session.inviteToken!,'준호');
 let r=s.mutate(id,a.session.token,'suggest',sample);const p=r.places[0].id;
 s.mutate(id,b.session.token,'vote',{placeId:p});r=s.mutate(id,b.session.token,'vote',{placeId:p});assert.equal(r.places[0].votes.length,0);
 s.mutate(id,a.session.token,'vote',{placeId:p});s.mutate(id,b.session.token,'vote',{placeId:p});
 assert.throws(()=>s.mutate(id,a.session.token,'confirm',{placeId:p}),(e:any)=>e.status===403);
 r=s.mutate(id,h.session.token,'confirm',{placeId:p});assert.equal(r.history.length,1);
 assert.throws(()=>s.mutate(id,a.session.token,'vote',{placeId:p}),(e:any)=>e.status===409);
 s.mutate(id,h.session.token,'reopen');s.mutate(id,b.session.token,'leave');assert.throws(()=>s.auth(id,b.session.token));
 r=s.mutate(id,h.session.token,'close');assert.equal(r.status,'closed');assert.throws(()=>s.join(id,h.session.inviteToken!,'새참가'));
 assert.ok(!JSON.stringify(r).includes(h.session.token));assert.ok(!JSON.stringify(r).includes(h.session.inviteToken!));
});
test('초대 만료와 방 격리',()=>{let now=0;const s=new RoomStore(()=>now,10);const a=s.create('a','a'),b=s.create('b','b');assert.throws(()=>s.auth(b.room.id,a.session.token));now=11;assert.throws(()=>s.auth(a.room.id,a.session.token),(e:any)=>e.status===410);});
