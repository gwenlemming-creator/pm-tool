# Year In Review Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Year In Review" tab where the user can upload photos and write free-form notes for each month of the current year.

**Architecture:** A new `YearInReview` component is added to `App.jsx`. Month notes are persisted in localStorage under the existing `pm-dashboard-v2` key (new `yearInReview` field). Images are stored as Blobs in IndexedDB via a small `imageDb.js` helper module, keeping binary data separate from the JSON state.

**Tech Stack:** React (useState, useEffect, useRef), IndexedDB (native browser API), existing inline-style conventions.

---

## Chunk 1: IndexedDB image helper

### Task 1: Create `imageDb.js`

**Files:**
- Create: `app/src/imageDb.js`

This module encapsulates all IndexedDB operations. The rest of the app never touches IndexedDB directly.

- [ ] **Step 1: Create the file with the full implementation**

```js
// app/src/imageDb.js
const DB_NAME = "pmYearInReview";
const STORE = "images";
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveImage(key, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

export async function getImages(prefix) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const results = {};
    const req = store.openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.key.startsWith(prefix)) {
          results[cursor.key] = cursor.value;
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = e => reject(e.target.error);
  });
}

export async function deleteImage(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}
```

- [ ] **Step 2: Verify the file was created**

Open `app/src/imageDb.js` and confirm the three exported functions are present: `saveImage`, `getImages`, `deleteImage`.

- [ ] **Step 3: Commit**

```bash
git add app/src/imageDb.js
git commit -m "feat: add IndexedDB image helper for Year In Review"
```

---

## Chunk 2: YearInReview component

### Task 2: Add `yearInReview` to app state and localStorage

**Files:**
- Modify: `app/src/App.jsx`

- [ ] **Step 1: Update `defaultData` to include `yearInReview`**

Find this line in `App.jsx`:
```js
const defaultData = { tasks: [], agenda: [], roadmap: [], recurring: [], notes: [] };
```
Change it to:
```js
const defaultData = { tasks: [], agenda: [], roadmap: [], recurring: [], notes: [], yearInReview: {} };
```

`yearInReview` shape: `{ "2026": { "1": { notes: "..." }, "3": { notes: "..." } } }`
Keys are 1-indexed month numbers as strings.

