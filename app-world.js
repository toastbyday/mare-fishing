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

const minimap=$("#minimap");
const mctx=minimap?.getContext("2d");
const vendorPrompt=$("#vendorPrompt");

function resize() {
  const dpr=Math.min(devicePixelRatio||1,2);
  ui.canvas.width=Math.round(innerWidth*dpr); ui.canvas.height=Math.round(innerHeight*dpr);
  ui.canvas.style.width=innerWidth+"px"; ui.canvas.style.height=innerHeight+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if(minimap && mctx){
    const w=Math.max(120,minimap.clientWidth||180),h=Math.max(88,minimap.clientHeight||132);
    minimap.width=Math.round(w*dpr); minimap.height=Math.round(h*dpr);
    mctx.setTransform(dpr,0,0,dpr,0,0);
  }
}
addEventListener("resize",resize); resize();

function screenPos(x,y) { return {x:innerWidth/2+(x-G.camera.x),y:innerHeight/2+(y-G.camera.y)}; }
function islandShape(r){
  return {rx:Number(r.radius)*.66, ry:Number(r.radius)*.46};
}
function pointOnIsland(r,x,y,margin=1){
  if(!r || r.id==="open_ocean") return false;
  const {rx,ry}=islandShape(r);
  const nx=(x-Number(r.x))/(rx*margin),ny=(y-Number(r.y))/(ry*margin);
  return nx*nx+ny*ny<=1;
}
function islandAt(x,y){
  let best=null,bestScore=Infinity;
  for(const r of G.regions){
    if(r.id==="open_ocean") continue;
    const {rx,ry}=islandShape(r);
    const score=((x-r.x)/rx)**2+((y-r.y)/ry)**2;
    if(score<=1 && score<bestScore){best=r;bestScore=score;}
  }
  return best;
}
function regionAt(x,y) {
  const land=islandAt(x,y);
  if(land) return land;
  const ocean=G.regions.find(r=>r.id==="open_ocean");
  return ocean || null;
}
function nearestRegion() {
  const islands=G.regions.filter(r=>r.id!=="open_ocean");
  let best=islands[0]||G.regions[0],d=Infinity;
  for (const r of islands) {const v=Math.hypot(G.pos.x-r.x,G.pos.y-r.y);if(v<d){best=r;d=v;}}
  return [best,d];
}

function drawWater(t){
  const night=G.world?.time_of_day==="Night";
  const storm=G.world?.weather==="Storm";
  const grad=ctx.createLinearGradient(0,0,0,innerHeight);
  grad.addColorStop(0,night?"#09283a":storm?"#123849":"#14516c");
  grad.addColorStop(.55,night?"#071d2c":"#0b334a");
  grad.addColorStop(1,"#061722");
  ctx.fillStyle=grad;ctx.fillRect(0,0,innerWidth,innerHeight);

  const spacing=58,ox=(-G.camera.x*.1)%spacing,oy=(-G.camera.y*.08)%spacing;
  ctx.lineWidth=1;
  for(let y=oy-spacing;y<innerHeight+spacing;y+=spacing){
    ctx.beginPath();
    for(let x=-40;x<innerWidth+40;x+=14){
      const yy=y+Math.sin((x+t*.05+y)*.018)*4+Math.sin((x-t*.025)*.034)*2;
      x===-40?ctx.moveTo(x,yy):ctx.lineTo(x,yy);
    }
    ctx.strokeStyle="rgba(118,225,255,.075)";ctx.stroke();
  }
  for(let i=0;i<26;i++){
    const x=((i*173+t*.018)% (innerWidth+180))-90;
    const y=((i*97+Math.sin(t*.0005+i)*120+innerHeight*2)%innerHeight);
    const a=.04+(i%5)*.012;
    ctx.strokeStyle=`rgba(198,246,255,${a})`;ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(x-8,y);ctx.lineTo(x+8,y);ctx.stroke();
  }
  for(let i=0;i<10;i++){
    const cx=((i*431-G.camera.x*.16)% (innerWidth+500))-180;
    const cy=((i*239-G.camera.y*.12)% (innerHeight+300))-100;
    ctx.strokeStyle="rgba(72,182,222,.055)";ctx.lineWidth=4;
    ctx.beginPath();ctx.arc(cx,cy,90+(i%3)*38,.2,2.3);ctx.stroke();
  }
}

