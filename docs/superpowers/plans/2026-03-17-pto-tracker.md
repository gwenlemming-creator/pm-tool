# PTO Tracker Tab Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "PTO" tab to the PM Command Center that auto-calculates accrued PTO balance, tracks used and planned time off, shows semi-annual usage progress, and displays company holidays — all synced via Firebase.

**Architecture:** A single `PTOView` React component is added inline to `App.jsx`, following the same pattern as `YearInReview` and other section views. All PTO state lives under `data.pto` and flows through the existing `save()` function for Firebase/localStorage sync. Balance calculations are pure functions derived at render time from stored data.

**Tech Stack:** React (hooks), inline styles (matches existing app), Firebase Realtime Database (existing sync), no new dependencies.

---

## File Map

| File | Change |
|---|---|
| `app/src/App.jsx` | All changes — new `PTOView` component, helpers, default data, SECTIONS entry, render call |

No new files needed — the app is a single large component file, and this feature follows that pattern.

---

## Task 1: Add PTO to defaultData and SECTIONS

**Files:**
- Modify: `app/src/App.jsx:8,17`

- [ ] **Step 1: Add "PTO" to SECTIONS array**

On line 8, change:
```js
const SECTIONS = ["Today", "Tasks", "1:1 Agenda", "Roadmap Queue", "Recurring", "Notes", "Year In Review"];
```
To:
```js
const SECTIONS = ["Today", "Tasks", "1:1 Agenda", "Roadmap Queue", "Recurring", "Notes", "Year In Review", "PTO"];
```

- [ ] **Step 2: Add PTO default data**

On line 17, change:
```js
const defaultData = { tasks: [], agenda: [], roadmap: [], recurring: [], notes: [], yearInReview: {} };
```
To:
```js
const defaultData = {
  tasks: [], agenda: [], roadmap: [], recurring: [], notes: [], yearInReview: {},
  pto: {
    settings: {
      planYearStart: "2025-07-01",
      planYearEnd: "2026-06-30",
      accrualStartDate: "2025-07-11",
      accrualRate: 7.39,
      carryoverHours: 40,
    },
    log: [],
    planned: [],
    floatingHolidays: { calendarYear: 2026, total: 2, used: 0 },
  }
};
```

- [ ] **Step 3: Verify app still loads**

Run `npm run dev` in `app/` directory. Open the browser. Check that the PTO tab appears in the sidebar and the app loads without errors. The PTO tab content will be empty — that's fine for now.

- [ ] **Step 4: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat: add PTO to SECTIONS and defaultData"
```

---

## Task 2: Add PTO balance calculation helpers

**Files:**
- Modify: `app/src/App.jsx` — add helpers after the existing `formatMonth` function (around line 58)

- [ ] **Step 1: Add `computePTOBalance` helper**

Insert after the `formatMonth` function:

```js
// PTO helpers
const HOLIDAYS_BY_YEAR = {
  2026: [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-05-25", name: "Memorial Day" },
    { date: "2026-07-03", name: "Independence Day (observed)" },
    { date: "2026-09-07", name: "Labor Day" },
    { date: "2026-11-26", name: "Thanksgiving" },
    { date: "2026-11-27", name: "Day after Thanksgiving" },
    { date: "2026-12-25", name: "Christmas Day" },
  ],
};

function computePTOBalance(pto) {
  const { settings, log, planned } = pto;
  const { planYearStart, planYearEnd, accrualStartDate, accrualRate, carryoverHours } = settings;
  const today = new Date().toISOString().slice(0, 10);

  // Count elapsed biweekly pay periods (pay date <= today)
  let periods = 0;
  let payDate = new Date(accrualStartDate + "T00:00:00");
  const todayDate = new Date(today + "T00:00:00");
  const planEnd = new Date(planYearEnd + "T00:00:00");
  while (payDate <= todayDate && payDate <= planEnd) {
    periods++;
    payDate = new Date(payDate.getTime() + 14 * 24 * 60 * 60 * 1000);
  }

  const maxAccrual = 192; // 24 days × 8 hrs
  const totalAccrued = Math.min(carryoverHours + periods * accrualRate, maxAccrual);

  // Only count log entries within the current plan year
  const planYearLogHours = log
    .filter(e => e.date >= planYearStart && e.date <= planYearEnd)
    .reduce((sum, e) => sum + (e.hours || 0), 0);

  const available = totalAccrued - planYearLogHours;
  const plannedHours = planned.reduce((sum, e) => sum + (e.hours || 0), 0);
  const availableAfterPlanned = available - plannedHours;

  // Semi-annual usage (using ALL log entries for the half-year date ranges)
  const half1Start = planYearStart; // e.g. "2025-07-01"
  const half1End = planYearStart.slice(0, 4) + "-12-31";
  const half2Start = planYearEnd.slice(0, 4) + "-01-01"; // e.g. "2026-01-01"
  const half2End = planYearEnd; // e.g. "2026-06-30"

  const half1Used = log
    .filter(e => e.date >= half1Start && e.date <= half1End)
    .reduce((sum, e) => sum + (e.hours || 0), 0);
  const half2Used = log
    .filter(e => e.date >= half2Start && e.date <= half2End)
    .reduce((sum, e) => sum + (e.hours || 0), 0);

  return {
    totalAccrued,
    planYearLogHours,
    available,
    plannedHours,
    availableAfterPlanned,
    half1: { label: `Jul–Dec ${planYearStart.slice(0, 4)}`, used: half1Used, target: 96 },
    half2: { label: `Jan–Jun ${planYearEnd.slice(0, 4)}`, used: half2Used, target: 96 },
  };
}

