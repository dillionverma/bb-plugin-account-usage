# bb-plugin-account-usage

Every pooled Claude and Codex account, with its plan, usage and next reset, in a
collapsible sidebar section styled like Ultra Sidebar's Scheduled list.

The Usage heading shows how many accounts are ready. Click the heading or any
preview bar to toggle the full account list. Expansion is remembered across
reloads. Account rows show the email on the first line, with the plan, status,
reset countdown and quota values beneath. Actively serving account names use the same
neutral shimmer as Ultra Sidebar, with reduced-motion support. Each known quota has a thin percent-used bar;
the separate weekly preview shows remaining capacity. Compact account rows use
11px names and 4px vertical padding. The section has no surrounding card.

Weekly remaining bars stay beneath the heading, including when collapsed, with
one segment per enabled account. Hover a segment for a styled tooltip with its email, plan, weekly quota and reset information. Usage updates automatically; there is no manual refresh button.

## Install

Needs BB's Account Pooler plugin (`account-pool`) enabled.

```sh
bb plugin install https://github.com/dillionverma/bb-plugin-account-usage
```

## Where the data comes from

The `account-pool` plugin owns every pooled account and its quota. We read it from
our plugin **server** over cross-plugin RPC:

```ts
bb.sdk.plugins.callRpc({ pluginId: "account-pool", method: "status.get", input: null, outputSchema })
```

The frontend never talks to `account-pool` — it cannot. Plugin RPC and realtime are
both scoped to the calling plugin, so `account-pool`'s own `accounts-changed` signal
is invisible to us. The server re-publishes on our own channel instead.

`status.get` is a pure cache read, so the open panel polls it every 30s and also
refreshes on `thread.idle` / `thread.failed`, which is when usage has just moved.

The server’s **refresh RPC** is different: there is no bulk-refresh RPC, so it fans out one
`account.refreshUsage` call per enabled OAuth account, and each of those is a real
request to Anthropic or OpenAI. It is not called by the sidebar or a timer.

## What the bars mean

`weeklyBars()` emits one segment per **enabled** account — not one averaged bar per
provider. The router spends accounts one at a time, so an average would hide the
account that is already empty behind the three that are not. Disabled accounts get
no bar at all: the router will never reach them, and a bar for their untouched week
would advertise capacity that does not exist. An account with no observed week
keeps its segment and reads `—`, because a missing row would say "this account is
gone", which is a different and wrong claim.

A `rejected` week is 0% left whatever number came with it, and an elapsed week is
worth a full 100% rather than the pre-reset number still in the cache.

**The time marker** is drawn on the same *remaining* axis as the fill:
`(resetAt - now) / windowMinutes`, i.e. the share of the window still ahead. That
is what makes the comparison direct — at the midpoint of the week the tick is at
50%, and a bar still 70% full is visibly ahead of it. Putting elapsed time there
instead would place the tick on the opposite axis from the fill and invert the
reading. No `resetAt`, or no known window length, means no tick rather than a
guessed one.

**Which account is in use.** The pool is a proxy that picks per request, but it
keeps a 30-minute affinity binding per session, so a chat sticks to one account
while it is active. That binding lives in the hub's memory and is not exposed over
RPC, so the strip shows the two signals that are: a solid green dot on an account
with `inFlight > 0` (exact — it is serving a request this second), and a grey dot
on the most-recently-used ready account (a guess, and the pool's 60s usage-record
throttle can make it lag). The dot keeps its place in the layout when idle so the
numbers do not shift sideways mid-turn.

Claude's week is `sevenDay*` (a fixed 10080 minutes); Codex's is the `limitWindows`
entry with `windowMinutes === 10080`, falling back to its longest window of a day
or more so a renamed upstream window cannot silently drop out. The marker scales to
whichever window the number actually came from, so a 30-day Codex window is not
drawn as if it were a week.

## The rules that keep it honest

`src/lib/normalise.ts` ports `account-pool`'s own `activeWindow` predicate verbatim. If
this panel disagreed with the pool, it would promise capacity the router will not
actually use. The subtle parts, all covered by `src/lib/normalise.test.ts`:

- **The headline is the max over gating windows.** An account can read 0% on its
  5-hour window and still be dead because the weekly window was rejected. Showing
  the 5-hour number would invite a request that cannot succeed.
- **`familyWeekly` never gates the account.** `account-pool`'s status derivation
  ignores it, so a maxed-out Fable bucket leaves the account `ready` — Fable
  requests route elsewhere, Opus requests still land there. It gets a column, not
  a verdict.
- **Blocked accounts wait for the LAST reset; ready accounts show the SOONEST.**
  Every blocking window has to clear before an exhausted account serves again, but
  the interesting moment for a usable account is its next refill.
- **An elapsed window is greyed, not trusted.** Its cached number stays at 100%
  until the next poll; rendering that as current is the easiest way to lie.
- **Providers diverge structurally.** Claude populates `fiveHour*` / `sevenDay*` /
  `familyWeekly` with empty `limitWindows`; Codex populates `limitWindows` and
  leaves the rest null. Windows are labelled by `windowMinutes` (300 → 5H,
  10080 → 7D). Missing durations use "Limit" or "Other limit" rather than
  inferring a duration from `slot`, which is an upstream limit-family name.
- **The active-name shimmer means `inFlight > 0`** — exact. The most-recently-used ready peer
  is labelled "next", never "active", because that proxy can lag the pool's 60s
  usage-record throttle.
- **Stale is visible.** `account-pool` swallows usage-refresh failures without
  setting `error`, so a frozen `observedAt` is the only signal the numbers stopped
  moving. Past ~11 minutes (two missed 5-minute cycles) the row says `stale`.

## Develop

```bash
npm install
npx vitest run          # the normalisation rules above
npx tsc --noEmit
bb plugin build .
bb plugin install . --yes
bb plugin disable provider-usage   # or two cards compete for the footer
bb plugin dev .                    # watch + hot reload
```

Reverting is `bb plugin enable provider-usage` plus `bb plugin remove account-usage`.

## Always visible

`src/app.tsx` registers an app overlay. `PersistentUsage` portals the panel into a
plugin-owned root directly above each `[data-sidebar="footer"]`. Since BB 0.47 the
footer is a fixed-height icon row, so the panel cannot live inside it. In the rail
layout the footer also sits in a horizontal flex row; the mount climbs out of any
such row first, and `usage-panel.css` lets that row size to its content and keeps
the rail's settings button level with it. That semantic host DOM selector is the
only attachment dependency; the current SDK has no persistent footer slot. There is no disclosure registration, footer toggle icon,
or close button, so other footer disclosures cannot dismiss usage. Hiding the
sidebar itself still hides its contents normally.

A mutation observer reconciles footer replacement during navigation and mobile
layout changes. Unmount/reload disconnects the observer and removes owned roots.
The portal root carries BB's plugin CSS scope. Replace this attachment with a
native persistent footer slot when the SDK provides one.

## Layout constraints

The section follows the sidebar width. Expanded details scroll within
`max-h-[min(16rem,28vh)]`, preserving space for the thread list. Both weekly
preview rows remain visible above the accounts. Account names use the full row width; compact quota values align with their provider's column labels.
Reset countdowns show days/hours or hours/minutes, with exact timestamps available
on hover. Account errors use a short status with the provider detail on hover.
The heading and previews form one disclosure button with a shared hover and focus state. Selecting account
text does not collapse it. `account-usage:expanded` in localStorage remembers
expansion per client.

The list explicitly resets the browser's default indentation with `list-none p-0
m-0`.
