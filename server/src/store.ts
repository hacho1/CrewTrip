import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import type {Room,Session,Role,Place,RoadFeed} from '../../shared/types';
import {demoRoadFeed} from './traffic';
export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
const token=()=>randomBytes(32).toString('base64url');
const id=()=>randomBytes(10).toString('hex');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
type Stored={room:Room;inviteHash:string;credentials:Record<string,string>};
export class RoomStore{
 rooms=new Map<string,Stored>();
 constructor(private now=()=>Date.now(),private ttl=12*60*60*1000){}
 create(title:string,nickname:string){
  this.sweep(); if(this.rooms.size>=200)throw new ApiError(503,'여행방이 가득 찼어요. 잠시 후 다시 시도해 주세요.');
  const roomId=id(),memberId=id(),secret=token(),inviteToken=token();
  const room:Room={id:roomId,title,createdAt:this.now(),expiresAt:this.now()+this.ttl,status:'open',members:[{id:memberId,nickname,role:'host'}],places:[],confirmedId:null,history:[],road:{area:null,feed:null,request:null},revision:1};
  this.rooms.set(roomId,{room,inviteHash:hash(inviteToken),credentials:{[memberId]:hash(secret)}});
  return {room:this.view(room),session:{roomId,memberId,token:secret,role:'host' as Role,inviteToken}};
 }
 get(roomId:string){const r=this.rooms.get(roomId);if(!r)throw new ApiError(404,'여행방을 찾을 수 없어요.');if(r.room.expiresAt<=this.now()){this.rooms.delete(roomId);throw new ApiError(410,'초대가 만료되었어요. 새 여행방을 만들어 주세요.');}return r;}
 open(room:Room){if(room.status!=='open')throw new ApiError(409,'종료된 여행방이에요. 기록을 확인할 수 있어요.');}
 auth(roomId:string,secret:string){const s=this.get(roomId);const h=hash(secret);const member=s.room.members.find(m=>s.credentials[m.id]===h);if(!member)throw new ApiError(401,'여행방에 다시 참여해 주세요.');return {stored:s,member};}
 join(roomId:string,invite:string,nickname:string){
  const s=this.get(roomId);this.open(s.room); const a=Buffer.from(hash(invite)),b=Buffer.from(s.inviteHash);
  if(!timingSafeEqual(a,b))throw new ApiError(403,'초대 링크가 올바르지 않아요.');
  if(s.room.members.length>=12)throw new ApiError(409,'최대 12명까지 참여할 수 있어요.');
  if(s.room.members.some(m=>m.nickname===nickname))throw new ApiError(409,'이미 사용 중인 이름이에요. 다른 이름을 입력해 주세요.');
  const memberId=id(),secret=token();s.room.members.push({id:memberId,nickname,role:'passenger'});s.credentials[memberId]=hash(secret);s.room.revision++;
  return {room:this.view(s.room),session:{roomId,memberId,token:secret,role:'passenger' as Role}};
 }
 mutate(roomId:string,secret:string,action:string,data:any={}){
  const {stored:s,member:m}=this.auth(roomId,secret),room=s.room;this.open(room);
  if(['confirm','close','reopen','road-demo','road-clear','road-resolve'].includes(action)&&m.role!=='host')throw new ApiError(403,'운전자만 여행 계획을 확정하거나 종료할 수 있어요.');
  if(action==='suggest'){
   if(room.places.length>=30)throw new ApiError(409,'장소는 30개까지 제안할 수 있어요.');
   if(room.places.some(p=>p.name===data.name))throw new ApiError(409,'이미 제안된 장소예요. 투표해 주세요.');
   if(data.roadRequestId&&(!room.road.request||room.road.request.id!==data.roadRequestId||room.road.request.resolvedAt))throw new ApiError(409,'앞길 확인 요청이 변경되었어요. 화면을 새로 확인해 주세요.');
   const roadArea = data.roadRequestId ? room.road.area : null;
   room.places.push({...data,id:id(),proposerId:m.id,votes:[],...(roadArea && {roadAreaLabel:roadArea.label})});
  }else if(action==='vote'){
   if(room.confirmedId)throw new ApiError(409,'경유지가 확정되었어요. 운전자가 다음 투표를 열 때까지 기다려 주세요.');
   const p=room.places.find(p=>p.id===data.placeId);if(!p)throw new ApiError(404,'장소를 찾을 수 없어요.');
   const selected=p.votes.includes(m.id);room.places.forEach(p=>p.votes=p.votes.filter(v=>v!==m.id));if(!selected)p.votes.push(m.id);
  }else if(action==='confirm'){
   if(room.confirmedId)throw new ApiError(409,'이미 확정된 경유지예요.');
   const p=room.places.find(p=>p.id===data.placeId);if(!p)throw new ApiError(404,'장소를 찾을 수 없어요.');
   const request = room.road.request;
   const matchingRequest = request !== null && request.id === p.roadRequestId;
   room.confirmedId = p.id;
   const history: Room['history'][number] = {placeId:p.id,name:p.name,confirmedAt:this.now()};
   if (p.roadRequestId) {
    history.roadRequestId = p.roadRequestId;
    history.roadAreaLabel = p.roadAreaLabel ?? (matchingRequest ? room.road.area?.label : undefined);
    history.roadCaution = '주변 정보 참고 · 실제 경로·방향·촬영 시각 일치 미확인';
   }
   room.history.push(history);
   if (matchingRequest) request.resolvedAt = history.confirmedAt;
  }else if(action==='reopen'){room.confirmedId=null;room.places.forEach(p=>p.votes=[]);}
  else if(action==='close'){room.status='closed';s.inviteHash=hash(token());}
  else if(action==='road-area'){
   if(m.role!=='host'&&room.road.request&&!room.road.request.resolvedAt)throw new ApiError(409,'진행 중인 앞길 확인이 있어요. 의견을 공유하거나 운전자가 확인을 마친 뒤 구간을 바꿔 주세요.');
   room.road={area:{...data,id:id()},feed:null,request:null};
  }else if(action==='road-demo'){
   room.road={area:{id:id(),label:'강릉IC 주변 · 시연 구간',lat:37.7513,lon:128.8355},feed:demoRoadFeed(this.now()),request:null};
  }else if(action==='road-clear'){room.road={area:null,feed:null,request:null};}
  else if(action==='road-request'){
   const feed=room.road.feed;
   if(!feed||!['ready','partial'].includes(feed.status))throw new ApiError(409,'교통정보를 확인한 뒤 크루에게 요청해 주세요.');
   if(feed.mode==='live'&&(!feed.fetchedAt||this.now()-feed.fetchedAt>180_000))throw new ApiError(409,'교통정보를 갱신한 뒤 다시 요청해 주세요.');
   const incident=data.incidentId?feed.incidents.find(x=>x.id===data.incidentId):null;
   if(data.incidentId&&!incident)throw new ApiError(409,'사고 안내가 변경되었어요. 다시 확인해 주세요.');
   if(room.road.request&&!room.road.request.resolvedAt)throw new ApiError(409,'이미 확인을 요청했어요. 크루의 의견을 기다려 주세요.');
   room.road.request={id:id(),requestedBy:m.id,requestedAt:this.now(),incidentId:incident?.id??null,summary:incident?`${incident.roadName} · ${incident.kind}`:`${room.road.area!.label} 주변 상황 확인`,mode:feed.mode,reports:[],resolvedAt:null};
  }else if(action==='road-report'){
   const request=room.road.request;
   if(m.role!=='passenger')throw new ApiError(403,'동승자가 확인 의견을 남길 수 있어요.');
   if(!request||request.id!==data.requestId||request.resolvedAt)throw new ApiError(409,'앞길 확인 요청이 변경되었거나 완료되었어요.');
   if(data.cameraId&&!room.road.feed?.cameras.some(x=>x.id===data.cameraId))throw new ApiError(400,'CCTV 정보가 변경되었어요.');
   const report={memberId:m.id,choice:data.choice,note:data.note,cameraId:data.cameraId??null,createdAt:this.now()};
   request.reports=request.reports.filter(x=>x.memberId!==m.id);request.reports.push(report);
  }else if(action==='road-resolve'){
   const request=room.road.request;if(!request||request.id!==data.requestId)throw new ApiError(409,'앞길 확인 요청이 변경되었어요.');
   request.resolvedAt=this.now();
  }
  else if(action==='leave'){
   if(m.role==='host')throw new ApiError(409,'운전자는 여행방을 종료해 주세요.');
   delete s.credentials[m.id];room.members=room.members.filter(x=>x.id!==m.id);room.places.forEach(p=>p.votes=p.votes.filter(x=>x!==m.id));
  }else throw new ApiError(400,'지원하지 않는 요청이에요.');
  room.revision++;return this.view(room);
 }
 setRoadFeed(roomId:string,secret:string,areaId:string,feed:RoadFeed){
  const {stored}=this.auth(roomId,secret);this.open(stored.room);
  if(stored.room.road.area?.id!==areaId||stored.room.road.feed?.mode==='demo')throw new ApiError(409,'확인 구간이 변경되었어요. 다시 조회해 주세요.');
  stored.room.road.feed=structuredClone(feed);stored.room.revision++;return this.view(stored.room);
 }
 view(room:Room){return structuredClone(room);}
 sweep(){for(const [key,value]of this.rooms)if(value.room.expiresAt<=this.now())this.rooms.delete(key);}
}
