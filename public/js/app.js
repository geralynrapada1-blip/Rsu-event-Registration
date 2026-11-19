const $=s=>document.querySelector(s), esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const data=f=>Object.fromEntries(new FormData(f).entries());
async function api(url,opt={}){let r=await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...opt}),d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.message||"Request failed");return d}
function say(m){let t=$("#toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3000)}
const date=d=>d?new Date(d+"T00:00:00").toLocaleDateString():"—";

function urlBase64ToUint8Array(base64String){const padding="=".repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
async function enablePush(){
 if(!("serviceWorker" in navigator)||!("PushManager" in window)){say("This browser does not support mobile push notifications.");return;}
 try{
  const permission=await Notification.requestPermission();
  if(permission!=="granted"){say("Notifications were not allowed. You can enable them in browser settings.");return;}
  const cfg=await api("/api/push/public-key");
  if(!cfg.enabled||!cfg.publicKey){say("Push is not configured on the server yet. Email notifications can still work.");return;}
  const registration=await navigator.serviceWorker.register("/sw.js");
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.publicKey)});
  const result=await api("/api/push/subscribe",{method:"POST",body:JSON.stringify({subscription})});
  say(result.message);
  const b=$("#enablePush");if(b)b.textContent="Mobile notifications enabled";
 }catch(error){console.error(error);say("Could not enable push notifications: "+error.message);}
}
async function setupPushButton(){
 const b=$("#enablePush");if(!b)return;
 if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(console.error);
 b.addEventListener("click",enablePush);
}
function addBackLink(){
 const main=$("main");if(!main||$(".back-link"))return;
 const p=document.body.dataset.page;
 if(p==="home")return;
 const target=["manageevents","manageann","manageregs","students"].includes(p)?"/organizer.html":p==="registerevent"?"/events.html":p==="myregs"||p==="notifications"?"/dashboard.html":"/";
 const label=target==="/organizer.html"?"← Back to Organizer Dashboard":target==="/dashboard.html"?"← Back to Student Dashboard":target==="/events.html"?"← Back to Events":"← Back to Home";
 const link=document.createElement("a");link.className="btn alt back-link";link.href=target;link.textContent=label;main.insertBefore(link,main.firstChild);
}

