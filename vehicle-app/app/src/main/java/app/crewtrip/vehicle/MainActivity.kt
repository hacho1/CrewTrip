package app.crewtrip.vehicle

import android.annotation.SuppressLint
import android.app.Activity
import android.car.Car
import android.car.drivingstate.CarUxRestrictionsManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RouteStateInfo
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.data.WaypointChangedInfo
import ai.pleos.playground.navi.data.WaypointInfo
import ai.pleos.playground.navi.data.NavigationScreenRequest
import ai.pleos.playground.navi.constants.WaypointIndex
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Kotlin AAOS host: platform UX safety and SDK access never depend on web state. */
class MainActivity: Activity() {
 private lateinit var web:WebView
 private lateinit var lock:TextView
 private lateinit var vehicle:VehicleRepository
 private lateinit var navi:NaviHelper
 private val main=Handler(Looper.getMainLooper())
 private val executor=Executors.newSingleThreadExecutor()
 private var car:Car?=null
 private var ux:CarUxRestrictionsManager?=null
 @Volatile private var uxClear=false
 @Volatile private var parked=false
 private var navConnected=false
 private var navStatus="NaviHelper 연결 중"
 private val navCheck=NavigationCheck()
 private var navSent=false
 private var navDeadline=0L
 private val navPending get()=navCheck.state=="pending"||navCheck.state=="connecting"
 private var navInitializing=false
 private var navConnectionEpoch=0
 private var requestEpoch=0
 private var stopped=false
 private var pageReady=false
 private var pageLoadError=false
 private val restricted get()=!uxClear||!parked
 private val uxListener=CarUxRestrictionsManager.OnUxRestrictionsChangedListener { r -> uxClear=!r.isRequiresDistractionOptimization&&r.activeRestrictions==0;updateLock() }
 private val naviListener=object:NaviHelperEventListener {
  override fun onRoutingCompleted(){main.post{queryNavigation()}}
  override fun onError(errorCode:NaviErrorCode){main.post{navCheck.error();navStatus="SDK 오류: $errorCode · 결과를 다시 확인해 주세요.";Log.w("CrewTripNavi",navStatus);sendSnapshot()}}
  override fun onDestinationInfo(destinationInfo:DestinationInfo){
   main.post{
    val matches=navCheck.confirm(destinationInfo.latitude,destinationInfo.longitude,false)
    if(matches)navStatus="SDK 목적지 확인: ${destinationInfo.name} · 요청 좌표 일치"
    else if(navPending&&navCheck.target?.waypoint==false&&!navSent)submitNavigation()
    Log.i("CrewTripNavi","destination=${destinationInfo.name} lat=${destinationInfo.latitude} lon=${destinationInfo.longitude} requestedMatch=$matches");sendSnapshot()
   }
  }
  override fun onRouteStateInfo(routeStateInfo:RouteStateInfo){main.post{Log.i("CrewTripNavi","routeState=${routeStateInfo.toString().take(180)}");sendSnapshot()}}
  override fun onWaypointChanged(waypointInfo:WaypointChangedInfo){main.post{if(navCheck.target?.waypoint==true&&navCheck.state!="confirmed")navStatus="경유지 변경 알림 수신 · 요청 좌표 확인 중";queryNavigation()}}
  override fun onWayPointInfo(waypointInfo:List<WaypointInfo>){main.post{
   if(BuildConfig.DEBUG)Log.i("CrewTripNavi","waypoints=${waypointInfo.take(5)} requested=${navCheck.target}")
   val match=waypointInfo.firstOrNull{navCheck.confirm(it.latitude,it.longitude,true)}
   if(match!=null){navStatus="SDK 응답: 경유지 변경 확인 · ${match.name} 요청 좌표 일치";Log.i("CrewTripNavi",navStatus)}
   else if(navCheck.target?.waypoint==true&&waypointInfo.any{!it.latitude.isFinite()||!it.longitude.isFinite()||(it.latitude==0.0&&it.longitude==0.0)||it.latitude !in -90.0..90.0||it.longitude !in -180.0..180.0}){navCheck.coordinatesUnavailable();navStatus="경유지 반영 미확인 · 추가 요청 보류";Log.w("CrewTripNavi","Waypoint coordinates unavailable; duplicate requests withheld")}
   else if(navPending&&navCheck.target?.waypoint==true&&!navSent)submitNavigation()
   sendSnapshot()
  }}
 }
 @SuppressLint("SetJavaScriptEnabled")
 override fun onCreate(state:Bundle?){super.onCreate(state)
  val frame=FrameLayout(this)
  web=WebView(this);web.settings.javaScriptEnabled=true;web.settings.domStorageEnabled=true;web.settings.allowFileAccess=false;web.settings.allowContentAccess=false;web.settings.setSupportMultipleWindows(false)
  if(BuildConfig.DEBUG)WebView.setWebContentsDebuggingEnabled(true)
  web.addJavascriptInterface(Bridge(),"CrewTripNative")
  web.webViewClient=object:WebViewClient(){
   override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=!allowed(request.url.toString())
   override fun onPageStarted(view:WebView,url:String,favicon:android.graphics.Bitmap?){pageReady=false;pageLoadError=false}
   override fun onPageFinished(view:WebView,url:String){pageReady=allowed(url)&&!pageLoadError;updateLock();sendSnapshot()}
   override fun onReceivedError(view:WebView,request:WebResourceRequest,error:android.webkit.WebResourceError){if(request.isForMainFrame){pageReady=false;pageLoadError=true;updateLock()}}
  }
  frame.addView(web,FrameLayout.LayoutParams(-1,-1))
  lock=TextView(this).apply{setBackgroundColor(Color.rgb(9,9,9));setTextColor(Color.rgb(240,240,235));textSize=28f;gravity=Gravity.CENTER;setPadding(80,40,80,40);isClickable=true;isFocusable=true;importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_YES}
  lock.setOnClickListener{if(!restricted&&pageLoadError){lock.text="여행 서버에 다시 연결하고 있어요.";web.reload()}}
  frame.addView(lock,FrameLayout.LayoutParams(-1,-1));setContentView(frame)
  vehicle=VehicleRepository(this,{sendSnapshot()},{isParked->parked=isParked;updateLock()});vehicle.start()
  navi=NaviHelper(applicationContext)
  navStatus="내비게이션 요청 시 SDK를 연결합니다."
  connectCar();updateLock();web.loadUrl(BuildConfig.SERVER_ORIGIN+"/vehicle")
 }
 private fun allowed(url:String):Boolean{val u=android.net.Uri.parse(url);val expected=android.net.Uri.parse(BuildConfig.SERVER_ORIGIN);return u.scheme==expected.scheme&&u.host==expected.host&&u.port==expected.port}
 private fun connectCar(){try{
  car=Car.createCar(this,null,Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT){c,ready->
   if(ready){try{ux=c.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as CarUxRestrictionsManager;ux!!.registerListener(uxListener);val r=ux!!.currentCarUxRestrictions;uxClear=!r.isRequiresDistractionOptimization&&r.activeRestrictions==0}catch(e:Exception){uxClear=false;parked=false;Log.w("CrewTripSafety","Car manager failed",e)}}else{uxClear=false;parked=false};updateLock()
  }
 }catch(e:Exception){Log.w("CrewTripSafety","Car service unavailable",e);uxClear=false;parked=false;updateLock()}}
 private fun updateLock(){main.post{if(stopped)return@post;lock.text=if(pageLoadError&&!restricted)"여행 서버에 연결할 수 없어요.\n서버와 Wi-Fi 연결을 확인한 뒤 이 화면을 눌러 다시 연결해 주세요." else if(parked)"차량 주행 제한을 확인하고 있어요.\n안전 상태가 확인되면 여행방을 사용할 수 있어요." else "안전하게 정차한 뒤 함께해요.\n주행 중에는 CrewTrip 차량 화면을 사용할 수 없어요.\n동승자는 스마트폰에서 장소를 제안하고 투표해 주세요.";lock.visibility=if(restricted||pageLoadError)View.VISIBLE else View.GONE;web.isEnabled=!restricted&&!pageLoadError;if(restricted){web.clearFocus();(getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(web.windowToken,0)};Log.i("CrewTripSafety","parked=$parked uxClear=$uxClear restricted=$restricted");sendSnapshot()}}
 private fun sendSnapshot(){main.post{if(stopped||!pageReady||!::vehicle.isInitialized)return@post;val t=navCheck.target;val navigation=JSONObject().put("state",navCheck.state).put("targetName",t?.name?:JSONObject.NULL).put("lat",t?.lat?:JSONObject.NULL).put("lon",t?.lon?:JSONObject.NULL).put("waypoint",t?.waypoint?:false).put("confirmedAt",navCheck.confirmedAt?:JSONObject.NULL).put("verificationIssue",navCheck.verificationIssue?:JSONObject.NULL);val data=JSONObject().put("readings",vehicle.json()).put("restricted",restricted).put("restrictionReason",if(restricted)"주행 중 또는 차량 안전 상태 미확인 · 조작 제한" else "정차 상태 확인 · 여행방 조작 가능").put("source","Pleos Connect Emulator · Vehicle SDK 2.3.2").put("navStatus",navStatus).put("navigation",navigation);web.evaluateJavascript("window.crewtripReceive && window.crewtripReceive($data)",null)}}
 private fun actionResult(ok:Boolean,error:String=""){main.post{if(!stopped)web.evaluateJavascript("window.crewtripAction && window.crewtripAction(${JSONObject().put("ok",ok).put("error",error)})",null)}}
 private fun ensureNavi(action:()->Unit){
  if(restricted){navStatus="정차 상태를 확인해 주세요.";sendSnapshot();return}
  if(navConnected){action();return}
  if(navInitializing){navStatus="NaviHelper 연결 중";sendSnapshot();return}
  navInitializing=true;val connection=++navConnectionEpoch;navCheck.connecting();navStatus="NaviHelper 연결 중";sendSnapshot()
  main.postDelayed({if(!stopped&&navInitializing&&connection==navConnectionEpoch){navInitializing=false;navConnectionEpoch++;navCheck.error();navStatus="내비 연결 시간 초과 · 준비 화면을 다시 열어 주세요.";try{navi.release()}catch(_:Exception){};sendSnapshot()}},20000)
  try{navi.initialize(onConnected={main.post{if(!stopped&&navInitializing&&connection==navConnectionEpoch){navInitializing=false;navConnected=true;navi.addListener(naviListener);if(navCheck.target!=null)navCheck.pending()else navCheck.ready();if(!restricted)action()else{navCheck.timeout();navStatus="주행 제한으로 내비게이션 요청 차단";sendSnapshot()}}}},onFailed={main.post{if(!stopped&&connection==navConnectionEpoch){navInitializing=false;navConnected=false;navCheck.error();navStatus="NaviHelper 연결 실패: ${it.message?.take(120)}";sendSnapshot()}}})}catch(e:Exception){navInitializing=false;navCheck.error();navStatus="NaviHelper 초기화 실패: ${e.message}";sendSnapshot()}
 }
 private fun queryNavigation(){if(!navConnected||stopped)return;try{navi.getDestinationInfo();navi.getWaypointInfo();navi.getRouteStateInfo()}catch(e:Exception){navCheck.error();navStatus="내비 결과 조회 실패 · 다시 확인해 주세요."};sendSnapshot()}
 private fun submitNavigation(){
  if(restricted||navSent||!navPending||(navCheck.target?.waypoint==true&&navCheck.verificationIssue=="coordinates_unavailable"))return
  val t=navCheck.target?:return
  try{navSent=true
   if(t.waypoint)navi.addWaypoint(RequestWaypointInfo(latitude=t.lat,longitude=t.lon,poiName=t.name,waypointIndex=WaypointIndex.FIRST,poiId="",address="",poiSubId=""))
   else navi.requestRoute(RouteInfo(latitude=t.lat,longitude=t.lon,displayLatitude=null,displayLongitude=null,poiName=t.name,poiId="",poiSubId="",address=""))
   navStatus=if(t.waypoint)"SDK 경유지 추가 요청 · 좌표 확인 대기" else "SDK 목적지 요청 · 좌표 확인 대기"
  }catch(e:Exception){navCheck.error();navStatus="내비 요청 실패 · 결과를 확인한 뒤 다시 시도해 주세요."}
  Log.i("CrewTripNavi",navStatus);sendSnapshot()
 }
 private fun requestNavigation(raw:String,waypoint:Boolean){
  if(restricted){navStatus="주행 제한으로 내비게이션 요청 차단";sendSnapshot();return}
  if(waypoint&&navCheck.verificationIssue=="coordinates_unavailable"){navStatus="경유지 좌표 미확인 · 추가 요청 보류. 내비에서 현재 경유지를 확인해 주세요.";sendSnapshot();return}
  try{require(raw.length<4096);val p=JSONObject(raw);val lat=p.getDouble("lat");val lon=p.getDouble("lon");require(lat in -90.0..90.0&&lon in -180.0..180.0)
   if(navInitializing||!navCheck.begin(NavigationTarget(lat,lon,p.getString("name").take(60),waypoint))){navStatus="기존 요청을 확인 중이에요. 중복 전송하지 않았어요.";sendSnapshot();return}
   navSent=false;requestEpoch++;val epoch=requestEpoch;navDeadline=android.os.SystemClock.elapsedRealtime()+60_000
   navStatus="내비 준비와 기존 반영 여부 확인 중";sendSnapshot()
   ensureNavi{queryNavigation()}
   val query=object:Runnable{override fun run(){if(!stopped&&epoch==requestEpoch&&navPending){queryNavigation();main.postDelayed(this,4000)}}};main.postDelayed(query,4000)
   main.postDelayed({if(epoch==requestEpoch&&navPending){navCheck.timeout();navStatus="내비 응답 시간 초과 · 반영 미확인. 내비 준비 화면을 연 뒤 돌아와 결과를 다시 확인해 주세요.";Log.w("CrewTripNavi",navStatus);sendSnapshot()}},60000)
  }catch(e:Exception){navCheck.error();navStatus="내비게이션 요청 실패: ${e.message?.take(140)}";sendSnapshot()}
 }
 inner class Bridge{
  @JavascriptInterface fun refresh(){main.post{vehicle.refresh(true);sendSnapshot()}}
  @JavascriptInterface fun navigationInfo(){main.post{ensureNavi{queryNavigation()}}}
  @JavascriptInterface fun prepareNavigation(){main.post{ensureNavi{try{navi.requestNavigationScreen(NavigationScreenRequest.Foreground);navStatus="내비 지도가 준비되면 CrewTrip으로 돌아와 연결해 주세요.";if(navCheck.target==null)navCheck.timeout()}catch(e:Exception){Log.w("CrewTripNavi","Navigation screen request failed",e);navCheck.error();navStatus="내비 준비 화면을 열지 못했어요. 다시 시도해 주세요."};sendSnapshot()}}}
  @JavascriptInterface fun confirmPlace(raw:String){
   if(raw.length>4096||restricted){actionResult(false,"안전한 정차 상태에서만 확정할 수 있어요.");return}
   executor.execute{try{
    val data=JSONObject(raw);val room=data.getString("roomId");val token=data.getString("token");val place=data.getString("placeId")
    require(room.matches(Regex("[a-f0-9]{20}"))&&place.matches(Regex("[a-f0-9]{20}"))&&token.matches(Regex("[A-Za-z0-9_-]{43}")))
    if(restricted)throw IllegalStateException("차량 조작 제한 활성화")
    val c=URL(BuildConfig.SERVER_ORIGIN+"/api/rooms/$room/confirm").openConnection() as HttpURLConnection
    try{c.requestMethod="POST";c.connectTimeout=5000;c.readTimeout=5000;c.doOutput=true;c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Authorization","Bearer $token");c.outputStream.use{it.write(JSONObject().put("placeId",place).toString().toByteArray())};if(c.responseCode !in 200..299)throw Exception("여행방 확정 실패 (${c.responseCode})");actionResult(true)}finally{c.disconnect()}
   }catch(e:Exception){actionResult(false,e.message?:"확정 실패")}}
  }
  @JavascriptInterface fun navigate(raw:String){main.post{requestNavigation(raw,false)}}
  @JavascriptInterface fun addWaypoint(raw:String){main.post{requestNavigation(raw,true)}}

 }
 override fun onResume(){super.onResume();if(::vehicle.isInitialized){if(navPending&&android.os.SystemClock.elapsedRealtime()>navDeadline)navCheck.timeout();if(!restricted&&navConnected)main.postDelayed({if(!stopped&&!restricted)queryNavigation()},500);sendSnapshot()}}
 override fun onDestroy(){stopped=true;main.removeCallbacksAndMessages(null);vehicle.stop();try{ux?.unregisterListener();car?.disconnect();navi.removeListener(naviListener);navi.release()}catch(_:Exception){};executor.shutdownNow();web.removeJavascriptInterface("CrewTripNative");web.destroy();super.onDestroy()}
}