function getEffectiveFloatingUsed(floatingHolidays) {
  const currentYear = new Date().getFullYear();
  if (!floatingHolidays || floatingHolidays.calendarYear !== currentYear) return 0;
  return floatingHolidays.used || 0;
}
```

- [ ] **Step 2: Verify no syntax errors**

Run `npm run dev`. App should still load. No new UI yet — just helpers added.

- [ ] **Step 3: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat: add PTO balance calculation helpers"
```

---

## Task 3: Build PTOView — stat cards and progress bars

**Files:**
- Modify: `app/src/App.jsx` — add `PTOView` component before the `export default function App()` line (around line 728)

- [ ] **Step 1: Add the PTOView component shell with stat cards**

Insert before `export default function App()`:

```jsx
function PTOView({ pto, onSave }) {
  const bal = computePTOBalance(pto);
  const floatingUsed = getEffectiveFloatingUsed(pto.floatingHolidays);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ ...pto.settings });
  const [showLogForm, setShowLogForm] = useState(false);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [logForm, setLogForm] = useState({ date: "", hours: 8, label: "" });
  const [planForm, setPlanForm] = useState({ date: "", hours: 8, label: "" });

  function saveSetting(key, val) {
    setSettingsForm(prev => ({ ...prev, [key]: val }));
  }

  function commitSettings() {
    onSave({ ...pto, settings: { ...settingsForm, accrualRate: parseFloat(settingsForm.accrualRate), carryoverHours: parseFloat(settingsForm.carryoverHours) } });
    setShowSettings(false);
  }

  function addLog() {
    if (!logForm.date || !logForm.hours) return;
    const entry = { id: generateId(), date: logForm.date, hours: parseFloat(logForm.hours), label: logForm.label.trim() || null };
    onSave({ ...pto, log: [...pto.log, entry] });
    setLogForm({ date: "", hours: 8, label: "" });
    setShowLogForm(false);
  }

  function addPlanned() {
    if (!planForm.date || !planForm.hours) return;
    const entry = { id: generateId(), date: planForm.date, hours: parseFloat(planForm.hours), label: planForm.label.trim() || null };
    onSave({ ...pto, planned: [...pto.planned, entry] });
    setPlanForm({ date: "", hours: 8, label: "" });
    setShowPlanForm(false);
  }

  function deleteLog(id) {
    onSave({ ...pto, log: pto.log.filter(e => e.id !== id) });
  }

  function deletePlanned(id) {
    onSave({ ...pto, planned: pto.planned.filter(e => e.id !== id) });
  }

  function convertToUsed(entry) {
    onSave({
      ...pto,
      planned: pto.planned.filter(e => e.id !== entry.id),
      log: [...pto.log, { ...entry }],
    });
  }

  function toggleFloating() {
    const currentYear = new Date().getFullYear();
    const currentUsed = getEffectiveFloatingUsed(pto.floatingHolidays);
    // If calendarYear doesn't match, start fresh at 1
    if (!pto.floatingHolidays || pto.floatingHolidays.calendarYear !== currentYear) {
      onSave({ ...pto, floatingHolidays: { calendarYear: currentYear, total: 2, used: 1 } });
      return;
    }
    const next = currentUsed >= 2 ? 0 : currentUsed + 1;
    onSave({ ...pto, floatingHolidays: { ...pto.floatingHolidays, used: next } });
  }

  const cardStyle = { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, textAlign: "center" };
  const labelStyle = { fontSize: 11, fontWeight: 600, letterSpacing: ".05em", color: "#64748b", textTransform: "uppercase", marginBottom: 6 };
  const bigNumStyle = { fontSize: 28, fontWeight: 700, color: "#0f172a" };
  const subStyle = { fontSize: 12, color: "#64748b", marginTop: 4 };

  return (
    <div>
      {/* Header row with settings link */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button onClick={() => setShowSettings(!showSettings)}
          style={{ background: "none", border: "none", color: "#6366f1", fontSize: 13, cursor: "pointer", padding: 0 }}>
          {showSettings ? "Hide Settings" : "Edit Settings"}
        </button>
      </div>

      {/* Settings inline form */}
      {showSettings && (
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 12 }}>Plan Year Settings</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              ["Plan Year Start", "planYearStart", "date"],
              ["Plan Year End", "planYearEnd", "date"],
              ["First Accrual Date", "accrualStartDate", "date"],
              ["Accrual Rate (hrs/period)", "accrualRate", "number"],
              ["Carryover Hours", "carryoverHours", "number"],
            ].map(([label, key, type]) => (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>{label}</label>
                <input type={type} value={settingsForm[key]}
                  onChange={e => saveSetting(key, e.target.value)}
                  style={{ padding: "7px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button onClick={() => setShowSettings(false)}
              style={{ padding: "6px 14px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={commitSettings}
              style={{ padding: "6px 14px", background: "#6366f1", color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save Settings</button>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Available</div>
          <div style={bigNumStyle}>{bal.available.toFixed(1)}<span style={{ fontSize: 14, color: "#64748b", marginLeft: 2 }}>hrs</span></div>
          <div style={subStyle}>{(bal.available / 8).toFixed(1)} days</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Used This Year</div>
          <div style={bigNumStyle}>{bal.planYearLogHours.toFixed(1)}<span style={{ fontSize: 14, color: "#64748b", marginLeft: 2 }}>hrs</span></div>
          <div style={subStyle}>{(bal.planYearLogHours / 8).toFixed(1)} days</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Available After Planned</div>
          <div style={{ ...bigNumStyle, color: bal.availableAfterPlanned < 0 ? "#dc2626" : "#0f172a" }}>
            {bal.availableAfterPlanned.toFixed(1)}<span style={{ fontSize: 14, color: "#64748b", marginLeft: 2 }}>hrs</span>
          </div>
          <div style={{ ...subStyle, color: bal.plannedHours > 0 ? "#f59e0b" : "#64748b" }}>
            {bal.plannedHours > 0 ? `${bal.plannedHours} hrs planned` : "no planned PTO"}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Floating Holidays</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "8px 0" }}>
            {[0, 1].map(i => (
              <div key={i} onClick={toggleFloating} style={{
                width: 28, height: 28, borderRadius: "50%", cursor: "pointer",
                background: i < floatingUsed ? "#6366f1" : "#e2e8f0",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: i < floatingUsed ? "white" : "#94a3b8", fontSize: 12, fontWeight: 700
              }}>{i + 1}</div>
            ))}
          </div>
          <div style={subStyle}>{floatingUsed} of 2 used</div>
        </div>
      </div>

      {/* Semi-annual progress bars */}
      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 12 }}>
          Semi-Annual Usage Targets <span style={{ fontWeight: 400, color: "#9ca3af", fontSize: 12 }}>(96 hrs each half)</span>
        </div>
        {[bal.half1, bal.half2].map((half, i) => {
          const pct = Math.min((half.used / half.target) * 100, 100);
          const met = half.used >= half.target;
          return (
            <div key={i} style={{ marginBottom: i === 0 ? 12 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                <span>{half.label}</span>
                <span style={{ color: met ? "#16a34a" : "#f59e0b", fontWeight: 600 }}>
                  {met ? `${half.used} hrs used ✓` : `${half.used.toFixed(1)} hrs used of ${half.target}`}
                </span>
              </div>
              <div style={{ background: "#f1f5f9", borderRadius: 999, height: 8 }}>
                <div style={{ background: met ? "#16a34a" : "#f59e0b", height: 8, borderRadius: 999, width: `${pct}%`, transition: "width 0.3s" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Carryover info banner */}
      {bal.available > 40 && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#1e40af", display: "flex", alignItems: "center", gap: 10 }}>
          <span>ℹ️</span>
          <span>40-hr rollover reserve: your <strong>true spendable balance is {(bal.available - 40).toFixed(1)} hrs</strong> (keeping 40 hrs for July 1 carryover)</span>
        </div>
      )}

      {/* Planned PTO + PTO Log side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Planned PTO */}
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Planned PTO</div>
            <button onClick={() => setShowPlanForm(!showPlanForm)}
              style={{ background: "#f1f5f9", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, color: "#475569", cursor: "pointer" }}>
              + Add Planned
            </button>
          </div>
          {showPlanForm && (
            <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input type="date" value={planForm.date} onChange={e => setPlanForm(p => ({ ...p, date: e.target.value }))}
                  style={{ padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" }} />
                <input type="number" value={planForm.hours} min="1" max="40"
                  onChange={e => setPlanForm(p => ({ ...p, hours: e.target.value }))}
                  style={{ width: 70, padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" }} />
                <input placeholder="Label (optional)" value={planForm.label}
                  onChange={e => setPlanForm(p => ({ ...p, label: e.target.value }))}
                  style={{ flex: 1, minWidth: 100, padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button onClick={() => setShowPlanForm(false)}
                  style={{ padding: "5px 12px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                <button onClick={addPlanned}
                  style={{ padding: "5px 12px", background: "#6366f1", color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pto.planned.slice().sort((a, b) => a.date.localeCompare(b.date)).map(entry => (
              <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#1e293b" }}>{entry.label || formatDate(entry.date)}</div>
                  <div style={{ fontSize: 12, color: "#92400e" }}>{entry.label ? formatDate(entry.date) + " · " : ""}{entry.hours} hrs</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button onClick={() => convertToUsed(entry)} title="Convert to Used"
                    style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>✓ Used</button>
                  <button onClick={() => deletePlanned(entry.id)}
                    style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
                </div>
              </div>
            ))}
            {pto.planned.length === 0 && (
              <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: 12, border: "1px dashed #e2e8f0", borderRadius: 8 }}>
                Add future time off to see projected balance
              </div>
            )}
          </div>
        </div>

        {/* PTO Log */}
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>PTO Log</div>
            <button onClick={() => setShowLogForm(!showLogForm)}
              style={{ background: "#f1f5f9", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, color: "#475569", cursor: "pointer" }}>
              + Log PTO
            </button>
          </div>
          {showLogForm && (
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input type="date" value={logForm.date} onChange={e => setLogForm(p => ({ ...p, date: e.target.value }))}
                  style={{ padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" }} />
                <input type="number" value={logForm.hours} min="1" max="40"
                  onChange={e => setLogForm(p => ({ ...p, hours: e.target.value }))}
                  style={{ width: 70, padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" }} />
                <input placeholder="Label (optional)" value={logForm.label}
                  onChange={e => setLogForm(p => ({ ...p, label: e.target.value }))}
                  style={{ flex: 1, minWidth: 100, padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button onClick={() => setShowLogForm(false)}
                  style={{ padding: "5px 12px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                <button onClick={addLog}
                  style={{ padding: "5px 12px", background: "#6366f1", color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {pto.log.slice().sort((a, b) => b.date.localeCompare(a.date)).map(entry => (
              <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: "#f8fafc", borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#1e293b" }}>{entry.label || formatDate(entry.date)}</div>
                  {entry.label && <div style={{ fontSize: 12, color: "#64748b" }}>{formatDate(entry.date)}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{entry.hours} hrs</span>
                  <button onClick={() => deleteLog(entry.id)}
                    style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
                </div>
              </div>
            ))}
            {pto.log.length === 0 && (
              <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: 12 }}>No PTO logged yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Company Holidays */}
      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 12 }}>
          Company Holidays {new Date().getFullYear()}
        </div>
        {HOLIDAYS_BY_YEAR[new Date().getFullYear()] ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
            {HOLIDAYS_BY_YEAR[new Date().getFullYear()].map(h => (
              <div key={h.date} style={{ padding: 8, background: "#f8fafc", borderRadius: 8, fontSize: 12 }}>
                <div style={{ color: "#64748b" }}>{formatDate(h.date)}</div>
                <div style={{ fontWeight: 500, color: "#1e293b" }}>{h.name}</div>
              </div>
            ))}
            {[0, 1].map(i => (
              <div key={`float-${i}`} onClick={toggleFloating} style={{
                padding: 8, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8, fontSize: 12, cursor: "pointer"
              }}>
                <div style={{ color: "#6366f1" }}>Floating #{i + 1}</div>
                <div style={{ fontWeight: 500, color: "#4338ca" }}>{i < floatingUsed ? "Used ✓" : "Available"}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>Holiday dates for {new Date().getFullYear()} not yet configured.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no syntax errors**

Run `npm run dev`. The app should load. PTO tab will still be blank (not wired up yet).

- [ ] **Step 3: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat: add PTOView component"
```

