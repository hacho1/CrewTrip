export type Role='host'|'passenger';
export type Member={id:string;nickname:string;role:Role};
export type Place={id:string;name:string;description:string;category:string;lat:number;lon:number;proposerId:string;votes:string[];roadRequestId?:string;roadAreaLabel?:string;roadReason?:'rest'|'detour'|'schedule'};
export type RoadArea={id:string;label:string;lat:number;lon:number};
export type RoadIncident={id:string;kind:string;roadName:string;description:string;lat:number;lon:number;direction:string|null;startedAt:number|null;endedAt:number|null};
export type RoadCamera={id:string;name:string;lat:number;lon:number;distanceKm:number;direction:string|null;recordedAt:number|null;mediaUrl:string|null;format:'hls'|'mp4'|'unavailable'};
export type RoadFeed={mode:'live'|'demo';status:'ready'|'partial'|'error'|'unconfigured';source:string;fetchedAt:number|null;incidents:RoadIncident[];cameras:RoadCamera[];issues:string[]};
export type RoadChoice='rest'|'detour'|'continue'|'unclear';
export type RoadReport={memberId:string;choice:RoadChoice;note:string;cameraId:string|null;createdAt:number};
export type RoadRequest={id:string;requestedAt:number;requestedBy:string;incidentId:string|null;summary:string;mode:'live'|'demo';reports:RoadReport[];resolvedAt:number|null};
export type RoadState={area:RoadArea|null;feed:RoadFeed|null;request:RoadRequest|null};
export type Room={id:string;title:string;createdAt:number;expiresAt:number;status:'open'|'closed';members:Member[];places:Place[];confirmedId:string|null;history:{placeId:string;name:string;confirmedAt:number;roadRequestId?:string;roadAreaLabel?:string;roadCaution?:string}[];road:RoadState;revision:number};
export type Session={roomId:string;memberId:string;token:string;role:Role;inviteToken?:string};
export type VehicleReading={key:string;title:string;state:'available'|'unsupported'|'error'|'unknown'|'permission';value:string|null;unit:string;source:string;updatedAt:number|null;severity:'info'|'warning'|'critical';detail:string;rawDetail?:string};
export type VehicleSnapshot={readings:VehicleReading[];restricted:boolean;restrictionReason:string;source:string;navStatus:string;navigation?:{state:'idle'|'connecting'|'pending'|'confirmed'|'unconfirmed'|'error';targetName:string|null;lat:number|null;lon:number|null;waypoint:boolean;confirmedAt:number|null;verificationIssue?:'coordinates_unavailable'|null}};
export const catalog=[
 {name:'안목해변',description:'바다를 보며 잠깐 쉬어 가기',category:'바다',lat:37.7712,lon:128.9487},
 {name:'경포호',description:'호숫가를 따라 천천히 산책',category:'산책',lat:37.7951,lon:128.8973},
 {name:'주문진해변',description:'탁 트인 동해와 해변 산책',category:'바다',lat:37.9118,lon:128.8199},
 {name:'강릉 중앙시장',description:'여행 중 함께 고르는 한 끼',category:'먹거리',lat:37.7546,lon:128.8980}
];
