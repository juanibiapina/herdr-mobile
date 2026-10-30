#!/usr/bin/env bash
# Builds a standalone arm64 release APK locally on a NixOS box with the
# Android dev shell from juanibiapina/dotfiles. Tuned for 2 CPUs and little
# free memory: one Gradle worker, one JVM, Kotlin compiled in process.
set -euo pipefail
cd "$(dirname "$0")/.."

# Prebuild only when android/ is missing or PREBUILD=1 (after app.json or
# native dependency changes): regenerating it costs a full native rebuild.
if [ ! -d android ] || [ "${PREBUILD:-}" = 1 ]; then
  CI=1 pnpm exec expo prebuild -p android --no-install
fi

props=android/gradle.properties
sed -i \
  -e 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m/' \
  -e 's/^org.gradle.parallel=.*/org.gradle.parallel=false/' \
  -e 's/^reactNativeArchitectures=.*/reactNativeArchitectures=arm64-v8a/' \
  -e '$a\\' \
  "$props"
grep -q '^kotlin.compiler.execution.strategy' "$props" || echo 'kotlin.compiler.execution.strategy=in-process' >>"$props"
grep -q '^org.gradle.workers.max' "$props" || echo 'org.gradle.workers.max=1' >>"$props"

export NIXPKGS_ACCEPT_ANDROID_SDK_LICENSE=1
nix develop "${DOTFILES:-$HOME/workspace/juanibiapina/dotfiles}#android" --command bash -c \
  'cd android && ./gradlew :app:assembleRelease --no-daemon'

cp android/app/build/outputs/apk/release/app-release.apk herdr-mobile.apk
echo "built $(pwd)/herdr-mobile.apk"
