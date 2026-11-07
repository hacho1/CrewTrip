import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import {AlertTriangle,ArrowRight,Check,ChevronDown,Eye,Map,MapPin,Play,RefreshCw,Route,ShieldCheck,Users,X} from 'lucide-react';
import type {Place,RoadCamera,RoadChoice,Room,Session} from '../../shared/types';
import './road.css';
import {CameraLocation} from './CameraLocation';
import {catalog} from '../../shared/types';
import {camerasNearIncident,IncidentAlerts,pointDistanceKm,type MapPoint} from '../../shared/road-map';
import './road-map.css';
const RoadMap=lazy(()=>import('./RoadMap'));
const quickAreas=[{name:'강릉IC',lat:37.7513,lon:128.8355},...catalog];

const time=(n:number|null)=>n?new Date(n).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'미제공';
const choices:Record<RoadChoice,string>={unclear:'상황을 확인하기 어려워요',rest:'쉬어 갈 곳을 찾아봐요',detour:'우회를 검토해요',continue:'현재 계획을 유지해요'};
class MapBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<p className="road-map-notice" role="status">지도를 불러오지 못했어요. 아래 교통정보 목록은 계속 사용할 수 있어요. <button className="text-link" onClick={()=>location.reload()}>화면 다시 연결</button></p>:this.props.children}
}
export function CctvPlayer({camera}:{camera:RoadCamera}){
 const ref=useRef<HTMLVideoElement>(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const video=ref.current,url=camera.mediaUrl;if(!video||!url)return;
  let cancelled=false,hls:import('hls.js').default|undefined;setError('');setReady(false);
  const fail=()=>{if(!cancelled){video.pause();hls?.stopLoad();setError('영상을 연결하지 못했어요. 제공기관의 영상 중단이나 연결 제한이 있을 수 있어요.')}};
  const loaded=()=>{setReady(true);clearTimeout(timer)};
  let lastTime=0,lastProgress=Date.now();
  const watchdog=setInterval(()=>{if(video.paused||document.hidden){lastProgress=Date.now();return}if(video.currentTime>lastTime+.05){lastTime=video.currentTime;lastProgress=Date.now()}else if(Date.now()-lastProgress>10_000){fail()}},2000);
  const timer=setTimeout(()=>{if(!cancelled){video.pause();hls?.stopLoad();setError('영상 연결이 지연되고 있어요. 다시 연결하거나 다른 CCTV를 선택해 주세요.')}},15_000);
  video.addEventListener('canplay',loaded);video.addEventListener('error',fail);
  if(camera.format==='mp4'||video.canPlayType('application/vnd.apple.mpegurl')){video.src=url;void video.play().catch(()=>{})}
  else void import('hls.js').then(({default:Hls})=>{
   if(cancelled)return;if(!Hls.isSupported()){fail();return}
   hls=new Hls({capLevelToPlayerSize:true,maxBufferLength:15,maxMaxBufferLength:30,manifestLoadingMaxRetry:1,levelLoadingMaxRetry:1,fragLoadingMaxRetry:1});
   hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)fail()});hls.on(Hls.Events.MANIFEST_PARSED,()=>{void video.play().catch(()=>{})});hls.loadSource(url);hls.attachMedia(video);
  }).catch(fail);
  return()=>{cancelled=true;clearTimeout(timer);clearInterval(watchdog);video.removeEventListener('canplay',loaded);video.removeEventListener('error',fail);hls?.destroy();video.pause();video.removeAttribute('src');video.load()};
 },[camera.id,camera.mediaUrl,camera.format,retry]);
 return <div className="cctv-player"><video ref={ref} controls muted playsInline preload="none" aria-label={`${camera.name} 교통 CCTV`} hidden={!!error}/>{error?<div className="video-failure" role="status"><Eye size={28}/><p>{error}</p><button className="secondary" onClick={()=>setRetry(x=>x+1)}>영상 다시 연결 <RefreshCw size={16}/></button></div>:<p className="player-state" role="status">{ready?'영상 연결됨 · 촬영 시각과 도로 방향을 확인해 주세요.':'영상에 연결하고 있어요…'}</p>}</div>;
}

