import {ArrowUpRight,Plus,RefreshCw} from 'lucide-react';
import type {Place,VehicleSnapshot} from '../../shared/types';

export function NavigationPanel({place,vehicle,disabled}:{place:Place;vehicle:VehicleSnapshot;disabled:boolean}){
 const bridge=window.CrewTripNative,nav=vehicle.navigation;
 const same=nav?.lat!=null&&nav.lon!=null&&Math.abs(nav.lat-place.lat)<.0001&&Math.abs(nav.lon-place.lon)<.0001;
 const busy=nav?.state==='pending'||nav?.state==='connecting';
 const current=nav?.lat==null||nav.lon==null||same||busy;
 const waypointBlocked=nav?.verificationIssue==='coordinates_unavailable';
 const labels={idle:'차량 내비에 연결해 주세요',connecting:'내비 연결 중',pending:'내비 반영 확인 중',confirmed:'요청 좌표 일치 확인',unconfirmed:'내비 반영을 확인하지 못했어요',error:'내비 연결 확인 필요'};
 const request=(waypoint:boolean)=>{if(bridge){if(waypoint)bridge.addWaypoint?.(JSON.stringify(place));else bridge.navigate(JSON.stringify(place))}};
 return <div className="navigation-result">
  <p className="nav-confirmation">여행방에서 장소 확정 완료 · 차량 내비 반영은 별도예요.</p>
  <div className="nav-state" role="status"><strong>{nav?(current?labels[nav.state]:'이번 장소의 내비 반영은 아직 미확인'):'차량 앱에서 내비 결과를 확인해 주세요.'}</strong><small>{current?vehicle.navStatus:'이전 장소의 내비 상태와 별개로, 이번 장소를 연결해 주세요.'}</small></div>
  {(nav?.state==='unconfirmed'||nav?.state==='error'||nav?.state==='idle')&&<p className="nav-help">{waypointBlocked?'경유지 위치 정보가 없어 반영을 확인할 수 없어요. 하단 앱 목록에서 내비게이션을 열어 현재 경유지를 확인해 주세요.':nav?.state==='unconfirmed'?'결과를 다시 확인해도 미확인이면 내비 준비 화면에서 지도를 확인해 주세요. 하단 앱 목록의 CrewTrip으로 돌아와 차량 내비게이션 연결을 다시 요청할 수 있어요.':'내비 준비 화면에서 지도가 표시되면 하단 앱 목록의 CrewTrip으로 돌아와 요청해 주세요. 응답이 늦으면 결과를 다시 확인해 주세요.'}</p>}
  <div className="nav-controls">
   <button className="primary" disabled={disabled||busy||!bridge} onClick={()=>request(false)}>차량 내비게이션에 연결 <ArrowUpRight size={19}/></button>
   <button className="secondary waypoint-button" disabled={disabled||busy||!bridge||waypointBlocked} onClick={()=>request(true)}>기존 경로에 경유지 추가 <Plus size={18}/></button>
   {bridge&&<><button className="text-link" disabled={disabled||busy} onClick={()=>bridge.prepareNavigation?.()}>내비 준비 화면 열기 <ArrowUpRight size={18}/></button><button className="text-link" disabled={disabled} onClick={()=>bridge.navigationInfo?.()}>연결 결과 다시 확인 <RefreshCw size={18}/></button></>}
  </div>
 </div>;
}