function drawIslandBase(r,s,locked,t){
  const {rx,ry}=islandShape(r);
  const base=r.id==="ember_cay"?["#91513b","#35231d"]:
    r.id==="frostwake"?["#e7fbff","#64899a"]:
    r.id==="mirefen"?["#557e50","#263d30"]:
    r.id==="coral_reach"?["#e1a99b","#4c7567"]:
    r.id==="abyssal_rift"?["#514b7c","#15182c"]:["#78a96b","#334f3d"];

  ctx.save();
  ctx.globalAlpha=locked?.68:1;
  ctx.strokeStyle="rgba(185,239,255,.20)";ctx.lineWidth=10;
  ctx.beginPath();ctx.ellipse(s.x,s.y,rx+9,ry+8,0,0,Math.PI*2);ctx.stroke();
  ctx.strokeStyle="rgba(255,255,255,.14)";ctx.lineWidth=2;
  ctx.setLineDash([8,11]);
  ctx.beginPath();ctx.ellipse(s.x,s.y,rx+15,ry+13,0,0,Math.PI*2);ctx.stroke();
  ctx.setLineDash([]);

  const rg=ctx.createRadialGradient(s.x-rx*.25,s.y-ry*.3,18,s.x,s.y,Math.max(rx,ry));
  rg.addColorStop(0,base[0]);rg.addColorStop(.68,base[1]);rg.addColorStop(1,"#17313a");
  ctx.fillStyle=rg;ctx.beginPath();
  const pts=30;
  for(let i=0;i<=pts;i++){
    const a=i/pts*Math.PI*2,w=1+Math.sin(i*2.13+r.x*.01)*.045+Math.cos(i*1.41+r.y*.01)*.035;
    const x=s.x+Math.cos(a)*rx*w,y=s.y+Math.sin(a)*ry*w;
    i?ctx.lineTo(x,y):ctx.moveTo(x,y);
  }
  ctx.closePath();ctx.fill();
  ctx.strokeStyle=locked?"rgba(255,100,120,.32)":"rgba(201,244,255,.22)";ctx.lineWidth=2;ctx.stroke();
  ctx.restore();
  drawIslandDetails(r,s,rx,ry,t,locked);
}

