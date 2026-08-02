plugins {
    application
    id("com.gradleup.shadow") version "9.4.1"
}

val edcVersion: String by project

dependencies {
    implementation(project(":health-probe"))
    implementation("org.eclipse.edc:controlplane-base-bom:$edcVersion") {
        exclude(group = "org.eclipse.edc", module = "data-plane-signaling")
        exclude(group = "org.eclipse.edc", module = "data-plane-signaling-oauth2")
    }
    implementation("org.eclipse.edc:controlplane-feature-sql-bom:$edcVersion")
    implementation("org.eclipse.edc:iam-mock:$edcVersion")
    implementation("org.eclipse.edc:transfer-data-plane-signaling:$edcVersion")
}

application {
    mainClass.set("org.eclipse.edc.boot.system.runtime.BaseRuntime")
}

tasks.shadowJar {
    archiveFileName.set("molit-edc-smoke-control-plane.jar")
    mergeServiceFiles()
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}