type Props={room:Room;session:Session;vehicle:boolean;restricted:boolean;connected:boolean;busy:boolean;visible:boolean;refreshing:boolean;refresh:()=>Promise<boolean>;selected?:Place;act:(action:string,data?:unknown)=>Promise<boolean>;onSuggest:(reason:'rest'|'detour'|'schedule')=>void};
export function RoadCheck({room,session,vehicle,restricted,connected,busy,visible,refreshing,refresh,selected,act,onSuggest}:Props){
 const {area,feed,request}=room.road??{area:null,feed:null,request:null},host=session.role==='host';
 const [expanded,setExpanded]=useState(false),[editing,setEditing]=useState(false),[playing,setPlaying]=useState(false),[cameraId,setCameraId]=useState(''),[choice,setChoice]=useState<RoadChoice>('unclear'),[note,setNote]=useState(''),[clock,setClock]=useState(Date.now());
 const [label,setLabel]=useState(''),[lat,setLat]=useState(''),[lon,setLon]=useState('');
 const [mapOpen,setMapOpen]=useState(false),[incidentId,setIncidentId]=useState<string|null>(null),[watch,setWatch]=useState(false),[alerts,setAlerts]=useState<string[]>([]),[mapMessage,setMapMessage]=useState('');
 const [mapCameraIds,setMapCameraIds]=useState<string[]|null>(null);
 const alertTracker=useRef(new IncidentAlerts()),latestRefresh=useRef(refresh),latestCanAct=useRef(false),lastAutoRefresh=useRef(0);
 latestRefresh.current=refresh;
 const active=room.status==='open',canAct=active&&visible&&connected&&!restricted&&!busy;
 const demo=feed?.mode==='demo',stale=!demo&&!!feed?.fetchedAt&&clock-feed.fetchedAt>180_000;
 const pending=!!request&&!request.resolvedAt;
 const incident=feed?.incidents.find(x=>x.id===(pending?request.incidentId:incidentId))??null;
 const visibleCameras=incident?camerasNearIncident(incident,feed?.cameras??[]).map(x=>x.camera):mapCameraIds?(feed?.cameras??[]).filter(x=>mapCameraIds.includes(x.id)):(feed?.cameras??[]).slice(0,6);
 const camera=visibleCameras.find(x=>x.id===cameraId)??visibleCameras[0];
 latestCanAct.current=canAct;
 const proposals=request?room.places.filter(x=>x.roadRequestId===request.id):[];
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),30_000);return()=>clearInterval(timer)},[]);
 useEffect(()=>{setPlaying(false);setCameraId('');setNote('');setChoice('unclear');if(request&&!host)setExpanded(true)},[area?.id,request?.id,host]);
 useEffect(()=>{setIncidentId(null);setMapCameraIds(null);setWatch(false);setAlerts([]);setMapMessage('')},[area?.id,demo]);
 useEffect(()=>{
  if(!area||!feed)return;
  const fresh=alertTracker.current.observe(area.id,feed);
  if(incidentId&&!feed.incidents.some(x=>x.id===incidentId)){setIncidentId(null);setPlaying(false);setCameraId('');setMapMessage('선택했던 돌발정보가 현재 조회 목록에 없어요. 사고가 해제됐다는 뜻은 아니에요.')}
  if(!watch){setAlerts([]);return}
  setAlerts(current=>[...new Set([...current,...fresh.map(x=>x.id)])].filter(id=>feed.incidents.some(x=>x.id===id)));
 },[area?.id,feed,watch]);
 useEffect(()=>{
  if(!watch||!area||demo||!active)return;
  const refresh=()=>{
   if(document.hidden||!latestCanAct.current||Date.now()-lastAutoRefresh.current<60_000)return;
   lastAutoRefresh.current=Date.now();void latestRefresh.current();
  };
  const timer=setInterval(refresh,60_000);document.addEventListener('visibilitychange',refresh);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh)};
 },[watch,area?.id,demo,active]);
 useEffect(()=>{if(!visible||!connected||!active||restricted)setPlaying(false)},[visible,connected,active,restricted]);
 useEffect(()=>{if(cameraId&&!visibleCameras.some(x=>x.id===cameraId)){setPlaying(false);setCameraId('')}},[feed,incident?.id]);
 useEffect(()=>{const stop=()=>{if(document.hidden)setPlaying(false)};document.addEventListener('visibilitychange',stop);return()=>document.removeEventListener('visibilitychange',stop)},[]);
 const sendReport=async(next=choice)=>{if(!request)return false;return act('road-report',{requestId:request.id,choice:next,note,cameraId:camera?.id??null})};
 async function setArea(e:React.FormEvent){e.preventDefault();if(await act('road-area',{label,lat:Number(lat),lon:Number(lon)}))setEditing(false)}
 async function queryPoint(point:MapPoint,pointLabel:string){
  if(!canAct||pending)return;
  setPlaying(false);setExpanded(true);setMapMessage('');
  if(await act('road-area',{label:pointLabel,lat:Number(point.lat.toFixed(5)),lon:Number(point.lon.toFixed(5))}))await refresh();
 }
 function selectIncident(id:string){
  if(pending&&request.incidentId!==id){setMapMessage('진행 중인 앞길 확인을 마친 뒤 다른 돌발정보를 선택해 주세요.');return}
  setIncidentId(id);setMapCameraIds(null);setPlaying(false);setCameraId('');setMapMessage('');setMapOpen(true);
 }
 function selectMapCamera(id:string){
  const selectedCamera=visibleCameras.find(x=>x.id===id)??(!incident?feed?.cameras.find(x=>x.id===id):undefined);if(!selectedCamera)return;
  if(!incident)setMapCameraIds([id]);
  setCameraId(id);setExpanded(true);setPlaying(!vehicle&&!!selectedCamera.mediaUrl&&canAct);
  setTimeout(()=>document.querySelector(vehicle?'.road-driver-note':'.camera-view')?.scrollIntoView({block:'nearest',behavior:'instant'}),100);
 }
 const selectedIncidentPanel=incident?<div className="selected-incident"><h3>{incident.roadName} · {incident.kind}</h3><p>{incident.description}</p><p>이 지점에서 직선거리 5km 이내 CCTV {visibleCameras.length}곳 · 같은 도로·진행 방향이나 사고 현장 촬영 여부는 미확인</p><div className="road-actions"><button className="secondary" disabled={!canAct||!camera} onClick={()=>camera&&selectMapCamera(camera.id)}>{vehicle?'크루 의견 확인':'가까운 CCTV 보기'} <Eye size={18}/></button>{!pending&&<button className="text-link" disabled={!canAct||stale||!feed||!['ready','partial'].includes(feed.status)} onClick={()=>act('road-request',{incidentId:incident.id})}>이 돌발정보 함께 확인 <Users size={18}/></button>}</div>{!visibleCameras.length&&<p className="incident-empty">이 사고 지점 가까이에 제공된 CCTV가 없어요. 사고 정보는 확인할 수 있지만 현장 영상은 제공하지 못해요.</p>}</div>:null;
 const status=demo?'시연 상황 · 실제 사고 아님':stale?'갱신 필요':feed?.status==='unconfigured'?'연결 준비 중':feed?.status==='error'?'연결 확인 필요':feed?.status==='partial'?'일부 정보만 제공':feed?'교통정보 조회됨':'확인할 구간 지정';
 return <section className={`road-check ${demo?'road-demo':''}`} aria-label="앞길 확인">
  <div className="road-heading"><div className="road-title"><Route size={22}/><h2>앞길 확인</h2><span className="road-status">{status}</span></div>{area&&<button className="text-link road-toggle" aria-expanded={expanded} onClick={()=>{setExpanded(x=>!x);setPlaying(false)}}>{expanded?'상세 접기':vehicle?'크루 의견 보기':'CCTV·상황 보기'}<ChevronDown size={17} className={expanded?'turned':''}/></button>}</div>
  <div className="road-map-entry"><button className="text-link" disabled={restricted} aria-expanded={mapOpen} onClick={()=>{setMapOpen(x=>!x);setPlaying(false)}}><Map size={19}/>{mapOpen?'앞길 지도 접기':'앞길 지도 열기'}</button>{area&&!demo&&!vehicle&&<label className="incident-watch"><input type="checkbox" checked={watch} disabled={!canAct} onChange={e=>{setWatch(e.target.checked);lastAutoRefresh.current=Date.now()}}/>새 사고 알림 받기</label>}</div>
  {watch&&<p className="road-map-footnote">이 앞길 확인 화면을 보고 있는 동안 1분마다 조회해 새로 확인한 사고를 알려드려요. 다른 메뉴를 보는 동안에는 쉬었다가 돌아오면 이어져요. 앱을 닫은 뒤의 푸시 알림은 아니에요.{feed?.status!=='ready'&&' 지금은 정보가 불완전해 새 사고 알림을 보류하고 있어요.'}</p>}
  {alerts.length>0&&<div className="incident-alert" role="status"><div><AlertTriangle size={21}/><div><strong>새로 확인한 사고 정보 {alerts.length}건</strong><p>제공기관의 조회 결과예요. 방금 발생한 사고라는 뜻은 아니에요.</p></div></div><button className="text-link" disabled={!canAct} onClick={()=>{if(pending){setMapMessage('진행 중인 앞길 확인을 마친 뒤 새 사고를 선택해 주세요.');setMapOpen(true)}else selectIncident(alerts[0]);setAlerts([])}}>지도에서 확인 <ArrowRight size={17}/></button></div>}
  {mapOpen&&visible&&<><MapBoundary><Suspense fallback={<p className="road-help" role="status">앞길 지도를 준비하고 있어요.</p>}><RoadMap area={area} feed={feed} incidentId={incident?.id??null} cameraId={camera?.id??''} vehicle={vehicle} interactive={canAct} canQuery={canAct&&!pending&&!refreshing} pending={pending} onQuery={queryPoint} onIncident={selectIncident} onCamera={selectMapCamera} selection={selectedIncidentPanel} onCameraGroup={ids=>{if(!incident)setMapCameraIds(ids);setExpanded(true);setPlaying(false);setCameraId(ids[0]);setTimeout(()=>document.querySelector(vehicle?'.road-driver-note':'.camera-options')?.scrollIntoView({block:'nearest'}),100)}}/></Suspense></MapBoundary>
   {mapMessage&&<p className="road-map-notice" role="status">{mapMessage}</p>}
   {feed&&<div className="incident-picks"><h3>{demo?'시연 돌발정보':'조회된 사고·돌발정보'} <span className="muted">{feed.incidents.length}건</span></h3><p>사고를 선택하면 해당 지점 주변 CCTV를 가까운 순서로 보여드려요.</p>{feed.incidents.map(x=><button key={x.id} className="incident-pick" aria-pressed={incident?.id===x.id} disabled={!canAct||(pending&&request.incidentId!==x.id)} onClick={()=>selectIncident(x.id)}><span><strong>{x.roadName} · {x.kind}</strong><small>{x.description}<br/>발생 시각 {time(x.startedAt)} · 방향 {x.direction||'미제공'}</small></span><ArrowRight size={18}/></button>)}{!feed.incidents.length&&<p className="incident-empty">{feed.status==='ready'?'이번 조회에 제공된 돌발정보가 없어요. 사고가 없다는 뜻은 아니에요.':'사고 정보를 확인하지 못했어요. 연결 상태를 확인한 뒤 교통정보를 다시 조회해 주세요.'}</p>}</div>}
  </>}
  {!area?<><p className="road-intro">동승자도 지도에서 구간을 정하고 주변 상황을 확인할 수 있어요. 차량 경유지는 운전자가 정차 후 확정해요.</p><div className="road-actions"><button className="secondary" disabled={!canAct} onClick={()=>setEditing(x=>!x)}>확인 구간 지정 <MapPin size={18}/></button>{host&&<button className="text-link" disabled={!canAct} onClick={()=>act('road-demo')}>협업 흐름 시연 <ArrowRight size={17}/></button>}</div></>:<>
   <div className="road-summary"><div><h3>{request&&pending?request.summary:feed?.incidents[0]?`${feed.incidents[0].roadName} · ${feed.incidents[0].kind}`:area.label}</h3><p>{pending?`확인 요청 ${time(request.requestedAt)} · ${request.reports.length}명 의견 공유`:request?.resolvedAt?'확인을 마쳤어요. 함께 정한 계획으로 이동해요.':feed?.status==='ready'&&!feed.incidents.length?'제공된 주변 돌발정보가 없어요. 사고가 없다는 뜻은 아니에요.':feed?.issues[0]||'구간을 지정했어요. 주변 교통정보를 확인해 주세요.'}</p></div>
   <div className="road-actions">{feed&&['ready','partial'].includes(feed.status)&&!pending?<button className="primary" disabled={!canAct||stale} onClick={()=>act('road-request',(incident??feed.incidents[0])?{incidentId:(incident??feed.incidents[0]).id}:{})}>크루에게 확인 요청 <Users size={18}/></button>:pending?<span className="request-waiting"><Users size={18}/>{room.members.find(x=>x.id===request.requestedBy)?.nickname||'크루'}의 확인 요청</span>:null}{!demo&&<button className="secondary" disabled={!canAct||refreshing} onClick={refresh}>{refreshing?'교통정보 갱신 중…':'교통정보 확인'}<RefreshCw size={17}/></button>}</div></div>
   {refreshing&&<p className="road-help" role="status">교통정보를 갱신하고 있어요. 의견 작성과 투표는 계속할 수 있어요.</p>}
   <p className="road-source">{demo?'시연 데이터 · 실제 CCTV 영상 없음':`${feed?.source||'교통정보 미조회'} · 조회 시각 ${time(feed?.fetchedAt??null)}`}<span> {area.label} 기준 반경 10km · 실제 주행 경로·방향 일치 미확인</span></p>
   {pending&&request.incidentId&&!feed?.incidents.some(x=>x.id===request.incidentId)&&<p className="road-warning" role="status">확인 요청했던 돌발정보가 최신 목록에 없어요. 사고 해제 여부는 확인할 수 없어요.</p>}
   {stale&&<p className="road-warning" role="status">조회한 지 3분이 지났어요. 새로운 요청 전에 교통정보를 갱신해 주세요.</p>}
   {request&&request.reports.length>0&&<div className="road-brief"><span className="road-brief-label">크루 의견</span>{request.reports.slice(-2).map(r=><p key={r.memberId}><strong>{room.members.find(m=>m.id===r.memberId)?.nickname||'떠난 크루'}</strong><span>{choices[r.choice]}</span></p>)}</div>}
   {host&&pending&&selected&&proposals.length>0&&<div className="road-next"><p>앞길 확인 후 새 장소 {proposals.length}곳이 도착했어요.</p><button className="primary" disabled={!canAct} onClick={async()=>{if(await act('reopen')){setExpanded(false);setTimeout(()=>document.querySelector('.ballot-panel')?.scrollIntoView({block:'start'}),0)}}}>계획 변경 투표 열기 <ArrowRight size={18}/></button></div>}
   {!host&&pending&&!expanded&&<div className="road-actions road-crew-actions"><button className="secondary" disabled={!active} onClick={()=>setExpanded(true)}>앞길 확인하기 <Eye size={18}/></button><button className="text-link" disabled={!canAct} onClick={()=>{setPlaying(false);onSuggest('rest')}}>쉬어 갈 곳 제안 <MapPin size={17}/></button></div>}
   {expanded&&<div className="road-detail">
    {!vehicle&&!mapOpen&&feed?.incidents.length?<div className="road-incidents"><h3>제공된 주변 돌발정보</h3>{feed.incidents.slice(0,3).map(x=><article key={x.id}><strong>{x.roadName} · {x.kind}</strong><p>{x.description}</p><small>발생 시각 {time(x.startedAt)} · 도로 방향 {x.direction||'미제공'}</small><button className="text-link" disabled={!canAct||(pending&&request.incidentId!==x.id)} onClick={()=>selectIncident(x.id)}>지도에서 주변 CCTV 확인 <Map size={16}/></button></article>)}</div>:null}
    {!vehicle&&feed?.issues.map((issue,i)=><p className="road-help" key={i}>{issue}</p>)}
    {vehicle?<div className="road-driver-note"><ShieldCheck size={20}/><p>영상은 동승자 휴대폰에서 확인해요. 크루의 의견을 살펴보고, 정차 후 계획을 변경할 수 있어요.</p></div>:<div className="cctv-section"><div className="section-heading"><h3>{incident?'선택한 돌발정보 주변 CCTV':'주변 CCTV'}</h3><span className="muted">{visibleCameras.length}곳</span></div><p className="road-help">{incident?'선택한 사고·돌발 지점에서 직선거리 5km 이내의 카메라예요.':'조회 지점에서 가까운 카메라예요.'} 사고 현장이나 같은 진행 방향이 아닐 수 있어요.</p>{visibleCameras.length?<>
     <div className="camera-options" role="group" aria-label="CCTV 선택">{visibleCameras.map(c=><button key={c.id} className={camera?.id===c.id?'selected':''} aria-pressed={camera?.id===c.id} onClick={()=>{setCameraId(c.id);setPlaying(false)}}><span>{c.name}</span><small>{incident?'선택한 돌발 지점':'지정 지점'}에서 {(incident?pointDistanceKm(incident,c):c.distanceKm).toFixed(1)}km · 촬영 방향 {c.direction||'미제공'}</small></button>)}</div>
     {camera&&<div className="camera-view">{!mapOpen&&<CameraLocation area={area} camera={camera}/>}<p className="camera-caption">{camera.name} · 영상 파일 생성 시각 {time(camera.recordedAt)}{!camera.recordedAt&&' · 촬영 시각을 확인할 수 없어요.'}</p>{playing&&visible&&camera.mediaUrl&&connected&&active?<><CctvPlayer key={camera.id} camera={camera}/><button className="text-link" onClick={()=>setPlaying(false)}>영상 닫기 <X size={17}/></button></>:camera.mediaUrl?<button className="secondary wide" disabled={!active||!connected} onClick={()=>{setCameraId(camera.id);setPlaying(true)}}>CCTV 영상 열기 <Play size={18}/></button>:<div className="camera-empty"><Eye size={25}/><p>{demo?'시연 카메라예요. 실제 영상을 재생하지 않아요.':'현재 안전하게 연결할 수 있는 영상 주소가 없어요.'}</p></div>}<small>조회 시각은 영상 촬영 시각과 달라요. 영상 지연·중단이 있을 수 있으며, 영상만으로 사고 원인이나 해제 시점을 판단할 수 없어요.</small></div>}
    </>:<p className="camera-empty">이 구간에 제공된 CCTV가 없거나 아직 연결하지 못했어요.</p>}</div>}
    {pending&&!host&&<form className="road-report" onSubmit={async e=>{e.preventDefault();if(await sendReport()){setExpanded(false);setPlaying(false)}}}><h3>크루에게 의견 전하기</h3><p className="road-help">영상을 못 봤다면 ‘상황을 확인하기 어려워요’를 선택해도 괜찮아요.</p><fieldset><legend>다음 행동 의견</legend>{(Object.entries(choices) as [RoadChoice,string][]).map(([value,text])=><label key={value}><input type="radio" name="road-choice" value={value} checked={choice===value} onChange={()=>setChoice(value)} disabled={!canAct}/><span>{text}</span></label>)}</fieldset><p className="road-help">현재 영상은 주변 상황의 참고 자료예요. 도로·방향이나 촬영 시각이 다를 수 있어요. 선택한 의견은 사고 해제 확인을 뜻하지 않아요.</p><label>함께 전할 말 <input value={note} maxLength={140} onChange={e=>setNote(e.target.value)} placeholder="확인한 내용과 모르는 부분을 알려 주세요." disabled={!canAct}/></label><button className="primary" disabled={!canAct}>의견 공유 <Check size={18}/></button><button type="button" className="secondary" disabled={!canAct} onClick={()=>{setPlaying(false);onSuggest('rest')}}>쉬어 갈 곳 제안 <MapPin size={18}/></button></form>}
    {request&&<div className="road-reports"><h3>크루의 확인 의견</h3><p className="road-help">동승자의 의견이에요. 교통기관이 확인한 사실과 구분해 주세요.</p>{request.reports.length?<ul>{request.reports.map(r=><li key={r.memberId}><div><strong>{room.members.find(m=>m.id===r.memberId)?.nickname||'떠난 크루'}</strong><small>{time(r.createdAt)}</small></div><p>{choices[r.choice]}</p>{r.note&&<p className="muted">{r.note}</p>}</li>)}</ul>:<p className="muted">아직 공유된 의견이 없어요.</p>}
     {proposals.length>0&&<p className="road-proposal-count">앞길 확인 후 새 장소 {proposals.length}곳을 제안했어요. 아래 후보에서 함께 투표해 주세요.</p>}
     {host&&pending&&<div className="road-actions"><button className="secondary" disabled={!canAct} onClick={()=>act('road-resolve',{requestId:request.id})}>앞길 확인 마치기 <Check size={18}/></button></div>}
    </div>}
    <div className="road-area-tools"><button className="text-link" disabled={!canAct||(!host&&pending)} onClick={()=>{setLabel(area.label);setLat(String(area.lat));setLon(String(area.lon));setEditing(x=>!x)}}>확인 구간 변경 <MapPin size={16}/></button>{host&&(demo?<button className="text-link" disabled={!canAct} onClick={()=>act('road-clear')}>시연 종료 <X size={16}/></button>:<button className="text-link" disabled={!canAct} onClick={()=>act('road-demo')}>협업 흐름 시연 <ArrowRight size={16}/></button>)}</div>
   </div>}
  </>}
  {editing&&<form className="road-area-form" onSubmit={setArea}><h3>확인할 구간 지정</h3><p className="road-help">확인할 지점을 골라 주세요. 주변 정보를 조회하며 실제 내비 경로를 가져오지는 않아요.</p><label>빠른 구간 선택<select aria-label="빠른 구간 선택" disabled={!canAct} defaultValue="" onChange={e=>{const point=quickAreas.find(x=>x.name===e.target.value);if(point){setLabel(`${point.name} 주변`);setLat(String(point.lat));setLon(String(point.lon))}}}><option value="" disabled>지점을 선택해 주세요</option>{quickAreas.map(p=><option key={p.name} value={p.name}>{p.name} 주변</option>)}</select></label>{selected&&selected.lat>=33&&selected.lat<=39&&selected.lon>=124&&selected.lon<=132&&<button type="button" className="secondary" disabled={!canAct} onClick={()=>{setLabel(`${selected.name} 주변`);setLat(String(selected.lat));setLon(String(selected.lon))}}>확정한 장소 주변으로 입력</button>}<label>확인할 구간 이름<input value={label} required disabled={!canAct} maxLength={60} onChange={e=>setLabel(e.target.value)} placeholder="예: 다음에 지날 IC 주변"/></label><div className="coordinate-input"><label>구간 위도<input type="number" step="any" min="33" max="39" value={lat} required disabled={!canAct} onChange={e=>setLat(e.target.value)}/></label><label>구간 경도<input type="number" step="any" min="124" max="132" value={lon} required disabled={!canAct} onChange={e=>setLon(e.target.value)}/></label></div><p className="road-warning">구간을 바꾸면 기존 확인 요청과 의견이 초기화돼요. 제안한 장소와 여행 기록은 남아요.</p><div className="road-actions"><button className="primary" disabled={!canAct}>이 구간으로 지정 <Check size={18}/></button><button type="button" className="text-link" onClick={()=>setEditing(false)}>입력 닫기</button></div></form>}
 </section>;
}
