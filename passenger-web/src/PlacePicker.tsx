import {useEffect,useRef,useState} from 'react';
import type L from 'leaflet';
import {MapPin,Minus,Plus,RefreshCw} from 'lucide-react';
import {defaultRoadPoint,isRoadPoint,type MapPoint} from '../../shared/road-map';
import 'leaflet/dist/leaflet.css';
import './place-picker.css';

type Props={initialCenter:MapPoint;initialLabel:string;point:MapPoint|null;disabled:boolean;onChange:(point:MapPoint)=>void};

export function PlacePicker(props:Props){
 const host=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),marker=useRef<L.CircleMarker|null>(null),library=useRef<typeof L|null>(null),latest=useRef(props);
 latest.current=props;
 const [ready,setReady]=useState(false),[state,setState]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0),[message,setMessage]=useState('');
 function choose(lat:number,lon:number){
  if(latest.current.disabled)return;
  const point={lat:Number(lat.toFixed(5)),lon:Number(lon.toFixed(5))};
  if(!isRoadPoint(point)){setMessage('국내 지도에서 제안할 장소를 선택해 주세요.');return}
  setMessage('');latest.current.onChange(point);
 }
 function showSelection(){
  const view=map.current,leaflet=library.current,point=latest.current.point;if(!view||!leaflet)return;
  if(point){
   const position:[number,number]=[point.lat,point.lon];
   if(marker.current)marker.current.setLatLng(position);
   else marker.current=leaflet.circleMarker(position,{radius:10,color:'#082a35',weight:3,fillColor:'#70c8e8',fillOpacity:1,interactive:false}).addTo(view);
  }else{marker.current?.remove();marker.current=null}
 }
 useEffect(()=>{
  let alive=true,view:L.Map|undefined,resize:ResizeObserver|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  setReady(false);setState('loading');
  void import('leaflet').then(({default:leaflet})=>{
   if(!alive||!host.current)return;
   library.current=leaflet;
   const seed=latest.current.point??(isRoadPoint(latest.current.initialCenter)?latest.current.initialCenter:defaultRoadPoint);
   view=leaflet.map(host.current,{zoomControl:false,attributionControl:false,scrollWheelZoom:false,minZoom:7,maxZoom:18,maxBounds:[[32.5,123],[39.7,133]],maxBoundsViscosity:.8,fadeAnimation:false,zoomAnimation:false,markerZoomAnimation:false}).setView([seed.lat,seed.lon],13);
   map.current=view;
   showSelection();
   const layer=leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,keepBuffer:1,referrerPolicy:'strict-origin-when-cross-origin'}).addTo(view);
   let loaded=false;
   timer=setTimeout(()=>{if(alive&&!loaded)setState('error')},12_000);
   layer.on('tileload',()=>{loaded=true;if(alive)setState('ready');clearTimeout(timer)});
   layer.on('tileerror',()=>{if(alive&&!loaded)setState('error')});
   view.on('click',(event:L.LeafletMouseEvent)=>choose(event.latlng.lat,event.latlng.lng));
   resize=new ResizeObserver(()=>view?.invalidateSize({pan:false}));resize.observe(host.current);
   setReady(true);
  }).catch(()=>{if(alive)setState('error')});
  return()=>{alive=false;clearTimeout(timer);resize?.disconnect();view?.remove();map.current=null;marker.current=null;library.current=null};
 },[retry]);
 useEffect(()=>{
  if(ready)showSelection();
 },[props.point,ready]);
 useEffect(()=>{
  const view=map.current;if(!view||!ready)return;
  for(const handler of [view.dragging,view.keyboard,view.touchZoom,view.doubleClickZoom])props.disabled?handler.disable():handler.enable();
 },[props.disabled,ready]);
 return <fieldset className="place-picker" disabled={props.disabled}>
  <legend>장소 위치</legend>
  <p id="place-picker-help">지도를 눌러 위치를 골라 주세요. 방향키로 지도를 움직인 뒤 가운데를 선택해도 돼요.</p>
  <p className="place-picker-origin">처음 표시한 곳: {props.initialLabel} · 현재 위치를 추적하지 않아요.</p>
  <div className="place-picker-frame" aria-disabled={props.disabled}>
   <div ref={host} className="place-picker-canvas" role="region" aria-label="장소 위치 지도" aria-describedby="place-picker-help" tabIndex={props.disabled?-1:0}/>
   <span className="place-picker-center" aria-hidden="true"/>
   <div className="place-picker-zoom"><button type="button" className="icon-button" aria-label="장소 지도 확대" disabled={!ready||props.disabled} onClick={()=>map.current?.zoomIn()}><Plus size={20}/></button><button type="button" className="icon-button" aria-label="장소 지도 축소" disabled={!ready||props.disabled} onClick={()=>map.current?.zoomOut()}><Minus size={20}/></button></div>
  </div>
  <div className="place-picker-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">지도 © OpenStreetMap 기여자</a></div>
  {state==='loading'&&<p role="status">장소 지도를 불러오고 있어요…</p>}
  {state==='error'&&<div className="place-picker-error" role="status"><p>지도를 불러오지 못했어요. 연결을 확인하고 다시 시도하거나 예시 장소를 골라 주세요.</p><button type="button" className="text-link" onClick={()=>setRetry(x=>x+1)}>장소 지도 다시 연결 <RefreshCw size={16}/></button></div>}
  <button type="button" className="secondary wide" disabled={!ready||props.disabled} onClick={()=>{const center=map.current?.getCenter();if(center)choose(center.lat,center.lng)}}><MapPin size={18}/>지도 가운데를 장소로 선택</button>
  <p className="place-picker-selection" role="status">{message|| (props.point?'장소 위치를 선택했어요. 이름과 지도 위 표시를 확인한 뒤 제안해 주세요.':'아직 장소 위치를 선택하지 않았어요.')}</p>
 </fieldset>;
}