- [ ] **Step 2: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat: add yearInReview field to app state"
```

---

### Task 3: Build the `YearInReview` component

**Files:**
- Modify: `app/src/App.jsx` (add component above `export default function App()`)

The component receives `yearData` (the `yearInReview[year]` object, e.g. `{ "1": { notes: "..." } }`) and `onSave(monthIndex, notes)` callback. It manages its own image loading state internally.

- [ ] **Step 1: Add imports at top of `App.jsx`**

Add after the existing imports on line 1–2:
```js
import { saveImage, getImages, deleteImage } from "./imageDb";
```

- [ ] **Step 2: Add the FULL_MONTHS constant near the top constants**

After the existing `MONTHS` array (line 9), add:
```js
const FULL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
```

- [ ] **Step 3: Add the `YearInReview` component**

Insert the following component just above the `export default function App()` line (~line 503):

```jsx
function YearInReview({ yearData, onSave }) {
  const year = new Date().getFullYear().toString();
  const [openMonth, setOpenMonth] = useState(null);
  const [notes, setNotes] = useState({});
  const [images, setImages] = useState({});  // { monthIndex: { key: objectURL } }
  const fileInputRef = useRef(null);
  const [uploadingMonth, setUploadingMonth] = useState(null);

  // Load saved notes into local edit state when opening a month
  function toggleMonth(idx) {
    const key = String(idx);
    if (openMonth === idx) {
      setOpenMonth(null);
    } else {
      setOpenMonth(idx);
      setNotes(prev => ({ ...prev, [key]: yearData?.[key]?.notes ?? "" }));
      loadImages(idx);
    }
  }

  async function loadImages(monthIdx) {
    const prefix = `${year}-${monthIdx}-`;
    try {
      const blobs = await getImages(prefix);
      const urls = {};
      Object.entries(blobs).forEach(([k, blob]) => {
        urls[k] = URL.createObjectURL(blob);
      });
      setImages(prev => ({ ...prev, [monthIdx]: urls }));
    } catch (e) {
      console.error("Failed to load images", e);
    }
  }

  function handleSave(idx) {
    const key = String(idx);
    onSave(key, notes[key] ?? "");
  }

  function handleAddImage(monthIdx) {
    setUploadingMonth(monthIdx);
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  }

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file || uploadingMonth === null) return;
    const idx = uploadingMonth;
    const imageKey = `${year}-${idx}-${Date.now()}`;
    try {
      await saveImage(imageKey, file);
      const url = URL.createObjectURL(file);
      setImages(prev => ({
        ...prev,
        [idx]: { ...(prev[idx] ?? {}), [imageKey]: url }
      }));
    } catch (err) {
      console.error("Failed to save image", err);
    }
    setUploadingMonth(null);
  }

  async function handleDeleteImage(monthIdx, imageKey) {
    try {
      await deleteImage(imageKey);
      setImages(prev => {
        const updated = { ...prev[monthIdx] };
        URL.revokeObjectURL(updated[imageKey]);
        delete updated[imageKey];
        return { ...prev, [monthIdx]: updated };
      });
    } catch (err) {
      console.error("Failed to delete image", err);
    }
  }

  const monthHasContent = (idx) => {
    const key = String(idx);
    const hasNotes = !!yearData?.[key]?.notes;
    const hasImages = Object.keys(images[idx] ?? {}).length > 0;
    return hasNotes || hasImages;
  };

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      {FULL_MONTHS.map((name, i) => {
        const idx = i + 1;
        const isOpen = openMonth === idx;
        const hasContent = monthHasContent(idx);
        const monthImages = images[idx] ?? {};
        const imageCount = Object.keys(monthImages).length;

        return (
          <div key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
            {/* Header row */}
            <div
              onClick={() => toggleMonth(idx)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 20px", cursor: "pointer",
                background: isOpen ? "#eff6ff" : "#f8fafc",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontWeight: 600, color: isOpen ? "#1e40af" : "#1e293b", width: 110 }}>{name}</span>
                <span style={{ fontSize: 12, color: hasContent ? "#3b82f6" : "#94a3b8" }}>
                  {hasContent
                    ? [imageCount > 0 && `${imageCount} image${imageCount !== 1 ? "s" : ""}`, yearData?.[String(idx)]?.notes && "notes added"].filter(Boolean).join(" · ")
                    : "No entries yet"}
                </span>
              </div>
              <span style={{ color: isOpen ? "#3b82f6" : "#94a3b8", fontSize: 13 }}>{isOpen ? "▼" : "▶"}</span>
            </div>

            {/* Expanded content */}
            {isOpen && (
              <div style={{ padding: 20, background: "white", borderTop: "1px solid #dbeafe" }}>
                {/* Photos */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                    Photos
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    {Object.entries(monthImages).map(([key, url]) => (
                      <div key={key} style={{ position: "relative" }}>
                        <img
                          src={url}
                          alt=""
                          style={{ height: 80, maxWidth: 140, borderRadius: 6, objectFit: "cover", display: "block" }}
                        />
                        <button
                          onClick={() => handleDeleteImage(idx, key)}
                          title="Remove"
                          style={{
                            position: "absolute", top: 4, right: 4,
                            background: "rgba(0,0,0,0.55)", color: "white",
                            border: "none", borderRadius: "50%", width: 20, height: 20,
                            fontSize: 11, cursor: "pointer", lineHeight: "20px", padding: 0, textAlign: "center"
                          }}
                        >×</button>
                      </div>
                    ))}
                    <div
                      onClick={() => handleAddImage(idx)}
                      style={{
                        width: 80, height: 80, border: "2px dashed #cbd5e1", borderRadius: 6,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, color: "#94a3b8", cursor: "pointer", flexShrink: 0
                      }}
                    >+ Add</div>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    Notes &amp; Wins
                  </div>
                  <textarea
                    value={notes[String(idx)] ?? ""}
                    onChange={e => setNotes(prev => ({ ...prev, [String(idx)]: e.target.value }))}
                    placeholder="What went well? What shipped? What are you proud of?"
                    rows={4}
                    style={{
                      width: "100%", boxSizing: "border-box", padding: "10px 12px",
                      border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13,
                      color: "#475569", lineHeight: 1.6, resize: "vertical", outline: "none",
                      fontFamily: "inherit"
                    }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button
                    onClick={() => handleSave(idx)}
                    style={{
                      padding: "7px 18px", background: "#6366f1", color: "white",
                      border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer"
                    }}
                  >Save</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Verify the component renders without errors**

Run the dev server:
```bash
cd app && npm run dev
```
Open the app in the browser. There should be no console errors on load.

- [ ] **Step 5: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat: add YearInReview component with accordion months, images, and notes"
```

---

### Task 4: Wire YearInReview into the App

**Files:**
- Modify: `app/src/App.jsx`

- [ ] **Step 1: Add "Year In Review" to SECTIONS**

Find line 4:
```js
const SECTIONS = ["Today", "Tasks", "1:1 Agenda", "Roadmap Queue", "Recurring", "Notes"];
```
Change to:
```js
const SECTIONS = ["Today", "Tasks", "1:1 Agenda", "Roadmap Queue", "Recurring", "Notes", "Year In Review"];
```

- [ ] **Step 2: Add the icon to `sectionIcons`**

Find the `sectionIcons` object (~line 564):
```js
const sectionIcons = { Today:"⚡", Tasks:"✓", "1:1 Agenda":"💬", "Roadmap Queue":"🗺️", Recurring:"🔁", Notes:"📝" };
```
Change to:
```js
const sectionIcons = { Today:"⚡", Tasks:"✓", "1:1 Agenda":"💬", "Roadmap Queue":"🗺️", Recurring:"🔁", Notes:"📝", "Year In Review":"🏆" };
```

- [ ] **Step 3: Add `onSaveYearInReview` handler to the `App` component**

After the `editRoadmap` function (~line 537), add:
```js
function saveYearInReview(monthKey, notesText) {
  const year = new Date().getFullYear().toString();
  const prev = data.yearInReview ?? {};
  const prevYear = prev[year] ?? {};
  save({
    ...data,
    yearInReview: {
      ...prev,
      [year]: { ...prevYear, [monthKey]: { notes: notesText } }
    }
  });
}
```

- [ ] **Step 4: Render the `YearInReview` tab in the main content area**

Find the section that renders active tabs (around line 634–696). After the `{active==="Recurring"&&...}` block and before the closing `</div>`, add:

```jsx
{active==="Year In Review"&&(
  <YearInReview
    yearData={(data.yearInReview ?? {})[new Date().getFullYear().toString()]}
    onSave={saveYearInReview}
  />
)}
```

- [ ] **Step 5: Hide the `ItemForm` for Year In Review tab**

Find the line that conditionally renders `ItemForm` (~line 631):
```js
{active!=="Today"&&active!=="Notes"&&<div style={{marginTop:16}}><ItemForm active={active} onAdd={addItem}/></div>}
```
Change to:
```js
{active!=="Today"&&active!=="Notes"&&active!=="Year In Review"&&<div style={{marginTop:16}}><ItemForm active={active} onAdd={addItem}/></div>}
```

- [ ] **Step 6: Verify the tab works end to end**

With the dev server running:
1. Click "Year In Review" in the sidebar — it should appear with 12 accordion rows
2. Click any month to expand it
3. Type notes and click Save — re-open the month and confirm notes persist after page reload
4. Click "+ Add" and upload an image — confirm thumbnail appears
5. Click the × on an image — confirm it's removed

- [ ] **Step 7: Commit**

```bash
git add app/src/App.jsx
git commit -m "feat: wire Year In Review tab into app shell and navigation"
```

---

## Chunk 3: Build and cleanup

### Task 5: Production build verification

- [ ] **Step 1: Run the production build**

```bash
cd app && npm run build
```
Expected: build completes with no errors.

- [ ] **Step 2: Add `.superpowers/` to `.gitignore` if not already present**

Check `app/.gitignore` or the root `.gitignore`. If `.superpowers/` is not listed, add it:
```
.superpowers/
```

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "chore: ensure .superpowers ignored; verify production build"
```
