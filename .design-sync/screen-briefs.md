# FitPal Coach redesign — screen briefs for Claude Design

1. Open the project **FitPal Coach Design System** at claude.ai/design, start a new design, and paste the **Consistency rules** at the bottom of this file as the first message of the session.
2. Then paste one brief per screen, in the order below, each as its own message; name the artboard with the heading (`C1 — Coach · Today`). The design agent builds with the synced component library (`Section`, `Row`, `Button`, `Segmented`, `LineChart`, `Logo`, …) and the class vocabulary in `conventions.md`.
3. Phone frames are 390×844, dark theme. D1–D3 are desktop 1200×800. P11 is the only light frame.
4. When a brief says "same shell as C1" (or P1), duplicate that artboard's frame, `#tabbar` and `.hdr`, and change only what the brief lists.
5. Sheets (C13, C14, C15, P6, P7) are drawn open over the screen they name, on a dimmed `.mback`, with the tab bar still visible underneath.

---

## S1 — Login

> Rewritten to match what shipped (PR #45). The earlier draft invented a "Sign in" card and a
> "Have an invite link?" row; neither exists. An invite arrives as a link that opens the app, and
> an existing account joins a coach from the Coach tab (P5), not from here.

```
Frame: phone 390x844, dark theme. No tab bar. Wrap everything in #app, vertically centred, text-align centre, min-height 78vh.
Top: the Logo component (the gold One Spine symbol, then "FitPal Coach" in gold), then one muted line 10px under it: "Your coach. Your plan. Your progress."
34px gap, then three stacked full-width controls:
  1. Button variant primary, icon person, "Sign in with passkey".
  2. 10px gap. Button (plain), icon sparkles, "Create new profile".
  3. 10px gap. Button variant ghost, dim, "Continue without account".
20px gap, then the InstallCard: a .card with a gold rounded-square download icon, .tt "Install FitPal Coach", .ss "Get the full-screen app on your home screen.", a full-width primary "Install" button and a plain "Not now" beneath it.
26px gap, then two centred .dim .small lines: "Passkeys use fingerprint, face or PIN - no passwords." and "Each profile keeps its own plan, workouts & body weight."
Rules: no username or password field anywhere - sign-in is passkey only. Gold appears on the logo, the primary button and the Install button, nothing else.
```

## S2 — Invite landing

```
Frame: phone 390x844, dark. The S1 screen with two changes, and the register sheet already open on top of it.
Base screen (dimmed behind .mback): the tagline under the wordmark reads "Amine invited you to train with them." instead of the usual one. Everything else is S1 unchanged.
Sheet (.sheet with .grab handle): <h3> "Amine invited you". Under it a muted paragraph: "Pick a name and confirm with fingerprint, face or PIN. You will arrive on Amine's client list - they can see your training and send you programs."
Then a TextField, placeholder "Your name", empty, focused.
10px gap, then the invite code as a READ-ONLY .input: centred text, letter-spacing .14em, font-weight 600, value "K7F29QDM", opacity .7. A .dim .small caption under it: "From your invite link."
12px gap, then Button variant primary, full width, "Create passkey".
Rules: the code field is not editable and carries no chevron or clear button - what the link carries is what gets sent. Nothing on this screen mentions an admin, a gym or a role choice; every account made here is a client.
```

## S3 — Register (no invite)

```
Frame: phone 390x844, dark. The S1 screen dimmed behind .mback, with the register sheet open.
Sheet (.sheet, .grab): <h3> "Create your profile", then a muted paragraph "Pick a name, then confirm with fingerprint, face or PIN. The passkey is saved in your device - no password needed."
A TextField, placeholder "Your name", empty, focused. That is the ONLY field.
12px gap, Button variant primary, full width, "Create passkey".
Rules: no invite-code field. This instance does not gate signup on codes, which is the normal case since PR #45 - a code is honoured whenever one is supplied but never required. The field appears only on an invite-only instance (then it is editable and captioned "This app is invite-only - enter the code you were given") or when a link supplied one (S2, read-only). Do not draw a role picker.
```

## C1 — Coach · Today

```
Frame: phone 390×844, dark. Coach shell: <nav id="tabbar"> with four cells — Today (icon house, class on), Clients (icon people), Programs (icon clipboard), Account (icon person). No raised centre button.
Header .hdr: h1 "Today", .sub "Wednesday 10 Sep · 12 clients"; right side an .iconbtn with icon reset (refresh).
Content top-to-bottom:
1. .tiles with three .tile: .l "Clients" .v "12"; .l "Training now" .v "2" in var(--acc); .l "Active 7d" .v "9".
2. Section titled "Needs attention", Rows with accessory chevron: icon warning iconTint var(--red), title "Sara Benali", subtitle "Check-in overdue · 9 days"; icon clock iconTint var(--orange), "Youssef K.", "Program waiting since Mon"; icon xmark iconTint var(--yellow), "Lina M.", "Declined 'Upper / lower'"; icon moon iconTint var(--label-3), "Omar R.", "No workout in 7 days"; icon sparkles iconTint var(--acc), "Nadia E.", "New client · no program yet".
3. .card with border var(--acc): h2 as a .row with icon dot in var(--green) then "Training now"; two .list > .item rows: .tt "Karim B." .ss "Push day · ex 4/7 · 12/21 sets" with .tag.acc "38m"; .tt "Sara Benali" .ss "Legs · ex 2/6 · 5/18 sets" with .tag.acc "12m".
4. Section "Recent activity": Row icon check iconTint var(--green) "Youssef K. finished Pull day", subtitle "Today 08:40 · 4,120 kg"; Row icon checkCircle iconTint var(--acc) "Lina M. accepted 'Push, pull, legs'", "Yesterday"; Row icon person "Nadia E. joined from your link", "Mon".
Numbers tabular; every icon from the set; no emoji; the list scrolls under the tab bar.
```

## C2 — Coach · Today empty

```
Same shell as C1, Today cell on. Header h1 "Today", .sub "Wednesday 10 Sep · 0 clients", refresh .iconbtn.
.tiles: Clients "0"; Training now "—"; Active 7d "—" (dashes in --label-3).
Then one centred .card as the empty state: a .lrow-i enlarged to 48px with background var(--acc-soft) holding icon people in var(--acc); .t-title2 "Invite your first client"; .t-sub muted "Send them a link. When they sign up they land on your roster, ready for a program."; Button primary icon link full width "Share invite link" (opens C14); under it Button tinted icon clipboard full width "Build a program first" (goes to C10).
Below: Section "While you wait" with Rows, accessory chevron: icon camera "Upload an exercise demo", subtitle "Your own footage replaces the stock animation"; icon figureStrength "Train myself", subtitle "Open the app as a client".
No Needs attention, Training now or Recent activity sections — the empty card replaces them. The tab bar stays. Nothing about admins, codes to type, or assigning.
```

## C3 — Coach · Clients

```
Same shell as C1, Clients cell on. .hdr h1 "Clients", .sub "12 · 9 active this week"; right side Button variant tinted size sm icon plus "Invite" (opens C14).
SearchField placeholder "Search clients" directly under the header.
.chips filter strip: .chip.on "All", .chip "Needs attention", .chip "Training now", .chip "Inactive".
Then .list > .item rows sorted needs-attention first. Each row: .grow with .tt (name, then a .tag where relevant) and .ss status line; on the right an adherence block (bold percentage in var(--green) ≥80, var(--yellow) 60–79, var(--red) below, over a .t-cap "28d" in --label-3) and .chev:
- Sara Benali · .tag "check-in overdue" in var(--red) · .ss "24 workouts · last Sun · synced 2h ago" · 61%
- Youssef K. · .tag "program waiting" · .ss "31 workouts · last Tue · synced 1h ago" · 88%
- Lina M. · .tag "declined" in var(--yellow) · .ss "12 workouts · last Mon" · 74%
- Omar R. · .ss "8 workouts · last 3 Sep · synced 6d ago" · 42%
- Nadia E. · .tag.acc "new" · .ss "0 workouts · joined Mon" · no percentage
- Karim B. · icon dot in var(--green) before the name · .ss "training now · Push day" · 93%
- Hind A., Mehdi T., Salma R. with plain .ss lines and green percentages.
Nine rows; the list scrolls under the tab bar. Rows are 60px minimum.
```

## C4 — Coach · Client · Overview

```
Same shell as C1, Clients cell on (client detail is a route under Clients, not a sheet). .hdr: left .iconbtn chevronLeft, h1 "Sara Benali", .sub "Client since March · 24 workouts"; right .iconbtn more (overflow, closed here).
Segmented (.seg) full width under the header, FIVE tabs and no more: Overview (selected) · Program · Check-ins · Photos · Stats. There is no Notes tab — that route was written and removed during P3 review because nothing ever read it back.
Content:
1. .tiles: .l "Adherence" .v "61%" in var(--yellow); "Last check-in" "9 d" in var(--red); "Workouts" "24"; "Routines" "3".
2. .card "Adherence · last 28 days": .row.between with h2 and "61%" in var(--yellow); .t-sub muted "Trained 11 of 18 planned days · 1 unplanned"; then 28 squares of 14px in a row (var(--green) trained, var(--red) missed, var(--teal) unplanned, --surface-2 rest at 45% opacity, --sep for today).
3. .card with border var(--acc) titled "Waiting for her to answer": .row.between — .t-sub "Sent Mon 8 Sep · 'Push, pull, legs'" and Button size sm "Withdraw".
4. Section "Last workouts", five Rows: title "Legs", subtitle "Sun 7 Sep · 52m · 18 sets · 1 PR", value "4,860 kg" in .lrow-v; then "Pull" (Fri 5 Sep · 48m · 16 sets · 4,120 kg), "Push", "Legs", "Pull" with similar lines. No chevrons — read-only.
5. Button primary icon clipboard full width "Send a program" (opens C13).
Numbers tabular; "Last check-in" replaces the old "Last sync" tile.
```

## C5 — Coach · Client · Program

```
Same screen as C4 with the Segmented on Program; header unchanged.
1. .card "Current program": h2 "Push, pull, legs", .t-sub muted "Accepted 22 Aug · 3 routines · 21 exercises"; then a .week strip — .week > .wday with .lbl Mon…Sun, no .num, .dot.plan on Mon, Wed and Fri, .wday.today on Wed.
2. Section "Her routines", Rows with routine glyph icons and accessory chevron (read-only preview): icon arm, title "Push", subtitle "7 exercises", value "Mon"; icon pullup "Pull" "7 exercises" "Wed"; icon legs "Legs" "7 exercises" "Fri"; icon stretch "Mobility" subtitle "5 exercises · her own" and no value.
3. Section "Assignment history": Row icon checkCircle iconTint var(--green) "Push, pull, legs" subtitle "Accepted 22 Aug"; Row icon xmark iconTint var(--yellow) "Upper / lower" subtitle "Declined 3 Jul · 'Too many days'"; Row icon check iconTint var(--green) "Beginner block A" subtitle "Accepted 12 Mar".
4. .t-foot muted: "Her own routines are never changed by a program you send."
5. Button primary icon clipboard full width "Send a program".
Nothing here is editable — the coach edits programs in the library (C11), not inside a client.
```

## C6 — Coach · Client · Check-ins

```
Same screen as C4, Segmented on Check-ins.
1. .tiles: .l "Last check-in" .v "9 d" in var(--red); "Streak" "0 wk"; "Avg score" "3.4".
2. .card "Check-in day": .row.between — "Sunday" in .t-body and "Overdue since 31 Aug" as .t-sub in var(--red).
3. One .card per check-in, newest first: .row.between with .t-sub muted date and a bold score "3.4" followed by "/5" in --label-3; then a .row of five .tag pills "Energy 3" "Sleep 2" "Recovery 4" "Life stress 3" "Nutrition 5"; then the note in .t-body. Entries: Sun 24 Aug, score 3.4 in var(--yellow), note "Work was brutal this week, slept badly Tue–Thu. Legs felt fine though."; Sun 17 Aug, 4.0 in var(--green), "Best week in a while."; Sun 10 Aug, 2.8 in var(--red), "Ankle still sore, skipped legs."; Sun 3 Aug, 3.6, no note.
Score colour: var(--green) at 4 and above, var(--yellow) 3–3.9, var(--red) below 3.
Nothing on this tab is editable; no buttons. The check-in questions are fixed — do not draw an "edit questions" control.
```

## C7 — Coach · Client · Photos

```
Same screen as C4, Segmented on Photos.
1. .t-sub muted line under the Segmented: "Newest first · three angles a week · tap one to open it full width."
2. One .card per week: .t-sub muted "Sun 24 Aug", then a .row of three 3:4 tiles (--surface-2 placeholders, radius 8, no real photos) captioned .t-cap centred "Front" "Side" "Back". Weeks: 24 Aug, 17 Aug, 10 Aug.
3. In the 24 Aug card, show the Front tile opened full width beneath the row (radius 12) to demonstrate the expanded state — same-angle comparison is a scroll away, so this is not a lightbox.
4. A final small .card, muted: .t-head "In the mobile app" and .t-sub "Photos only open in the browser dashboard, not in the app build." Draw it quiet, at the bottom, not as an error.
No upload control anywhere — the coach never adds photos; the client sends them in the check-in (P7).
```

## C8 — Coach · Client · Stats

```
Same screen as C4, Segmented on Stats. This is StatsPanels in read-only mode against Sara's data — the same panels a client sees on her own Stats screen, minus every button that writes.
1. .card "Body weight": .big "64.2 kg" with a small icon arrowDown and "0.4" in var(--green) beside it, .t-sub dim "Sun 7 Sep"; LineChart of 30 points, unit kg, goal 62 as a dashed line.
2. .card "Waist": .big "74 cm" and a LineChart of 8 tape points.
3. .card "Training days": Heatmap of the last 12 weeks × 7 days, trained cells in var(--acc).
4. .card "Muscle balance": BodyMap front and back side by side, BodyMapLegend beneath.
5. .card "Estimated 1RM": Section with three Rows — "Squat" value "95 kg", "Bench" "52 kg", "Deadlift" "115 kg", each subtitle "2.5 kg up this month" with icon arrowUp iconTint var(--green).
No Log, Goal or Add buttons anywhere on this tab.
```

## C9 — Coach · Client · overflow menu

> Rewritten. The earlier draft gave this screen a **Notes** tab; there is no such thing. The
> coach-private notes route was written and then removed during P3 review — it was write-only,
> nothing ever read it back — so a Notes tab on an artboard would send P7 off to build a feature
> that was deliberately deleted. The shipped tabs are Overview, Program, Check-ins, Photos, Stats
> and nothing else.
>
> What this artboard is FOR is the overflow menu, which is still unbuilt: `POST
> /api/coach/member/release` shipped in PR #45 and has no entry point anywhere in the UI.

```
Same screen as C4 (Segmented on Overview, dimmed by .mback), with the header overflow menu open.
Overflow menu: anchored under the .iconbtn "more" at the top right, drawn as a small .card (radius 12, background var(--surface-2), width about 240) containing a Section of three Rows without icons:
- "Send a program", accessory chevron.
- "Release from my clients", title in var(--yellow).
- "Disable account", as .lrow.danger.
The rest of the screen is dimmed; the tab bar stays visible.
Releasing is the coach's half of a relationship ending. It is not disabling: the client keeps their account, their history and their own plan, and can join someone else with a new link. Any program still waiting for them is withdrawn at the same moment.
No "Reassign coach" item - there is one coach. No "Delete" - disabling keeps the data. No Notes anywhere.
```

## C10 — Coach · Programs library

```
Same shell as C1, Programs cell on. .hdr h1 "Programs", .sub "4 in your library"; right Button tinted sm icon plus "New" (opens C11 blank).
.list > .item rows, each with a .thumb (44px, background var(--acc-soft)) holding a routine glyph icon in var(--acc), then .grow with .tt and .ss, a .tag and .chev:
- icon barbell · .tt "Push, pull, legs" · .ss "3 routines · 21 exercises · sent to 5 clients" · .tag.acc "3 days/wk"
- icon dumbbell · "Upper / lower" · "4 routines · 24 exercises · sent to 3" · .tag "4 days/wk"
- icon sparkles · "Beginner block A" · "2 routines · 12 exercises · sent to 4" · .tag "2 days/wk"
- icon kettlebell · "Home dumbbells" · "3 routines · 15 exercises · never sent" · .tag "3 days/wk"
Below the list a Section "Start from" with Rows, accessory chevron: icon figureStrength "Copy from my own plan", subtitle "Your current routines, saved as a program"; icon sparkles "Starter plan", subtitle "Beginner 3-day, intermediate 4-day…".
Bottom .t-foot muted: "Programs live in your library, not in your own plan. Editing one later never changes what a client already accepted."
No "Send my current plan instead" button and no "build it in your Plan first" copy.
```

## C11 — Coach · Program editor

```
Same shell as C1, Programs cell on. .hdr: left .iconbtn chevronLeft, h1 "Push, pull, legs" with a small icon pencil after it in --label-3, .sub "Saved just now"; right Button tinted sm icon clipboard "Send" (opens C13).
1. TextField labelled "Program name", value "Push, pull, legs".
2. Section "Routines": Rows with routine glyphs and chevron — icon arm "Push" subtitle "7 exercises · about 45 min"; icon pullup "Pull" "7 exercises"; icon legs "Legs" "7 exercises". Then Row icon plus iconTint var(--acc) "New routine" and Row icon figureStrength "Copy from my own plan".
3. Section "Weekly schedule": seven Rows Mon…Sun, each with a value in .lrow-v and a chevron — Mon "Push", Tue "Rest" in --label-3, Wed "Pull", Thu "Rest", Fri "Legs", Sat "Rest", Sun "Rest".
4. Section "Defaults (optional)": Row icon target "Daily targets" value "2,100 kcal · 150 g protein" chevron; Row icon calendar "Check-in day" value "Sunday" chevron.
5. Section with a single .lrow.danger "Delete program".
Draft autosaves, so there is no Save button; Send lives in the header. Everything scrolls under the tab bar.
```

## C12 — Coach · Routine editor in program context

```
Same shell as C1, Programs cell on. The existing routine editor mounted inside a program, so the header carries a breadcrumb: .hdr with .iconbtn chevronLeft, then a .t-foot muted "Push, pull, legs" above h1 "Push", .sub "7 exercises · about 45 min"; right .iconbtn more.
1. A .row of two Buttons size sm: tinted icon plus "Add exercise"; plain icon shuffle "Reorder".
2. .list > .item rows, one per exercise, each with .thumb (48px --surface-2 placeholder for the exercise animation), .tt the exercise name, .ss the set scheme, .chev:
- "Barbell bench press" · "4 × 6–8 · +2.5 kg on success"
- "Incline dumbbell press" · "3 × 8–10"
- "Overhead press" · "3 × 6–8"
- "Cable fly" · "3 × 12–15"
- "Lateral raise" · "3 × 12–15 · superset A"
- "Triceps pushdown" · "3 × 12–15 · superset A"
- "Overhead triceps extension" · "2 × 15"
3. Section "Routine": Row icon arm "Glyph" value "Arm" chevron; Row icon timer "Rest timer" value "90 s" chevron; Row icon list "Progression" value "Double progression" chevron.
4. Section with a single .lrow.danger "Remove from program".
The breadcrumb is the only thing that says this is a program routine — the editor is otherwise identical to the client's own.
```

## C13 — Coach · Send program sheet

```
Same shell as C1 underneath: draw C4 dimmed by .mback with the tab bar visible. Sheet .sheet with .grab and <h3> "Send 'Push, pull, legs'".
Under the title a .t-sub muted "3 routines · 21 exercises · scheduled on 3 days", then .t-foot dim "Sara is asked to accept before anything is added. Her own routines are never changed."
1. TextField labelled "Note (optional)", placeholder "What this block is for".
2. Section: Row icon calendar "Also set her weekly schedule" with a Switch (on); .t-foot dim beneath "Replaces which routine sits on each weekday. Off adds the routines and lets her slot them in."
3. Section "Daily targets (optional)": four Rows with a NumberField on the right — "Calories" 2,100 kcal; "Protein" 150 g; "Carbs" empty "—" g; "Fat" empty "—" g; then TextField "Note on the diet (optional)".
4. Section: Row icon calendar "Check-in day" value "Leave as Sunday" chevron.
5. Section "Send to": Rows with Check accessories — Sara Benali (checked, preselected from her page), Youssef K., Lina M., Omar R.; each subtitle like "24 workouts · synced 2h ago".
6. Button primary full width "Send to 1 client" — the label counts the checked rows.
Sheet about 85% height, scrolls internally. No "build it in your Plan first" state exists any more.
```

## C14 — Coach · Invite sheet

```
Same shell as C1 underneath: draw C3 dimmed by .mback, Clients cell on. Sheet .sheet, .grab, <h3> "Invite a client".
1. .t-sub muted "Share the link. Whoever opens it signs up and lands on your roster."
2. A .card with the link as .t-callout in --label-2: "coach.fitpal.ma/?invite=K7F2-9QDM"; beneath it Button primary icon link full width "Share link", then a plain Button "Copy link".
3. Section "Waiting": Row title "K7F2-9QDM", subtitle "For Sara's sister · made Mon", with a Button size xs "Copy" and an .iconbtn trash on the right; Row "P3XA-1LMR", subtitle "made 2 Sep", same actions.
4. Section "Joined": Row icon person iconTint var(--green) "Nadia E." subtitle "Joined Mon 8 Sep" value "Q8R2-…" in --label-3; Row icon person "Karim B." subtitle "Joined 14 Aug" value "H4TN-…".
No red card about an admin or invite-only; no quota text (it only appears when the cap is hit). Revoke is the trash icon and is confirmed on tap — the confirm is not drawn. Sheet about 75% height.
```

## C15 — Coach · Exercise demos sheet

```
Same shell as C1 underneath: draw C16 dimmed by .mback, Account cell on. Sheet .sheet, .grab, <h3> "Exercise demos".
1. .t-sub muted "Your own video of a lift, shown to every client instead of the stock animation. Any phone video works."
2. Section "1 · Pick the exercise": SearchField placeholder "Search the exercise library"; below it the chosen exercise as a Row: icon barbell, title "Barbell bench press", subtitle "2 of 6 uploaded", with a Button size xs "Change" on the right.
3. Section "2 · Send the video": TextField labelled "Label (optional)", placeholder "e.g. side on, 60 kg"; Button primary icon upload full width "Choose a video". Draw the resting state, before a file is chosen.
4. Section "Already uploaded": Row icon play "side on" subtitle "18 MB · 2 Sep"; Row icon play "front, 60 kg" subtitle "24 MB · 28 Aug"; Row icon warning iconTint var(--yellow) "Squat — phone clip" subtitle "41 MB · 20 Aug" with a .tag "needs conversion" in var(--yellow).
5. A collapsed disclosure at the bottom: Row icon info "Why didn't it play?" accessory chevronDown — the HEVC explanation lives inside, closed here.
When an exercise is full the button reads "This exercise is full — pick another"; not shown in this state. Sheet about 85% height.
```

## C16 — Coach · Account

```
Same shell as C1, Account cell on. .hdr h1 "Account", .sub "Ahmed · Coach".
Grouped Sections of Rows, each at least 44px, with icon, title and accessory:
Section "Profile": Row icon personCircle iconTint var(--acc) "Ahmed" subtitle "Coach" chevron; Row icon qr "Pair mobile" subtitle "Sign this phone into the app" chevron.
Section "Coaching": Row icon link "Invite link" subtitle "2 waiting" chevron (opens C14); Row icon camera "Exercise demos" subtitle "5 videos" chevron (opens C15); Row icon figureStrength iconTint var(--acc) "Train myself" subtitle "Open the app as a client" chevron (opens C19).
Section "Appearance": Row icon moon "Theme" value "Dark" chevron; Row icon sparkles "Accent" value "Gold" with a small gold swatch before the value; Row icon globe "Language" value "English" chevron.
Section "Business": Row icon people "Accounts" subtitle "13 accounts · 1 disabled" chevron (C17); Row icon history "Activity log" subtitle "Sign-ins and changes" chevron (C18).
Section: Row icon signOut "Sign out"; .lrow.danger "Sign out everywhere".
Footer .t-cap dim centred "FitPal Coach · v2.0".
No classes, timetable, access requests, invite-only toggle or AI-coach rows anywhere.
```

## C17 — Coach · Business · Accounts

```
Same shell as C1, Account cell on (Business subpage). .hdr with .iconbtn chevronLeft, h1 "Accounts", .sub "13 · 1 disabled".
SearchField placeholder "Search accounts".
.chips: .chip.on "All", .chip "Clients", .chip "Disabled".
.list > .item rows with .tt name, .ss detail, and a .tag on the right where relevant:
- Ahmed · .tag.acc "coach" · .ss "You · 2 passkeys"
- Sara Benali · .ss "Joined 12 Mar · seen 2h ago · 1 passkey"
- Youssef K. · "Joined 3 Apr · seen today"
- Lina M. · "Joined 20 May · seen yesterday"
- Omar R. · "Joined 1 Jul · seen 6d ago"
- Nadia E. · .tag.acc "new" · "Joined Mon · seen today"
- Rachid F. · .tag "disabled" in var(--red), whole row at 55% opacity · "Disabled 2 Sep"
Tapping a row (not drawn) opens a small confirm sheet with Enable or Disable. Under the list a .t-foot muted: "Disabling keeps their data and signs them out everywhere. Nothing here deletes an account."
No role picker, no "make coach", no coach assignment — one coach owns every account.
```

## C18 — Coach · Business · Activity log

```
Same shell as C1, Account cell on (Business subpage). .hdr with .iconbtn chevronLeft, h1 "Activity", .sub "Last 30 days".
.chips: .chip.on "All", .chip "Sign-ins", .chip "Programs", .chip "Accounts".
One Section per day, Rows without chevrons:
Section "Today": Row icon key iconTint var(--green) "Sara Benali signed in" subtitle "08:12 · iPhone · passkey"; Row icon clipboard iconTint var(--acc) "You sent 'Push, pull, legs' to Sara Benali" subtitle "07:55"; Row icon check "Lina M. accepted 'Push, pull, legs'" subtitle "07:40".
Section "Yesterday": Row icon pencil "You saved 'Home dumbbells'" subtitle "19:20"; Row icon person "Nadia E. joined from invite K7F2-9QDM" subtitle "18:02"; Row icon xmark iconTint var(--red) "Rachid F. disabled" subtitle "11:30 · by you".
Section "Mon 8 Sep": Row icon key "Youssef K. signed in" subtitle "06:50 · Android"; Row icon trash "You deleted 'Old block'" subtitle "09:10"; Row icon link "You made invite P3XA-1LMR" subtitle "08:30".
Final .t-foot muted "Kept for 90 days." Times in tabular figures; the list scrolls under the tab bar.
```

## C19 — Coach · Train myself

```
Frame: phone 390×844, dark. Client shell: <nav id="tabbar"> with five cells — Today (icon house, class on), Plan (icon calendar), the raised centre button.start > span.cir holding icon dumbbell, Coach (icon clipboard), You (icon person).
A banner sits above the header: a .card with background var(--acc-soft), radius 12, .row.between — left a .row of icon figureStrength in var(--acc) and .t-callout "Training as yourself", right a Button size xs tinted "Back to coaching".
Then the client Today for the coach's own data: .hdr h1 "Hi Amine", .sub "Wednesday 10 September", .iconbtn gear.
.card with the week strip: .row.between of .iconbtn chevronLeft, "This week" in .t-sub muted, .iconbtn chevronRight; .week > .wday Mon…Sun with .lbl and .num 7…13, .dot.done on Mon, .dot.plan on Wed and Fri, .wday.today on Wed; then the .today-row: .lrow-i in var(--acc) with icon arm, .lbl2 "Today", .ttl "Push", .tag.acc "Start".
.card "Body weight": .row.between with h2 and Buttons size sm icon target "Goal" and icon plus "Log"; .big "78.4 kg"; LineChart of 30 points.
.card streak: .row of icon flame in var(--orange) and "6 week streak" at 22px 600, .t-sub muted "1 / 3 this week · 142 workouts total", .iconbtn calendar on the right.
No offer card, no check-in card, no photos-due, no targets, no "Your coach" row — the coach has no coach.
```

## D1 — Desktop · Today

```
Frame: desktop 1200×800, dark. No phone tab bar. A left rail 220px wide in --bg-el with the Logo at the top, then four nav Rows without accessories: Today (icon house, active — title in var(--acc) on a var(--acc-soft) background), Clients (icon people), Programs (icon clipboard), Account (icon person). At the bottom of the rail a Row icon figureStrength "Train myself".
Main area is #app with .cols for two columns, roughly 60 / 40, 24px gutters.
Header across the main area: .hdr h1 "Today", .sub "Wednesday 10 Sep · 12 clients", .iconbtn reset on the right.
Left column: .tiles (Clients 12; Training now 2 in var(--acc); Active 7d 9); Section "Needs attention" with the same five Rows as C1; Section "Recent activity" with the three Rows from C1 plus Row icon scale "Omar R. logged a weigh-in" subtitle "Mon" and Row icon check "Hind A. finished Legs" subtitle "Sun".
Right column: the "Training now" .card from C1 (border var(--acc), two live .item rows with .tag.acc durations); then a .card "This week" with a Heatmap of 12 clients × 7 days, rows labelled by first name, trained cells in var(--acc), rest cells --surface-2.
Cards keep the 14px radius; no hover states drawn; numbers tabular.
```

## D2 — Desktop · Client detail

```
Frame: desktop 1200×800, dark. Same left rail as D1 with Clients active.
Header: .iconbtn chevronLeft, h1 "Sara Benali", .sub "Client since March · 24 workouts"; right side a .row of Button tinted sm icon clipboard "Send a program" and an .iconbtn more.
Under it the Segmented (Overview selected · Program · Check-ins · Photos · Stats — five tabs, no Notes) spanning the main width.
.cols, two columns:
Left (wider): .tiles four — Adherence "61%" in var(--yellow), Last check-in "9 d" in var(--red), Workouts "24", Routines "3"; the Adherence .card with the 28 squares from C4; the pending-offer .card with border var(--acc) and Button size sm "Withdraw"; Section "Last workouts" with five Rows and .lrow-v volumes.
Right: .card "Body weight" with .big "64.2 kg" and a LineChart with goal 62; .card "Latest check-in" with .t-sub "Sun 24 Aug", score "3.4" and "/5" in --label-3, the five .tag pills, the note in .t-body; .card "Adherence" repeating the 28-day strip from the Overview tab, since a desktop column has the room for it. (The earlier draft put a private-notes card here; there are no notes.)
Everything on this screen is read-only except Send a program and Withdraw. No messaging panel, no chat column.
```

## D3 — Desktop · Program editor

```
Frame: desktop 1200×800, dark. Left rail from D1 with Programs active.
Header: .iconbtn chevronLeft, h1 "Push, pull, legs", .sub "Saved just now"; right a .row of Button tinted sm icon clipboard "Send" and an .iconbtn trash.
.cols, two columns:
Left column (routines): TextField labelled "Program name" value "Push, pull, legs"; Section "Routines" with Rows icon arm "Push" (subtitle "7 exercises · about 45 min"), icon pullup "Pull", icon legs "Legs", each chevron, the Push row highlighted with a var(--acc-soft) background as the selected one; then Rows "New routine" (icon plus, iconTint var(--acc)) and "Copy from my own plan" (icon figureStrength). Under the section the selected routine expands inline: a .list of the seven .item exercise rows from C12 (.thumb, .tt, .ss, .chev) with a Button size sm tinted icon plus "Add exercise" above it, so a routine is edited without leaving the page.
Right column (schedule + send): Section "Weekly schedule" with seven Rows Mon…Sun and .lrow-v values Push / Rest / Pull / Rest / Legs / Rest / Rest; Section "Defaults" with Row icon target "Daily targets" value "2,100 kcal · 150 g protein" and Row icon calendar "Check-in day" value "Sunday"; a .card "Send to" with four Rows and Check accessories (Sara Benali checked; Youssef K., Lina M., Omar R. unchecked) and Button primary full width "Send to 1 client".
24px gutters; numbers tabular; no Save button — the draft autosaves.
```

## P1 — Client · Today coached

```
Frame: phone 390×844, dark. Client shell: <nav id="tabbar"> with five cells — Today (icon house, class on), Plan (icon calendar), the raised centre button.start > span.cir holding icon dumbbell, Coach (icon clipboard), You (icon person).
.hdr h1 "Hi Sara", .sub "Wednesday 10 September", .iconbtn gear.
Top-to-bottom:
1. Offer card: .card with border var(--acc), .row.between — .tt "Amine sent you a program", .ss dim "Push, pull, legs — let's build the base.", .chev (opens P6).
2. Week card: .row.between of .iconbtn chevronLeft, "This week" .t-sub muted, .iconbtn chevronRight; .week > .wday Mon…Sun with .lbl and .num 7…13, .dot.done Mon, .dot.plan Wed and Fri, .wday.today Wed; then .today-row: .lrow-i in var(--acc) with icon pullup, .lbl2 "Today", .ttl "Pull", .tag.acc "Start".
3. Check-in card: .row.between — .tt "Weekly check-in", .ss "3 weeks running — keep it going.", Button size sm icon plus "Check in" (opens P7).
4. Photos-due card: .row.between — .lrow-i in var(--acc) with icon camera, .lbl2 "Progress photos", .ttl "Front · side · back", .chev.
5. Targets card: h2 "Today's targets", TargetRows — Calories 1,420 of 2,100 kcal, Protein 96 of 150 g, bars in var(--acc).
6. Body weight card: h2 with Buttons size sm icon target "62" (var(--yellow)) and icon plus "Log"; .big "64.2 kg" with icon arrowDown "0.4" in var(--green); LineChart of 30 points with the goal line.
7. Streak card: icon flame in var(--orange), "3 week streak", .t-sub muted "1 / 3 this week · 24 workouts total", .iconbtn calendar.
No gym QR card, no starter-plan welcome.
```

## P2 — Client · Today waiting

```
Same shell as P1, Today cell on. .hdr h1 "Hi Nadia", .sub "Wednesday 10 September", .iconbtn gear.
1. Week card as in P1 but every .dot empty, .wday.today on Wed; the .today-row has .lrow-i in --surface-3 holding icon moon, .lbl2 "Today", .ttl "Rest day", and icon plus as .chev.
2. Waiting card, which replaces the old starter-plan welcome: .card with a .row of .lrow-i in var(--acc-soft) holding icon clipboard in var(--acc) and .big at 22px "Amine is preparing your program"; .t-sub muted "You'll get a card here the moment it's sent. Until then you can log a weigh-in or start a free workout."; Button tinted icon dumbbell full width "Start a free workout".
3. Body weight card: .row.between with h2 and Buttons size sm icon target "Goal" and icon plus "Log"; no-entries state as .t-sub muted "No entries yet — log your weight to start the curve."
4. Streak card: icon flame in --label-3, "0 week streak", .t-sub muted "0 this week · 0 workouts total", .iconbtn calendar.
No offer card, no check-in card (nothing due yet), no photos-due, no targets, no QR card, no "Load starter plan" button — the coach sends the plan.
```

## P3 — Client · Plan

```
Same shell as P1, Plan cell on. .hdr h1 "Plan", .sub "Push, pull, legs · 3 days a week"; right Button tinted sm icon plus "Routine".
1. .card "Week": .week > .wday Mon…Sun with .lbl only, .dot.plan on Mon, Wed and Fri, .wday.today on Wed. Under the strip, inside the card, seven compact .row.between lines: "Mon" · "Push"; "Tue" · "Rest" in --label-3; "Wed" · "Pull"; "Thu" · "Rest"; "Fri" · "Legs"; "Sat" · "Rest"; "Sun" · "Rest".
2. Section "Routines" as .list > .item rows: .thumb with icon arm in var(--acc) on var(--acc-soft), .tt "Push", .ss "7 exercises · 45 min · from Amine", .chev; icon pullup "Pull" .ss "7 exercises · from Amine"; icon legs "Legs" .ss "7 exercises · from Amine"; icon stretch "Mobility" .ss "5 exercises · mine".
3. Section "Settings": Row icon calendar "Week starts on" value "Monday" chevron; Row icon timer "Rest timer" value "90 s" chevron; Row icon list "Progression" value "Double progression" chevron.
There is no AI-coach call to action on this screen. Program routines are editable like her own — no lock icons, no "from your coach" banner beyond the .ss text.
```

## P4 — Client · Coach tab

```
Same shell as P1, Coach cell on. .hdr h1 "Coach", .sub "Ahmed".
1. Coach header .card: .row with a 56px circle in var(--acc-soft) holding the initial "A" in var(--acc) at .t-title size, then .t-head "Ahmed" and .t-sub muted "Can see your training and send you programs."
2. Section "Pending": Row icon clipboard iconTint var(--acc) "Push, pull, legs" subtitle "Sent Monday · 'Let's build the base.'" with a .tag.acc "Review" on the right (opens P6).
3. Section "Current program": Row icon checkCircle iconTint var(--green) "Beginner block A" subtitle "Accepted 12 Mar · 2 routines" chevron.
4. .card "Weekly check-in": .row.between — .tt "Due today", .ss "3 weeks running", Button size sm icon plus "Check in" (opens P7). Under it three compact .row.between lines: "24 Aug" · "3.4/5"; "17 Aug" · "4.0/5"; "10 Aug" · "2.8/5"; then a plain Button "All check-ins" (opens P8).
5. .card "Progress photos": .t-sub muted "Sun 24 Aug", a .row of three 3:4 tiles (--surface-2, radius 8) captioned .t-cap Front / Side / Back, then a plain Button "Gallery" (opens P8, Photos segment).
6. .card "Daily targets": TargetRows — Calories 1,420 of 2,100 kcal, Protein 96 of 150 g, Carbs 140 of 220 g, Fat 48 of 70 g.
7. Reserved row, last: Section with one Row — icon bell in --label-3, title "Messages" in --label-3, and a .tag "Coming soon" in --label-3; no chevron, not tappable. It is a placeholder for later, not a feature; draw nothing else about chat.
   NOTE for the P7 parity pass: this row is DELIBERATELY on the artboard and NOT in the app. The shipped Coach tab (views/MyCoach.jsx) has no messaging row, by the plan's own decision that messaging is out of scope and appears in mockups only. Do not resolve this difference in either direction — neither build the row nor delete it from the artboard.
```

## P5 — Client · Coach tab, no coach

```
Same shell as P1, Coach cell on. .hdr h1 "Coach", .sub "Training on your own".
1. Empty-state .card, centred: .lrow-i enlarged to 48px with background var(--acc-soft) holding icon personCircle in var(--acc); .t-title2 "You're training on your own"; .t-sub muted "Everything works without a coach. If someone is coaching you, enter their invite and they'll see your training and can send you programs."
2. Section "Have an invite link?": TextField labelled "Invite code", empty, placeholder "K7F2-9QDM"; Button primary icon link full width "Join my coach", drawn disabled (the code field is empty); .t-foot muted "Opening the link on this phone fills this in for you."
3. Section "Keep going": Row icon calendar "Plan" subtitle "Your routines and week" chevron; Row icon chart "Stats" subtitle "Weight, volume, 1RM" chevron; Row icon sparkles "Starter plan" subtitle "A ready-made week to begin with" chevron.
No pending, no current program, no check-in card, no photos, no targets, and no Messages row — none of those exist without a coach.
```

## P6 — Client · Program offer sheet

```
Same shell as P1 underneath: draw P1 dimmed by .mback, tab bar visible. Sheet .sheet with .grab and <h3> "Amine sent you a program".
1. .t-callout "Push, pull, legs" and .t-sub muted "3 routines · 21 exercises · 3 days a week".
2. .card with the coach's note in .t-body: "Let's build the base. Three days, nothing fancy, and we add weight every week you hit the top of the range." and .t-cap dim "Sent Monday".
3. Section "What you'll get": Row icon arm "Push" subtitle "7 exercises" value "Mon"; Row icon pullup "Pull" subtitle "7 exercises" value "Wed"; Row icon legs "Legs" subtitle "7 exercises" value "Fri". No chevrons.
4. Section: Row icon calendar "Set my weekly schedule" subtitle "Mon, Wed and Fri" with a Switch (on); Row icon target "Daily targets" subtitle "2,100 kcal · 150 g protein"; Row icon calendar "Check-in day" value "Sunday".
5. .t-foot muted "Your own routines stay as they are. Declining tells Amine, nothing else."
6. Button primary full width "Accept program"; beneath it a plain Button "Decline" with the label in --label-2.
Sheet about 80% height. This is the client's translated surface, so keep the copy plain enough to translate.
```

## P7 — Client · Check-in sheet

```
Same shell as P1 underneath: draw P4 dimmed by .mback, tab bar visible. Sheet .sheet, .grab, <h3> "Weekly check-in", .t-sub muted "Week of 8 Sep · about a minute".
1. Five scale rows. Each is a .row.between with the label in .t-body on the left and a Segmented of 1 · 2 · 3 · 4 · 5 on the right (the selected segment in var(--acc)); under each label a .t-cap dim hint. "Energy" 3 selected, hint "How you felt in the gym and out of it"; "Sleep" 2, "Hours and quality together"; "Recovery" 4, "5 = fresh, 1 = still sore from last time"; "Life stress" 3, "5 = calm week, 1 = relentless"; "Nutrition" 5, "How closely you ate the way you meant to".
2. TextArea labelled "Anything Amine should know?" with two lines of sample text: "Slept badly Tue–Thu, work was brutal. Legs felt fine though."
3. Section "Progress photos": a .row of three 3:4 slots (--surface-2, dashed --sep border, radius 8), each with icon camera centred and a .t-cap "Front" / "Side" / "Back"; the Front slot is filled with a grey thumbnail and a small icon check in var(--green) to show one taken.
4. Button primary full width "Send check-in"; .t-foot dim beneath "Photos are optional. Only Amine sees this."
Sheet about 90% height, scrolls internally; every segment is at least 44px tall.
```

## P8 — Client · Check-in history + photo gallery

```
Same shell as P1, Coach cell on (subpage). .hdr with .iconbtn chevronLeft, h1 "Check-ins", .sub "3 weeks running · average 3.4".
Segmented under the header: "History" (selected) · "Photos".
History: one .card per check-in, newest first — .row.between with .t-sub muted "Sun 24 Aug" and the score "3.4" bold in var(--yellow) followed by "/5" in --label-3; a .row of five .tag pills "Energy 3" "Sleep 2" "Recovery 4" "Stress 3" "Nutrition 5"; the note in .t-body. Then Sun 17 Aug (4.0 in var(--green), "Best week in a while."), Sun 10 Aug (2.8 in var(--red), "Ankle still sore, skipped legs."), Sun 3 Aug (3.6, no note).
Photos segment: draw it as a second frame beside this one labelled "P8 — Photos", same header with the Segmented on Photos; one .card per week — .t-sub muted "Sun 24 Aug" and a .row of three 3:4 tiles (--surface-2, radius 8) captioned .t-cap Front / Side / Back; weeks 24 Aug, 17 Aug, 10 Aug; in the first card the Side tile is opened full width beneath the row, as on C7.
No edit or delete anywhere — a check-in is filed once. No coach replies or comments.
```

## P9 — Client · You hub

```
Same shell as P1, You cell on. .hdr h1 "You", .sub "Sara Benali".
Section "Profile": Row icon personCircle iconTint var(--acc) "Sara Benali" subtitle "Coached by Amine" chevron.
Section "Training": Row icon chart "Stats" subtitle "Weight, volume, 1RM, muscles" chevron; Row icon history "History" subtitle "24 workouts" chevron; Row icon magnifier "Library" subtitle "1,324 exercises + 2 of yours" chevron; Row icon figureStrength "Muscles" subtitle "Recovery map" chevron; Row icon flame "Nutrition" subtitle "Targets from Amine" chevron.
Section "Body": Row icon scale "Body weight" value "64.2 kg" chevron; Row icon target "Measurements" subtitle "Waist, hips, arm…" chevron.
Section "App": Row icon gear "Settings" chevron (opens P10); Row icon bell "Notifications" value "On" chevron.
Section: Row icon signOut "Sign out".
Footer .t-cap dim centred "FitPal Coach · v2.0".
Rows that must not appear: Staff, Admin, Coach dashboard, Sessions, Gym check-in. The pending-offer dot lives on the Coach tab cell, not here, and neither does the offer itself.
There is no AI Coach row. An earlier revision of this brief put one here, last in Training, after P5 part 2 moved it off the banner above the Plan screen. The whole feature was removed afterwards, so the row does not exist on any screen — "Coach" means a person, and nothing on a client's plan advertises an automated one.
```

## P10 — Client · Settings

```
Same shell as P1, You cell on (subpage). .hdr with .iconbtn chevronLeft, h1 "Settings", .sub "Sara Benali".
Section "Workout": Row icon timer "Rest timer" value "90 s" chevron; Row icon scale "Units" value "kg" chevron; Row icon list "Show RIR" with a Switch (on); Row icon calendar "Week starts on" value "Monday" chevron; Row icon bell "Rest-timer alerts" with a Switch (on).
Section "Appearance": Row icon moon "Theme" value "Dark" chevron; Row icon sparkles "Accent" value "Gold" with a small gold swatch before the value; Row icon globe "Language" value "English" chevron.
Section "Data": Row icon download "Export my data" chevron; Row icon upload "Import" chevron; Row icon qr "Pair mobile" subtitle "Sign the app in with this phone" chevron.
Section "Account": Row icon key "Passkeys" value "2" chevron; Row icon signOut "Sign out everywhere"; .lrow.danger "Delete my account".
Footer .t-cap dim centred "FitPal Coach · v2.0".
Rows that must not appear: Admin, Coach dashboard, "Your coach", Gym check-in / QR toggle, AI coach, Sessions. Their SCREENS are deleted, so there is nothing to link to even if one were drawn; the session routes still exist on the server. Every row is at least 44px; values right-aligned in .lrow-v.
```

## P11 — Client · Today, light theme

```
Frame: phone 390×844, LIGHT theme: set data-theme="light" on the root element and change nothing else. Every colour must come from the same var(--…) tokens so the light values map in on their own — --bg, --surface, --label and --sep switch; --acc stays gold; --on-acc stays dark.
Reproduce P1 exactly: the same five-cell client tab bar with Today on and the raised button.start; .hdr "Hi Sara" / "Wednesday 10 September" with the gear .iconbtn; the offer card with the gold border; the week card with .week > .wday (.dot.done Mon, .dot.plan Wed and Fri, .wday.today Wed) and the .today-row with .tag.acc "Start"; the check-in card; the photos-due card; the targets card with TargetRows; the body-weight card with .big "64.2 kg" and the LineChart with goal line; the streak card with icon flame in var(--orange).
Check specifically: .tag.acc keeps --on-acc text and stays legible on a light surface; .dot.done and .dot.plan still read against the card; the LineChart line and goal line use their light tokens; #tabbar is --bg-el at 94% with the hairline top; .card borders come from --sep, not a hard-coded grey.
Purpose: prove the token mapping both ways. If anything needs a hard-coded colour to look right in light mode, that is a bug in the tokens — flag it in a note beside the frame, do not patch it in the artboard.
```

---

## R4 — licensing, self-serve signup and sign-in by email

> Added for R4 (Linear CHW-234). Same session rules as above: paste the Consistency rules first,
> then one brief per message. These continue the numbering (S4–S7, C20–C23) and add an E series
> for mail. Plans are named Solo, Pro and Studio and differ only by how many active clients they
> allow (10, 30, 75); prices are never drawn — they live in the payment page, not in the app.
> Billing copy states facts and next steps; nothing alarming, no red for a trial ending.

## S4 — Start (coach signup)

```
Frame: phone 390x844, dark. No tab bar. Same centred column as S1: the Logo, then one muted line under it: "Coach your clients from one app."
26px gap, then a .card titled with .t-sub "Your plan":
  a Segmented with three options "Solo", "Pro", "Studio" (Pro selected), and under it one muted line that follows the choice: "Up to 30 active clients".
  10px gap, a second Segmented "Monthly" / "Yearly" (Monthly selected).
  10px gap, a .dim .small line: "14 days free, then billed by Creem. Cancel any time from Account."
18px gap, then the form, each field full width:
  TextField placeholder "Your name".
  TextField placeholder "Email" (type email), with a .dim .small caption under it: "For receipts and for signing in if you lose your passkey."
  14px gap, Button variant primary, icon person, "Create passkey and continue".
20px gap, a centred .dim .small line: "Already coaching here? " followed by a link-styled "Sign in".
Rules: the plan comes pre-selected from the link (?plan=pro&period=month); when the link names none, Pro and Monthly are the defaults drawn here. No price, no card field — the card is entered on the payment page that opens next. One coach per account; no gym, team or seat wording.
```

## S5 — Login, sign in with email

```
Frame: phone 390x844, dark. S1 unchanged except under the passkey button: draw two states side by side as two artboards, "S5a" and "S5b".
S5a: under "Sign in with passkey", a 10px gap, then Button variant ghost, icon link, "Sign in with email". Under it, open, an inline .card: TextField placeholder "Your email" (type email, focused), then Button variant primary full width "Send me a link". The "Create new profile" and guest buttons move below the card.
S5b: the same card after sending: icon link in var(--acc) at 28px, centred .tt "Check your inbox", centred .ss "If that address belongs to a coach, a sign-in link is on its way. It works once, for 15 minutes.", then a plain Button "Use another address".
Rules: the passkey button stays first and primary — email is the fallback. The confirmation never says whether the address exists (that is deliberate). Not shown in guest mode. Clients do not sign in by email; nothing here addresses them.
```

## S6 — Link landing

```
Frame: phone 390x844, dark. No tab bar. Three artboards, "S6a", "S6b", "S6c", each the S1 centred column with the Logo on top.
S6a (loading): under the logo a spinner in var(--acc) and a muted line "Signing you in…".
S6b (signed in): icon checkCircle in var(--green) at 32px, .tt "You are signed in", .ss "Taking you to Today…". (The app moves on by itself; draw the moment before.)
S6c (expired or used): icon clock in var(--label-3) at 32px, .tt "This link no longer works", .ss "Sign-in links work once, for 15 minutes.", then Button variant primary full width "Send a new link" and under it a plain Button "Sign in with passkey".
Rules: no error red — an old link is ordinary. The two server sentences ("this sign-in link has expired — request a new one", "this sign-in link was already used") may replace the .ss line; keep room for two lines.
```

## S7 — Add a passkey sheet

```
Same shell as C1 underneath (Today, coach shell), dimmed by .mback. Sheet .sheet, .grab, <h3> "Add a passkey to this device?".
1. .t-sub muted "You signed in with an email link. A passkey lets you sign in here with fingerprint, face or PIN next time — no email needed."
2. Button primary icon person full width "Add passkey".
3. A plain Button "Not now".
Rules: offered once per device after a link sign-in; "Not now" is remembered and the sheet does not come back on this device. Sheet about 40% height.
```

## C20 — Coach · Account · Plan & billing

```
Same shell as C16, Account cell on. Insert a new Section "Plan & billing" between "Profile" and "Coaching"; draw two artboards, "C20a" and "C20b".
C20a (trialing): Row icon sparkles iconTint var(--acc) title "Pro · monthly" subtitle "Free trial · ends 5 Nov" value "12 / 30 clients"; Row icon gear "Manage billing" subtitle "Payment method, invoices, change or cancel" chevron (opens the payment provider's page); a .dim .small footnote under the section: "Plans differ only by active clients: Solo 10, Pro 30, Studio 75."
C20b (read-only, payment failed for good): the first Row reads title "Pro · monthly" subtitle "Paused — your clients can still train" value "12 / 30 clients", then a .card with border var(--orange): .tt "Billing needs attention", .ss "You can see everything, but inviting, sending programs and uploading demos are paused until billing is sorted out.", Button primary full width "Update payment".
Rules: no prices. The client count is "active clients" (disabled clients do not count). Admins see none of this section.
```

## C21 — Coach · Today · banners

```
Same shell as C1, Today cell on. A single banner .card sits between the .hdr and the .tiles; draw five artboards C21a–C21e, everything else C1 unchanged.
C21a (activating, just back from the payment page): spinner in var(--acc), .tt "Setting up your plan…", .ss "This takes a few seconds." No button.
C21b (trialing, 3 days left): icon sparkles iconTint var(--acc), .tt "Free trial · 3 days left", .ss "Your Pro plan starts on 5 Nov." Button size xs "Plan & billing" on the right.
C21c (past_due): icon warning iconTint var(--orange), .tt "Payment didn't go through", .ss "We'll retry automatically. Everything keeps working meanwhile." Button size xs "Update payment".
C21d (lapsed, read-only): icon pause iconTint var(--orange), .tt "Your plan is paused", .ss "Clients can still train. Inviting, sending programs and uploading demos are paused." Button size xs "Fix billing".
C21e (over cap after a downgrade): icon people iconTint var(--yellow), .tt "32 active clients on a 30-client plan", .ss "Everyone keeps training. Upgrade to invite more." Button size xs "Upgrade".
Rules: one banner at a time, the most urgent first (lapsed, past_due, over cap, activating, trialing). It is a card, not a modal; it never covers the tiles.
```

## C22 — Coach · Invite sheet at the cap

```
Same as C14 (sheet over C3, Clients cell on), with the link card replaced; draw two artboards, "C22a" and "C22b".
C22a (at cap): in place of the link .card, a .card with border var(--yellow): icon people iconTint var(--yellow), .tt "Your plan allows 30 clients", .ss "You have 30 active clients. Upgrade your plan to invite more — or disable a client who has stopped training to free a seat.", Button primary full width "Upgrade plan", plain Button "Manage clients".
C22b (read-only): the same card in var(--orange): icon pause, .tt "Inviting is paused", .ss "Your plan is read-only until billing is sorted out.", Button primary full width "Plan & billing".
The "Waiting" and "Joined" sections stay below, unchanged; waiting codes can still be revoked.
```

## C23 — Coach · Account · email row

```
Same shell as C16, Account cell on. In Section "Profile", under the name Row, add the email Row; draw three artboards, "C23a" to "C23c".
C23a (verified): Row icon link title "ahmed@example.com" subtitle "Verified · for sign-in links and receipts" accessory chevron.
C23b (changing): Row icon link title "ahmed@example.com" subtitle "Waiting for confirmation of new@example.com" with a .tag "pending"; tapping opens a small sheet (draw it open): <h3> "Change email", TextField placeholder "New email", .dim .small "We'll send a link to the new address. Your sign-in email changes when you open it.", Button primary full width "Send link".
C23c (no email yet, an older account): Row icon link title "Add an email" subtitle "Lets you sign in by link if you lose your passkey" chevron.
Rules: the address never changes until the link is opened; the old address gets a notice. Clients have no email row.
```

## E1 — Mail · Sign-in link

```
Frame: email, 600px wide content on a mobile width of 390 (draw the 390 view). Light-on-dark brand palette from email/: background graphite #1C1A17, text bone #F2EDE4, muted #A9A198, rules #746C62, the button gold #D4AF37 with ink #14120F text — this is the one place outside the app tokens, because mail clients do not read CSS variables.
French copy (the primary language of the coaches):
  Wordmark as live text "FitPal Coach" in gold, small icon (https://fitpal.ma/icon-180.png, alt "") before it.
  Heading: "Votre lien de connexion".
  Body: "Bonjour Ahmed, voici votre lien pour vous connecter à FitPal Coach. Il fonctionne une seule fois, pendant 15 minutes."
  Button: "Me connecter".
  Under the button, muted: "Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :" then the link as text.
  Footer, muted, small: "Vous n'avez rien demandé ? Ignorez ce message — personne ne peut se connecter sans ce lien."
Rules: vous throughout; a table-based layout (Outlook-safe), no background images, no VML; Archivo with a system-font fallback; the plain-text part says the same words. The same design serves the email-change link ("Confirmez votre nouvelle adresse") and the change notice to the old address ("Votre adresse de connexion a changé"); draw the first only.
```

## Consistency rules

Paste once at the start of the session, before the first brief.

```
1. Dark is the default. Only P11 is light, and only via data-theme="light" on the root — no hand-picked light colours anywhere.
2. Every colour is a var(--…) token from styles.css. Gold appears only through var(--acc), var(--acc-soft), var(--acc-2) and var(--on-acc); no hex values, no other yellows.
3. No emoji anywhere. Icons are the Icon component with names from ICON_NAMES only; routine glyphs are arm, pullup, legs, stretch, kettlebell, barbell, dumbbell.
4. Every tappable target is at least 44px tall; Row, .item and tab cells never go below that.
5. The tab bar (#tabbar) is on every phone screen except S1–S3, and stays visible under open sheets. Coach shell = four cells (Today, Clients, Programs, Account), no raised button. Client shell = five cells (Today, Plan, Start, Coach, You) with the raised button.start > span.cir in the centre.
6. Numbers are tabular (the body style sets it); values sit right-aligned in .lrow-v and .tile .v, dates and times use the same figures.
7. Type only from the scale: h1 34/700, .big 30/600, body 17, .item .tt 16, .ss and .sect-t 13, .tag 12, tab label 10. No in-between sizes.
8. Radii: .card 14, buttons 12 (.sm 8), .sheet 22 at the top, tiles and thumbs 12. No other radius values.
9. Sheets are drawn open over the screen they belong to, on a dimmed .mback, with the .grab handle and an <h3> title; the sheet surface is --bg-el.
10. Coach copy is English, plain and short; client copy is written so it translates cleanly (no puns, no idioms). One coach, no admin role, no gym concepts (classes, timetable, QR check-in, access requests) and no AI Coach — none of these belongs on a screen you draw. That is a rule about COPY, not a claim about the code: the AI Coach and the gym SCREENS are deleted, but access requests and the session routes are still live on the server and access requests still have a client-facing form on S1. Do not read this line as permission to delete anything. The action of taking someone on is called "Invite a client" on every surface, and it is a LINK you send, not a code they type; the code is only the fallback you can read down a phone. The people on a roster are "clients", never "members". Messaging exists only as the "Coming soon" row on P4; see the note there.
```
