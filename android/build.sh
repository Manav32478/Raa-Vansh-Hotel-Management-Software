#!/bin/bash
# Build Raa Vansh Hotel APK from the current hotel-billing web build.
# Usage: bash android/build.sh   (output: /home/user/RaaVansh-Hotel.apk)
set -e
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)
# Self-heal the toolchain (large binaries can be truncated by the workspace snapshot)
bash bootstrap.sh
BT=tools/android-14
PLAT=tools/android-34
JAVA=$(ls -d tools/jdk-17*/bin/java 2>/dev/null | head -1)
if [ -z "$JAVA" ]; then JAVA=$(command -v java); fi

WORK=$(mktemp -d /tmp/apkbuild.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/obj" "$WORK/astage/assets" "$WORK/astage/vendor"

echo "[1/6] compiling sources"
javac -encoding UTF-8 -source 1.8 -target 1.8 -classpath "$PLAT/android.jar" -d "$WORK/obj" Main.java RvFileProvider.java

echo "[2/6] dex"
find "$WORK/obj" -name "*.class" > "$WORK/classes.txt"
test -s "$WORK/classes.txt"
"$BT/d8" --release --min-api 24 --output "$WORK" $(cat "$WORK/classes.txt")
test -f "$WORK/classes.dex"

echo "[3/6] staging assets"
cp "$ROOT/index.html" "$ROOT/sw.js" "$ROOT/manifest.webmanifest" "$WORK/astage/"
mkdir -p "$WORK/astage/assets"
for f in logo.png qr.png icon-192.png icon-512.png apple-touch-icon.png favicon-64.png; do
  cp "$ROOT/assets/$f" "$WORK/astage/assets/"
done
cp "$ROOT/vendor/jspdf.umd.min.js" "$WORK/astage/vendor/"

echo "[4/6] aapt2 resources + link"
"$BT/aapt2" compile --dir res -o "$WORK/res.zip"
"$BT/aapt2" link -o "$WORK/base.apk" -I "$PLAT/android.jar" --manifest AndroidManifest.xml -A "$WORK/astage" "$WORK/res.zip"

echo "[5/6] add classes.dex + zipalign"
(cd "$WORK" && zip -q -j base.apk classes*.dex)
"$BT/zipalign" -f 4 "$WORK/base.apk" "$WORK/aligned.apk"

echo "[6/6] sign (key: rv.keystore)"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign --ks rv.keystore --ks-pass pass:raavansh --ks-key-alias raavansh --out /home/user/RaaVansh-Hotel.apk "$WORK/aligned.apk"

"$JAVA" -jar "$BT/lib/apksigner.jar" verify /home/user/RaaVansh-Hotel.apk
echo "APK OK: $(ls -la /home/user/RaaVansh-Hotel.apk | awk '{print $5}') bytes"
