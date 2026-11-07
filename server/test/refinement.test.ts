import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RoomStore} from '../src/store';
import {demoRoadFeed} from '../src/traffic';

test('동승자가 앞길 확인을 시작하되 진행 중 구간 덮어쓰기와 최종 확정은 차단',()=>{
 const store=new RoomStore(),h=store.create('동승자가 시작하는 여행','운전자');
 const p=store.join(h.room.id,h.session.inviteToken!,'민지'),other=store.join(h.room.id,h.session.inviteToken!,'준호');
 const act=(token:string,a:string,d:unknown={})=>store.mutate(h.room.id,token,a,d);
 const room=act(p.session.token,'road-area',{label:'강릉IC 주변',lat:37.7513,lon:128.8355});
 store.setRoadFeed(h.room.id,p.session.token,room.road.area!.id,demoRoadFeed(Date.now()));
 const request=act(p.session.token,'road-request').road.request!;assert.equal(request.requestedBy,p.session.memberId);
 assert.throws(()=>act(other.session.token,'road-area',{label:'덮어쓰기',lat:37.8,lon:128.8}),(e:any)=>e.status===409);
 assert.throws(()=>act(p.session.token,'road-resolve',{requestId:request.id}),(e:any)=>e.status===403);
 const proposed=act(other.session.token,'suggest',{name:'새 쉼터',lat:37.79,lon:128.89,category:'산책',description:'함께 확인 후 제안',roadRequestId:request.id,roadReason:'rest'}).places[0];
 assert.throws(()=>act(p.session.token,'confirm',{placeId:proposed.id}),(e:any)=>e.status===403);
 const confirmed=act(h.session.token,'confirm',{placeId:proposed.id});
 assert.equal(confirmed.history[0].roadAreaLabel,'강릉IC 주변');assert.match(confirmed.history[0].roadCaution!,/일치 미확인/);
 assert.ok(confirmed.road.request!.resolvedAt);
});

test('조회 구간을 바꾼 뒤 이전 제안을 확정해도 제안 당시 구간이 기록된다',()=>{
 const store=new RoomStore(),host=store.create('강릉 여행','운전자'),roomId=host.room.id;
 const passenger=store.join(roomId,host.session.inviteToken!,'민지');
 const act=(action:string,data:unknown={})=>store.mutate(roomId,host.session.token,action,data);
 const original=act('road-area',{label:'강릉IC 주변',lat:37.7513,lon:128.8355});
 store.setRoadFeed(roomId,host.session.token,original.road.area!.id,demoRoadFeed(Date.now()));
 const request=act('road-request').road.request!;
 const proposal=store.mutate(roomId,passenger.session.token,'suggest',{
  name:'강릉 쉼터',lat:37.79,lon:128.89,category:'휴식',description:'앞길 확인 후 제안',roadRequestId:request.id,roadReason:'rest'
 }).places[0];
 act('road-resolve',{requestId:request.id});
 act('road-area',{label:'주문진 주변',lat:37.893,lon:128.82});
 const confirmed=act('confirm',{placeId:proposal.id});
 assert.equal(confirmed.road.area!.label,'주문진 주변');
 assert.equal(confirmed.history[0].roadRequestId,request.id);
 assert.equal(confirmed.history[0].roadAreaLabel,'강릉IC 주변');

 // Simulate a proposal saved before it carried its original area label.
 delete store.get(roomId).room.places[0].roadAreaLabel;
 act('reopen');
 const legacy=act('confirm',{placeId:proposal.id});
 assert.equal(legacy.history[0].roadAreaLabel,'강릉IC 주변');
 assert.equal(legacy.history[1].roadRequestId,request.id);
 assert.equal(legacy.history[1].roadAreaLabel,undefined);
 assert.match(legacy.history[1].roadCaution!,/일치 미확인/);
});
