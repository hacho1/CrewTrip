plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
 namespace = "app.crewtrip.vehicle"
 compileSdk = 35
 useLibrary("android.car")
 defaultConfig { applicationId = "app.crewtrip.vehicle"; minSdk = 28; targetSdk = 34; versionCode = 1; versionName = "0.1.0" }
 buildFeatures { buildConfig = true }
 buildTypes {
  debug { buildConfigField("String", "SERVER_ORIGIN", "\"http://10.0.2.2:4310\"") }
  release { isMinifyEnabled = false; buildConfigField("String", "SERVER_ORIGIN", "\"${providers.gradleProperty("crewtripServerOrigin").orElse("").get()}\"") }
  create("emulatorRelease") {
   initWith(getByName("release"))
   applicationIdSuffix = ".demo"
   isDebuggable = false
   signingConfig = null
   matchingFallbacks += listOf("release")
   buildConfigField("String", "SERVER_ORIGIN", "\"http://10.0.2.2:4310\"")
  }
 }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
}
tasks.configureEach {
 if (name.startsWith("assembleRelease") || name.startsWith("bundleRelease")) {
  doFirst { require(providers.gradleProperty("crewtripServerOrigin").orNull?.startsWith("https://") == true) { "Release requires -PcrewtripServerOrigin=https://your-reviewed-server . See docs/RELEASE.md." } }
 }
}
dependencies {
 implementation("ai.pleos.playground:Vehicle:2.3.2")
 implementation("ai.pleos.playground:NaviHelper:3.0.5")
 implementation("androidx.core:core-ktx:1.15.0")
 testImplementation("junit:junit:4.13.2")
}
