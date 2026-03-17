# PTO Tracker Tab — Design Spec

**Date:** 2026-03-17

---

## Overview

A new "PTO" tab in the PM Command Center dashboard for tracking paid time off. Replaces a manual Excel spreadsheet with an auto-calculating, Firebase-synced view that shows current balance, usage history, planned future time off, and company holiday reference.

---

## Accrual Rules (hardcoded from company policy)

- **Plan year:** July 1 → June 30 (annual cycle)
- **Accrual rate:** 7.39 hrs per biweekly pay period
- **Maximum annual PTO:** 24 days (192 hrs) — accrual stops accumulating once this cap is reached for the plan year; it does not resume until the next plan year
- **Maximum carryover:** 5 days (40 hrs) — the amount a user manually sets as their starting balance each July 1
- **Semi-annual usage targets:** 96 hrs (12 days) each half-year
  - Half 1: July 1 – December 31
  - Half 2: January 1 – June 30
- **Floating holidays:** 2 per **calendar year** (Jan 1 – Dec 31), reset each January 1, do not roll over

### Starting data (2025–2026 plan year, informational only)

Carryover into July 1, 2025 was 40 hrs. First biweekly accrual date was July 11, 2025. This data is entered via settings — it is not hardcoded in the app.

---

## Data Model

Stored in Firebase under the user's data root as `pto`.

```js
pto: {
  settings: {
    planYearStart: "2025-07-01",      // July 1 of current plan year
    planYearEnd: "2026-06-30",        // June 30 of current plan year
    accrualStartDate: "2025-07-11",   // first pay date of current plan year
    accrualRate: 7.39,                // hrs per pay period
    carryoverHours: 40,               // hrs carried in on planYearStart (manually set)
  },
  log: [                              // PTO actually taken
    { id, date, hours, label }        // label optional; id = generateId() (existing app utility)
  ],
  planned: [                          // future PTO not yet taken
    { id, date, hours, label }
  ],
  floatingHolidays: {
    calendarYear: 2026,               // calendar year this record applies to
    total: 2,
    used: 1                           // integer 0–2; clicking a tile increments/decrements
                                      // click unused tile → used++; click used tile → used--
  }
}
```

**ID generation:** Use the existing `generateId()` utility already in App.jsx.

**Floating holiday reset:** On render, if `floatingHolidays.calendarYear` does not match the current calendar year, treat `used` as 0 (display only — do not auto-write). The user can click to mark one used, which will save a fresh `floatingHolidays` object with the new `calendarYear` and `used: 1`.

**Settings editing:** A minimal "Edit Settings" link in the PTO tab header opens an inline form to update `planYearStart`, `planYearEnd`, `accrualStartDate`, `accrualRate`, and `carryoverHours`. This supports plan year rollover each July. No other settings UI is needed.

---

## Balance Calculations (all derived at render time)

| Value | Formula |
|---|---|
| **Elapsed pay periods** | Count of biweekly dates from `accrualStartDate` where the pay date ≤ today (inclusive of today if today IS a pay date) |
| **Total accrued** | `carryoverHours` + (elapsed pay periods × accrualRate), capped at 192 hrs |
| **Total used (plan year)** | Sum of hours in `log` where date ≥ `planYearStart` |
| **Available** | Total accrued − Total used |
| **Planned hours** | Sum of hours in all `planned` entries |
| **Available after planned** | Available − Planned hours (can be negative; shown as-is with a warning color below zero) |
| **Spendable balance** | Available − 40 (shown in info banner when available > 40) |

**"Used This Year" stat card scope:** Plan year (July 1 – June 30), not calendar year.

**Accrual cap:** Once `total accrued` reaches 192 hrs, no further accrual is added until the next plan year. The cap is applied per-calculation, not stored.

---

## UI Layout

### Stat Cards Row (4 cards)

1. **Available** — current available hours + days equivalent (hrs ÷ 8)
2. **Used This Year** — total plan-year hours used from log + days equivalent
3. **Available After Planned** — available minus planned hours; subtext shows total planned hours in amber; shown in red with warning if negative
4. **Floating Holidays** — two dot indicators (filled indigo = used, grey = available); click a dot to toggle; "X of 2 used" label below

