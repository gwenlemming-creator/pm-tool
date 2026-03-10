import * as XLSX from "xlsx";
import { useState, useEffect } from "react";

const SECTIONS = ["Today", "Tasks", "1:1 Agenda", "Roadmap Queue", "Recurring", "Notes"];
const PRIORITIES = ["High", "Medium", "Low"];
const FREQUENCIES = ["Daily", "Weekly", "Biweekly", "Monthly"];
const priorityColor = { High: "#ef4444", Medium: "#f59e0b", Low: "#6b7280" };

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
const defaultData = { tasks: [], agenda: [], roadmap: [], recurring: [], notes: [] };

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

  function upcomingMonths() {
    const now = new Date();
    const months = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
    }
    return months;
  }
  const upcoming = upcomingMonths();
  const upcomingRoadmap = data.roadmap.filter(r => !r.added && r.targetMonth && upcoming.includes(r.targetMonth));

  const overdueAll = [...overdueTasks.map(t=>({...t,_type:"task"})),...overdueAgenda.map(a=>({...a,_type:"agenda"}))].sort((a,b)=>daysDiff(a.due)-daysDiff(b.due));
  const weekAll = [...weekTasks.map(t=>({...t,_type:"task"})),...weekAgenda.map(a=>({...a,_type:"agenda"}))].sort((a,b)=>daysDiff(a.due)-daysDiff(b.due));
  const sourceLabel = t=>t._type==="task"?"Task":"1:1 Agenda";

  if (overdueAll.length+weekAll.length+recurringDue.length===0) return (
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
          {upcomingRoadmap.map(r => (
            <div key={r.id} style={{ background:"white", borderRadius:10, marginBottom:8, border:"1px solid #e2e8f0", padding:"11px 14px", display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ flex:1, fontSize:14, color:"#1e293b" }}>{r.text}</span>
              <span style={{ background:"#ede9fe", color:"#7c3aed", fontSize:11, padding:"2px 8px", borderRadius:6, fontWeight:500, flexShrink:0 }}>
                {formatMonth(r.targetMonth)}
              </span>
              {r.notes && <span style={{ fontSize:12, color:"#94a3b8", flexShrink:0, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.notes}</span>}
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

export default function App() {
  const [active, setActive] = useState("Today");
  const [data, setData] = useState(defaultData);
  const [loaded, setLoaded] = useState(false);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pm-dashboard-v2");
      if (raw) setData(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);

  function save(next) {
    setData(next);
    try { localStorage.setItem("pm-dashboard-v2", JSON.stringify(next)); } catch {}
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
  const sectionIcons = { Today:"⚡", Tasks:"✓", "1:1 Agenda":"💬", "Roadmap Queue":"🗺️", Recurring:"🔁", Notes:"📝" };

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
          <div style={{ color:"#475569", fontSize:11 }}>Total open</div>
          <div style={{ color:"#f1f5f9", fontWeight:700, fontSize:22 }}>{data.tasks.filter(t=>!t.done).length+data.agenda.filter(a=>!a.discussed).length+data.roadmap.filter(r=>!r.added).length}</div>
          <button onClick={()=>exportAllXLSX(data)} style={{ marginTop:12, width:"100%", padding:"8px 0", background:"#334155", color:"#94a3b8", border:"1px solid #475569", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" }}>
            ↓ Download All
          </button>
        </div>
      </div>

      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ background:"white", borderBottom:"1px solid #e2e8f0", padding:"20px 28px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:active==="Today"||active==="Notes"?0:16 }}>
            <div>
              <h1 style={{ margin:0, fontSize:20, fontWeight:700, color:"#1e293b" }}>{sectionIcons[active]} {active==="Today"?"Today's Focus":active}</h1>
              {active==="Today"&&<p style={{margin:"4px 0 0",fontSize:13,color:"#94a3b8"}}>Overdue items, due this week, and recurring tasks</p>}
              {active==="Notes"&&<p style={{margin:"4px 0 0",fontSize:13,color:"#94a3b8"}}>{data.notes.length} note{data.notes.length!==1?"s":""} · click any note to edit</p>}
            </div>
            {active==="Roadmap Queue"&&(
              <button onClick={()=>exportRoadmapCSV(data.roadmap)} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                ↓ Export CSV
              </button>
            )}
          </div>
          {active!=="Today"&&active!=="Notes"&&<div style={{marginTop:16}}><ItemForm active={active} onAdd={addItem}/></div>}
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"20px 28px" }}>
          {active==="Today"&&<TodayView data={data} onToggle={handleToggle} onDelete={handleDelete}/>}
          {active==="Notes"&&<NotesView notes={data.notes} onAdd={addNote} onDelete={deleteNote} onEdit={editNote}/>}

          {active==="Tasks"&&<>
            {PRIORITIES.map(p=>{
              const items=data.tasks.filter(t=>t.priority===p&&(showDone||!t.done));
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
        </div>
      </div>
    </div>
  );
}