---

## Task 4: Wire PTOView into the app render

**Files:**
- Modify: `app/src/App.jsx` — inside the `App` component render, around lines 966–968 where other section views are conditionally rendered

- [ ] **Step 1: Add icon for PTO tab**

Find `sectionIcons` object in App.jsx (it maps section names to emoji). Add an entry for PTO:

```js
// Find the sectionIcons object and add:
PTO: "🌴",
```

- [ ] **Step 2: Wire up the PTO render block**

In the section render area (after the `Year In Review` block around line 1030), add:

```jsx
{active === "PTO" && (
  <PTOView
    pto={data.pto}
    onSave={nextPto => save({ ...data, pto: nextPto })}
  />
)}
```

- [ ] **Step 3: Ensure `data.pto` is always defined**

The `save()` function merges data, but if a user has existing localStorage/Firebase data without `pto`, `data.pto` will be undefined. Add a safety fallback where `PTOView` is called:

```jsx
{active === "PTO" && (
  <PTOView
    pto={data.pto || defaultData.pto}
    onSave={nextPto => save({ ...data, pto: nextPto })}
  />
)}
```

- [ ] **Step 4: Verify the full feature works**

Run `npm run dev`. Click the PTO tab. Confirm:
- 4 stat cards show (with calculated values based on empty log)
- Semi-annual progress bars render
- "+ Log PTO" button opens the inline form
- "+ Add Planned" button opens the inline form
- Adding a log entry updates the "Used This Year" and "Available" cards
- Adding a planned entry updates "Available After Planned"
- "✓ Used" button on a planned entry moves it to the log
- Floating holiday dots are clickable and toggle state
- "Edit Settings" link shows the settings form
- Company holidays grid renders for 2026

