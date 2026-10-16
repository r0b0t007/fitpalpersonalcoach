# Building the mobile app (iOS / Android)

openGym ships in two flavors from the same codebase:

| | **Self-hosted** (this repo's default) | **Mobile app** (`VITE_MOBILE=1`) |
|---|---|---|
| Runs | in any browser, against your own server | natively on iPhone / Android (Capacitor shell) |
| Accounts | passkey sign-in, one profile per person | none — the phone *is* the account |
| Data | synced to your server, readable on desktop | stays on the device (file in the app's private storage) |
| Reminders | Web Push from your server | native local notifications, no server involved |
| Exercise media | served by your server (`img/`, `gif/`) | loaded from the jsDelivr CDN |

The mobile flavor never talks to a backend by default: no sign-in screen, no sync, no
telemetry. State is mirrored from `localStorage` into `opengym-state.json` in the app's
private data directory on every change (iOS is allowed to evict WebView storage under
pressure — the file mirror is the durable copy and is restored on launch). Backups go out
through the OS share sheet instead of a browser download.

### Connecting the app to your own server

On first launch the app asks how you want to use it. Alongside the fully local mode above,
you can instead **connect it to a self-hosted openGym server** — your data then lives there,
synced the same way the browser PWA does, instead of only on the phone. This is a mode of the
same app, not a different build or download.

Passkeys can't be used for this: the app's WebView runs at its own origin, which never
matches the real hostname WebAuthn needs. Instead you *pair* the device from a browser
that's already signed in: Settings → **"Pair the mobile app"** shows a one-time code (valid
5 minutes); enter your server's address and that code in the app (same first-launch screen,
or Settings → **"Connect to my server"** later) to finish. Notes:

- Requires network access every time the app is used — there's no offline file mirror once
  connected, same as the browser PWA.
- Use an HTTPS address if at all possible: the connection carries a bearer token instead of
  a cookie, and that token would otherwise cross the network in plain text.
- "Sign out everywhere" (Settings → Account, in the browser) revokes a paired app's access
  too — it's the same signed session token either way, just delivered over a header instead
  of a cookie. See `/api/pair/create` and `/api/pair/redeem` in `api/server.js` for the
  exchange itself.
- Settings → "Disconnect" syncs one last time, then drops the device cleanly back to local
  mode.

## Prerequisites

- Node 20+
- **Android:** Android Studio (bundles the SDK). Java 21 for Gradle.
- **iOS:** a Mac with Xcode 15+ and CocoaPods (`brew install cocoapods`). A free Apple ID
  is enough to run the app on your own iPhone (see below); paid membership is only needed
  for App Store distribution, which openGym doesn't do.

## Build & run

```sh
cd frontend
npm install
npm run build:mobile        # VITE_MOBILE build + `cap sync` into android/ and ios/

npx cap open android        # opens Android Studio → run on emulator or device
npx cap open ios            # opens Xcode (Mac only) → set your signing team, then run
```

`npm run build:mobile` bakes the CDN media base into the bundle and copies the web build
into both native projects — re-run it after every web-code change before building natively.

> **Heads-up:** after `build:mobile`, `frontend/dist` contains the *mobile* bundle.
> Run a plain `npm run build` again before deploying `dist` to a server.

## App icons & splash screens

`frontend/resources/icon.svg` is the single source: the gold One Spine symbol on a graphite
field, from `brand/logo-kit`. Every native icon and launch screen is written from it by one
script:

```sh
cd frontend
npm run assets:native
```

It writes these, and nothing else in the native projects should be edited by hand:

| Platform | What | Where |
|---|---|---|
| Android 8+ | Adaptive icon: graphite colour background, vector foreground | `mipmap-anydpi-v26/`, `drawable-v24/ic_launcher_foreground.xml`, `values/ic_launcher_background.xml` |
| Android 6–7 | Square and round icons, PNG per density | `mipmap-*/ic_launcher*.png` |
| Android, all versions | Launch screen: the symbol centred on black, 120dp tall | `drawable/splash_icon.xml`, `launch_background` in `values/ic_launcher_background.xml` |
| iOS | App icon, 1024 px, no alpha | `AppIcon.appiconset/` |
| iOS | Launch image, 2732 px square, no alpha, aspect-filled by `LaunchScreen.storyboard` | `Splash.imageset/` |

The launch theme in `android/app/src/main/res/values/styles.xml` uses them through its two
`windowSplashScreen*` items, on every Android version: 12+ draws them as its own launch screen
(without them it shows a white frame first), and below 12 `Theme.SplashScreen` makes them the
window background at the same size and place. So `splash_icon.xml` is the launch screen
everywhere, not only on 12+. Launch screens are black, not graphite: the script takes the colour
from `backgroundColor` in `capacitor.config.json`, the WebView's colour, so there is no colour
jump when the app takes over.

