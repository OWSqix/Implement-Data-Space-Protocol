pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "molit-edc-ci-runtime"
include("health-probe", "control-plane", "data-plane", "smoke-control-plane", "smoke-data-plane")
