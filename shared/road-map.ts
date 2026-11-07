import type {RoadCamera,RoadFeed,RoadIncident} from './types';

export type MapPoint={lat:number;lon:number};
export const defaultRoadPoint={lat:37.7513,lon:128.8355,label:'강릉IC 주변'};
export function isRoadPoint(point:MapPoint){
 return Number.isFinite(point.lat)&&Number.isFinite(point.lon)&&point.lat>=33&&point.lat<=39&&point.lon>=124&&point.lon<=132;
}
export function pointDistanceKm(a:MapPoint,b:MapPoint){
 const rad=Math.PI/180,h=Math.sin((b.lat-a.lat)*rad/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lon-a.lon)*rad/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export const isAccident=(incident:RoadIncident)=>/사고/.test(incident.kind);
export function camerasNearIncident(incident:MapPoint,cameras:RoadCamera[]){
 return cameras.map(camera=>({camera,distanceKm:pointDistanceKm(incident,camera)})).filter(x=>x.distanceKm<=5).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,6);
}
// A failed/partial incident feed must not erase the baseline and turn old reports
// into new alerts on the next successful query. Baselines are scoped by area ID.
export class IncidentAlerts{
 private areaId='';
 private seen=new Set<string>();
 observe(areaId:string,feed:RoadFeed):RoadIncident[]{
  if(this.areaId!==areaId){this.areaId=areaId;this.seen.clear()}
  if(feed.mode!=='live'||feed.status!=='ready')return [];
  const accidents=feed.incidents.filter(isAccident),fresh=accidents.filter(x=>!this.seen.has(x.id));
  for(const incident of accidents)this.seen.add(incident.id);
  return fresh;
 }
}
