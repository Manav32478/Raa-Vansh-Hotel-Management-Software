#!/bin/bash
# Self-healing toolchain: (re)download the Android build tools + JDK 17 if missing/corrupt.
# The workspace snapshot can truncate large binaries, so we verify sizes and re-fetch as needed.
set -e
cd "$(dirname "$0")"
T=tools
mkdir -p "$T"

need_bt=0; need_plat=0; need_jdk=0
[ -x "$T/android-14/aapt2" ] && [ -s "$T/android-14/d8" ] && [ -s "$T/android-14/lib/apksigner.jar" ] || need_bt=1
[ -s "$T/android-34/android.jar" ] || need_plat=1
JDKDIR=$(ls -d "$T"/jdk-17* 2>/dev/null | head -1)
if [ -z "$JDKDIR" ] || [ ! -x "$JDKDIR/bin/java" ] || [ "$("$JDKDIR/bin/java" -version 2>&1 | head -1 | grep -c "openjdk" || true)" = "0" ]; then
  need_jdk=1
fi

if [ "$need_bt" = "1" ]; then
  echo "[bootstrap] build-tools missing/corrupt — downloading"
  rm -rf "$T/android-14" "$T/bt.zip"
  curl -s -o "$T/bt.zip" "https://dl.google.com/android/repository/build-tools_r34-linux.zip"
  (cd "$T" && unzip -q bt.zip && rm bt.zip)
fi
if [ "$need_plat" = "1" ]; then
  echo "[bootstrap] platform android.jar missing/corrupt — downloading"
  rm -rf "$T/android-34" "$T/plat.zip"
  curl -s -o "$T/plat.zip" "https://dl.google.com/android/repository/platform-34-ext7_r02.zip"
  (cd "$T" && unzip -q plat.zip && rm plat.zip)
fi
if [ "$need_jdk" = "1" ]; then
  echo "[bootstrap] JDK 17 missing/corrupt — downloading"
  rm -rf "$T"/jdk-17* "$T/jdk17.tar.gz"
  curl -sL -o "$T/jdk17.tar.gz" "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
  (cd "$T" && tar xzf jdk17.tar.gz && rm jdk17.tar.gz)
fi
JDKDIR=$(ls -d "$T"/jdk-17* 2>/dev/null | head -1)
chmod +x "$JDKDIR/bin/"* 2>/dev/null || true
echo "[bootstrap] toolchain ready (bt=$need_bt plat=$need_plat jdk=$need_jdk)"