function card(e){return `<article class="card"><span class="tag">${esc(e.status)}</span><h3>${esc(e.title)}</h3><p>${esc(e.description||"Campus activity")}</p><p class="muted small">▦ ${date(e.date)} · ${esc(e.time||"")}<br>⌖ ${esc(e.venue)}</p><a class="btn" href="/registration.html?eventId=${e._id}">View / Register</a></article>`}
function tableRows(rows){if(!rows.length)return '<p class="card muted">No records found.</p>';return `<div class="table"><table><thead><tr><th>Event</th><th>Date</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.event?.title||"Event removed")}</td><td>${date(r.event?.date)}</td><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table></div>`}
async function loadEvents(){let {events}=await api("/api/events"),available=events.filter(e=>!["completed","cancelled"].includes(e.status));if($("#eventCards"))$("#eventCards").innerHTML=available.map(card).join("")||"No events yet.";if($("#homeCards"))$("#homeCards").innerHTML=available.slice(0,3).map(card).join("")||"No upcoming events.";return events}
async function init(){
 let p=document.body.dataset.page;
 addBackLink();
 setupPushButton();
 if($("#login"))$("#login").onsubmit=async e=>{e.preventDefault();try{let d=await api("/api/auth/login",{method:"POST",body:JSON.stringify(data(e.target))});location.href=d.user.role==="organizer"?"/organizer.html":"/dashboard.html"}catch(x){say(x.message)}};
 if($("#register"))$("#register").onsubmit=async e=>{e.preventDefault();try{let d=await api("/api/auth/register",{method:"POST",body:JSON.stringify(data(e.target))});say(d.message||"Account created.");location.href="/dashboard.html"}catch(x){say(x.message)}};
 if(["home","events"].includes(p))loadEvents().catch(x=>say(x.message));
 if(p==="registerevent"){let id=new URLSearchParams(location.search).get("eventId");try{let {event}=await api("/api/events/"+id);$("#eventInfo").innerHTML=card(event);$("#join").onclick=async()=>{try{let d=await api("/api/registrations",{method:"POST",body:JSON.stringify({eventId:id})});say(d.message);setTimeout(()=>location.href="/my-registrations.html",800)}catch(x){say(x.message)}}}catch(x){$("#eventInfo").textContent=x.message}}
 if(p==="dashboard"){try{let [r,n,e]=await Promise.all([api("/api/my-registrations"),api("/api/notifications"),api("/api/events")]);$("#myCount").textContent=r.registrations.length;$("#noteCount").textContent=n.notifications.filter(x=>!x.isRead).length;$("#myRows").innerHTML=tableRows(r.registrations);$("#hello").textContent=(await api("/api/auth/me")).user?.name||"Student"}catch(x){say(x.message)}}
 if(p==="myregs"){try{let d=await api("/api/my-registrations");$("#myRows").innerHTML=tableRows(d.registrations)}catch(x){say(x.message)}}
 if(p==="announcements"||p==="manageann"){try{let {announcements}=await api("/api/announcements");if($("#annList"))$("#annList").innerHTML=announcements.map(a=>`<article class="card"><h3>${esc(a.title)}</h3><p>${esc(a.message)}</p><small>${new Date(a.createdAt).toLocaleString()}</small></article>`).join("")||"No announcements yet."}catch(x){say(x.message)}}
 if(p==="organizer"){let [e,r,s]=await Promise.all([api("/api/events"),api("/api/organizer/registrations"),api("/api/organizer/students")]);$("#eventCount").textContent=e.events.length;$("#regCount").textContent=r.registrations.length;$("#studentCount").textContent=s.students.length}
 if(p==="manageevents")manageEvents();
 if(p==="manageann")manageAnnouncements();
 if(p==="manageregs")manageRegs();
 if(p==="students")manageStudents();
 if(p==="notifications"){let {notifications}=await api("/api/notifications");$("#notes").innerHTML=notifications.map(n=>`<article class="card"><h3>${esc(n.title)}</h3><p>${esc(n.message)}</p>${n.isRead?"Read":`<button class="btn" data-read="${n._id}">Mark read</button>`}</article>`).join("")||"No notifications.";document.querySelectorAll("[data-read]").forEach(b=>b.onclick=async()=>{await api(`/api/notifications/${b.dataset.read}/read`,{method:"PATCH"});location.reload()})}
 $("#logout")?.addEventListener("click",async()=>{await api("/api/auth/logout",{method:"POST"});location.href="/"});
}
async function manageEvents(){
 const f=$("#eventForm");async function refresh(){let {events}=await api("/api/events");$("#records").innerHTML=events.map(e=>`<article class="card"><b>${esc(e.title)}</b><p class="muted small">${date(e.date)} · ${esc(e.venue)}</p><button class="btn alt" data-edit="${e._id}">Edit</button> <button class="btn danger" data-del="${e._id}">Delete</button></article>`).join("");document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{let {event}=await api("/api/events/"+b.dataset.edit);Object.keys(event).forEach(k=>{if(f.elements[k])f.elements[k].value=event[k]??""});f.elements.id.value=event._id});document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(confirm("Delete this event and its registrations?")){await api("/api/events/"+b.dataset.del,{method:"DELETE"});refresh()}})}
 f.onsubmit=async e=>{e.preventDefault();let d=data(f),id=d.id;delete d.id;try{let x=await api(id?"/api/events/"+id:"/api/events",{method:id?"PUT":"POST",body:JSON.stringify(d)});say(x.message);f.reset();refresh()}catch(x){say(x.message)}};$("#clear")?.addEventListener("click",()=>f.reset());refresh().catch(x=>say(x.message));
}
async function manageAnnouncements(){
 const f=$("#annForm");async function refresh(){let {announcements}=await api("/api/announcements");$("#records").innerHTML=announcements.map(a=>`<article class="card"><b>${esc(a.title)}</b><p>${esc(a.message)}</p><button class="btn alt" data-edit="${a._id}">Edit</button> <button class="btn danger" data-del="${a._id}">Delete</button></article>`).join("");document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{let a=announcements.find(x=>x._id===b.dataset.edit);f.elements.id.value=a._id;f.elements.title.value=a.title;f.elements.message.value=a.message});document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(confirm("Delete announcement?")){await api("/api/announcements/"+b.dataset.del,{method:"DELETE"});refresh()}})}
 f.onsubmit=async e=>{e.preventDefault();let d=data(f),id=d.id;delete d.id;d.sendEmail=f.elements.sendEmail.checked;try{let x=await api(id?"/api/announcements/"+id:"/api/announcements",{method:id?"PUT":"POST",body:JSON.stringify(d)});say(x.message);f.reset();refresh()}catch(x){say(x.message)}};refresh().catch(x=>say(x.message));
}
async function manageRegs(){let {registrations}=await api("/api/organizer/registrations");$("#records").innerHTML=registrations.length?`<div class="table"><table><tr><th>Student</th><th>ID</th><th>Event</th><th>Status</th><th>Save</th></tr>${registrations.map(r=>`<tr><td>${esc(r.student?.name)}</td><td>${esc(r.student?.studentId)}</td><td>${esc(r.event?.title)}</td><td><select id="s${r._id}">${["pending","approved","rejected","attended"].map(x=>`<option ${x===r.status?"selected":""}>${x}</option>`)}</select></td><td><button class="btn" data-save="${r._id}">Update</button> <button class="btn danger" data-del="${r._id}">Delete</button></td></tr>`).join("")}</table></div>`:"No registrations yet.";document.querySelectorAll("[data-save]").forEach(b=>b.onclick=async()=>{let status=$("#s"+b.dataset.save).value;let d=await api("/api/organizer/registrations/"+b.dataset.save,{method:"PATCH",body:JSON.stringify({status})});say(d.message)});document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(confirm("Delete registration?")){await api("/api/organizer/registrations/"+b.dataset.del,{method:"DELETE"});manageRegs()}})}
async function manageStudents(){let {students}=await api("/api/organizer/students");$("#records").innerHTML=`<div class="table"><table><tr><th>Name</th><th>Student ID</th><th>Email</th><th>Active</th><th>Action</th></tr>${students.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.studentId)}</td><td>${esc(s.email)}</td><td>${s.active}</td><td><button class="btn" data-toggle="${s._id}" data-active="${!s.active}">${s.active?"Deactivate":"Activate"}</button></td></tr>`).join("")}</table></div>`;document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=async()=>{await api("/api/organizer/students/"+b.dataset.toggle,{method:"PATCH",body:JSON.stringify({active:b.dataset.active==="true"})});manageStudents()})}
document.addEventListener("DOMContentLoaded",()=>init().catch(e=>say(e.message)));
