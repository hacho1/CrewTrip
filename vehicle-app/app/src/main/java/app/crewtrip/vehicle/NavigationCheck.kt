package app.crewtrip.vehicle

data class NavigationTarget(val lat:Double,val lon:Double,val name:String,val waypoint:Boolean)

/** One outstanding request. Callback type alone can never confirm a target. */
class NavigationCheck(private val now:()->Long={System.currentTimeMillis()}) {
 var target:NavigationTarget?=null;private set
 var state="idle";private set
 var confirmedAt:Long?=null;private set
 var verificationIssue:String?=null;private set
 fun begin(next:NavigationTarget):Boolean {
  if(state=="pending"||state=="connecting"||(next.waypoint&&verificationIssue=="coordinates_unavailable"))return false
  target=next;state="pending";confirmedAt=null;verificationIssue=null;return true
 }
 fun connecting(){state="connecting"}
 fun pending(){state="pending"}
 fun ready(){if(target==null)state="idle"}
 fun error(){state="error"}
 fun timeout(){if(state=="pending"||state=="connecting")state="unconfirmed"}
 fun coordinatesUnavailable(){if(target?.waypoint==true){state="unconfirmed";confirmedAt=null;verificationIssue="coordinates_unavailable"}}
 fun confirm(lat:Double,lon:Double,waypoint:Boolean):Boolean {
  val wanted=target?:return false
  if(!lat.isFinite()||!lon.isFinite()||(lat==0.0&&lon==0.0)||wanted.waypoint!=waypoint||kotlin.math.abs(wanted.lat-lat)>=.0001||kotlin.math.abs(wanted.lon-lon)>=.0001)return false
  if(state!="confirmed"){state="confirmed";confirmedAt=now()};verificationIssue=null;return true
 }
}
