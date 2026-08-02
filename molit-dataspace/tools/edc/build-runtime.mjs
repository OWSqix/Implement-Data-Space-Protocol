import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const runtimeDirectory = path.resolve(toolDirectory, '..', '..', 'deploy', 'edc', 'runtime');
const javaExecutable = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : 'java';
const wrapperJar = path.join(runtimeDirectory, 'gradle', 'wrapper', 'gradle-wrapper.jar');
const tasks = [
  '--no-daemon',
  'clean',
  ':control-plane:shadowJar',
  ':data-plane:shadowJar',
  ':smoke-control-plane:shadowJar',
  ':smoke-data-plane:shadowJar',
];

const child = spawn(javaExecutable, [
  '-Dorg.gradle.appname=gradlew',
  '-classpath',
  wrapperJar,
  'org.gradle.wrapper.GradleWrapperMain',
  ...tasks,
], {
  cwd: runtimeDirectory,
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', (error) => {
  process.stderr.write(`EDC Gradle build could not start: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.stderr.write(`EDC Gradle build stopped by ${signal}\n`);
  process.exitCode = code ?? 1;
});