The script reads the symbol, its gold and the graphite from `icon.svg` (one `<path>`, one
`<rect>`) and measures the symbol's size and position from the path, so a change there reaches
every output. It stops with an error if the file has a second path or the path uses commands
other than M, L, H, V, C and Z. Its renderer, `sharp`, is pinned in `devDependencies` so a re-run
writes the same bytes.

Do not run `npx @capacitor/assets generate` over this. It makes the adaptive-icon layers too
small (Android scales them up and they go soft), pads the old icons by a fixed 8px, and writes
the Android launch screen as a full-window bitmap that Android stretches to the screen's shape.
The script's header has the details.

## Distribution — deliberately no app stores

openGym's mobile app is not on the Play Store or App Store, and that's a choice: no store
accounts, no store rules, no yearly fees between you and an open-source app.

### Android — sideload the APK

> **FitPal Coach has no Android release of its own yet.** Everything below describes upstream
> openGym's APK. The app's own links to it are build settings now, empty by default (CHW-210):
>
> - `VITE_RELEASES_GITLAB_PROJECT` — the GitLab project (URL-encoded, `group%2Fproject`) whose
>   releases carry the APK and its `.sha256`. Set, the Android build's Settings → Updates checks
>   it and installs newer releases; empty, that row does not exist.
> - `VITE_ANDROID_DOWNLOAD_URL` — where the *web* app's "Get the Android app" row sends people.
>   Empty, the row does not exist.
>
> Before shipping a FitPal APK, also change `appId` in `frontend/capacitor.config.json`: it is
> still upstream's `ch.duartesantos.opengym`, so a FitPal build would install over openGym's app
> (or be replaced by it) on the same phone.

The official signed APK is in three places, all the same file:

- **[opengym.duarte-santos.ch](https://opengym.duarte-santos.ch)** — the download page.
- **[GitLab's package registry](https://gitlab.com/DuarteSantos8/opengym/-/packages)** — every
  build under `opengym-android/<version>/`, with a `.sha256` beside it. Direct link, no login:
  `https://gitlab.com/api/v4/projects/85678327/packages/generic/opengym-android/<version>/openGym-<version>.apk`
- **[The GitLab release](https://gitlab.com/DuarteSantos8/opengym/-/releases)** for that version,
  which links to the two above.

Android asks you to allow installs from the browser the first time — that's standard for any
app outside the Play Store. Check the `.sha256` if you got the file from anywhere else.

Both come out of CI: the `build:apk` job in [`.gitlab-ci.yml`](../.gitlab-ci.yml) runs
`npm run build:mobile` and `./gradlew assembleRelease`, then `zipalign`s and signs the result
with the release key. The key lives in *protected* CI variables (`ANDROID_KEYSTORE_B64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`), so it only exists on `main` and on `v*`
tags — a merge request from a fork can build an APK, but gets an unsigned one and never sees
the key. On a `v*` tag the signed APK is also pushed to the generic package registry, which is
what the release links to.

To build and sign your own:

```sh
cd frontend && npm run build:mobile
cd android && ./gradlew assembleRelease            # → app/build/outputs/apk/release/app-release-unsigned.apk

# one-time: create a keystore. KEEP IT — updates must be signed with the same key,
# or Android refuses to install the new version over the old one.
keytool -genkeypair -keystore my.keystore -alias opengym -keyalg RSA -validity 10950

# align + sign (zipalign/apksigner ship with the Android SDK build-tools)
zipalign -f -p 4 app-release-unsigned.apk aligned.apk
apksigner sign --ks my.keystore --ks-key-alias opengym --out openGym.apk aligned.apk
```

### iPhone — what's actually possible

Apple does not allow installing apps outside the App Store, so there is no `.ipa` download
that would simply install. Your free options:

- **Self-host + PWA** (recommended): open your instance in Safari → Share → *Add to Home
  Screen*. Full-screen app, no expiry, plus sync and passkeys.
- **Xcode free signing:** open `ios/` in Xcode with a free Apple ID as the team and run it
  onto your own iPhone. Apple expires the signature after 7 days; re-run from Xcode to renew.
- **AltStore:** automates that 7-day re-signing over Wi-Fi via a Mac companion app.

### Release notes for maintainers

- Bump `versionName`/`versionCode` in `android/app/build.gradle` per release; keep them in
  step with `frontend/package.json`. `versionCode` must strictly increase or updates won't
  install over an existing APK. The APK is *named* from `frontend/package.json` (the CI job
  reads `version` out of it), so the two drifting apart shows up as a misnamed file.
- Tagging `vX.Y.Z` is what ships everything: images, APK, release notes. Don't push a version
  tag you don't mean to release — `v*` tags are protected for that reason.
- The app requests notification permission only when the workout-day reminder is switched
  on, and (on Android) declares `SCHEDULE_EXACT_ALARM` so the reminder fires to the minute
  where the user allows it.
