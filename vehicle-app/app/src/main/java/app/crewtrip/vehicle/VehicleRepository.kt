package app.crewtrip.vehicle

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.constant.telltale.TelltaleState
import org.json.JSONArray
import org.json.JSONObject

/** Vehicle results remain in-process and never enter the room API. */
class VehicleRepository(context: Context, private val changed: () -> Unit, private val gearChanged: (Boolean) -> Unit) {
 private val handler = Handler(Looper.getMainLooper())
 private val sdk = Vehicle(context)
 private val rows = java.util.concurrent.ConcurrentHashMap<String, JSONObject>()
 private val worker=java.util.concurrent.Executors.newSingleThreadExecutor()
 private val refreshing=java.util.concurrent.atomic.AtomicBoolean(false)
 @Volatile private var active = false
 @Volatile private var generation = 0
 @Volatile private var gearAt = 0L
 private val gearListener=object:ai.pleos.playground.vehicle.listener.GearSelectionListener{
  override fun onSelected(gear:ai.pleos.playground.vehicle.constant.control.VehicleGear?){handler.post{if(active){gearAt=System.currentTimeMillis();gearChanged(gear==ai.pleos.playground.vehicle.constant.control.VehicleGear.GEAR_PARK)}}}
  override fun onFailed(e:Exception){handler.post{if(active)gearChanged(false)}}
 }
 private val titles = mapOf("telltales" to "차량 알림", "tire" to "타이어 저압 주의 기준", "soc" to "배터리 충전 상태", "charge" to "충전 스위치 상태")
 init { titles.forEach { (key,title) -> rows[key] = row(key,title,"unknown",null,"", "아직 조회되지 않았어요.") } }
 private fun row(key:String,title:String,state:String,value:Any?,unit:String,detail:String,severity:String="info") = JSONObject().put("key",key).put("title",title).put("state",state).put("value",value?.toString() ?: JSONObject.NULL).put("unit",unit).put("detail",detail).put("severity",severity).put("source","Pleos Vehicle 2.3.2 · 에뮬레이터").put("updatedAt", if(state=="available") System.currentTimeMillis() else JSONObject.NULL)
 private fun set(key:String,state:String,value:Any?=null,unit:String="",detail:String,severity:String="info",rawDetail:String="") { handler.post { if(!active)return@post;rows[key] = row(key,titles[key]?:key,state,value,unit,detail,severity).put("rawDetail",rawDetail);Log.i("CrewTripSDK", "$key $state value=$value severity=$severity");changed() } }
 private fun fail(key:String,e:Exception){handler.post {
  if(!active)return@post
  val affected=if(key=="telltales") rows.keys.filter{it==key||it.startsWith("telltale_")}.toList() else listOf(key)
  affected.forEach{k->val previous=rows[k];val state=if(e is SecurityException||e.message?.contains("permission",true)==true)"permission" else "error"
   rows[k]=row(k,previous?.optString("title")?:titles[k]?:k,state,previous?.opt("value")?.takeUnless{it==JSONObject.NULL},previous?.optString("unit")?:"", if(state=="permission") "이 정보를 확인할 권한이 필요해요. 허용 범위를 확인한 뒤 다시 시도해 주세요." else "차량 정보 연결을 확인해 주세요. 이전 값이 있다면 현재 상태가 아니에요.",previous?.optString("severity")?:"info").put("updatedAt",previous?.opt("updatedAt")?:JSONObject.NULL).put("rawDetail","${e.javaClass.simpleName}: ${e.message?.take(180)}")
  };Log.w("CrewTripSDK","$key query failed",e);changed()
 }}
 private fun readable(access:AccessType)=access==AccessType.READ||access==AccessType.READ_WRITE
 fun start(){if(active)return;active=true;worker.execute{try{sdk.initialize();sdk.getGear().registerGearSelection(gearListener)}catch(e:Exception){titles.keys.forEach{fail(it,e)}};handler.post{if(active)handler.postDelayed(poll,1500)}}}
 private val poll=object:Runnable{override fun run(){if(!active)return;refresh();handler.postDelayed(this,4000)}}
 fun refresh(force:Boolean=false){if(!active||!refreshing.compareAndSet(false,true))return;worker.execute{try{refreshSdk(force)}finally{refreshing.set(false)}}}
 private fun refreshSdk(force:Boolean){if(!active)return;val current=++generation
  try{
   sdk.getGear().getCurrentGearSelectionState(onComplete={gear->handler.post{if(active){gearAt=System.currentTimeMillis();gearChanged(gear==ai.pleos.playground.vehicle.constant.control.VehicleGear.GEAR_PARK)}}},onFailed={handler.post{if(active)gearChanged(false)}})
   if(force||rows["telltales"]?.optString("state")!="permission")sdk.getSafety().checkTelltalesCapabilities(onComplete={config->
    if(!readable(config.accessType))set("telltales","unsupported",detail="이 차량은 알림 조회를 지원하지 않아요.")
    else sdk.getSafety().getTelltalesInfo(onComplete={data->
     val on=data.telltales.filter{it.state!=TelltaleState.OFF}
     set("telltales","available",if(on.isEmpty())"활성 알림 없음" else "${on.size}개 알림","",if(on.isEmpty())"조회된 경고등 중 켜진 알림이 없어요. 전체 차량의 정상 판정을 의미하지 않아요." else "확인된 차량 알림을 아래에 모두 표시했어요. 차량의 공식 안내를 함께 확인해 주세요.")
     handler.post{if(active){rows.keys.filter{it.startsWith("telltale_")}.toList().forEach{rows.remove(it)};on.forEach{item->
      val code=item.type.name
      val title=mapOf("TPMS" to "타이어 관련 주의", "ABS" to "제동 장치 관련 주의", "SEAT_BELT" to "안전벨트 확인", "DOOR_OPEN" to "도어 열림 알림", "PARKING_BRAKE" to "주차 브레이크 알림", "ENGINE_OIL_PRESSURE" to "엔진 오일 관련 주의", "ENGINE_TEMPERATURE" to "엔진 온도 관련 주의", "EV_SYSTEM" to "전기차 시스템 주의")[code]?:"차량 알림"
      val info=setOf("PARKING_BRAKE","ELECTRONIC_PARKING_BRAKE","TURN_SIGNAL_LEFT","TURN_SIGNAL_RIGHT","HEADLAMP_LOW","HEADLAMP_HIGH","POSITION_LAMP","AUTO_HOLD","AUTO_HIGH_BEAM").contains(code)
      rows["telltale_$code"]=row("telltale_$code",title,"available",if(item.state==TelltaleState.BLINK)"깜박임" else "켜짐","",if(info)"해당 차량 표시등이 켜져 있어요. 차량 화면의 안내를 함께 확인해 주세요." else "관련 주의 정보가 확인되었어요. 출발하기 전 차량의 공식 안내와 해당 상태를 확인해 주세요.",if(info)"info" else "warning").put("rawDetail","type=$code, state=${item.state.name}, color=${item.color}, priority=${item.priority}, warningCount=${item.warningCount}")
     };changed()}}
    },onFailed={fail("telltales",it)})
   },onFailed={fail("telltales",it)})
   sdk.getTire().checkLowTirePressureCapabilities(onComplete={config,areas->
    if(!readable(config.accessType)||areas.isEmpty())set("tire","unsupported",detail="타이어 기준 정보가 지원되지 않아요. 미지원은 정상 상태를 의미하지 않아요.")
    else {val values=java.util.concurrent.ConcurrentHashMap<String,Float>();areas.forEach{area->sdk.getTire().getLowTirePressure(area,onComplete={v->if(v==null)fail("tire",Exception("빈 응답"))else{values[area.values.filter{it!=ai.pleos.playground.vehicle.constant.area.WheelValue.UNKNOWN}.joinToString{mapOf("LEFT_FRONT" to "앞 왼쪽", "RIGHT_FRONT" to "앞 오른쪽", "LEFT_REAR" to "뒤 왼쪽", "RIGHT_REAR" to "뒤 오른쪽")[it.name]?:it.name}]=v; if(values.size==areas.size)set("tire","available",if(values.values.distinct().size==1) values.values.first().toString() else "영역별 기준",if(values.values.distinct().size==1) "kPa" else "","조회한 ${values.size}개 타이어 영역의 극저압 기준이에요. 현재 공기압이나 저압 발생 여부를 나타내지 않아요.",rawDetail=values.entries.sortedBy{it.key}.joinToString("\n"){"${it.key}: ${it.value} kPa"})}},onFailed={fail("tire",it)})}}
   },onFailed={fail("tire",it)})
   sdk.getEvBattery().checkEvBatteryStateOfChargeCapabilities(onComplete={config->
    if(!readable(config.accessType))set("soc","unsupported",detail="배터리 충전 상태가 지원되지 않아요.")
    else sdk.getEvBattery().getEvBatteryStateOfCharge(onComplete={v->if(v==null)fail("soc",Exception("빈 응답"))else set("soc","available",v,"%","구동 배터리의 현재 충전 상태예요. 충전 완료 시각은 제공하지 않아요.")},onFailed={fail("soc",it)})
   },onFailed={fail("soc",it)})
   sdk.getEvBattery().checkEvChargeSwitchCapabilities(onComplete={config->
    if(!readable(config.accessType))set("charge","unsupported",detail="충전 스위치 조회를 지원하지 않아요.")
    else sdk.getEvBattery().getEvChargeSwitchState(onComplete={v->if(v==null)fail("charge",Exception("빈 응답"))else set("charge","available",if(v)"켜짐" else "꺼짐","","충전 스위치의 상태예요. 실제 충전 전력이나 완료 시각은 나타내지 않아요.")},onFailed={fail("charge",it)})
   },onFailed={fail("charge",it)})
  }catch(e:Exception){titles.keys.forEach{fail(it,e)}}
  handler.postDelayed({if(active&&generation==current){if(System.currentTimeMillis()-gearAt>6000)gearChanged(false);rows.forEach{(key,r)->val stamp=r.optLong("updatedAt",0);if(r.optString("state") in setOf("unknown","available")&&(stamp==0L||System.currentTimeMillis()-stamp>10_000))fail(key,Exception("SDK 응답 시간 초과"))}}},3500)
 }
 fun json()=JSONArray((titles.keys+rows.keys.filter{it.startsWith("telltale_")}.sorted()).mapNotNull{rows[it]})
 fun stop(){active=false;handler.removeCallbacksAndMessages(null);worker.execute{try{sdk.getGear().unregisterGearSelection(gearListener);sdk.release()}catch(_:Exception){}};worker.shutdown()}
}
