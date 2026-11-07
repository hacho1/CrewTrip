import {useEffect,useRef,useState,type ReactNode} from 'react';
import L from 'leaflet';
import {AlertTriangle,Camera,LocateFixed,MapPin,Minus,Plus,RefreshCw} from 'lucide-react';
import type {RoadArea,RoadFeed} from '../../shared/types';
import {camerasNearIncident,defaultRoadPoint,isAccident,isRoadPoint,type MapPoint} from '../../shared/road-map';
import 'leaflet/dist/leaflet.css';
import './road-map.css';

type Props={
 area:RoadArea|null;feed:RoadFeed|null;incidentId:string|null;cameraId:string;
 vehicle:boolean;interactive:boolean;canQuery:boolean;pending:boolean;
 onQuery:(point:MapPoint,label:string)=>Promise<void>;
 onIncident:(id:string)=>void;onCamera:(id:string)=>void;
 onCameraGroup:(ids:string[])=>void;selection:ReactNode;
};
type LocatedPoint=MapPoint&{accuracy:number;at:number};
const pinSvg={
 incident:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.1"/></svg>',
 camera:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 5 2-2h6l2 2h4v15H3V5h4Z"/><circle cx="12" cy="12" r="4"/></svg>',
 point:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>'
};
function pin(kind:keyof typeof pinSvg,selected=false){
 return L.divIcon({className:`road-map-pin pin-${kind}${selected?' is-selected':''}`,html:pinSvg[kind],iconSize:kind==='point'?[28,28]:[48,48],iconAnchor:kind==='point'?[14,14]:[24,24]});
}
function namedMarker(point:MapPoint,kind:keyof typeof pinSvg,label:string,selected=false){
 const marker=L.marker([point.lat,point.lon],{icon:pin(kind,selected),title:label,keyboard:kind!=='point',interactive:kind!=='point',riseOnHover:kind!=='point',zIndexOffset:kind==='incident'?(selected?4000:3000):1000});
 marker.on('add',()=>marker.getElement()?.setAttribute('aria-label',label));
 const tooltip=document.createElement('span');tooltip.textContent=label;
 marker.bindTooltip(tooltip,{direction:'top',offset:[0,selected&&kind==='incident'?-24:-16],permanent:selected&&kind==='incident',className:selected&&kind==='incident'?'selected-incident-label':''});return marker;
}