function drawIslandDetails(r,s,rx,ry,t,locked){
  ctx.save();ctx.translate(s.x,s.y);ctx.globalAlpha=locked?.62:1;
  if(r.id==="harbor_haven"){
    ctx.fillStyle="#8b6b43";ctx.fillRect(rx*.45,-ry*.08,rx*.48,18);ctx.fillRect(rx*.6,-ry*.18,16,ry*.36);
    ctx.fillStyle="#d9c39b";ctx.fillRect(-rx*.32,-ry*.12,55,40);ctx.fillStyle="#8d5144";ctx.beginPath();ctx.moveTo(-rx*.36,-ry*.12);ctx.lineTo(-rx*.18,-ry*.3);ctx.lineTo(-rx*.02,-ry*.12);ctx.fill();
    ctx.fillStyle="#c9d3d6";ctx.fillRect(rx*.05,-ry*.32,20,70);ctx.fillStyle="#ffcf6b";ctx.beginPath();ctx.arc(rx*.05+10,-ry*.34,8,0,Math.PI*2);ctx.fill();
    for(let i=0;i<4;i++){ctx.fillStyle="#486d4b";ctx.beginPath();ctx.arc(-rx*.45+i*33,ry*.18+(i%2)*14,14,0,Math.PI*2);ctx.fill();}
  } else if(r.id==="ember_cay"){
    ctx.fillStyle="#3c2723";ctx.beginPath();ctx.moveTo(-rx*.32,ry*.22);ctx.lineTo(0,-ry*.5);ctx.lineTo(rx*.34,ry*.22);ctx.closePath();ctx.fill();
    ctx.fillStyle="#ff6a35";ctx.beginPath();ctx.ellipse(0,-ry*.33,rx*.1,ry*.06,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(255,95,45,.8)";ctx.lineWidth=5;
    for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*rx*.07,-ry*.27);ctx.bezierCurveTo(i*rx*.16,-ry*.05,i*rx*.1,ry*.1,i*rx*.22,ry*.34);ctx.stroke();}
    for(let i=0;i<7;i++){ctx.fillStyle="rgba(255,110,55,.25)";ctx.beginPath();ctx.arc(Math.sin(i*4.2)*rx*.55,Math.cos(i*2.3)*ry*.42,6+i%3,0,Math.PI*2);ctx.fill();}
  } else if(r.id==="frostwake"){
    for(let i=0;i<8;i++){const x=(i-3.5)*rx*.14,y=((i%3)-1)*ry*.18;ctx.fillStyle=i%2?"#c6f4ff":"#e9fdff";ctx.beginPath();ctx.moveTo(x-12,y+22);ctx.lineTo(x,y-32-(i%3)*12);ctx.lineTo(x+13,y+22);ctx.closePath();ctx.fill();}
    ctx.fillStyle="rgba(210,248,255,.42)";for(let i=0;i<18;i++){ctx.beginPath();ctx.arc(Math.sin(i*7.1)*rx*.7,Math.cos(i*3.7)*ry*.65,2.2,0,Math.PI*2);ctx.fill();}
  } else if(r.id==="mirefen"){
    for(let i=0;i<9;i++){const x=Math.sin(i*3.9)*rx*.62,y=Math.cos(i*2.1)*ry*.5;ctx.fillStyle="#263c2c";ctx.fillRect(x-3,y,6,24);ctx.fillStyle="#527a43";ctx.beginPath();ctx.arc(x,y-4,16+(i%3)*4,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle="rgba(49,95,74,.85)";for(let i=0;i<5;i++){ctx.beginPath();ctx.ellipse((i-2)*rx*.2,ry*.2+Math.sin(i)*18,rx*.11,ry*.07,.2,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle="#7ebf71";for(let i=0;i<12;i++){ctx.beginPath();ctx.arc(Math.sin(i*4.4)*rx*.5,ry*.18+Math.cos(i*2.9)*ry*.12,4,0,Math.PI*2);ctx.fill();}
  } else if(r.id==="coral_reach"){
    for(let i=0;i<10;i++){const x=Math.sin(i*2.6)*rx*.68,y=Math.cos(i*4.1)*ry*.5;ctx.strokeStyle=i%3===0?"#ff80be":i%3===1?"#ffb16f":"#7ee8dc";ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x,y+14);ctx.lineTo(x,y-14);ctx.lineTo(x+9,y-22);ctx.moveTo(x,y-5);ctx.lineTo(x-9,y-14);ctx.stroke();}
    for(let i=0;i<4;i++){const x=-rx*.4+i*rx*.25;ctx.strokeStyle="#7b5a38";ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x,ry*.18);ctx.quadraticCurveTo(x+8,0,x+5,-ry*.18);ctx.stroke();ctx.fillStyle="#5aa756";for(let a=0;a<5;a++){ctx.beginPath();ctx.ellipse(x+5+Math.cos(a*1.25)*15,-ry*.18+Math.sin(a*1.25)*8,13,5,a,0,Math.PI*2);ctx.fill();}}
  } else if(r.id==="abyssal_rift"){
    const glow=.35+.15*Math.sin(t*.002);
    ctx.fillStyle=`rgba(24,14,45,${.8})`;ctx.beginPath();ctx.ellipse(0,0,rx*.42,ry*.32,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=`rgba(139,111,255,${glow})`;ctx.lineWidth=7;ctx.beginPath();ctx.ellipse(0,0,rx*.36,ry*.27,0,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<7;i++){const a=i/7*Math.PI*2,x=Math.cos(a)*rx*.58,y=Math.sin(a)*ry*.55;ctx.fillStyle="#2a2751";ctx.fillRect(x-6,y-28,12,55);ctx.fillStyle="#9187ff";ctx.fillRect(x-2,y-22,4,19);}
  }
  ctx.restore();

  ctx.textAlign="center";ctx.fillStyle=locked?"#998c99":"#ecfaff";ctx.font="800 13px system-ui";
  ctx.fillText((locked?"🔒 ":"") + r.name.toUpperCase(),s.x,s.y-ry-24);
  ctx.fillStyle=locked?"#8b7d85":r.accent||"#7fdfff";ctx.font="700 9px system-ui";
  ctx.fillText(locked?"NÍVEL "+r.level_required:(regionSymbols[r.id]||"◦")+"  "+r.biome,s.x,s.y-ry-9);
}

function boatVendorPos(){
  const h=getRegion("harbor_haven");
  if(!h) return null;
  return {x:Number(h.x)+Number(h.radius)*.55,y:Number(h.y)+Number(h.radius)*.04};
}
function drawBoatVendor(){
  const p=boatVendorPos();if(!p)return;
  const s=screenPos(p.x,p.y);
  if(s.x<-100||s.x>innerWidth+100||s.y<-100||s.y>innerHeight+100)return;
  ctx.save();ctx.translate(s.x,s.y);
  ctx.fillStyle="rgba(0,0,0,.24)";ctx.beginPath();ctx.ellipse(0,14,18,7,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#263a49";ctx.fillRect(-9,-7,18,24);
  ctx.fillStyle="#e7b58f";ctx.beginPath();ctx.arc(0,-14,9,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#f4c45d";ctx.fillRect(-11,-23,22,5);
  ctx.fillStyle="#2c7ea4";ctx.fillRect(-6,-3,12,12);
  ctx.restore();
  ctx.textAlign="center";ctx.font="800 9px system-ui";ctx.fillStyle="#ffd979";ctx.fillText("⚓ CAPITÃO NILO",s.x,s.y-36);
  ctx.font="8px system-ui";ctx.fillStyle="#d5edf7";ctx.fillText("Vendedor de barcos",s.x,s.y-25);
}
function nearBoatVendor(){
  const p=boatVendorPos();if(!p)return false;
  return Math.hypot(G.pos.x-p.x,G.pos.y-p.y)<76;
}
function openBoatShop(){
  if(!G.profile || G.fishing.busy)return;
  G.panel="shop";ui.sidePanel.classList.remove("hidden");renderShop("boats");
}
vendorPrompt?.addEventListener("click",openBoatShop);

function drawRemotePlayer(p){
  if(Date.now()-new Date(p.last_seen).getTime()>90000)return;
  const s=screenPos(Number(p.x),Number(p.y));
  if(s.x<-40||s.x>innerWidth+40||s.y<-40||s.y>innerHeight+40)return;
  ctx.save();ctx.translate(s.x,s.y);
  ctx.fillStyle="rgba(0,0,0,.22)";ctx.beginPath();ctx.ellipse(0,9,10,4,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#70e6bd";ctx.beginPath();ctx.arc(0,-5,6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#3388aa";ctx.fillRect(-5,1,10,13);ctx.restore();
  ctx.textAlign="center";ctx.font="700 10px system-ui";ctx.fillStyle="#fff";ctx.fillText(p.username,s.x,s.y-17);
}

function drawLocalPlayer(t){
  const me=screenPos(G.pos.x,G.pos.y),boat=getBoat(G.profile?.active_boat),land=islandAt(G.pos.x,G.pos.y);
  const angle=Math.hypot(G.vel.x,G.vel.y)>.5?Math.atan2(G.vel.y,G.vel.x):0;
  ctx.save();ctx.translate(me.x,me.y);ctx.rotate(angle);
  if(boat){
    if(Math.hypot(G.vel.x,G.vel.y)>8){
      ctx.strokeStyle="rgba(204,246,255,.35)";ctx.lineWidth=2;
      for(const off of [-6,6]){ctx.beginPath();ctx.moveTo(-12,off);ctx.quadraticCurveTo(-30,off*1.6,-48,off*2.1);ctx.stroke();}
    }
    ctx.fillStyle="rgba(0,0,0,.22)";ctx.beginPath();ctx.ellipse(-1,8,25,9,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#c5985b";ctx.beginPath();ctx.moveTo(23,0);ctx.lineTo(-17,-12);ctx.lineTo(-11,0);ctx.lineTo(-17,12);ctx.closePath();ctx.fill();
    ctx.strokeStyle="#f3dfad";ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle="#405f73";ctx.fillRect(-8,-5,16,10);
    ctx.fillStyle="#eee0bb";ctx.fillRect(2,-20,2,21);
    ctx.fillStyle="#d7eff6";ctx.beginPath();ctx.moveTo(4,-19);ctx.lineTo(4,-3);ctx.lineTo(16,-4);ctx.closePath();ctx.fill();
    ctx.fillStyle="#e8b48e";ctx.beginPath();ctx.arc(-2,-7,5,0,Math.PI*2);ctx.fill();
  }else if(!land){
    const swim=Math.sin(t*.012)*4;
    ctx.strokeStyle="rgba(215,250,255,.38)";ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(-10,0,12,-.6,.6);ctx.stroke();ctx.beginPath();ctx.arc(-20,0,18,-.5,.5);ctx.stroke();
    ctx.fillStyle="#e7b38d";ctx.beginPath();ctx.arc(3,-2,6,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#75d6ef";ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-2,3);ctx.lineTo(-12,3);ctx.stroke();
    ctx.strokeStyle="#e7b38d";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-3,2);ctx.lineTo(-10,-8+swim);ctx.moveTo(-3,4);ctx.lineTo(-10,12-swim);ctx.stroke();
  }else{
    ctx.fillStyle="rgba(0,0,0,.23)";ctx.beginPath();ctx.ellipse(0,10,10,5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#254e68";ctx.fillRect(-6,-2,12,16);
    ctx.fillStyle="#4ecdf4";ctx.fillRect(-5,1,10,7);
    ctx.strokeStyle="#d7edf5";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(4,0);ctx.lineTo(13,-15);ctx.stroke();
    ctx.fillStyle="#e7b38d";ctx.beginPath();ctx.arc(0,-8,7,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#173344";ctx.beginPath();ctx.arc(0,-11,7,Math.PI,0);ctx.fill();
    ctx.strokeStyle="#263a46";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-3,14);ctx.lineTo(-5,22);ctx.moveTo(3,14);ctx.lineTo(6,22);ctx.stroke();
  }
  ctx.restore();
  ctx.textAlign="center";ctx.font="800 10px system-ui";ctx.fillStyle="#fff";ctx.fillText(G.profile?.username||"",me.x,me.y-(boat?30:28));
  if(!boat&&!land){ctx.font="700 8px system-ui";ctx.fillStyle="#8fe9ff";ctx.fillText("NADANDO · LENTO",me.x,me.y+29);}
}

function drawMinimap(){
  if(!mctx||!minimap)return;
  const w=minimap.clientWidth||180,h=minimap.clientHeight||132;
  mctx.clearRect(0,0,w,h);
  const bounds={minX:-650,maxX:4700,minY:-1700,maxY:1700};
  const tx=x=>8+(x-bounds.minX)/(bounds.maxX-bounds.minX)*(w-16);
  const ty=y=>8+(y-bounds.minY)/(bounds.maxY-bounds.minY)*(h-16);
  const sx=(w-16)/(bounds.maxX-bounds.minX),sy=(h-16)/(bounds.maxY-bounds.minY);
  const bg=mctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,"#0b4059");bg.addColorStop(1,"#071d2b");mctx.fillStyle=bg;mctx.fillRect(0,0,w,h);
  for(const r of G.regions){
    if(r.id==="open_ocean")continue;
    const {rx,ry}=islandShape(r);
    mctx.fillStyle=(r.accent||"#78b7a5")+"aa";mctx.beginPath();mctx.ellipse(tx(r.x),ty(r.y),Math.max(3,rx*sx),Math.max(2.5,ry*sy),0,0,Math.PI*2);mctx.fill();
    if(G.targetRegion===r.id){mctx.strokeStyle="#ffffff";mctx.lineWidth=1;mctx.stroke();}
  }
  for(const p of G.others.values()){
    if(Date.now()-new Date(p.last_seen).getTime()>90000)continue;
    mctx.fillStyle="#78efbd";mctx.beginPath();mctx.arc(tx(Number(p.x)),ty(Number(p.y)),2,0,Math.PI*2);mctx.fill();
  }
  mctx.fillStyle="#fff";mctx.strokeStyle="#48d5ff";mctx.lineWidth=2;mctx.beginPath();mctx.arc(tx(G.pos.x),ty(G.pos.y),3.5,0,Math.PI*2);mctx.fill();mctx.stroke();
}

function drawWorld(t) {
  ctx.clearRect(0,0,innerWidth,innerHeight);
  drawWater(t);
  for (const r of G.regions) {
    if (r.id==="open_ocean") continue;
    const {rx,ry}=islandShape(r),s=screenPos(r.x,r.y);
    if(s.x<-rx-180||s.x>innerWidth+rx+180||s.y<-ry-180||s.y>innerHeight+ry+180)continue;
    const locked=G.profile && G.profile.level<r.level_required;
    drawIslandBase(r,s,locked,t);
  }
  drawBoatVendor();
  for (const p of G.others.values()) drawRemotePlayer(p);
  drawLocalPlayer(t);
  drawMinimap();
}

function updateMovement(dt) {
  if (!G.profile || G.fishing.busy || !G.running) return;
  let dx=0,dy=0;
  if(G.keys.has("w")||G.keys.has("arrowup"))dy-=1;if(G.keys.has("s")||G.keys.has("arrowdown"))dy+=1;if(G.keys.has("a")||G.keys.has("arrowleft"))dx-=1;if(G.keys.has("d")||G.keys.has("arrowright"))dx+=1;
  dx+=G.joystick.x;dy+=G.joystick.y;
  const mag=Math.hypot(dx,dy); if(mag>1){dx/=mag;dy/=mag;}
  const land=islandAt(G.pos.x,G.pos.y),boat=getBoat(G.profile.active_boat);
  let speed;
  if(boat) speed=158*Number(boat.speed||1);
  else speed=land?132:46;
  G.vel.x += (dx*speed-G.vel.x)*Math.min(1,dt*(land||boat?8:5));
  G.vel.y += (dy*speed-G.vel.y)*Math.min(1,dt*(land||boat?8:5));
  if(mag<.05){G.vel.x*=Math.pow(land||boat?.18:.3,dt);G.vel.y*=Math.pow(land||boat?.18:.3,dt);}
  G.pos.x += G.vel.x*dt;G.pos.y += G.vel.y*dt;G.pos.x=clamp(G.pos.x,-800,4700);G.pos.y=clamp(G.pos.y,-1800,1800);
  G.camera.x += (G.pos.x-G.camera.x)*Math.min(1,dt*4.5);G.camera.y += (G.pos.y-G.camera.y)*Math.min(1,dt*4.5);
  const here=regionAt(G.pos.x,G.pos.y);G.currentRegion=here?.id || "open_ocean";
  const [near,d]=nearestRegion();ui.waypoint.innerHTML=escapeHtml(near?.name?.toUpperCase()||"OCEANO")+` <span>${Math.round(d)}m</span>`;
  ui.region.textContent=getRegion(G.currentRegion)?.name || "Open Ocean";
  if(vendorPrompt) vendorPrompt.classList.toggle("hidden",!nearBoatVendor());
}
function loop(now) { if(!G.running)return;const dt=Math.min(.04,(now-G.last)/1000||.016);G.last=now;updateMovement(dt);drawWorld(now);requestAnimationFrame(loop); }

function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}
addEventListener("keydown", e => {
  if (isTypingTarget(e.target)) return;
  const k = e.key.toLowerCase();
  if(k==="e" && nearBoatVendor()){e.preventDefault();openBoatShop();return;}
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
