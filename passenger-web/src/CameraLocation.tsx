import type {RoadArea,RoadCamera} from '../../shared/types';

/** Local equirectangular position comparison, not road geometry or a route. */
export function CameraLocation({area,camera}:{area:RoadArea;camera:RoadCamera}){
 const east=(camera.lon-area.lon)*111.32*Math.cos(area.lat*Math.PI/180),north=(camera.lat-area.lat)*111.32;
 const scale=65/Math.max(Math.abs(east),Math.abs(north),.2),x=150+east*scale,y=90-north*scale;
 const direction=`${north>=0?'북':'남'}쪽 ${Math.abs(north).toFixed(1)}km, ${east>=0?'동':'서'}쪽 ${Math.abs(east).toFixed(1)}km`;
 return <figure className="camera-location"><figcaption><strong>선택 지점과 CCTV 위치</strong><span>위치 비교 · 도로 지도 아님</span></figcaption>
  <svg viewBox="0 0 300 180" role="img" aria-label={`${area.label}에서 ${camera.name}까지 ${direction}. 도로 연결과 진행 방향은 미확인입니다.`}>
   <text x="12" y="20">북쪽 ↑</text><line x1="150" y1="90" x2={x} y2={y}/><circle className="area-point" cx="150" cy="90" r="7"/><circle className="camera-point" cx={x} cy={y} r="7"/>
  </svg><div className="location-legend"><span><i className="area-point"/>지정 지점 · {area.label}</span><span><i className="camera-point"/>CCTV · {camera.name}</span></div>
  <p>지정 지점에서 {direction}. 거리가 가까워도 같은 도로·진행 방향인지는 확인되지 않았어요.</p>
 </figure>;
}
