function restorePosition() {
  const key = "mare-pos-" + G.session.user.id;
  try {
    const p = JSON.parse(localStorage.getItem(key));
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) G.pos = {x:p.x,y:p.y};
    else { const r=getRegion(G.profile.active_region)||getRegion("harbor_haven"); G.pos={x:r?.x||0,y:r?.y||0}; }
  } catch { G.pos={x:0,y:0}; }
  G.camera.x=G.pos.x; G.camera.y=G.pos.y;
}
function savePosition() {
  if (!G.session) return;
  localStorage.setItem("mare-pos-"+G.session.user.id, JSON.stringify({x:Math.round(G.pos.x),y:Math.round(G.pos.y)}));
}

async function upsertPresence() {
  if (!G.session || !G.profile) return;
  const payload = {
    user_id:G.session.user.id, username:G.profile.username, x:G.pos.x, y:G.pos.y,
    region:G.currentRegion, boat:G.profile.active_boat, level:G.profile.level,
    active_title:G.profile.active_title, last_seen:new Date().toISOString()
  };
  await sb.from("mare_presence").upsert(payload, { onConflict:"user_id" });
}

async function loadPresence() {
  const since = new Date(Date.now()-90000).toISOString();
  const {data} = await sb.from("mare_presence").select("*").gte("last_seen",since);
  G.others.clear();
  for (const p of data || []) if (p.user_id !== G.session.user.id) G.others.set(p.user_id,p);
  renderOnline();
}

function renderOnline() {
  const list=[...G.others.values()].filter(p=>Date.now()-new Date(p.last_seen).getTime()<90000);
  ui.onlineCount.textContent = list.length + 1;
  ui.onlineList.innerHTML = [
    `<div class="online-user"><span class="online-avatar">${escapeHtml(G.profile.username[0]?.toUpperCase()||"M")}</span><div><b>${escapeHtml(G.profile.username)} (você)</b><small>Lv. ${G.profile.level} · ${escapeHtml(G.profile.active_title)}</small></div></div>`,
    ...list.slice(0,8).map(p=>`<div class="online-user"><span class="online-avatar">${escapeHtml(p.username?.[0]?.toUpperCase()||"?")}</span><div><b>${escapeHtml(p.username)}</b><small>Lv. ${p.level} · ${escapeHtml(p.active_title||"")}</small></div></div>`)
  ].join("");
}

function subscribeRealtime() {
  cleanupRealtime();
  const presence = sb.channel("mare-presence-ui")
    .on("postgres_changes",{event:"*",schema:"public",table:"mare_presence"},p=>{
      const row=p.new || p.old; if (!row || row.user_id===G.session.user.id) return;
      if (p.eventType==="DELETE") G.others.delete(row.user_id); else G.others.set(row.user_id,row);
      renderOnline();
    }).subscribe();
  const announcements = sb.channel("mare-announcements-ui")
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"mare_announcements"},p=>showAnnouncement(p.new)).subscribe();
  const world = sb.channel("mare-world-ui")
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"mare_world",filter:"room=eq.main"},p=>{G.world=p.new;syncHud();}).subscribe();
  G.channels.push(presence,announcements,world);
}
function cleanupRealtime() { for (const c of G.channels) sb.removeChannel(c); G.channels=[]; }
function showAnnouncement(a) {
  ui.announcement.textContent = a.message;
  ui.announcement.classList.remove("hidden");
  ui.announcement.style.borderColor = a.rarity === "Secret" ? "#ff739d66" : "#ffd16655";
  clearTimeout(showAnnouncement.t); showAnnouncement.t=setTimeout(()=>ui.announcement.classList.add("hidden"),5500);
}

