package app.crewtrip.vehicle

import org.junit.Assert.*
import org.junit.Test

class NavigationCheckTest {
 @Test fun onlyRequestedCoordinatesAndKindConfirm(){
  val check=NavigationCheck{123L};check.begin(NavigationTarget(37.7951,128.8973,"경포호",true))
  assertFalse(check.confirm(37.7712,128.9487,true));assertFalse(check.confirm(37.7951,128.8973,false))
  assertFalse(check.confirm(Double.NaN,128.8973,true))
  assertEquals("pending",check.state);assertNull(check.confirmedAt)
  assertTrue(check.confirm(37.7951,128.8973,true));assertEquals(123L,check.confirmedAt)
 }
 @Test fun duplicateRequestsAreBlockedAndLateResultsCanBeRechecked(){
  val check=NavigationCheck();val target=NavigationTarget(37.77,128.94,"안목",false)
  assertTrue(check.begin(target));assertFalse(check.begin(target));check.timeout()
  assertEquals("unconfirmed",check.state);assertEquals(target,check.target)
  assertTrue(check.confirm(target.lat,target.lon,false));assertEquals("confirmed",check.state)
 }
 @Test fun missingCoordinatesRemainUnconfirmedAndBlockAnotherWaypoint(){
  val check=NavigationCheck();val target=NavigationTarget(37.7951,128.8973,"경포호",true)
  check.begin(target);assertFalse(check.confirm(0.0,0.0,true));check.coordinatesUnavailable()
  assertEquals("unconfirmed",check.state);assertNull(check.confirmedAt)
  assertEquals("coordinates_unavailable",check.verificationIssue);assertFalse(check.begin(target))
  assertTrue(check.confirm(target.lat,target.lon,true));assertNull(check.verificationIssue)
 }
 @Test fun missingWaypointDataDoesNotBlockAnExplicitDestinationRequest(){
  val check=NavigationCheck();check.begin(NavigationTarget(37.7951,128.8973,"경포호",true));check.coordinatesUnavailable()
  val destination=NavigationTarget(37.7712,128.9487,"안목해변",false)
  assertTrue(check.begin(destination));assertNull(check.verificationIssue)
  assertTrue(check.confirm(destination.lat,destination.lon,false))
 }
}
