plugins {
    application
    id("com.gradleup.shadow") version "9.4.1"
}

val edcVersion: String by project

dependencies {
    implementation(project(":health-probe"))
    implementation("org.eclipse.edc:controlplane-base-bom:$edcVersion")
    implementation("org.eclipse.edc:controlplane-feature-sql-bom:$edcVersion")
}

application {
    mainClass.set("org.eclipse.edc.boot.system.runtime.BaseRuntime")
}

tasks.shadowJar {
    archiveFileName.set("molit-edc-control-plane.jar")
    mergeServiceFiles()
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}

val verifyProductionRuntimeClasspath = tasks.register("verifyProductionRuntimeClasspath") {
    description = "Rejects mock identity and the deprecated legacy Data Plane signaling module"
    doLast {
        val forbiddenModules = setOf("iam-mock", "transfer-data-plane-signaling")
        val resolved = configurations.runtimeClasspath.get().resolvedConfiguration.resolvedArtifacts
            .map { "${it.moduleVersion.id.group}:${it.name}:${it.moduleVersion.id.version}" }
        val forbidden = resolved.filter { coordinate ->
            coordinate.substringAfter(':').substringBefore(':') in forbiddenModules
        }
        check(forbidden.isEmpty()) {
            "Production Control Plane runtime contains smoke-only dependencies: ${forbidden.joinToString()}"
        }
    }
}

tasks.shadowJar {
    dependsOn(verifyProductionRuntimeClasspath)
}
