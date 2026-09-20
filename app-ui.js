function panelButton(panel){return `<button data-panel-tab="${panel}">${panel}</button>`;}
function openPanel(type) { if(G.fishing.busy)return;G.panel=type;ui.sidePanel.classList.remove("hidden");renderPanel(type); }
function closePanel(){G.panel=null;ui.sidePanel.classList.add("hidden");}
$("#closePanel").onclick=closePanel;$("#menuBtn").onclick=()=>openPanel("profile");$$$('[data-panel]').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel));

function setTabs(tabs,active,fn){ui.panelTabs.innerHTML=tabs.map(t=>`<button class="${t.id===active?"active":""}" data-tab="${t.id}">${t.label}</button>`).join("");ui.panelTabs.querySelectorAll("button").forEach(b=>b.onclick=()=>fn(b.dataset.tab));}

function renderPanel(type, sub) {
  if(!G.profile)return;
  if(type==="inventory") return renderInventory(sub||"fish");
  if(type==="bestiary") return renderBestiary(sub||"all");
  if(type==="shop") return renderShop(sub||"rods");
  if(type==="quests") return renderQuests();
  if(type==="map") return renderMap();
  if(type==="profile") return renderProfile();
}

function renderInventory(tab="fish") {
  G.panel="inventory";ui.panelTitle.textContent="Inventário";setTabs([{id:"fish",label:"Peixes"},{id:"rods",label:"Varas"},{id:"baits",label:"Iscas"},{id:"boats",label:"Barcos"}],tab,t=>renderInventory(t));
  if(tab==="fish"){
    const inv=G.profile.fish_inventory||[];const sellable=inv.filter(x=>!x.favorite);const total=sellable.reduce((s,x)=>s+Number(x.value||0),0);
    ui.panelBody.innerHTML=`<div class="section-line"><div><h3>${inv.length}/120 capturas</h3><small>${sellable.length} podem ser vendidas</small></div><button id="sellAll" class="mini-btn gold" ${sellable.length?"":"disabled"}>Vender tudo · C$ ${fmt.format(total)}</button></div><div class="grid-list">${inv.map(x=>`<div class="card"><div class="card-top"><div><h4>${escapeHtml(x.name)}</h4><span class="rarity ${rarityClass(x.rarity)}">${x.rarity}</span></div><b class="inventory-value">C$ ${fmt.format(x.value)}</b></div><div class="tag-row">${(x.attributes||[]).map(a=>`<span class="tag">${escapeHtml(a)}</span>`).join("")}${x.mutation?`<span class="tag">${escapeHtml(x.mutation)}</span>`:""}<span class="tag">${Number(x.weight).toFixed(2)} kg</span></div><div class="card-actions"><button class="mini-btn fav" data-id="${x.id}">${x.favorite?"★ Favorito":"☆ Favoritar"}</button></div></div>`).join("")||`<div class="empty">Seu inventário está vazio. Vá pescar.</div>`}</div>`;
    $("#sellAll")?.addEventListener("click",sellAll);ui.panelBody.querySelectorAll(".fav").forEach(b=>b.onclick=()=>toggleFavorite(b.dataset.id));
  } else if(tab==="rods"){
    ui.panelBody.innerHTML=`<div class="grid-list">${G.rods.filter(r=>owned(G.profile.rods,r.id)).map(r=>equipCard("rod",r,G.profile.active_rod===r.id,`Luck ${r.luck} · Control ${r.control} · Max ${fmt.format(r.max_kg)}kg`)).join("")}</div>`;bindEquip();
  } else if(tab==="baits"){
    ui.panelBody.innerHTML=`<div class="grid-list">${G.baits.filter(b=>Number((G.profile.baits||{})[b.id]||0)>0).map(b=>equipCard("bait",b,G.profile.active_bait===b.id,`${(G.profile.baits||{})[b.id]}x · Luck +${b.universal_luck}`)).join("")||`<div class="empty">Sem iscas. Compre na loja.</div>`}</div>`;bindEquip();
  } else {
    ui.panelBody.innerHTML=`<div class="grid-list">${G.boats.filter(b=>owned(G.profile.boats,b.id)).map(b=>equipCard("boat",b,G.profile.active_boat===b.id,`Speed ${b.speed} · ${b.seats} assentos`)).join("")||`<div class="empty">Você ainda não possui barcos.</div>`}</div>`;bindEquip();
  }
}
function equipCard(type,item,active,desc){return `<div class="card"><div class="card-top"><h4>${escapeHtml(item.name)}</h4>${active?`<span class="tag">EQUIPADO</span>`:""}</div><p>${escapeHtml(item.description||desc)}</p><div class="tag-row"><span class="tag">${escapeHtml(desc)}</span></div><div class="card-actions"><button class="mini-btn accent equip" data-type="${type}" data-id="${item.id}" ${active?"disabled":""}>${active?"Em uso":"Equipar"}</button>${type==="bait"&&active?`<button class="mini-btn equip" data-type="bait" data-id="">Remover</button>`:""}</div></div>`;}
function bindEquip(){ui.panelBody.querySelectorAll(".equip").forEach(b=>b.onclick=()=>equip(b.dataset.type,b.dataset.id||null));}

function renderBestiary(filter="all") {
  G.panel="bestiary";ui.panelTitle.textContent="Bestiário";
  const filters=[{id:"all",label:"Todos"},...G.regions.filter(r=>r.id!=="open_ocean").map(r=>({id:r.id,label:r.name}))];setTabs(filters,filter,t=>renderBestiary(t));
  const known=G.profile.bestiary||{};const pool=G.fish.filter(f=>filter==="all"||f.regions.includes(filter));const caught=pool.filter(f=>known[f.id]).length;
  ui.panelBody.innerHTML=`<div class="section-line"><div><h3>${caught}/${pool.length} espécies descobertas</h3><small>${Math.round((caught/Math.max(1,pool.length))*100)}% completo</small></div></div><div class="progress-line"><div style="width:${caught/Math.max(1,pool.length)*100}%"></div></div><br><div class="grid-list">${pool.map(f=>{const k=known[f.id];return `<div class="card ${k?"":"locked-card"}"><div class="bestiary-icon ${k?"":"unknown"}">◁</div><div class="card-top"><h4>${k?escapeHtml(f.name):"???"}</h4><span class="rarity ${rarityClass(f.rarity)}">${k?f.rarity:"?"}</span></div><p>${k?`Melhor peso: ${Number(k.best_weight).toFixed(2)}kg · ${k.count} captura(s)`:`Descubra esta espécie pescando nas condições corretas.`}</p>${k?`<div class="tag-row"><span class="tag">${f.preferred_bait?"Isca: "+escapeHtml(getBait(f.preferred_bait)?.name||f.preferred_bait):"Sem preferência"}</span><span class="tag">${(f.weathers||[]).join("/")||"Qualquer clima"}</span><span class="tag">${(f.times||[]).join("/")||"Qualquer hora"}</span></div>`:""}</div>`}).join("")}</div>`;
}
