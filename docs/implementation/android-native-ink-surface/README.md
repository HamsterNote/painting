# Android Ink A0 probe

Approval and actual verification results: [validation.md](validation.md).
This probe is separate from the editor. The existing `/layered-editor` continues
to use Web on Android. The approved `androidInk=1` integration is pending A0/A1/A2.

## Build

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run build:lib
pnpm --filter @hamster-note/painting-playground exec expo prebuild --platform android --no-install
```

Use your existing JDK 17+ and SDK paths via `JAVA_HOME` and `ANDROID_HOME`. Do not
replace local SDK files or change the Expo baseline. Then, from
`apps/playground/android`:

```sh
./gradlew :app:assembleDebug --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a
```

The example targets a physical arm64 device. For another ABI use its actual ABI;
the default generated project lists armeabi-v7a, arm64-v8a, x86 and x86_64, but this
does not prove all transitive JNI dependencies support every ABI. Generated
Android projects and build output are ignored and must not be committed.

## Device startup

1. Enable USB debugging and authorize the development machine. Run
   `adb devices -l`; select the device explicitly when several are present.
2. Install the APK using
   `adb -s SERIAL install -r apps/playground/android/app/build/outputs/apk/debug/app-debug.apk`.
   Reinstallation can update an existing playground app; preserve any required
   local app data before changing its installed build.
3. Run `pnpm --filter @hamster-note/painting-playground dev:native` in the
   foreground. The existing command advertises LAN port 5266. Record the native
   build's source revision and the served JavaScript revision separately.
4. Open the development client and select `http://DEV_LAN_IP:5266`. On the same
   LAN open `painting-playground://android-ink-probe`, for example:

   ```sh
   adb -s SERIAL shell am start -W -a android.intent.action.VIEW -d 'painting-playground://android-ink-probe' com.hamsternote.paintingplayground
   ```

   If LAN is unavailable, use `adb -s SERIAL reverse tcp:5266 tcp:5266` and select
   `http://127.0.0.1:5266` in the client. Without reverse forwarding, a phone's
   localhost is not the development machine.

5. Record the API, density and pixel dimensions reported by `onReady`. Draw four
   stylus strokes and retire the earliest. Confirm remaining previews persist,
   the fifth stroke can start, and the background crosshair remains visible
   through the transparent view. Test side buttons, inverted tip and system
   cancellation. This is standalone rendering evidence, not WebView input
   routing or physical Ink-to-PF handoff acceptance.

An old client or mismatched probe version displays a rebuild message. Web/iOS
show an Android-only message and do not import Android native runtime code.

## Required next gate evidence

A0 still requires actual Expo DOM/WebView composition and per-stroke retirement
on screen, calibrated at actual device density and 0.5/1/2 viewport scales.
After A0, follow the approved tasks for A1 mixed-input routing and A2 external
120fps video before the shared bridge/main editor integration. A3 requires both
pressure stylus and no-stylus Android scenarios and user appearance approval.
An APK, JS export, mocked RN test or screenshot cannot replace those checks.

## Cleanup

Stop Metro with Ctrl-C. If reverse forwarding was added, run
`adb -s SERIAL reverse --remove tcp:5266`. Do not uninstall the app merely to
clean up a test; uninstalling removes its local data. No server or emulator is
left running by this implementation turn.
