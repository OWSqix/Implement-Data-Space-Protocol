plugins {
    application
    id("com.gradleup.shadow") version "9.4.1"
}

val edcVersion: String by project

dependencies {
    implementation(project(":health-probe"))
    implementation("org.eclipse.edc:controlplane-base-bom:$edcVersion") {
        // The local smoke uses EDC's deprecated legacy Data Plane. Loading the
        // new DPS flow controller at the same time replaces the legacy
        // controller and sends incompatible prepare/start messages to it.
        exclude(group = "org.eclipse.edc", module = "data-plane-signaling")
        exclude(group = "org.eclipse.edc", module = "data-plane-signaling-oauth2")
    }
    implementation("org.eclipse.edc:controlplane-feature-sql-bom:$edcVersion")
    implementation("org.eclipse.edc:iam-mock:$edcVersion")
    // EDC's own Data Plane is deprecated in 0.18.0. This compatibility
    // extension is retained only so the local two-connector smoke can drive
    // that Data Plane. Production must replace both with a DPS implementation.
    implementation("org.eclipse.edc:transfer-data-plane-signaling:$edcVersion")
}

application {
    mainClass.set("org.eclipse.edc.boot.system.runtime.BaseRuntime")
}

tasks.shadowJar {
    archiveFileName.set("molit-edc-control-plane.jar")
    mergeServiceFiles()
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}
