function startCharge(e){if(G.fishing.busy||!G.profile)return;e.preventDefault();G.fishing.busy=true;G.fishing.charging=true;G.fishing.charge=0;G.fishing.chargeDir=1;ui.fishingOverlay.classList.remove("hidden");ui.castStage.classList.remove("hidden");ui.waitStage.classList.add("hidden");ui.reelStage.classList.add("hidden");ui.fishBtn.classList.add("charging");ui.fishHint.textContent="solte para lançar";chargeLoop();}
function chargeLoop(){if(!G.fishing.charging)return;G.fishing.charge+=G.fishing.chargeDir*1.7;if(G.fishing.charge>=100){G.fishing.charge=100;G.fishing.chargeDir=-1}else if(G.fishing.charge<=0){G.fishing.charge=0;G.fishing.chargeDir=1}ui.castFill.style.width=G.fishing.charge+"%";requestAnimationFrame(chargeLoop);}
async function releaseCharge(e){if(!G.fishing.charging)return;e.preventDefault();G.fishing.charging=false;ui.fishBtn.classList.remove("charging");ui.fishHint.textContent="preparando...";const power=G.fishing.charge;try{await cast(power);}catch(err){endFishing();toast(err.message,"error");}}
ui.fishBtn.addEventListener("pointerdown",startCharge);addEventListener("pointerup",releaseCharge);

async function cast(power){
  const region=G.currentRegion||"open_ocean";const r=getRegion(region);if(r&&G.profile.level<r.level_required)throw new Error("Essa região exige nível "+r.level_required+".");
  const data=await game("start_fishing",{region_id:region,cast_power:power});G.profile=data.profile;G.world=data.world;G.fishing.challenge=data.challenge;syncHud();ui.castStage.classList.add("hidden");ui.waitStage.classList.remove("hidden");ui.fishHint.textContent="linha lançada";
  let remaining=Math.max(600,Number(data.challenge.lure_delay_ms)*(1-(power/100)*.16));G.fishing.shakeBoost=0;
  while(G.fishing.busy&&remaining>0){await sleep(220);remaining-=220+G.fishing.shakeBoost;G.fishing.shakeBoost=0;if(Math.random()<.42)spawnShake();ui.waitingText.textContent=remaining<700?"Alguma coisa mordeu!":"Esperando uma mordida...";}
  if(!G.fishing.busy)return;ui.shakeLayer.innerHTML="";await sleep(220);startReel(data.challenge);
}
function spawnShake(){if(ui.shakeLayer.children.length>=3)return;const b=document.createElement("button");b.className="shake";b.style.left=10+Math.random()*78+"%";b.style.top=5+Math.random()*75+"%";b.onclick=()=>{G.fishing.shakeBoost+=520;b.remove();};ui.shakeLayer.appendChild(b);setTimeout(()=>b.remove(),1400);}

