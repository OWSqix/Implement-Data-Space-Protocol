import org.gradle.api.plugins.JavaPlugin
import org.gradle.api.tasks.bundling.Jar
import org.gradle.api.tasks.compile.JavaCompile
import java.io.DataInputStream

plugins {
    base
}

allprojects {
    group = "kr.go.molit.dataspace.test"
    version = "0.18.0-molit-ci.1"
}

subprojects {
    plugins.withType<JavaPlugin> {
        tasks.withType<JavaCompile>().configureEach {
            options.release.set(17)
        }

        val moduleProjectDir = projectDir
        val modulePath = path
        val mainClassesDirectory = layout.buildDirectory.dir("classes/java/main")
        val verifyJava17Bytecode = tasks.register("verifyJava17Bytecode") {
            description = "Verifies that this module's compiled Java classes use class-file major version 61"
            dependsOn(tasks.withType<JavaCompile>())
            doLast {
                val classFiles = mainClassesDirectory.get().asFileTree
                    .matching { include("**/*.class") }
                    .files
                classFiles.forEach { classFile ->
                    DataInputStream(classFile.inputStream().buffered()).use { input ->
                        check(input.readInt() == 0xCAFEBABE.toInt()) {
                            "Invalid class-file header: ${classFile.relativeTo(moduleProjectDir)}"
                        }
                        input.readUnsignedShort()
                        val major = input.readUnsignedShort()
                        check(major == 61) {
                            "Expected Java 17 class-file major 61, found $major: ${classFile.relativeTo(moduleProjectDir)}"
                        }
                    }
                }
                if (classFiles.isNotEmpty()) {
                    logger.lifecycle("$modulePath: verified ${classFiles.size} Java 17 class file(s), major=61")
                }
            }
        }

        tasks.withType<Jar>().configureEach {
            finalizedBy(verifyJava17Bytecode)
        }
    }
}
