# Download All (XLSX) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Download All" button to the PM Command Center header that exports all dashboard data as a single `pm-dashboard.xlsx` file with one sheet per section.

**Architecture:** Install SheetJS (`xlsx`) as a dependency. Add an `exportAllXLSX(data)` function to `App.jsx` that builds 5 worksheets from the app's `data` state and triggers a browser download. Add a "Download All" button to the sidebar footer area (below "Total open") so it's always visible regardless of active section.

**Tech Stack:** React 19, Vite, SheetJS (`xlsx` npm package)

---

### Task 1: Install SheetJS

**Files:**
- Modify: `app/package.json` (via npm install)

**Step 1: Install the package**

Run from the `app/` directory:
```bash
cd "C:/Sandbox/PM Tool/app"
npm install xlsx
```

**Step 2: Verify it was added**

Check `app/package.json` — you should see `"xlsx"` under `"dependencies"`.

**Step 3: Commit**

```bash
git add app/package.json app/package-lock.json
git commit -m "feat: add xlsx (SheetJS) dependency for excel export"
```

---

### Task 2: Add `exportAllXLSX` function

**Files:**
- Modify: `app/src/App.jsx` — add function after the existing `exportRoadmapCSV` function (around line 68)

**Step 1: Add the import at the top of App.jsx**

At line 1 (before `import { useState, useEffect } from "react";`), add:
```js
import * as XLSX from "xlsx";
```

**Step 2: Add the export function**

After the closing `}` of `exportRoadmapCSV` (around line 68), add:

```js
function exportAllXLSX(data) {
  const wb = XLSX.utils.book_new();

  // Tasks sheet
  const taskRows = [["Title", "Priority", "Due Date", "Done", "Notes"]];
  data.tasks.forEach(t => taskRows.push([
    t.text,
    t.priority,
    t.due ? formatDate(t.due) : "",
    t.done ? "Yes" : "No",
    t.notes || ""
  ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(taskRows), "Tasks");

  // 1:1 Agenda sheet
  const agendaRows = [["Item", "Discussed"]];
  data.agenda.forEach(a => agendaRows.push([
    a.text,
    a.discussed ? "Yes" : "No"
  ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(agendaRows), "1-1 Agenda");

  // Roadmap Queue sheet
  const roadmapRows = [["Item", "Notes", "Target Month", "Added to Roadmap", "Captured On"]];
  data.roadmap.forEach(r => roadmapRows.push([
    r.text,
    r.notes || "",
    r.targetMonth ? formatMonth(r.targetMonth) : "",
    r.added ? "Yes" : "No",
    r.createdAt || ""
  ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(roadmapRows), "Roadmap Queue");

  // Recurring sheet
  const recurringRows = [["Task", "Frequency", "Last Done"]];
  data.recurring.forEach(r => recurringRows.push([
    r.text,
    r.freq,
    r.lastDone ? formatDate(r.lastDone) : "Never"
  ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(recurringRows), "Recurring");

  // Notes sheet
  const noteRows = [["Title", "Body", "Created At"]];
  data.notes.forEach(n => noteRows.push([
    n.title || "",
    n.body || "",
    n.createdAt || ""
  ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(noteRows), "Notes");

  XLSX.writeFile(wb, "pm-dashboard.xlsx");
}
```

**Step 3: Verify the app still loads**

Run `npm run dev` from `app/` and confirm the app opens without errors in the browser console.

**Step 4: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat: add exportAllXLSX function with 5-sheet workbook"
```

---

### Task 3: Add "Download All" button to the sidebar

**Files:**
- Modify: `app/src/App.jsx` — the sidebar footer section (around line 536–539)

**Step 1: Find the sidebar footer**

Locate this block (around line 536):
```jsx
<div style={{ padding:"16px 20px", borderTop:"1px solid #334155" }}>
  <div style={{ color:"#475569", fontSize:11 }}>Total open</div>
  <div style={{ color:"#f1f5f9", fontWeight:700, fontSize:22 }}>{data.tasks.filter(t=>!t.done).length+data.agenda.filter(a=>!a.discussed).length+data.roadmap.filter(r=>!r.added).length}</div>
</div>
```

**Step 2: Add the Download All button after the total count div**

Replace that block with:
```jsx
<div style={{ padding:"16px 20px", borderTop:"1px solid #334155" }}>
  <div style={{ color:"#475569", fontSize:11 }}>Total open</div>
  <div style={{ color:"#f1f5f9", fontWeight:700, fontSize:22 }}>{data.tasks.filter(t=>!t.done).length+data.agenda.filter(a=>!a.discussed).length+data.roadmap.filter(r=>!r.added).length}</div>
  <button onClick={()=>exportAllXLSX(data)} style={{ marginTop:12, width:"100%", padding:"8px 0", background:"#334155", color:"#94a3b8", border:"1px solid #475569", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" }}>
    ↓ Download All
  </button>
</div>
```

**Step 3: Test the button**

1. Open the app in the browser (`npm run dev`)
2. Add at least one item to Tasks, Agenda, Roadmap, Recurring, and Notes
3. Click "Download All"
4. Open the downloaded `pm-dashboard.xlsx` in Excel or Google Sheets
5. Confirm 5 sheets exist with correct column headers and data

**Step 4: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat: add Download All button to sidebar footer"
```