function startReel(challenge){ui.waitStage.classList.add("hidden");ui.reelStage.classList.remove("hidden");let fish=.5,dir=Math.random()<.5?-1:1,control=.5,prog=.36,last=performance.now(),started=performance.now(),pointer=false;const diff=Number(challenge.difficulty||.3);const zone=clamp(.29-diff*.13,.12,.29);ui.controlZone.style.width=(zone*100)+"%";
  const movePointer=e=>{if(!pointer)return;const r=ui.reelBar.getBoundingClientRect();control=clamp((e.clientX-r.left)/r.width,zone/2,1-zone/2);};
  const down=e=>{pointer=true;ui.reelBar.setPointerCapture(e.pointerId);movePointer(e)},up=()=>pointer=false;ui.reelBar.onpointerdown=down;ui.reelBar.onpointermove=movePointer;ui.reelBar.onpointerup=up;ui.reelBar.onpointercancel=up;
  const frame=async now=>{if(!G.fishing.busy)return;const dt=Math.min(.035,(now-last)/1000);last=now;const keyboard=(G.keys.has("a")||G.keys.has("arrowleft")?-1:0)+(G.keys.has("d")||G.keys.has("arrowright")?1:0);control=clamp(control+keyboard*dt*.65,zone/2,1-zone/2);
    const jitter=(Math.sin(now*.004*(1+diff*2.7))+Math.sin(now*.0073))*diff*.015;fish+=dir*dt*(.15+diff*.28)+jitter;if(fish<.03){fish=.03;dir=1}else if(fish>.97){fish=.97;dir=-1}if(Math.random()<dt*(.8+diff*2.8))dir*=-1;
    const inside=Math.abs(fish-control)<zone/2;prog+=dt*(inside?(0.10+(.9-diff)*.055):-(.055+diff*.09));if(now-started<1200)prog=Math.max(prog,.15);prog=clamp(prog,0,1);ui.controlZone.style.left=((control-zone/2)*100)+"%";ui.fishMarker.style.left=(fish*100)+"%";ui.reelProgress.style.width=(prog*100)+"%";
    if(prog>=1){await finishFishing(true);return;}if(prog<=0&&now-started>1800){await finishFishing(false);return;}G.fishing.reelRAF=requestAnimationFrame(frame);};G.fishing.reelRAF=requestAnimationFrame(frame);
}
async function finishFishing(success){if(!G.fishing.busy)return;const id=G.fishing.challenge?.id;try{const data=await game("finish_fishing",{catch_id:id,success});if(data.profile)G.profile=data.profile;syncHud();endFishing();if(success&&data.catch)showCatch(data.catch);else toast("O peixe escapou.","error");}catch(e){endFishing();toast(e.message,"error");}}
function endFishing(){G.fishing.busy=false;G.fishing.charging=false;G.fishing.challenge=null;if(G.fishing.reelRAF)cancelAnimationFrame(G.fishing.reelRAF);ui.fishingOverlay.classList.add("hidden");ui.castStage.classList.add("hidden");ui.waitStage.classList.add("hidden");ui.reelStage.classList.add("hidden");ui.shakeLayer.innerHTML="";ui.fishBtn.classList.remove("charging");ui.fishHint.textContent="segure e solte";}
function showCatch(c){ui.catchRarity.textContent=c.rarity.toUpperCase();ui.catchRarity.className=rarityClass(c.rarity);ui.catchName.textContent=c.name;ui.catchTraits.innerHTML=[...(c.attributes||[]),c.mutation].filter(Boolean).map(x=>`<span class="tag">${escapeHtml(x)}</span>`).join("")||`<span class="tag">Captura normal</span>`;ui.catchWeight.textContent=Number(c.weight).toFixed(2)+" kg";ui.catchValue.textContent="C$ "+fmt.format(c.value);ui.catchXp.textContent="+"+fmt.format(c.xp);ui.catchModal.classList.remove("hidden");}
$("#catchClose").onclick=()=>ui.catchModal.classList.add("hidden");

const ACCOUNT_PREFIX="mare-account-v1:";
function normalizeUsername(value){
  return String(value||"").trim().toLocaleLowerCase("pt-BR");
}
function accountStorageKey(username){
  return ACCOUNT_PREFIX+encodeURIComponent(normalizeUsername(username));
}
function rememberAccount(username,session){
  if(!username||!session?.access_token||!session?.refresh_token)return;
  localStorage.setItem(accountStorageKey(username),JSON.stringify({
    username:String(username),
    access_token:session.access_token,
    refresh_token:session.refresh_token,
    saved_at:Date.now()
  }));
}
function loadRememberedAccount(username){
  try{
    const raw=localStorage.getItem(accountStorageKey(username));
    if(!raw)return null;
    const data=JSON.parse(raw);
    if(!data?.access_token||!data?.refresh_token)return null;
    return data;
  }catch{return null;}
}
function moveRememberedAccount(oldName,newName,session){
  const oldKey=oldName?accountStorageKey(oldName):null;
  if(oldKey)localStorage.removeItem(oldKey);
  rememberAccount(newName,session);
}
function usernameError(value){
  const name=String(value||"").trim();
  if(name.length<3)return "O nome precisa ter pelo menos 3 caracteres.";
  if(name.length>24)return "O nome pode ter no máximo 24 caracteres.";
  return "";
}
function authErrorMessage(error){
  const raw=String(error?.message||"");
  const msg=raw.toLowerCase();
  if(msg.includes("anonymous sign-ins are disabled")||msg.includes("anonymous provider is disabled")) return "O modo de conta sem e-mail ainda não está ativado no Supabase.";
  if(msg.includes("invalid refresh token")||msg.includes("refresh token not found")) return "Essa conta não está mais disponível neste navegador.";
  return raw || "Não foi possível entrar.";
}
function showAccountChooser(message=""){
  G.choosingAccount=true;
  G.running=false;
  clearInterval(G.presenceTimer);clearInterval(G.worldTimer);cleanupRealtime();
  if(G.session?.user?.id) sb.from("mare_presence").delete().eq("user_id",G.session.user.id).then(()=>{},()=>{});
  ui.app.classList.add("hidden");
  ui.loading.classList.add("hidden");
  ui.auth.classList.remove("hidden");
  closePanel();
  authMsg(message,false);
}
$$('[data-auth-tab]').forEach(btn=>btn.onclick=()=>{
  $$('[data-auth-tab]').forEach(b=>b.classList.toggle("active",b===btn));
  $("#loginForm").classList.toggle("hidden",btn.dataset.authTab!=="login");
  $("#signupForm").classList.toggle("hidden",btn.dataset.authTab!=="signup");
  authMsg("");
});
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const username=$("#loginUsername").value.trim();
  const bad=usernameError(username);if(bad)return authMsg(bad);
  const saved=loadRememberedAccount(username);
  if(!saved)return authMsg("Essa conta não está salva neste navegador. Se for nova, use “Criar conta”.");
  authMsg("Entrando...");
  G.authManual=true;
  try{
    const {data,error}=await sb.auth.setSession({access_token:saved.access_token,refresh_token:saved.refresh_token});
    if(error)throw error;
    if(!data?.session)throw new Error("Sessão inválida.");
    G.choosingAccount=false;
    await boot(data.session);
    if(normalizeUsername(G.profile?.username)!==normalizeUsername(username)){
      throw new Error("O nome salvo não corresponde a esta conta.");
    }
    rememberAccount(G.profile.username,data.session);
  }catch(error){
    authMsg(authErrorMessage(error));
  }finally{G.authManual=false;}
});
$("#signupForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const username=$("#signupName").value.trim();
  const bad=usernameError(username);if(bad)return authMsg(bad);
  if(loadRememberedAccount(username))return authMsg("Essa conta já está salva neste navegador. Use “Entrar”.");
  authMsg("Criando conta...");
  G.authManual=true;
  try{
    const {data,error}=await sb.auth.signInAnonymously();
    if(error)throw error;
    if(!data?.session)throw new Error("Não foi possível criar a sessão.");
    const named=await game("set_name",{username});
    G.profile=named.profile;
    rememberAccount(username,data.session);
    G.choosingAccount=false;
    await boot(data.session);
  }catch(error){
    authMsg(authErrorMessage(error));
  }finally{G.authManual=false;}
});

