import java.util.zip.ZipFile

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
    archiveFileName.set("molit-edc-data-plane.jar")
    mergeServiceFiles()
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}

val verifyNoSmokeClasses = tasks.register("verifyNoSmokeClasses") {
    description = "Fails when the production Data Plane JAR contains a smoke-only class"
    doLast {
        val archiveFile = tasks.shadowJar.get().archiveFile.get().asFile
        val forbiddenEntries = ZipFile(archiveFile).use { archive ->
            archive.entries().asSequence()
                .map { it.name }
                .filter { it.startsWith("org/eclipse/edc/molit/smoke/") }
                .take(10)
                .toList()
        }
        check(forbiddenEntries.isEmpty()) {
            "Production Data Plane JAR contains smoke-only entries: ${forbiddenEntries.joinToString()}"
        }
    }
}

tasks.shadowJar {
    finalizedBy(verifyNoSmokeClasses)
}