function resize() {
  const dpr=Math.min(devicePixelRatio||1,2);
  ui.canvas.width=Math.round(innerWidth*dpr); ui.canvas.height=Math.round(innerHeight*dpr);
  ui.canvas.style.width=innerWidth+"px"; ui.canvas.style.height=innerHeight+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
addEventListener("resize",resize); resize();

function screenPos(x,y) { return {x:innerWidth/2+(x-G.camera.x),y:innerHeight/2+(y-G.camera.y)}; }
function regionAt(x,y) {
  let best=null,bestD=Infinity;
  for (const r of G.regions) {
    const d=Math.hypot(x-r.x,y-r.y);
    if (d<r.radius && d<bestD) {best=r;bestD=d;}
  }
  return best;
}
function nearestRegion() {
  let best=G.regions[0],d=Infinity;
  for (const r of G.regions) {const v=Math.hypot(G.pos.x-r.x,G.pos.y-r.y);if(v<d){best=r;d=v;}}
  return [best,d];
}

function drawWorld(t) {
  ctx.clearRect(0,0,innerWidth,innerHeight);
  const grad=ctx.createLinearGradient(0,0,0,innerHeight);grad.addColorStop(0,"#0d3850");grad.addColorStop(1,"#071c2a");ctx.fillStyle=grad;ctx.fillRect(0,0,innerWidth,innerHeight);
  const spacing=72, ox=(-G.camera.x*.08)%spacing, oy=(-G.camera.y*.08)%spacing;
  ctx.strokeStyle="rgba(108,218,255,.055)";ctx.lineWidth=1;
  for(let x=ox-spacing;x<innerWidth+spacing;x+=spacing){ctx.beginPath();for(let y=0;y<innerHeight;y+=14){const xx=x+Math.sin((y+t*.04)*.025)*5;y===0?ctx.moveTo(xx,y):ctx.lineTo(xx,y);}ctx.stroke();}
  for(let y=oy-spacing;y<innerHeight+spacing;y+=spacing){ctx.beginPath();for(let x=0;x<innerWidth;x+=18){const yy=y+Math.sin((x-t*.03)*.022)*3;x===0?ctx.moveTo(x,yy):ctx.lineTo(x,yy);}ctx.stroke();}

  for (const r of G.regions) {
    if (r.id==="open_ocean") continue;
    const s=screenPos(r.x,r.y); if(s.x<-r.radius-200||s.x>innerWidth+r.radius+200||s.y<-r.radius-200||s.y>innerHeight+r.radius+200)continue;
    const locked=G.profile && G.profile.level<r.level_required;
    const rg=ctx.createRadialGradient(s.x-r.radius*.2,s.y-r.radius*.25,10,s.x,s.y,r.radius);
    const base=r.id==="ember_cay"?["#744332","#2e2520"]:r.id==="frostwake"?["#d8f5ff","#648aa1"]:r.id==="mirefen"?["#476d4a","#233d32"]:r.id==="coral_reach"?["#ce9a91","#556e66"]:r.id==="abyssal_rift"?["#4d4776","#15182b"]:["#69996a","#304c3d"];
    rg.addColorStop(0,base[0]);rg.addColorStop(.72,base[1]);rg.addColorStop(1,"#17313a");ctx.fillStyle=rg;
    ctx.beginPath();const pts=18;for(let i=0;i<=pts;i++){const a=i/pts*Math.PI*2;const wob=1+Math.sin(i*2.7+r.x)*.07;const x=s.x+Math.cos(a)*r.radius*.55*wob,y=s.y+Math.sin(a)*r.radius*.38*wob;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.fill();
    ctx.strokeStyle=locked?"rgba(255,100,120,.25)":"rgba(174,235,255,.16)";ctx.stroke();
    ctx.textAlign="center";ctx.fillStyle=locked?"#8d8290":"#ecfaff";ctx.font="700 12px system-ui";ctx.fillText((locked?"🔒 ":"") + r.name.toUpperCase(),s.x,s.y-r.radius*.46);
    ctx.fillStyle=locked?"#8b7d85":"#7fdfff";ctx.font="9px system-ui";ctx.fillText(locked?"NÍVEL "+r.level_required:(regionSymbols[r.id]||"◦")+"  "+r.biome,s.x,s.y-r.radius*.46+16);
  }

  for (const p of G.others.values()) {
    if(Date.now()-new Date(p.last_seen).getTime()>90000)continue;const s=screenPos(Number(p.x),Number(p.y));if(s.x<-30||s.x>innerWidth+30||s.y<-30||s.y>innerHeight+30)continue;
    ctx.beginPath();ctx.arc(s.x,s.y,10,0,Math.PI*2);ctx.fillStyle="#72efbd";ctx.fill();ctx.strokeStyle="#d9fff0";ctx.stroke();ctx.textAlign="center";ctx.font="700 10px system-ui";ctx.fillStyle="#fff";ctx.fillText(p.username,s.x,s.y-16);
  }

  const me=screenPos(G.pos.x,G.pos.y);ctx.save();ctx.translate(me.x,me.y);const angle=Math.atan2(G.vel.y,G.vel.x)||0;ctx.rotate(angle);
  if(G.profile?.active_boat){ctx.fillStyle="#e4c489";ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(-12,-9);ctx.lineTo(-8,0);ctx.lineTo(-12,9);ctx.closePath();ctx.fill();ctx.fillStyle="#4d89a5";ctx.fillRect(-6,-4,10,8);}else{ctx.fillStyle="#f1f7ff";ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.fill();ctx.fillStyle="#4ccfff";ctx.beginPath();ctx.arc(2,-2,4,0,Math.PI*2);ctx.fill();}ctx.restore();
  ctx.textAlign="center";ctx.font="700 10px system-ui";ctx.fillStyle="#fff";ctx.fillText(G.profile?.username||"",me.x,me.y-16);
}

function updateMovement(dt) {
  if (!G.profile || G.fishing.busy || !G.running) return;
  let dx=0,dy=0;
  if(G.keys.has("w")||G.keys.has("arrowup"))dy-=1;if(G.keys.has("s")||G.keys.has("arrowdown"))dy+=1;if(G.keys.has("a")||G.keys.has("arrowleft"))dx-=1;if(G.keys.has("d")||G.keys.has("arrowright"))dx+=1;
  dx+=G.joystick.x;dy+=G.joystick.y;
  const mag=Math.hypot(dx,dy); if(mag>1){dx/=mag;dy/=mag;}
  let speed=150;const boat=getBoat(G.profile.active_boat);if(boat)speed*=Number(boat.speed||1);else speed*=.9;
  G.vel.x += (dx*speed-G.vel.x)*Math.min(1,dt*8);G.vel.y += (dy*speed-G.vel.y)*Math.min(1,dt*8);
  if(mag<.05){G.vel.x*=Math.pow(.15,dt);G.vel.y*=Math.pow(.15,dt);}
  G.pos.x += G.vel.x*dt;G.pos.y += G.vel.y*dt;G.pos.x=clamp(G.pos.x,-800,4600);G.pos.y=clamp(G.pos.y,-1800,1700);
  G.camera.x += (G.pos.x-G.camera.x)*Math.min(1,dt*4.5);G.camera.y += (G.pos.y-G.camera.y)*Math.min(1,dt*4.5);
  const here=regionAt(G.pos.x,G.pos.y);G.currentRegion=here?.id || "open_ocean";
  const [near,d]=nearestRegion();ui.waypoint.innerHTML=escapeHtml(near?.name?.toUpperCase()||"OCEANO")+` <span>${Math.round(d)}m</span>`;
  ui.region.textContent=getRegion(G.currentRegion)?.name || "Open Ocean";
}
function loop(now) { if(!G.running)return;const dt=Math.min(.04,(now-G.last)/1000||.016);G.last=now;updateMovement(dt);drawWorld(now);requestAnimationFrame(loop); }

function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}
addEventListener("keydown", e => {
  if (isTypingTarget(e.target)) return;
  const k = e.key.toLowerCase();
  if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(k)) {
    G.keys.add(k);
    e.preventDefault();
  }
});
addEventListener("keyup", e => {
  if (isTypingTarget(e.target)) return;
  G.keys.delete(e.key.toLowerCase());
});

function setupJoystick() {
  const root=$("#joystick"), knob=$("#joystickKnob");
  const update=e=>{const r=root.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;let dx=e.clientX-cx,dy=e.clientY-cy;const m=Math.hypot(dx,dy),max=37;if(m>max){dx=dx/m*max;dy=dy/m*max;}G.joystick.x=dx/max;G.joystick.y=dy/max;knob.style.transform=`translate(${dx}px,${dy}px)`;};
  root.addEventListener("pointerdown",e=>{G.joystick.active=true;G.joystick.id=e.pointerId;root.setPointerCapture(e.pointerId);update(e);});
  root.addEventListener("pointermove",e=>{if(G.joystick.active&&e.pointerId===G.joystick.id)update(e);});
  const end=e=>{if(e.pointerId!==G.joystick.id)return;G.joystick.active=false;G.joystick.x=G.joystick.y=0;knob.style.transform="";};root.addEventListener("pointerup",end);root.addEventListener("pointercancel",end);
}
setupJoystick();
