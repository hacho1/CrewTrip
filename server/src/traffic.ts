import {createHash} from 'node:crypto';
import {XMLParser} from 'fast-xml-parser';
import type {RoadArea,RoadCamera,RoadFeed,RoadIncident} from '../../shared/types';

// decodeIts rejects DTD/entity declarations before parsing; only standard XML escapes are decoded.
const parser=new XMLParser({ignoreAttributes:true,parseTagValue:false,processEntities:true});
const array=(x:any):any[]=>x==null?[]:Array.isArray(x)?x:[x];
const text=(x:unknown,max=500)=>typeof x==='string'||typeof x==='number'?String(x).trim().slice(0,max):'';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,20);
export function itsDate(value:unknown):number|null{
 const s=text(value);if(!/^\d{14}$/.test(s))return null;
 const iso=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}+09:00`;
 const n=Date.parse(iso);return Number.isFinite(n)?n:null;
}
export function distanceKm(a:{lat:number;lon:number},b:{lat:number;lon:number}){
 const rad=Math.PI/180,dy=(b.lat-a.lat)*rad,dx=(b.lon-a.lon)*rad;
 const h=Math.sin(dy/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dx/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
// Streams are opened only by passenger browsers; the server never proxies arbitrary URLs.
export function safeMediaUrl(value:unknown):string|null{
 try{const u=new URL(text(value,3000)),host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return null;
  if(!host.includes('.')||host.endsWith('.local')||host.endsWith('.localhost')||host.endsWith('.internal')||host.includes(':')||/^\d+(\.\d+){3}$/.test(host))return null;
  if(/[\r\n]/.test(u.href))return null;return u.href;
 }catch{return null}
}
export function decodeIts(body:string):any{
 if(Buffer.byteLength(body)>3_000_000||/<!DOCTYPE|<!ENTITY/i.test(body))throw new Error('교통정보 응답 형식을 확인할 수 없어요.');
 const json=body.trim().startsWith('{')?JSON.parse(body):parser.parse(body);
 // The live eventInfo JSON places header/body at the root; the XML and CCTV responses may wrap them in response.
 const r=json?.response??(json?.header&&typeof json.header==='object'&&Object.hasOwn(json,'body')?json:null);
 if(!r||typeof r!=='object')throw new Error('교통정보 응답 형식을 확인할 수 없어요.');
 const code=r.header?.resultCode??r.resultCode;
 if(code!=null&&!['0','00','SUCCESS'].includes(String(code)))throw new Error('교통정보 제공기관이 요청을 승인하지 않았어요. 인증키와 이용 한도를 확인해 주세요.');
 return r;
}
function coords(row:any,x:string,y:string){const lon=Number(row[x]),lat=Number(row[y]);return text(row[x])&&text(row[y])&&Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=90?{lat,lon}:null;}
export function parseIncidents(body:string,area:RoadArea,now:number):RoadIncident[]{
 const r=decodeIts(body),entries=r.body?.items?.item??r.body?.items??r.items?.item??r.data;
 if(entries===undefined&&Number(r.body?.totalCount??r.totalCount)!==0)throw new Error('돌발정보 형식을 확인할 수 없어요.');
 const rows=array(entries);
 return rows.flatMap(row=>{const point=coords(row,'coordX','coordY');if(!point||distanceKm(area,point)>10)return [];
  const endedAt=itsDate(row.endDate);if(endedAt!==null&&endedAt<=now)return [];
  const description=text(row.message);if(!description)return [];
  return [{id:digest([row.linkId,row.startDate,point.lat,point.lon,row.eventType,row.startDate?'':description].join('|')),kind:text(row.eventType,40)||'돌발정보',roadName:text(row.roadName,100)||'도로명 미제공',description,...point,direction:text(row.roadDrcType,80)||null,startedAt:itsDate(row.startDate),endedAt}];
 }).slice(0,20);
}
export function parseCameras(body:string,area:RoadArea):RoadCamera[]{
 const r=decodeIts(body),entries=r.data??r.body?.items?.item??r.body?.items;
 if(entries===undefined&&Number(r.datacount??r.body?.totalCount)!==0)throw new Error('CCTV 정보 형식을 확인할 수 없어요.');
 const rows=array(entries);
 return rows.flatMap(row=>{const point=coords(row,'coordx','coordy');if(!point)return [];const distance=distanceKm(area,point);if(distance>10)return [];
  const name=text(row.cctvname,160)||'CCTV 이름 미제공',mediaUrl=safeMediaUrl(row.cctvurl),format=text(row.cctvformat).toUpperCase();
  const kind:RoadCamera['format']=mediaUrl?(format.includes('HLS')||['1','4'].includes(text(row.cctvtype))?'hls':format.includes('MP4')||['2','5'].includes(text(row.cctvtype))?'mp4':'unavailable'):'unavailable';
  return [{id:digest(`${name}|${point.lat}|${point.lon}`),name,...point,distanceKm:Math.round(distance*10)/10,direction:null,recordedAt:itsDate(row.filecreatetime),mediaUrl:kind==='unavailable'?null:mediaUrl,format:kind}];
 }).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,60);
}
export class TrafficService{
 private cache=new Map<string,{at:number;feed:RoadFeed}>();
 private pending=new Map<string,Promise<RoadFeed>>();
 constructor(private key=process.env.ITS_API_KEY||'',private request:typeof fetch=fetch,private now=()=>Date.now()){}
 async read(area:RoadArea):Promise<RoadFeed>{
  const unavailable:RoadFeed={mode:'live',status:'unconfigured',source:'국가교통정보센터 ITS',fetchedAt:null,incidents:[],cameras:[],issues:['실시간 교통정보 연결 준비 중이에요. 연결 전에는 사고 유무를 확인할 수 없어요.']};
  // The documented public sample key returns fixed, historical nationwide data even for a small bounding box.
  if(!this.key||this.key.toLowerCase()==='test')return unavailable;
  const cacheKey=`${area.lat.toFixed(3)},${area.lon.toFixed(3)}`,cached=this.cache.get(cacheKey);
  if(cached&&this.now()-cached.at<60_000)return structuredClone(cached.feed);
  if(this.pending.has(cacheKey))return structuredClone(await this.pending.get(cacheKey)!);
  const promise=this.load(area);this.pending.set(cacheKey,promise);
  try{const feed=await promise;if(this.cache.size>=200)this.cache.delete(this.cache.keys().next().value!);this.cache.set(cacheKey,{at:this.now(),feed});return structuredClone(feed)}finally{this.pending.delete(cacheKey)}
 }
 private async load(area:RoadArea):Promise<RoadFeed>{
  const spanLat=10/111,spanLon=10/(111*Math.cos(area.lat*Math.PI/180));
  const bounds={apiKey:this.key,minX:String(area.lon-spanLon),maxX:String(area.lon+spanLon),minY:String(area.lat-spanLat),maxY:String(area.lat+spanLat),getType:'json'};
  const get=async(path:string,params:Record<string,string>)=>{
   const url=new URL(`https://openapi.its.go.kr:9443/${path}`);url.search=new URLSearchParams({...bounds,...params}).toString();
   const response=await this.request(url,{signal:AbortSignal.timeout(12_000),redirect:'error',headers:{Accept:'application/json, application/xml, text/xml'}});
   if(!response.ok)throw new Error('교통정보 연결에 실패했어요. 인증키와 제공기관 상태를 확인해 주세요.');
   const reader=response.body?.getReader();if(!reader)throw new Error('교통정보 응답이 비어 있어요.');const chunks:Uint8Array[]=[];let bytes=0;
   try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>3_000_000)throw new Error('교통정보 응답이 너무 커요.');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
   return Buffer.concat(chunks).toString('utf8');
  };
  const jobs=await Promise.allSettled([
   get('eventInfo',{type:'all',eventType:'all'}).then(x=>parseIncidents(x,area,this.now())),
   get('cctvInfo',{type:'ex',cctvType:'4'}).then(x=>parseCameras(x,area)),
   get('cctvInfo',{type:'its',cctvType:'4'}).then(x=>parseCameras(x,area))
  ]);
  const incidents=jobs[0].status==='fulfilled'?jobs[0].value as RoadIncident[]:[];
  const cameras=[...new Map(jobs.slice(1).flatMap(x=>x.status==='fulfilled'?x.value as RoadCamera[]:[]).map(x=>[x.id,x])).values()].sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,60);
  const failed=jobs.filter(x=>x.status==='rejected').length;
  return {mode:'live',status:failed===3?'error':failed?'partial':'ready',source:'국가교통정보센터 ITS',fetchedAt:this.now(),incidents,cameras,issues:failed?[failed===3?'교통정보를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.':'일부 교통정보를 불러오지 못했어요. 제공된 정보만 표시합니다.']:[]};
 }
}
export function demoRoadFeed(now:number):RoadFeed{
 return {mode:'demo',status:'ready',source:'CrewTrip 협업 흐름 시연 · 실제 교통정보 아님',fetchedAt:now,
  incidents:[{id:'demo-incident',kind:'사고 안내 시연',roadName:'강릉IC 주변 · 시연',description:'사고 안내를 받은 상황을 가정했어요. 동승자가 앞길을 확인하고 쉬어 갈 곳을 제안해 보세요.',lat:37.7513,lon:128.8355,direction:null,startedAt:null,endedAt:null}],
  cameras:[{id:'demo-camera',name:'주변 CCTV · 시연',lat:37.752,lon:128.836,distanceKm:0.1,direction:null,recordedAt:null,mediaUrl:null,format:'unavailable'}],
  issues:['시연에는 실제 CCTV 영상을 연결하지 않았어요. 실제 영상은 교통정보 연결 후 확인할 수 있어요.']};
}
