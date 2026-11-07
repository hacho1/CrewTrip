import {test} from 'node:test';
import assert from 'node:assert/strict';
import {camerasNearIncident,IncidentAlerts,isRoadPoint,pointDistanceKm} from '../../shared/road-map';
import {demoRoadFeed,parseCameras,parseIncidents} from '../src/traffic';
import type {RoadCamera,RoadFeed,RoadIncident} from '../../shared/types';

test('지도는 조회 지점이 아니라 선택한 사고 지점 가까운 CCTV를 거리순으로 제공',()=>{
 const camera=(id:string,lat:number,lon:number):RoadCamera=>({id,name:id,lat,lon,distanceKm:0,direction:null,recordedAt:null,mediaUrl:null,format:'unavailable'});
 const incident={lat:37.79,lon:128.91};
 const cameras=[camera('조회 지점 카메라',37.7513,128.8355),camera('사고와 가까운 카메라',37.791,128.911),camera('두 번째 후보',37.80,128.92)];
 assert.deepEqual(camerasNearIncident(incident,cameras).map(x=>x.camera.id),['사고와 가까운 카메라','두 번째 후보']);
 assert.equal(pointDistanceKm(incident,incident),0);
 assert.ok(!isRoadPoint({lat:NaN,lon:128.9}));assert.ok(!isRoadPoint({lat:0,lon:0}));assert.ok(isRoadPoint(incident));
 const area={id:'a',label:'검증',lat:37.7513,lon:128.8355};
 const rows=Array.from({length:8},(_,i)=>({cctvname:`시험${i}`,coordx:128.8355+i*.001,coordy:37.7513,cctvtype:4,cctvurl:'https://example.org/live.m3u8'}));
 assert.equal(parseCameras(JSON.stringify({response:{data:rows}}),area).length,8,'지도용 응답을 조회 지점 가까운 6곳으로 먼저 잘라서는 안 됨');
});

test('새 사고 알림은 같은 사건을 반복하지 않고 부분 실패를 새 사고로 오인하지 않음',()=>{
 const tracker=new IncidentAlerts(),sample=demoRoadFeed(Date.now()).incidents[0];
 const incident=(id:string,kind='교통사고'):RoadIncident=>({...sample,id,kind});
 const feed=(items:RoadIncident[],status:RoadFeed['status']='ready'):RoadFeed=>({...demoRoadFeed(Date.now()),mode:'live',status,incidents:items});
 assert.deepEqual(tracker.observe('area',feed([incident('a'),incident('work','공사')])).map(x=>x.id),['a']);
 assert.deepEqual(tracker.observe('area',feed([incident('a')])),[]);
 assert.deepEqual(tracker.observe('area',feed([], 'partial')),[]);
 assert.deepEqual(tracker.observe('area',feed([incident('a'),incident('b')])).map(x=>x.id),['b']);
 assert.deepEqual(tracker.observe('area',feed([],'error')),[]);
 assert.deepEqual(tracker.observe('area',feed([incident('a'),incident('b')])),[]);
 assert.deepEqual(tracker.observe('other-area',feed([incident('a')])).map(x=>x.id),['a']);
});

test('같은 ITS 사고의 설명 갱신은 같은 ID이며 다른 위치·발생 시각은 구별',()=>{
 const now=Date.now(),area={id:'area',label:'시험',lat:37.7513,lon:128.8355};
 const row={linkId:'link',eventType:'교통사고',roadName:'모의 도로',coordX:128.836,coordY:37.752,startDate:'20261102090000',message:'최초 안내'};
 const parse=(value:typeof row)=>parseIncidents(JSON.stringify({header:{resultCode:0},body:{items:[value]}}),area,now)[0];
 assert.equal(parse(row).id,parse({...row,message:'차로 통제 내용 갱신'}).id);
 assert.notEqual(parse(row).id,parse({...row,coordX:128.837}).id);
 assert.notEqual(parse(row).id,parse({...row,startDate:'20261102100000'}).id);
});