function showGameScreen(){
  ui.auth.classList.add("hidden");
  ui.loading.classList.add("hidden");
  ui.app.classList.remove("hidden");
}
async function boot(session) {
  if (!session?.user) throw new Error("Sessão inválida.");
  if (G.running && G.session?.user?.id === session.user.id) { showGameScreen(); return; }
  if (G.booting) return;
  G.booting=true;G.session=session;ui.loading.classList.remove("hidden");ui.auth.classList.add("hidden");
  try {
    await fetchCatalogs();await refreshState();rememberAccount(G.profile.username,session);restorePosition();await loadPresence();subscribeRealtime();await upsertPresence();
    clearInterval(G.presenceTimer);G.presenceTimer=setInterval(()=>{upsertPresence();savePosition();loadPresence();},15000);
    clearInterval(G.worldTimer);G.worldTimer=setInterval(()=>refreshState().catch(()=>{}),120000);
    G.running=true;G.last=performance.now();showGameScreen();requestAnimationFrame(loop);syncHud();authMsg("");
  } catch(e) {console.error(e);toast("Falha ao carregar: "+e.message,"error");ui.auth.classList.remove("hidden");}
  finally {G.booting=false;ui.loading.classList.add("hidden");}
}
async function shutdown(){G.running=false;G.booting=false;clearInterval(G.presenceTimer);clearInterval(G.worldTimer);cleanupRealtime();if(G.session){try{await sb.from("mare_presence").delete().eq("user_id",G.session.user.id);}catch{}}G.session=null;G.profile=null;G.others.clear();ui.app.classList.add("hidden");ui.auth.classList.remove("hidden");closePanel();}

sb.auth.onAuthStateChange((event,session)=>{
  setTimeout(()=>{
    if(G.authManual)return;
    if((event==="SIGNED_IN" || event==="INITIAL_SESSION") && session && !G.choosingAccount) {
      boot(session).catch(err=>{console.error(err);authMsg("Falha ao carregar o jogo: "+err.message);});
    } else if(event==="SIGNED_OUT") {
      shutdown().catch(console.error);
    } else if(event==="TOKEN_REFRESHED" && session) {
      if(G.profile?.username)rememberAccount(G.profile.username,session);
      if(!G.running && !G.booting && !G.choosingAccount)boot(session).catch(console.error);
    }
  },0);
});
(async()=>{const {data:{session}}=await sb.auth.getSession();if(session)await boot(session);else{G.choosingAccount=true;ui.auth.classList.remove("hidden");ui.loading.classList.add("hidden");}})();
