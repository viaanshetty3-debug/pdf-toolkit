# PDF Toolkit — Native Mobile Shell (Capacitor + TWA)

Produces a real Android `.apk` (and iOS `.ipa` on a Mac) wrapping the PDF
Toolkit PWA. Users install it like any other app and lose the browser URL bar.

## Three ways to build

### 1. Docker (easiest — no SDK on your host)

```sh
# From the repository root:
docker build -f mobile/Dockerfile.android -t pdftk-android-builder .
docker run --rm -v $(pwd)/build:/out pdftk-android-builder
# → ./build/app-release-unsigned.apk

# Sign it:
keytool -genkey -v -keystore pdftk.keystore -alias pdftk -keyalg RSA -keysize 2048 -validity 10000
jarsigner -keystore pdftk.keystore build/app-release-unsigned.apk pdftk
zipalign -v 4 build/app-release-unsigned.apk build/pdftk.apk
```

### 2. On your dev machine (Mac / Linux / Windows)

```sh
# Prerequisites: Node 20+, JDK 17, Android Studio OR Android SDK + build-tools
cd mobile
npm install
export PDFTK_SERVER_URL=https://pdftk.example.com   # or your LAN URL
# Copy the PWA assets into the shell's webroot:
mkdir -p www && cp -r ../public/* www/
npx cap add android      # one-time
npx cap sync android
cd android
./gradlew assembleRelease
# → mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk
```

### 3. On Termux (experimental — slow + fragile)

```sh
pkg install openjdk-17 android-tools
# Still needs Android SDK — fetch via:
curl -sL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o cmd.zip
unzip cmd.zip -d $HOME/android-sdk/cmdline-tools
export ANDROID_HOME=$HOME/android-sdk
yes | $ANDROID_HOME/cmdline-tools/cmdline-tools/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/cmdline-tools/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0"
# Then follow the dev-machine steps above.
```

Expect gradle to use several GB of RAM. Not recommended for low-RAM devices.

## iOS build

Requires macOS + Xcode (there is no way around this; Apple's tooling is
Mac-only).

```sh
cd mobile
npm install
mkdir -p www && cp -r ../public/* www/
npx cap add ios
npx cap sync ios
npx cap open ios
# → Xcode opens; Archive + upload to App Store Connect from there
```

## How this works

- The PWA at `public/` is the entire frontend. Capacitor wraps it in a
  WebView-hosted native app.
- With `PDFTK_SERVER_URL` set, the WebView loads from the server (so you
  only have to update server-side to ship new features — no app updates).
- Without `PDFTK_SERVER_URL`, Capacitor serves the bundled `www/` from the
  APK itself (works offline for the browser-side tools, API calls fail
  without a reachable server).

## Signing + Play Store submission

Signing is standard Android. See
https://developer.android.com/studio/publish/app-signing.

Play Store submission is a manual process (Play Console account, data-safety
form, screenshots) — not scriptable. See
https://developer.android.com/distribute/console.
