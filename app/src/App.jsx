import * as XLSX from "xlsx";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { ref, set, onValue } from "firebase/database";
import { useState, useEffect, useRef } from "react";
import { saveImage, getImages, deleteImage } from "./imageDb";

const SECTIONS = ["Today", "Tasks", "1:1 Agenda", "Roadmap Queue", "Recurring", "Notes", "Year In Review", "PTO"];
const PRIORITIES = ["High", "Medium", "Low"];
const FREQUENCIES = ["Daily", "Weekly", "Biweekly", "Monthly"];
const priorityColor = { High: "#ef4444", Medium: "#f59e0b", Low: "#6b7280" };

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
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

function formatDate(d) {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

function daysDiff(due) {
  if (!due) return null;
  return Math.floor((new Date(due + "T00:00:00") - new Date(new Date().toDateString())) / 86400000);
}

function isOverdue(due) { const d = daysDiff(due); return d !== null && d < 0; }
function isDueThisWeek(due) { const d = daysDiff(due); return d !== null && d >= 0 && d <= 6; }

function dueBadge(due, done) {
  if (!due || done) return null;
  const d = daysDiff(due);
  if (d < 0) return { label: `Overdue · ${formatDate(due)}`, bg: "#fef2f2", color: "#dc2626" };
  if (d === 0) return { label: `Due today`, bg: "#fef2f2", color: "#dc2626" };
  if (d === 1) return { label: `Due tomorrow`, bg: "#fffbeb", color: "#d97706" };
  if (d <= 6) return { label: `Due ${formatDate(due)}`, bg: "#fffbeb", color: "#d97706" };
  return { label: formatDate(due), bg: "#f1f5f9", color: "#64748b" };
}

// Month picker helpers
function monthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    opts.push({ value: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
  }
  return opts;
}

function formatMonth(val) {
  if (!val) return null;
  const [y, m] = val.split("-");
  return `${MONTHS[parseInt(m)-1]} ${y}`;
}

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

function exportRoadmapCSV(items) {
  const rows = [["Item", "Notes", "Target Month", "Added to Roadmap", "Captured On"]];
  items.forEach(r => rows.push([
    `"${r.text.replace(/"/g,'""')}"`,
    `"${(r.notes||"").replace(/"/g,'""')}"`,
    r.targetMonth ? formatMonth(r.targetMonth) : "",
    r.added ? "Yes" : "No",
    r.createdAt
  ]));
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "roadmap-queue.csv"; a.click();
  URL.revokeObjectURL(url);
}

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

function ItemForm({ active, onAdd }) {
  const [text, setText] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [freq, setFreq] = useState("Weekly");
  const [due, setDue] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);

  function handleAdd() {
    if (!text.trim()) return;
    onAdd({ text: text.trim(), priority, freq, due: due || null, targetMonth: targetMonth || null, notes: notes.trim() });
    setText(""); setDue(""); setTargetMonth(""); setNotes(""); setExpanded(false);
  }

  return (
    <div style={{ background:"white", borderRadius:12, border:"1px solid #e2e8f0", padding:16, marginBottom:20 }}>
      <div style={{ display:"flex", gap:8 }}>
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!expanded&&handleAdd()}
          placeholder={active==="Tasks"?"Add a task..."
            :active==="1:1 Agenda"?"Add agenda item..."
            :active==="Roadmap Queue"?"Add roadmap item..."
            :"Add recurring task..."}
          style={{ flex:1, padding:"9px 14px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:14, outline:"none", color:"#1e293b" }}
        />
        {active==="Tasks" && (
          <select value={priority} onChange={e=>setPriority(e.target.value)} style={{ padding:"9px 10px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", background:"white" }}>
            {PRIORITIES.map(p=><option key={p}>{p}</option>)}
          </select>
        )}
        {active==="Recurring" && (
          <select value={freq} onChange={e=>setFreq(e.target.value)} style={{ padding:"9px 10px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", background:"white" }}>
            {FREQUENCIES.map(f=><option key={f}>{f}</option>)}
          </select>
        )}
        <button onClick={()=>setExpanded(!expanded)} title="More options" style={{ padding:"9px 12px", background:expanded?"#ede9fe":"#f1f5f9", color:expanded?"#7c3aed":"#64748b", border:"1px solid #e2e8f0", borderRadius:8, cursor:"pointer", fontSize:14 }}>⋯</button>
        <button onClick={handleAdd} style={{ padding:"9px 18px", background:"#6366f1", color:"white", border:"none", borderRadius:8, fontSize:14, fontWeight:600, cursor:"pointer" }}>Add</button>
      </div>
      {expanded && (
        <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
          {active==="Roadmap Queue" ? (
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:12, color:"#64748b", fontWeight:500 }}>Target month (optional)</label>
              <select value={targetMonth} onChange={e=>setTargetMonth(e.target.value)}
                style={{ padding:"7px 10px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", background:"white", outline:"none" }}>
                <option value="">No target month</option>
                {monthOptions().map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:12, color:"#64748b", fontWeight:500 }}>Due date (optional)</label>
              <input type="date" value={due} onChange={e=>setDue(e.target.value)}
                style={{ padding:"7px 10px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", outline:"none" }}
              />
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:4, flex:1, minWidth:200 }}>
            <label style={{ fontSize:12, color:"#64748b", fontWeight:500 }}>Notes (optional)</label>
            <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Any context..."
              style={{ padding:"7px 10px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", outline:"none" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, onToggle, onDelete, onEdit=null, badge=null, sourceLabel=null }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const [editNotes, setEditNotes] = useState(item.notes||"");
  const [editDue, setEditDue] = useState(item.due||"");
  const [editPriority, setEditPriority] = useState(item.priority||"Medium");

  const done = item.done || item.discussed || item.added || item.doneToday;
  const db = dueBadge(item.due, done);
  const hasDetail = item.notes || item.createdAt;

  function saveEdit() {
    if (!editText.trim()) return;
    onEdit({ ...item, text: editText.trim(), notes: editNotes.trim(), due: editDue||null, priority: editPriority });
    setEditing(false);
  }
  function cancelEdit() {
    setEditText(item.text); setEditNotes(item.notes||""); setEditDue(item.due||""); setEditPriority(item.priority||"Medium");
    setEditing(false);
  }

  if (editing) return (
    <div style={{ background:"white", borderRadius:10, marginBottom:8, border:"2px solid #6366f1", padding:14 }}>
      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <input value={editText} onChange={e=>setEditText(e.target.value)}
          style={{ flex:1, fontSize:14, fontWeight:500, color:"#1e293b", border:"none", outline:"none", padding:0 }}
        />
        {item.priority !== undefined && (
          <select value={editPriority} onChange={e=>setEditPriority(e.target.value)}
            style={{ padding:"4px 8px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", background:"white" }}>
            {PRIORITIES.map(p=><option key={p}>{p}</option>)}
          </select>
        )}
      </div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          <label style={{ fontSize:12, color:"#64748b", fontWeight:500 }}>Due date</label>
          <input type="date" value={editDue} onChange={e=>setEditDue(e.target.value)}
            style={{ padding:"6px 10px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", outline:"none" }}
          />
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:4, flex:1, minWidth:180 }}>
          <label style={{ fontSize:12, color:"#64748b", fontWeight:500 }}>Notes</label>
          <input value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="Any context..."
            style={{ padding:"6px 10px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", outline:"none" }}
          />
        </div>
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={cancelEdit} style={{ padding:"6px 14px", background:"#f1f5f9", color:"#64748b", border:"none", borderRadius:8, fontSize:13, cursor:"pointer" }}>Cancel</button>
        <button onClick={saveEdit} style={{ padding:"6px 14px", background:"#6366f1", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>Save</button>
      </div>
    </div>
  );

  return (
    <div style={{ background:"white", borderRadius:10, marginBottom:8, border:`1px solid ${db&&db.color==="#dc2626"&&!done?"#fca5a5":db&&db.color==="#d97706"&&!done?"#fde68a":"#e2e8f0"}`, opacity:done?0.55:1 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px" }}>
        <input type="checkbox" checked={!!done} onChange={onToggle} style={{ width:17, height:17, accentColor:"#6366f1", cursor:"pointer", flexShrink:0 }}/>
        <span style={{ flex:1, fontSize:14, color:"#1e293b", textDecoration:done?"line-through":"none" }}>{item.text}</span>
        {sourceLabel && <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6, fontWeight:500, background:"#f1f5f9", color:"#64748b", flexShrink:0 }}>{sourceLabel}</span>}
        {badge}
        {db && <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6, fontWeight:500, background:db.bg, color:db.color, flexShrink:0 }}>{db.label}</span>}
        {onEdit && !done && <button onClick={()=>setEditing(true)} title="Edit" style={{ background:"none", border:"none", color:"#a5b4fc", cursor:"pointer", fontSize:14, padding:"0 2px", flexShrink:0 }}>✎</button>}
        {hasDetail && <button onClick={()=>setExpanded(!expanded)} style={{ background:"none", border:"none", color:expanded?"#6366f1":"#cbd5e1", cursor:"pointer", fontSize:14, padding:"0 2px", flexShrink:0 }}>{expanded?"▲":"▼"}</button>}
        <button onClick={onDelete} style={{ background:"none", border:"none", color:"#cbd5e1", cursor:"pointer", fontSize:18, padding:"0 2px", flexShrink:0 }}>×</button>
      </div>
      {expanded && (
        <div style={{ padding:"0 14px 12px 41px", display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-start" }}>
          {item.notes && <p style={{ margin:0, fontSize:13, color:"#475569", lineHeight:1.5 }}>{item.notes}</p>}
          {item.createdAt && <span style={{ fontSize:11, color:"#94a3b8", marginLeft:"auto" }}>Added {item.createdAt}</span>}
        </div>
      )}
    </div>
  );
}

// Roadmap-specific editable row
function RoadmapRow({ item, onToggle, onDelete, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [notes, setNotes] = useState(item.notes || "");
  const [targetMonth, setTargetMonth] = useState(item.targetMonth || "");
  const [noteOpen, setNoteOpen] = useState(false);

  function save() {
    if (!text.trim()) return;
    onEdit({ ...item, text: text.trim(), notes: notes.trim(), targetMonth: targetMonth || null });
    setEditing(false);
  }

  function cancel() {
    setText(item.text); setNotes(item.notes||""); setTargetMonth(item.targetMonth||"");
    setEditing(false);
  }

  if (editing) return (
    <div style={{ background:"white", borderRadius:10, marginBottom:8, border:"2px solid #6366f1", padding:14 }}>
      <input value={text} onChange={e=>setText(e.target.value)}
        style={{ width:"100%", fontSize:14, fontWeight:500, color:"#1e293b", border:"none", outline:"none", marginBottom:10, boxSizing:"border-box", padding:0 }}
      />
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          <label style={{ fontSize:12, color:"#64748b", fontWeight:500 }}>Target month</label>
          <select value={targetMonth} onChange={e=>setTargetMonth(e.target.value)}
            style={{ padding:"6px 10px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", background:"white", outline:"none" }}>
            <option value="">No target month</option>
            {monthOptions().map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:4, flex:1, minWidth:180 }}>
          <label style={{ fontSize:12, color:"#64748b", fontWeight:500 }}>Notes</label>
          <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Any context..."
            style={{ padding:"6px 10px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#374151", outline:"none" }}
          />
        </div>
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={cancel} style={{ padding:"6px 14px", background:"#f1f5f9", color:"#64748b", border:"none", borderRadius:8, fontSize:13, cursor:"pointer" }}>Cancel</button>
        <button onClick={save} style={{ padding:"6px 14px", background:"#6366f1", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>Save</button>
      </div>
    </div>
  );

  return (
    <div style={{ background:"white", borderRadius:10, marginBottom:8, border:"1px solid #e2e8f0", opacity:item.added?0.55:1 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px" }}>
        <input type="checkbox" checked={!!item.added} onChange={onToggle} style={{ width:17, height:17, accentColor:"#6366f1", cursor:"pointer", flexShrink:0 }}/>
        <span style={{ flex:1, fontSize:14, color:"#1e293b", textDecoration:item.added?"line-through":"none" }}>{item.text}</span>
        {item.targetMonth && (
          <span style={{ background:"#ede9fe", color:"#7c3aed", fontSize:11, padding:"2px 8px", borderRadius:6, fontWeight:500, flexShrink:0 }}>
            {formatMonth(item.targetMonth)}
          </span>
        )}
        <span style={{ background:"#f1f5f9", color:"#64748b", fontSize:11, padding:"2px 8px", borderRadius:6, fontWeight:500, flexShrink:0 }}>→ Roadmap</span>
        {!item.added && <button onClick={()=>setEditing(true)} title="Edit" style={{ background:"none", border:"none", color:"#a5b4fc", cursor:"pointer", fontSize:14, padding:"0 2px", flexShrink:0 }}>✎</button>}
        {item.notes && <button onClick={()=>setNoteOpen(!noteOpen)} style={{ background:"none", border:"none", color:noteOpen?"#6366f1":"#cbd5e1", cursor:"pointer", fontSize:14, padding:"0 2px", flexShrink:0 }}>{noteOpen?"▲":"▼"}</button>}
        <button onClick={onDelete} style={{ background:"none", border:"none", color:"#cbd5e1", cursor:"pointer", fontSize:18, padding:"0 2px", flexShrink:0 }}>×</button>
      </div>
      {noteOpen && item.notes && (
        <div style={{ padding:"0 14px 12px 41px" }}>
          <p style={{ margin:0, fontSize:13, color:"#475569", lineHeight:1.5 }}>{item.notes}</p>
          {item.createdAt && <span style={{ fontSize:11, color:"#94a3b8" }}>Added {item.createdAt}</span>}
        </div>
      )}
    </div>
  );
}

function NoteCard({ note, onDelete, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);

  function save() {
    if (!title.trim() && !body.trim()) return;
    onEdit({ ...note, title: title.trim(), body: body.trim() });
    setEditing(false);
  }

  if (editing) return (
    <div style={{ background:"white", borderRadius:12, border:"2px solid #6366f1", padding:16, marginBottom:12 }}>
      <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title (optional)"
        style={{ width:"100%", fontSize:15, fontWeight:600, color:"#1e293b", border:"none", outline:"none", marginBottom:10, boxSizing:"border-box", padding:0 }}
      />
      <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Write your note..." rows={5}
        style={{ width:"100%", fontSize:14, color:"#374151", border:"none", outline:"none", resize:"vertical", lineHeight:1.6, boxSizing:"border-box", padding:0, fontFamily:"inherit" }}
      />
      <div style={{ display:"flex", gap:8, marginTop:12, justifyContent:"flex-end" }}>
        <button onClick={()=>{setTitle(note.title);setBody(note.body);setEditing(false);}} style={{ padding:"6px 14px", background:"#f1f5f9", color:"#64748b", border:"none", borderRadius:8, fontSize:13, cursor:"pointer" }}>Cancel</button>
        <button onClick={save} style={{ padding:"6px 14px", background:"#6366f1", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>Save</button>
      </div>
    </div>
  );

  return (
    <div onClick={()=>setEditing(true)} style={{ background:"white", borderRadius:12, border:"1px solid #e2e8f0", padding:16, marginBottom:12, cursor:"pointer" }}
      onMouseEnter={e=>e.currentTarget.style.borderColor="#a5b4fc"}
      onMouseLeave={e=>e.currentTarget.style.borderColor="#e2e8f0"}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
        <div style={{ flex:1 }}>
          {note.title && <div style={{ fontWeight:600, fontSize:15, color:"#1e293b", marginBottom:note.body?6:0 }}>{note.title}</div>}
          {note.body && <p style={{ margin:0, fontSize:13, color:"#475569", lineHeight:1.6, whiteSpace:"pre-wrap" }}>{note.body}</p>}
        </div>
        <button onClick={e=>{e.stopPropagation();onDelete(note.id);}} style={{ background:"none", border:"none", color:"#cbd5e1", cursor:"pointer", fontSize:18, padding:"0 2px", flexShrink:0 }}>×</button>
      </div>
      <div style={{ marginTop:10, fontSize:11, color:"#94a3b8" }}>{note.updatedAt ? `Updated ${note.updatedAt}` : `Added ${note.createdAt}`}</div>
    </div>
  );
}

function NotesView({ notes, onAdd, onDelete, onEdit }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState(false);

  function handleAdd() {
    if (!title.trim() && !body.trim()) return;
    onAdd({ title: title.trim(), body: body.trim() });
    setTitle(""); setBody(""); setComposing(false);
  }

  const filtered = notes.filter(n => (n.title+n.body).toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes..."
          style={{ flex:1, padding:"9px 14px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:14, outline:"none", color:"#1e293b" }}
        />
        <button onClick={()=>setComposing(true)} style={{ padding:"9px 18px", background:"#6366f1", color:"white", border:"none", borderRadius:8, fontSize:14, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>+ New Note</button>
      </div>
      {composing && (
        <div style={{ background:"white", borderRadius:12, border:"2px solid #6366f1", padding:16, marginBottom:20 }}>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title (optional)"
            style={{ width:"100%", fontSize:15, fontWeight:600, color:"#1e293b", border:"none", outline:"none", marginBottom:10, boxSizing:"border-box", padding:0 }}
          />
          <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Write your note..." rows={5} autoFocus
            style={{ width:"100%", fontSize:14, color:"#374151", border:"none", outline:"none", resize:"vertical", lineHeight:1.6, boxSizing:"border-box", padding:0, fontFamily:"inherit" }}
          />
          <div style={{ display:"flex", gap:8, marginTop:12, justifyContent:"flex-end" }}>
            <button onClick={()=>{setTitle("");setBody("");setComposing(false);}} style={{ padding:"6px 14px", background:"#f1f5f9", color:"#64748b", border:"none", borderRadius:8, fontSize:13, cursor:"pointer" }}>Cancel</button>
            <button onClick={handleAdd} style={{ padding:"6px 14px", background:"#6366f1", color:"white", border:"none", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>Save Note</button>
          </div>
        </div>
      )}
      {filtered.length===0&&!composing && (
        <div style={{ textAlign:"center", padding:"48px 0", color:"#94a3b8", fontSize:14 }}>
          <div style={{ fontSize:32, marginBottom:12 }}>📝</div>
          {search?"No notes match your search":"No notes yet — click \"+ New Note\" to start"}
        </div>
      )}
      <div style={{ columns:"2 320px", columnGap:12 }}>
        {filtered.map(n=><div key={n.id} style={{ breakInside:"avoid" }}><NoteCard note={n} onDelete={onDelete} onEdit={onEdit}/></div>)}
      </div>
    </div>
  );
}

function TodayView({ data, onToggle, onDelete }) {
  const today = new Date().toLocaleDateString();
  const overdueTasks = data.tasks.filter(t=>!t.done&&isOverdue(t.due));
  const weekTasks = data.tasks.filter(t=>!t.done&&isDueThisWeek(t.due));
  const overdueAgenda = data.agenda.filter(a=>!a.discussed&&isOverdue(a.due));
  const weekAgenda = data.agenda.filter(a=>!a.discussed&&isDueThisWeek(a.due));
  const recurringDue = data.recurring.filter(r=>r.lastDone!==today);

  const now2 = new Date();
  const upcoming = Array.from({length:3}, (_,i) => { const d = new Date(now2.getFullYear(), now2.getMonth()+i, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; });
  const upcomingRoadmap = data.roadmap.filter(r => !r.added && r.targetMonth && upcoming.includes(r.targetMonth));

  const overdueAll = [...overdueTasks.map(t=>({...t,_type:"task"})),...overdueAgenda.map(a=>({...a,_type:"agenda"}))].sort((a,b)=>daysDiff(a.due)-daysDiff(b.due));
  const weekAll = [...weekTasks.map(t=>({...t,_type:"task"})),...weekAgenda.map(a=>({...a,_type:"agenda"}))].sort((a,b)=>daysDiff(a.due)-daysDiff(b.due));
  const sourceLabel = t=>t._type==="task"?"Task":"1:1 Agenda";

  if (overdueAll.length+weekAll.length+recurringDue.length+upcomingRoadmap.length===0) return (
    <div style={{ textAlign:"center", padding:"64px 0" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>🎉</div>
      <div style={{ fontSize:16, fontWeight:600, color:"#1e293b", marginBottom:8 }}>You're all caught up!</div>
      <div style={{ fontSize:14, color:"#94a3b8" }}>Nothing overdue or due this week.</div>
    </div>
  );

  return (
    <div>
      {overdueAll.length>0 && <Section title="Overdue" color="#dc2626" count={overdueAll.length}>{overdueAll.map(item=><ItemRow key={item.id} item={item} sourceLabel={sourceLabel(item)} onToggle={()=>onToggle(item._type,item.id)} onDelete={()=>onDelete(item._type,item.id)}/>)}</Section>}
      {weekAll.length>0 && <Section title="Due This Week" color="#d97706" count={weekAll.length}>{weekAll.map(item=><ItemRow key={item.id} item={item} sourceLabel={sourceLabel(item)} onToggle={()=>onToggle(item._type,item.id)} onDelete={()=>onDelete(item._type,item.id)}/>)}</Section>}
      {recurringDue.length>0 && <Section title="Recurring — Due Today" color="#6366f1" count={recurringDue.length}>{recurringDue.map(r=><ItemRow key={r.id} item={{...r,doneToday:r.lastDone===today}} badge={<span style={{background:"#f0f9ff",color:"#0369a1",fontSize:11,padding:"2px 8px",borderRadius:6,fontWeight:500,flexShrink:0}}>{r.freq}</span>} onToggle={()=>onToggle("recurring",r.id)} onDelete={()=>onDelete("recurring",r.id)}/>)}</Section>}
      {upcomingRoadmap.length > 0 && (
        <Section title="Coming Up on the Roadmap" color="#0d9488" count={upcomingRoadmap.length}>
          {[...upcomingRoadmap].sort((a,b)=>a.targetMonth.localeCompare(b.targetMonth)).map(r => (
            <div key={r.id} style={{ background:"white", borderRadius:10, marginBottom:8, border:"1px solid #e2e8f0", padding:"11px 14px", display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ background:"#ede9fe", color:"#7c3aed", fontSize:11, padding:"2px 8px", borderRadius:6, fontWeight:500, flexShrink:0, minWidth:80, textAlign:"center" }}>
                {formatMonth(r.targetMonth)}
              </span>
              <span style={{ flex:1, fontSize:14, color:"#1e293b" }}>{r.text}</span>
              {r.notes && <span title={r.notes} style={{ fontSize:12, color:"#94a3b8", flexShrink:0, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.notes}</span>}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, color, count, children }) {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <div style={{ width:10, height:10, borderRadius:"50%", background:color, flexShrink:0 }}/>
        <span style={{ fontWeight:700, fontSize:13, color:"#374151", textTransform:"uppercase", letterSpacing:"0.05em" }}>{title}</span>
        <span style={{ fontSize:12, color:"#94a3b8" }}>· {count} item{count!==1?"s":""}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ label }) {
  return (
    <div style={{ textAlign:"center", padding:"48px 0", color:"#94a3b8", fontSize:14 }}>
      <div style={{ fontSize:32, marginBottom:12 }}>📋</div>
      {label}
    </div>
  );
}

function YearInReview({ yearData, onSave }) {
  const year = new Date().getFullYear().toString();
  const [openMonth, setOpenMonth] = useState(null);
  const [notes, setNotes] = useState({});
  const [images, setImages] = useState({});  // { monthIndex: { key: objectURL } }
  const fileInputRef = useRef(null);
  const [uploadingMonth, setUploadingMonth] = useState(null);
  const allUrlsRef = useRef(new Set());

  useEffect(() => {
    return () => {
      allUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      allUrlsRef.current.clear();
    };
  }, []);

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

      // Create URLs outside the updater so they are created exactly once
      const newUrls = {};
      Object.entries(blobs).forEach(([k, blob]) => {
        newUrls[k] = URL.createObjectURL(blob);
      });

      setImages(prev => {
        // Revoke old URLs for this month and remove from ref
        Object.values(prev[monthIdx] ?? {}).forEach(u => {
          URL.revokeObjectURL(u);
          allUrlsRef.current.delete(u);
        });
        // Track new URLs in ref
        Object.values(newUrls).forEach(u => allUrlsRef.current.add(u));
        return { ...prev, [monthIdx]: newUrls };
      });
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
      allUrlsRef.current.add(url);
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
        allUrlsRef.current.delete(updated[imageKey]);
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

export default function App() {
  const [active, setActive] = useState("Today");
  const [data, setData] = useState(defaultData);
  const [loaded, setLoaded] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle");
  const isSavingRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pm-dashboard-v2");
      if (raw) setData(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;

    const dbRef = ref(db, `users/${user.uid}/pm-dashboard-v2`);

    const unsub = onValue(dbRef, (snapshot) => {
      if (isSavingRef.current) return;

      const val = snapshot.val();
      if (val) {
        setData(val);
        try { localStorage.setItem("pm-dashboard-v2", JSON.stringify(val)); } catch {}
        setSyncStatus("synced");
      } else {
        const raw = localStorage.getItem("pm-dashboard-v2");
        const localData = raw ? JSON.parse(raw) : null;
        if (localData) {
          isSavingRef.current = true;
          set(dbRef, localData)
            .then(() => { setSyncStatus("synced"); })
            .catch(() => { setSyncStatus("error"); })
            .finally(() => { isSavingRef.current = false; });
        } else {
          setSyncStatus("synced");
        }
      }
    });

    return () => unsub();
  }, [user]);

  function save(next) {
    setData(next);
    try { localStorage.setItem("pm-dashboard-v2", JSON.stringify(next)); } catch {}

    if (user) {
      const dbRef = ref(db, `users/${user.uid}/pm-dashboard-v2`);
      isSavingRef.current = true;
      setSyncStatus("saving");
      set(dbRef, next)
        .then(() => { setSyncStatus("synced"); })
        .catch(() => { setSyncStatus("error"); })
        .finally(() => { isSavingRef.current = false; });
    }
  }

  async function handleSignIn() {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error("Sign-in failed", e);
    }
  }

  function handleSignOut() {
    if (!window.confirm("Sign out? Your data stays on this device but won't sync until you sign back in.")) return;
    signOut(auth);
    setSyncStatus("idle");
  }

  function addItem({ text, priority, freq, due, targetMonth, notes }) {
    const base = { id: generateId(), text, due, notes, createdAt: new Date().toLocaleDateString() };
    let next = { ...data };
    if (active==="Tasks") next.tasks = [{ ...base, priority, done:false }, ...next.tasks];
    if (active==="1:1 Agenda") next.agenda = [{ ...base, discussed:false }, ...next.agenda];
    if (active==="Roadmap Queue") next.roadmap = [{ ...base, targetMonth: targetMonth||null, added:false }, ...next.roadmap];
    if (active==="Recurring") next.recurring = [{ ...base, freq, lastDone:null }, ...next.recurring];
    save(next);
  }

  function addNote({ title, body }) {
    save({ ...data, notes: [{ id:generateId(), title, body, createdAt:new Date().toLocaleDateString(), updatedAt:null }, ...data.notes] });
  }
  function editNote(updated) { save({ ...data, notes: data.notes.map(n=>n.id===updated.id?{...updated,updatedAt:new Date().toLocaleDateString()}:n) }); }
  function deleteNote(id) { save({ ...data, notes: data.notes.filter(n=>n.id!==id) }); }
  function editRoadmap(updated) { save({ ...data, roadmap: data.roadmap.map(r=>r.id===updated.id?updated:r) }); }

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

  function handleToggle(type, id) {
    if (type==="task") save({...data,tasks:data.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)});
    if (type==="agenda") save({...data,agenda:data.agenda.map(a=>a.id===id?{...a,discussed:!a.discussed}:a)});
    if (type==="recurring") { const t=new Date().toLocaleDateString(); save({...data,recurring:data.recurring.map(r=>r.id===id?{...r,lastDone:r.lastDone===t?null:t}:r)}); }
  }
  function handleDelete(type, id) {
    if (type==="task") save({...data,tasks:data.tasks.filter(t=>t.id!==id)});
    if (type==="agenda") save({...data,agenda:data.agenda.filter(a=>a.id!==id)});
    if (type==="recurring") save({...data,recurring:data.recurring.filter(r=>r.id!==id)});
  }
  function del(section, id) {
    const k={Tasks:"tasks","1:1 Agenda":"agenda","Roadmap Queue":"roadmap",Recurring:"recurring"}[section];
    save({...data,[k]:data[k].filter(i=>i.id!==id)});
  }

  const today = new Date().toLocaleDateString();
  const todayCount = [...data.tasks.filter(t=>!t.done&&(isOverdue(t.due)||isDueThisWeek(t.due))),...data.agenda.filter(a=>!a.discussed&&(isOverdue(a.due)||isDueThisWeek(a.due))),...data.recurring.filter(r=>r.lastDone!==today)].length;
  const counts = {
    Today: todayCount,
    Tasks: data.tasks.filter(t=>!t.done).length,
    "1:1 Agenda": data.agenda.filter(a=>!a.discussed).length,
    "Roadmap Queue": data.roadmap.filter(r=>!r.added).length,
    Recurring: data.recurring.filter(r=>r.lastDone!==today).length,
    Notes: data.notes.length,
  };
  const sectionIcons = { Today:"⚡", Tasks:"✓", "1:1 Agenda":"💬", "Roadmap Queue":"🗺️", Recurring:"🔁", Notes:"📝", "Year In Review":"🏆", PTO:"🌴" };

  // Group roadmap by month
  const roadmapByMonth = () => {
    const visible = data.roadmap.filter(r => showDone || !r.added);
    const groups = {};
    visible.forEach(r => {
      const key = r.targetMonth || "__none__";
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    // Sort keys: dated months first (asc), then no-month
    const sorted = Object.keys(groups).sort((a,b) => {
      if (a==="__none__") return 1;
      if (b==="__none__") return -1;
      return a.localeCompare(b);
    });
    return sorted.map(k => ({ key: k, label: k==="__none__"?"No target month":formatMonth(k), items: groups[k] }));
  };

  if (!loaded) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"sans-serif",color:"#6b7280"}}>Loading...</div>;

  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background:"#f8fafc" }}>
      <div style={{ width:220, background:"#1e293b", display:"flex", flexDirection:"column", padding:"24px 0" }}>
        <div style={{ padding:"0 20px 24px", borderBottom:"1px solid #334155" }}>
          <div style={{ color:"#f1f5f9", fontWeight:700, fontSize:16 }}>PM Command Center</div>
          <div style={{ color:"#64748b", fontSize:12, marginTop:4 }}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}</div>
        </div>
        <nav style={{ padding:"16px 0", flex:1 }}>
          {SECTIONS.map(s=>(
            <button key={s} onClick={()=>{setActive(s);setShowDone(false);}} style={{
              display:"flex",alignItems:"center",justifyContent:"space-between",
              width:"100%",padding:"10px 20px",border:"none",cursor:"pointer",
              background:active===s?"#334155":"transparent",
              color:active===s?"#f1f5f9":"#94a3b8",
              fontSize:14,fontWeight:active===s?600:400,
              borderLeft:active===s?"3px solid #6366f1":"3px solid transparent",textAlign:"left"
            }}>
              <span>{sectionIcons[s]} {s}</span>
              {counts[s]>0&&<span style={{background:s==="Today"?"#ef4444":"#6366f1",color:"white",borderRadius:10,fontSize:11,padding:"1px 7px",fontWeight:700}}>{counts[s]}</span>}
            </button>
          ))}
        </nav>
        <div style={{ padding:"16px 20px", borderTop:"1px solid #334155" }}>
          {user && (
            <div style={{ fontSize:10, color: syncStatus==="error" ? "#f87171" : "#475569", marginBottom:8 }}>
              {syncStatus==="saving" && "⟳ Saving..."}
              {syncStatus==="synced" && "✓ Synced"}
              {syncStatus==="error" && "⚠ Sync failed — check connection"}
            </div>
          )}
          {user ? (
            <div style={{ marginBottom:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                {user.photoURL && <img src={user.photoURL} alt="" style={{ width:22, height:22, borderRadius:"50%" }} />}
                <span style={{ color:"#94a3b8", fontSize:11, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.email}</span>
              </div>
              <button onClick={handleSignOut} style={{ width:"100%", padding:"6px 0", background:"transparent", color:"#475569", border:"1px solid #334155", borderRadius:8, fontSize:11, cursor:"pointer" }}>
                Sign out
              </button>
            </div>
          ) : (
            <button onClick={handleSignIn} style={{ marginBottom:8, width:"100%", padding:"8px 0", background:"#3b82f6", color:"white", border:"none", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" }}>
              Sign in with Google
            </button>
          )}
          <div style={{ color:"#475569", fontSize:11 }}>Total open</div>
          <div style={{ color:"#f1f5f9", fontWeight:700, fontSize:22 }}>{data.tasks.filter(t=>!t.done).length+data.agenda.filter(a=>!a.discussed).length+data.roadmap.filter(r=>!r.added).length}</div>
          <button onClick={()=>exportAllXLSX(data)} style={{ marginTop:12, width:"100%", padding:"8px 0", background:"#334155", color:"#94a3b8", border:"1px solid #475569", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" }}>
            ↓ Download All
          </button>
          <button onClick={()=>{ const a=document.createElement('a'); a.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(data,null,2)); a.download='pm-dashboard.json'; a.click(); }} style={{ marginTop:6, width:"100%", padding:"8px 0", background:"#334155", color:"#94a3b8", border:"1px solid #475569", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" }}>
            ↓ Export JSON
          </button>
          <label style={{ marginTop:6, display:"block", width:"100%", padding:"8px 0", background:"#334155", color:"#94a3b8", border:"1px solid #475569", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", textAlign:"center", boxSizing:"border-box" }}>
            ↑ Import JSON
            <input type="file" accept=".json" style={{ display:"none" }} onChange={e=>{ const file=e.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=ev=>{ try{ const parsed=JSON.parse(ev.target.result); save(parsed); alert('Data imported successfully!'); }catch{ alert('Invalid JSON file.'); } }; reader.readAsText(file); e.target.value=''; }} />
          </label>
        </div>
      </div>

      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ background:"white", borderBottom:"1px solid #e2e8f0", padding:"20px 28px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:active==="Today"||active==="Notes"?0:16 }}>
            <div>
              <h1 style={{ margin:0, fontSize:20, fontWeight:700, color:"#1e293b" }}>{sectionIcons[active]} {active==="Today"?"Today's Focus":active}</h1>
              {active==="Today"&&<p style={{margin:"4px 0 0",fontSize:13,color:"#94a3b8"}}>Overdue items, due this week, recurring tasks, and upcoming roadmap</p>}
              {active==="Notes"&&<p style={{margin:"4px 0 0",fontSize:13,color:"#94a3b8"}}>{data.notes.length} note{data.notes.length!==1?"s":""} · click any note to edit</p>}
            </div>
            {active==="Roadmap Queue"&&(
              <button onClick={()=>exportRoadmapCSV(data.roadmap)} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                ↓ Export CSV
              </button>
            )}
          </div>
          {active!=="Today"&&active!=="Notes"&&active!=="Year In Review"&&active!=="PTO"&&<div style={{marginTop:16}}><ItemForm active={active} onAdd={addItem}/></div>}
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"20px 28px" }}>
          {active==="Today"&&<TodayView data={data} onToggle={handleToggle} onDelete={handleDelete}/>}
          {active==="Notes"&&<NotesView notes={data.notes} onAdd={addNote} onDelete={deleteNote} onEdit={editNote}/>}

          {active==="Tasks"&&<>
            {PRIORITIES.map(p=>{
              const items=data.tasks.filter(t=>t.priority===p&&(showDone||!t.done)).sort((a,b)=>{
                if(a.due&&b.due) return a.due.localeCompare(b.due);
                if(a.due) return -1;
                if(b.due) return 1;
                return 0;
              });
              if(!items.length) return null;
              return <div key={p} style={{marginBottom:24}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:priorityColor[p]}}/>
                  <span style={{fontWeight:600,fontSize:13,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em"}}>{p} Priority</span>
                  <span style={{color:"#94a3b8",fontSize:12}}>· {items.filter(i=>!i.done).length} open</span>
                </div>
                {items.map(t=><ItemRow key={t.id} item={t} onToggle={()=>save({...data,tasks:data.tasks.map(x=>x.id===t.id?{...x,done:!x.done}:x)})} onDelete={()=>del("Tasks",t.id)} onEdit={u=>save({...data,tasks:data.tasks.map(x=>x.id===u.id?u:x)})}/>)}
              </div>;
            })}
            {data.tasks.some(t=>t.done)&&<button onClick={()=>setShowDone(!showDone)} style={{background:"none",border:"none",color:"#6366f1",fontSize:13,cursor:"pointer",padding:0}}>{showDone?"Hide":"Show"} completed ({data.tasks.filter(t=>t.done).length})</button>}
            {data.tasks.length===0&&<Empty label="No tasks yet — add one above"/>}
          </>}

          {active==="1:1 Agenda"&&<>
            {data.agenda.filter(a=>showDone||!a.discussed).map(a=>(
              <ItemRow key={a.id} item={{...a,done:a.discussed}}
                onToggle={()=>save({...data,agenda:data.agenda.map(x=>x.id===a.id?{...x,discussed:!x.discussed}:x)})}
                onDelete={()=>del("1:1 Agenda",a.id)}/>
            ))}
            {data.agenda.some(a=>a.discussed)&&<button onClick={()=>setShowDone(!showDone)} style={{background:"none",border:"none",color:"#6366f1",fontSize:13,cursor:"pointer",padding:0}}>{showDone?"Hide":"Show"} discussed ({data.agenda.filter(a=>a.discussed).length})</button>}
            {data.agenda.length===0&&<Empty label="Nothing on the agenda — add items to discuss with your manager"/>}
          </>}

          {active==="Roadmap Queue"&&<>
            {roadmapByMonth().map(group=>(
              <div key={group.key} style={{marginBottom:28}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <span style={{fontWeight:700,fontSize:13,color:"#374151",textTransform:"uppercase",letterSpacing:"0.05em"}}>🗓 {group.label}</span>
                  <span style={{fontSize:12,color:"#94a3b8"}}>· {group.items.filter(i=>!i.added).length} open</span>
                </div>
                {group.items.map(r=><RoadmapRow key={r.id} item={r}
                  onToggle={()=>save({...data,roadmap:data.roadmap.map(x=>x.id===r.id?{...x,added:!x.added}:x)})}
                  onDelete={()=>del("Roadmap Queue",r.id)}
                  onEdit={editRoadmap}/>)}
              </div>
            ))}
            {data.roadmap.some(r=>r.added)&&<button onClick={()=>setShowDone(!showDone)} style={{background:"none",border:"none",color:"#6366f1",fontSize:13,cursor:"pointer",padding:0,marginTop:4}}>{showDone?"Hide":"Show"} added ({data.roadmap.filter(r=>r.added).length})</button>}
            {data.roadmap.length===0&&<Empty label="No roadmap items queued — capture ideas here before adding them to Excel"/>}
          </>}

          {active==="Recurring"&&<>
            {data.recurring.map(r=>{
              const doneToday=r.lastDone===today;
              return <ItemRow key={r.id} item={{...r,done:doneToday,doneToday}}
                onToggle={()=>save({...data,recurring:data.recurring.map(x=>x.id===r.id?{...x,lastDone:doneToday?null:today}:x)})}
                onDelete={()=>del("Recurring",r.id)}
                badge={<span style={{background:"#f0f9ff",color:"#0369a1",fontSize:11,padding:"2px 8px",borderRadius:6,fontWeight:500,flexShrink:0}}>{r.freq}</span>}/>;
            })}
            {data.recurring.length===0&&<Empty label="No recurring tasks yet"/>}
          </>}

          {active==="Year In Review"&&(
            <YearInReview
              yearData={(data.yearInReview ?? {})[new Date().getFullYear().toString()]}
              onSave={saveYearInReview}
            />
          )}
          {active === "PTO" && (
            <PTOView
              pto={data.pto || defaultData.pto}
              onSave={nextPto => save({ ...data, pto: nextPto })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
