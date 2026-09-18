plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "1.9.25" apply false
}

// Force Java 17 toolchain globally to avoid Java 25 parsing issues
allprojects {
    tasks.withType<JavaCompile>().configureEach {
        options.release.set(17)
    }
}
