import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import {z} from 'zod';
import {resolve} from 'node:path';
import {networkInterfaces} from 'node:os';
import {ApiError,RoomStore} from './store';
import {TrafficService} from './traffic';
import type {RoadArea} from '../../shared/types';

type RoadRefresh = {roomId:string;memberId:string;token:string;area:RoadArea};
export function createApp(store=new RoomStore(),traffic=new TrafficService()){
 const app=express(),http=createServer(app);
 const io=new Server(http,{maxHttpBufferSize:8192,serveClient:false});
 app.disable('x-powered-by');
 app.use(helmet({referrerPolicy:{policy:'strict-origin-when-cross-origin'},contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','https://tile.openstreetmap.org'],connectSrc:["'self'",'ws:','wss:','https:'],mediaSrc:["'self'",'https:','blob:'],workerSrc:["'self'",'blob:'],fontSrc:["'self'"],upgradeInsecureRequests:null}},hsts:false}));
 app.use(express.json({limit:'8kb'}));
 app.use('/api',rateLimit({windowMs:60_000,limit:180,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'요청이 많아요. 잠시 후 다시 시도해 주세요.'}}));
 const strict=rateLimit({windowMs:60_000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'잠시 후 다시 참여해 주세요.'}});
 const name=z.string().trim().min(1).max(24);
 const place=z.object({name:z.string().trim().min(1).max(60),description:z.string().trim().max(140),category:z.string().trim().min(1).max(12),lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),roadRequestId:z.string().length(20).optional(),roadReason:z.enum(['rest','detour','schedule']).optional()}).strict().refine(x=>!x.roadReason||!!x.roadRequestId);
 const roadBodies={
  'road-area':z.object({label:z.string().trim().min(1).max(60),lat:z.number().min(33).max(39),lon:z.number().min(124).max(132)}).strict(),
  'road-request':z.object({incidentId:z.string().min(1).max(40).optional()}).strict(),
  'road-report':z.object({requestId:z.string().length(20),choice:z.enum(['rest','detour','continue','unclear']),note:z.string().trim().max(140),cameraId:z.string().max(40).nullable().optional()}).strict(),
  'road-resolve':z.object({requestId:z.string().length(20)}).strict()
 };
 const secret=(req:express.Request)=>{const h=req.headers.authorization;if(!h?.startsWith('Bearer '))throw new ApiError(401,'참여가 필요해요.');return h.slice(7);};
 const notify=(roomId:string)=>{const s=store.rooms.get(roomId);if(s)io.to(roomId).emit('room',store.view(s.room));};
 app.get('/api/health',(_req,res)=>res.json({ok:true,service:'CrewTrip'}));
 app.get('/api/config',(_req,res)=>{
  const ips=Object.values(networkInterfaces()).flat().filter(x=>x?.family==='IPv4'&&!x.internal).map(x=>x!.address).filter(x=>/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x));
  res.json({publicOrigin:process.env.PUBLIC_ORIGIN||`http://${ips[0]||'127.0.0.1'}:${process.env.PORT||4310}`,retentionHours:12});
 });
 app.post('/api/rooms',strict,(req,res)=>{const b=z.object({title:z.string().trim().min(1).max(40),nickname:name}).strict().parse(req.body);res.status(201).json(store.create(b.title,b.nickname));});
 app.post('/api/rooms/:id/join',strict,(req,res)=>{const b=z.object({nickname:name,inviteToken:z.string().min(40).max(60)}).strict().parse(req.body);const r=store.join(String(req.params.id),b.inviteToken,b.nickname);notify(String(req.params.id));res.status(201).json(r);});
 app.get('/api/rooms/:id',(req,res)=>{const {stored}=store.auth(String(req.params.id),secret(req));res.json(store.view(stored.room));});
 const roadLimit = rateLimit({
  windowMs:60_000,
  limit:6,
  standardHeaders:'draft-8',
  legacyHeaders:false,
  keyGenerator:(_req,res)=>{
   const {roomId,memberId}: RoadRefresh = res.locals.roadRefresh;
   return `${roomId}:${memberId}`;
  },
  message:{error:'교통정보는 잠시 후 다시 확인해 주세요.'}
 });
 app.post('/api/rooms/:id/road/refresh',(req,res,next)=>{
  z.object({}).strict().parse(req.body);
  const roomId = String(req.params.id);
  const token = secret(req);
  const {stored,member} = store.auth(roomId,token);
  store.open(stored.room);
  const {area,feed} = stored.room.road;
  if (!area) throw new ApiError(409,'먼저 확인할 구간을 지정해 주세요.');
  if (feed?.mode === 'demo') throw new ApiError(409,'시연을 종료한 뒤 실제 구간을 지정해 주세요.');
  res.locals.roadRefresh = {roomId,memberId:member.id,token,area} satisfies RoadRefresh;
  next();
 },roadLimit,async(_req,res)=>{
  const {roomId,token,area}: RoadRefresh = res.locals.roadRefresh;
  const feed = await traffic.read({...area});
  const room = store.setRoadFeed(roomId,token,area.id,feed);
  notify(roomId);
  res.json(room);
 });
 app.post('/api/rooms/:id/:action',(req,res)=>{
  const a=String(req.params.action),rid=String(req.params.id);const roadSchema=roadBodies[a as keyof typeof roadBodies];const body=a==='suggest'?place.parse(req.body):roadSchema?roadSchema.parse(req.body):['vote','confirm'].includes(a)?z.object({placeId:z.string().length(20)}).strict().parse(req.body):z.object({}).strict().parse(req.body);
  const key=secret(req);const room=store.mutate(rid,key,a,body);notify(rid);
  if(a==='leave')for(const socket of io.sockets.sockets.values())if(socket.data.token===key)socket.disconnect(true);
  res.json(room);
 });
 io.use((socket,next)=>{try{const {roomId,token}=socket.handshake.auth; if(typeof roomId!=='string'||typeof token!=='string'||token.length>60)throw new Error();store.auth(roomId,token);if([...io.sockets.sockets.values()].filter(s=>s.data.token===token).length>=4)throw new Error();socket.data={roomId,token};next();}catch{next(new Error('여행방 연결 권한이 없거나 연결 수를 초과했어요.'));}});
 io.on('connection',socket=>{const {roomId,token}=socket.data;socket.join(roomId);try{socket.emit('room',store.view(store.auth(roomId,token).stored.room));}catch{socket.disconnect(true);}});
 const sweep=setInterval(()=>{for(const socket of io.sockets.sockets.values()){try{store.auth(socket.data.roomId,socket.data.token);}catch{socket.emit('expired');socket.disconnect(true);}}store.sweep();},15_000);sweep.unref();
 app.use('/api',(_req,res)=>res.status(404).json({error:'요청을 찾을 수 없어요.'}));
 app.use(express.static(resolve('dist'),{index:false}));
 app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));
 app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(err instanceof z.ZodError)return res.status(400).json({error:'입력 내용을 확인해 주세요.',fields:err.issues.map(x=>x.path.join('.'))});
  if(err instanceof ApiError)return res.status(err.status).json({error:err.message});
  res.status(err.status===400?400:500).json({error:'요청을 처리하지 못했어요. 다시 시도해 주세요.'});
 });
 return {app,http,io,store,dispose:()=>{clearInterval(sweep);io.close();}};
}
