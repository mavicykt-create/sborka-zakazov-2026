plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun String.asBuildConfigString(): String = "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

val debugBackendUrl = providers.gradleProperty("PICKER_DEBUG_BASE_URL")
    .orElse(providers.environmentVariable("PICKER_DEBUG_BASE_URL"))
    .orElse("https://example.invalid/")
val productionBackendUrl = providers.gradleProperty("PICKER_PRODUCTION_BASE_URL")
    .orElse(providers.environmentVariable("PICKER_PRODUCTION_BASE_URL"))
    .orElse("https://example.invalid/")

require(debugBackendUrl.get().startsWith("https://")) { "PICKER_DEBUG_BASE_URL must use HTTPS" }
require(productionBackendUrl.get().startsWith("https://")) { "PICKER_PRODUCTION_BASE_URL must use HTTPS" }
if (
    gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) } &&
    productionBackendUrl.get() == "https://example.invalid/"
) {
    throw GradleException("Set PICKER_PRODUCTION_BASE_URL to the Amvera HTTPS URL before a release build")
}

android {
    namespace = "ru.sborka.picker"
    compileSdk = 36

    defaultConfig {
        applicationId = "ru.sborka.picker"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("String", "BACKEND_URL", debugBackendUrl.get().asBuildConfigString())
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "BACKEND_URL", productionBackendUrl.get().asBuildConfigString())
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.08.01")

    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
