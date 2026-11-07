import {createApp} from './app';
import {existsSync} from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');
const {http}=createApp();
const port=Number(process.env.PORT||4310);
http.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`CrewTrip http://127.0.0.1:${port}/vehicle · 모바일 초대는 차량 화면 QR 사용`));
