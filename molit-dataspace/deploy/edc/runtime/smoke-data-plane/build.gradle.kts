plugins {
    application
    id("com.gradleup.shadow") version "9.4.1"
}

val edcVersion: String by project

dependencies {
    implementation(project(":health-probe"))
    implementation("org.eclipse.edc:dataplane-base-bom:$edcVersion")
    implementation("org.eclipse.edc:dataplane-feature-sql-bom:$edcVersion")

    compileOnly("org.eclipse.edc:core-spi:$edcVersion")
    compileOnly("org.eclipse.edc:data-plane-spi:$edcVersion")
    compileOnly("org.eclipse.edc:web-spi:$edcVersion")
    compileOnly("jakarta.ws.rs:jakarta.ws.rs-api:4.0.0")
}

application {
    mainClass.set("org.eclipse.edc.boot.system.runtime.BaseRuntime")
}

tasks.shadowJar {
    archiveFileName.set("molit-edc-smoke-data-plane.jar")
    mergeServiceFiles()
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}