export default function RoadMap(props:Props){
 const {area,feed,incidentId,cameraId,vehicle,interactive,canQuery,pending}=props;
 const host=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),tiles=useRef<L.TileLayer|null>(null),latest=useRef(props);
 latest.current=props;
 const [draft,setDraft]=useState<MapPoint>(area??defaultRoadPoint),[draftLabel,setDraftLabel]=useState(area?.label??defaultRoadPoint.label);
 const [located,setLocated]=useState<LocatedPoint|null>(null),[locating,setLocating]=useState(false),[locationMessage,setLocationMessage]=useState('');
 const [tileState,setTileState]=useState<'loading'|'ready'|'error'>('loading'),[mounted,setMounted]=useState(false);
 const [zoom,setZoom]=useState(12);
 const locationEpoch=useRef(0);
 const incident=feed?.incidents.find(x=>x.id===incidentId);
 const candidates=incident?camerasNearIncident(incident,feed?.cameras??[]).map(x=>x.camera):feed?.cameras??[];

 useEffect(()=>{
  if(!host.current)return;
  const initial=latest.current.area??defaultRoadPoint;
  const view=L.map(host.current,{zoomControl:false,attributionControl:false,scrollWheelZoom:false,minZoom:7,maxZoom:18,maxBounds:[[32.5,123],[39.7,133]],maxBoundsViscosity:.8,fadeAnimation:false,zoomAnimation:false,markerZoomAnimation:false}).setView([initial.lat,initial.lon],12);
  const layer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,keepBuffer:1,updateWhenIdle:true,referrerPolicy:'strict-origin-when-cross-origin'}).addTo(view);
  let alive=true,loaded=false,cycleLoaded=0;
  const timeout=setTimeout(()=>{if(alive&&!loaded)setTileState('error')},12_000);
  layer.on('loading',()=>{cycleLoaded=0});
  layer.on('tileload',()=>{loaded=true;cycleLoaded++;if(alive)setTileState('ready');clearTimeout(timeout)});
  layer.on('tileerror',()=>{if(alive&&!cycleLoaded)setTileState('error')});
  view.on('click',(event:L.LeafletMouseEvent)=>{
   if(!latest.current.interactive||!latest.current.canQuery)return;
   const point={lat:Number(event.latlng.lat.toFixed(5)),lon:Number(event.latlng.lng.toFixed(5))};
   if(!isRoadPoint(point)){setLocationMessage('제공 범위 안의 국내 지점을 선택해 주세요.');return}
   setDraft(point);setDraftLabel('지도에서 선택한 지점');
  });
  view.on('zoomend',()=>setZoom(view.getZoom()));
  map.current=view;tiles.current=layer;setMounted(true);
  const observer=new ResizeObserver(()=>view.invalidateSize({pan:false}));observer.observe(host.current);
  return()=>{alive=false;locationEpoch.current++;clearTimeout(timeout);observer.disconnect();layer.off();view.remove();map.current=null;tiles.current=null};
 },[]);

 useEffect(()=>{
  if(!area)return;setDraft({lat:area.lat,lon:area.lon});setDraftLabel(area.label);
  map.current?.setView([area.lat,area.lon],12,{animate:false});
 },[area?.id]);

 useEffect(()=>{
  const view=map.current;if(!view)return;
  for(const handler of [view.dragging,view.touchZoom,view.doubleClickZoom,view.boxZoom,view.keyboard])interactive?handler.enable():handler.disable();
 },[interactive,mounted]);

 useEffect(()=>{
  const view=map.current;if(!view)return;
  const group=L.layerGroup().addTo(view);
  if(area)L.circle([area.lat,area.lon],{radius:10_000,color:'#70c8e8',weight:1,dashArray:'5 7',fillOpacity:.035,interactive:false}).addTo(group);
  namedMarker(draft,'point',`${draftLabel} · 조회할 지점`).addTo(group);
  if(located){
   L.circle([located.lat,located.lon],{radius:Math.min(located.accuracy,10_000),color:'#2389d7',weight:1,fillOpacity:.08,interactive:false}).addTo(group);
   L.circleMarker([located.lat,located.lon],{radius:8,color:'#fff',weight:3,fillColor:'#2389d7',fillOpacity:1,interactive:false}).bindTooltip('휴대폰에서 받은 내 위치').addTo(group);
  }
  for(const item of feed?.incidents??[]){
   const label=`${item.roadName} · ${item.kind} 위치`;
   const marker=namedMarker(item,'incident',label,item.id===incidentId).addTo(group);
   if(!isAccident(item))marker.getElement()?.classList.add('pin-other');
   marker.on('click',()=>{if(latest.current.interactive)latest.current.onIncident(item.id)});
  }
  const groups:{cameras:typeof candidates;point:L.Point}[]=[];
  for(const camera of candidates){
   const point=view.latLngToContainerPoint([camera.lat,camera.lon]);
   const existing=groups.find(item=>item.point.distanceTo(point)<56);
   if(existing)existing.cameras.push(camera);else groups.push({cameras:[camera],point});
  }
  for(const item of groups){
   const members=item.cameras,first=members[0],center={lat:members.reduce((sum,c)=>sum+c.lat,0)/members.length,lon:members.reduce((sum,c)=>sum+c.lon,0)/members.length};
   const nearIncident=(feed?.incidents??[]).some(event=>view.latLngToContainerPoint([event.lat,event.lon]).distanceTo(view.latLngToContainerPoint([center.lat,center.lon]))<56);
   const label=members.length>1?`겹친 CCTV ${members.length}곳 목록 보기`:`${first.name} CCTV 보기`;
   const selected=members.some(c=>c.id===cameraId),offset=members.length>1||nearIncident;
   const icon=L.divIcon({className:`road-map-pin pin-camera${offset?' camera-callout':''}${selected?' is-selected':''}`,html:pinSvg.camera+(members.length>1?`<span class="camera-group-count">${members.length}</span>`:''),iconSize:[48,48],iconAnchor:offset?[24,-24]:[24,24]});
   const marker=L.marker([center.lat,center.lon],{icon,title:label,keyboard:true,zIndexOffset:1500,riseOnHover:true}).addTo(group);
   marker.getElement()?.setAttribute('aria-label',label);
   marker.getElement()?.setAttribute('data-camera-ids',members.map(c=>c.id).join(' '));
   const tooltip=document.createElement('span');tooltip.textContent=label;marker.bindTooltip(tooltip,{direction:'top',offset:[0,offset?24:-20]});
   marker.on('click',()=>{if(!latest.current.interactive)return;if(members.length>1)latest.current.onCameraGroup(members.map(c=>c.id));else latest.current.onCamera(first.id)});
  }
  return()=>{group.remove()};
 },[mounted,area,feed,draft,draftLabel,located,incidentId,cameraId,zoom]);

 useEffect(()=>{
  if(!incident||!map.current)return;
  const points:L.LatLngExpression[]=[[incident.lat,incident.lon],...candidates.map(c=>[c.lat,c.lon] as L.LatLngTuple)];
  map.current.fitBounds(L.latLngBounds(points),{padding:[72,72],maxZoom:15,animate:false});
 },[mounted,incidentId]);

 async function locate(){
  if(!interactive||vehicle)return;
  if(!window.isSecureContext){setLocationMessage('현재 위치는 HTTPS 연결에서 사용할 수 있어요. 지금은 지도를 눌러 조회할 지점을 선택해 주세요.');return}
  if(!navigator.geolocation){setLocationMessage('이 브라우저에서 위치를 받을 수 없어요. 지도에서 지점을 선택해 주세요.');return}
  const epoch=++locationEpoch.current;setLocating(true);setLocationMessage('현재 위치를 확인하고 있어요.');
  navigator.geolocation.getCurrentPosition(position=>{
   if(epoch!==locationEpoch.current)return;setLocating(false);
   const point={lat:position.coords.latitude,lon:position.coords.longitude};
   if(!isRoadPoint(point)){setLocationMessage('현재 위치가 교통정보 제공 범위를 벗어났어요. 국내 지점을 지도에서 선택해 주세요.');return}
   if(Date.now()-position.timestamp>120_000||!Number.isFinite(position.coords.accuracy)){setLocationMessage('새 위치를 확인하지 못했어요. 다시 요청하거나 지도에서 선택해 주세요.');return}
   setLocated({...point,accuracy:position.coords.accuracy,at:position.timestamp});setDraft(point);setDraftLabel('내 위치 주변');
   setLocationMessage(`위치를 받았어요. 오차 약 ${Math.round(position.coords.accuracy).toLocaleString('ko-KR')}m · 아래 버튼을 누르면 이 지점을 크루와 공유해 조회해요.`);
   map.current?.setView([point.lat,point.lon],13,{animate:false});
  },error=>{
   if(epoch!==locationEpoch.current)return;setLocating(false);
   setLocationMessage(error.code===1?'위치 권한이 허용되지 않았어요. 브라우저 권한을 바꾸거나 지도에서 선택해 주세요.':error.code===3?'위치 확인 시간이 지났어요. 다시 요청하거나 지도에서 선택해 주세요.':'현재 위치를 받지 못했어요. 지도를 눌러 조회할 지점을 선택해 주세요.');
  },{enableHighAccuracy:true,timeout:12_000,maximumAge:30_000});
 }

 return <section className="road-map" aria-label="앞길 지도">
  <div className="road-map-title"><div><h3>사고 위치에서, 주변 영상까지.</h3><p>{feed?.mode==='demo'?'시연 표식 · 실제 사고·영상 아님':area?`${area.label} · 반경 10km 조회`:'지점을 선택하고 주변 교통정보를 확인해요.'}</p></div><MapPin size={21} aria-hidden="true"/></div>
  <div className="road-map-tools">{!vehicle&&<button className="secondary" disabled={!interactive||locating} onClick={locate}><LocateFixed size={18}/>{locating?'위치 확인 중…':'내 위치 찾기'}</button>}<span>{located?`내 위치 수신 ${new Date(located.at).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}`:vehicle?'차량 GPS 위치가 아닌 조회 지점이에요.':'내 위치는 위치 찾기를 눌렀을 때만 받아요.'}</span></div>
  {locationMessage&&<p className="road-map-notice" role="status">{locationMessage}</p>}
  <div className="road-map-frame" aria-disabled={!interactive}>
   <div ref={host} className="road-map-canvas" aria-label="사고와 CCTV 도로 지도"/>
   {tileState==='loading'&&<p className="road-map-load" role="status">도로 지도를 불러오고 있어요.</p>}
   {tileState==='error'&&<div className="road-map-failure" role="status"><p>도로 지도를 연결하지 못했어요. 아래 돌발정보와 CCTV 목록은 계속 확인할 수 있어요.</p><button className="secondary" disabled={!interactive} onClick={()=>{setTileState('loading');tiles.current?.redraw()}}>지도 다시 연결 <RefreshCw size={17}/></button></div>}
  </div>
  <div className="road-map-credit">
   <div className="road-map-attribution">
    <span>지도 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> 기여자</span>
    <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">지도 오류 알리기</a>
   </div>
   <div className="road-map-zoom" role="group" aria-label="지도 크기 조절">
    <button className="icon-button" aria-label="지도 확대" disabled={!interactive} onClick={()=>map.current?.zoomIn()}><Plus size={20}/></button>
    <button className="icon-button" aria-label="지도 축소" disabled={!interactive} onClick={()=>map.current?.zoomOut()}><Minus size={20}/></button>
   </div>
  </div>
  <div className="road-map-legend"><span><i className="map-legend-location"/>내 위치</span><span><AlertTriangle className="legend-accident" size={14}/>사고</span><span><AlertTriangle className="legend-other" size={14}/>공사·돌발</span><span><Camera size={14}/>CCTV</span><span><LocateFixed size={14}/>조회 지점</span></div>
  {props.selection}
  <div className="road-map-query"><div><strong>{draftLabel}</strong><span>{draft.lat.toFixed(5)}, {draft.lon.toFixed(5)}</span></div><button className="primary" disabled={!canQuery||locating} onClick={()=>props.onQuery(draft,draftLabel)}>이 위치 주변 조회 <RefreshCw size={17}/></button></div>
  <p className="road-map-footnote">{pending?'진행 중인 앞길 확인을 마친 뒤 조회 지점을 바꿀 수 있어요.':'지도를 누르면 조회 지점을 바꿀 수 있어요. 조회한 지점은 같은 여행방에 공유돼요.'} 도로 지도는 실제 내비 경로와 연결되지 않았어요.</p>
 </section>;
}