- [ ] **Step 5: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat: wire PTOView into app render — PTO tab complete"
```

---

## Task 5: Seed initial PTO data

The user's spreadsheet has 14 past PTO entries and confirmed balances. Seed this data through the UI after verifying the feature works.

- [ ] **Step 1: Open the PTO tab and click "+ Log PTO"**

Enter each of the following entries (date + 8 hrs each):

| Date | Hours |
|---|---|
| 2025-08-02 | 8 |
| 2025-08-08 | 8 |
| 2025-09-18 | 8 |
| 2025-09-19 | 8 |
| 2025-09-22 | 8 |
| 2025-09-23 | 8 |
| 2025-10-06 | 8 |
| 2025-11-14 | 8 |
| 2025-12-24 | 8 |
| 2025-12-26 | 8 |
| 2026-01-08 | 8 |
| 2026-01-09 | 8 |
| 2026-01-12 | 8 |
| 2026-03-02 | 8 |

- [ ] **Step 2: Verify the balances match the spreadsheet**

After entering all 14 entries:
- Used This Year: **112 hrs**
- Available: should be **~120 hrs** (will vary slightly by exact pay period count from accrual start)
- Jul–Dec 2025 bar: **96 hrs ✓** (green)
- Jan–Jun 2026 bar: **16 hrs** (amber)

- [ ] **Step 3: Set floating holiday #1 as used**

Click one floating holiday dot to mark 1 of 2 used (matching the spreadsheet state).

- [ ] **Step 4: Commit note**

No code change — data is in Firebase/localStorage. No commit needed.

---

## Task 6: Final verification

- [ ] **Step 1: Test Firebase sync**

Sign in with Google. Verify the PTO data syncs to Firebase (check sync status shows "✓ Synced").

- [ ] **Step 2: Test data persistence**

Reload the page. Confirm all PTO log entries, planned entries, and settings are preserved.

- [ ] **Step 3: Test edge cases**

- Add a planned entry that exceeds available hours → "Available After Planned" should go negative and show in red
- Click floating holiday dot multiple times → cycles 0 → 1 → 2 → 0
- Toggle "Edit Settings" → change a value → Save → verify balance recalculates

- [ ] **Step 4: Final commit**

```bash
git add app/src/App.jsx
git commit -m "feat: PTO tracker tab — complete implementation"
```