### Semi-Annual Progress Bars

Two stacked bars:
- **Jul–Dec [planYearStart year]** — hours from log in that half vs. 96-hr target; green when ≥ 96, amber when in progress
- **Jan–Jun [planYearEnd year]** — same

Each bar shows label on left, hours/status on right, progress bar below.

### Carryover Info Banner

Blue info banner: "40-hr rollover reserve: your true spendable balance is X hrs (keeping 40 hrs for July 1 carryover)"

Hidden when `available ≤ 40`. When `available` is between 0 and 40, spendable balance would be zero or negative — the banner is hidden in this case and no special treatment is needed (the Available card shows the real number).

### Two-Column Section

**Left — Planned PTO**
- List of planned entries sorted by date ascending, shown in amber cards (date, label, hours)
- Each entry has a delete button (×)
- "Convert to Used" button appears on all entries regardless of date (user decides when to convert); on click, the entry moves from `planned` to `log` preserving its original date and hours
- "+ Add Planned" button opens an inline form above the list: date picker + hours field (default 8) + optional label field; Enter or a Save button submits

**Right — PTO Log**
- Scrollable list sorted newest-first (date, label, hours)
- Each entry has a delete button (×)
- "+ Log PTO" button opens an inline form above the list: date picker + hours (default 8) + optional label; Enter or Save submits

### Company Holidays Section

A reference grid of holiday tiles for the **current calendar year** (derived from `new Date().getFullYear()`). Fixed holidays are hardcoded per calendar year in the app. If the current year has no hardcoded data, show a message: "Holiday dates for [year] not yet configured."

**2026 holiday data (hardcoded):**
- Jan 1 — New Year's Day
- May 25 — Memorial Day
- Jul 3 — Independence Day (observed Friday)
- Sep 7 — Labor Day
- Nov 26 — Thanksgiving
- Nov 27 — Day after Thanksgiving
- Dec 25 — Christmas Day
- Floating #1 (tracked via `floatingHolidays`)
- Floating #2 (tracked via `floatingHolidays`)

Floating holiday tiles are styled in indigo. Their used/available state reflects `floatingHolidays.used` — first dot used means Floating #1 is used, both used means both tiles show used. Clicking a tile increments or decrements `floatingHolidays.used` (min 0, max 2).

---

## Interactions Summary

| Action | Behavior |
|---|---|
| "+ Log PTO" | Inline form; saves `{ id, date, hours, label }` to `pto.log` |
| "+ Add Planned" | Inline form; saves to `pto.planned` |
| Delete log entry | Removes from `pto.log` |
| Delete planned entry | Removes from `pto.planned` |
| "Convert to Used" | Moves entry from `pto.planned` to `pto.log`; preserves original date |
| Click floating holiday dot | Increments/decrements `floatingHolidays.used` (0–2); saves fresh `{ calendarYear, total:2, used }` |
| "Edit Settings" | Inline form to update all `pto.settings` fields |

---

## Integration with Existing App

- `"PTO"` added to the `SECTIONS` array in App.jsx
- `defaultData` extended: `pto: { settings: { planYearStart:"2025-07-01", planYearEnd:"2026-06-30", accrualStartDate:"2025-07-11", accrualRate:7.39, carryoverHours:40 }, log:[], planned:[], floatingHolidays:{ calendarYear:2026, total:2, used:0 } }`
- Firebase sync handles `pto` alongside existing keys — no changes to sync logic needed
- All PTO state lives under `data.pto` following the same pattern as `data.tasks`, `data.notes`, etc.
- The existing `generateId()` utility is used for entry IDs

---

## Out of Scope

- Date range / vacation block entry (single date + hours only)
- Automatic plan year rollover (user manually updates settings each July 1)
- Computed carryover at rollover (user manually enters new `carryoverHours`)
- Export to CSV/XLSX
- Notifications or reminders for usage targets
- Multiple plan year history
