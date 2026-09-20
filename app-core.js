
const SUPABASE_URL = "https://eroujmfrrxvrmybctanz.supabase.co";
const SUPABASE_KEY = "sb_publishable_ejd8Z9zE6e_ODJj3rArrAA_siGSSNgp";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = new Intl.NumberFormat("pt-BR");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const ui = {
  app: $("#app"), auth: $("#authScreen"), loading: $("#loading"), canvas: $("#world"),
  level: $("#levelText"), money: $("#moneyText"), region: $("#regionText"), weather: $("#weatherText"),
  weatherIcon: $("#weatherIcon"), world: $("#worldText"), event: $("#eventBanner"), announcement: $("#announcement"),
  onlineList: $("#onlineList"), onlineCount: $("#onlineCount"), waypoint: $("#waypoint"), fishBtn: $("#fishBtn"),
  fishHint: $("#fishHint"), sidePanel: $("#sidePanel"), panelTitle: $("#panelTitle"), panelTabs: $("#panelTabs"), panelBody: $("#panelBody"),
  fishingOverlay: $("#fishingOverlay"), castStage: $("#castStage"), castFill: $("#castFill"), waitStage: $("#waitStage"),
  waitingText: $("#waitingText"), shakeLayer: $("#shakeLayer"), reelStage: $("#reelStage"), reelBar: $("#reelBar"),
  controlZone: $("#controlZone"), fishMarker: $("#fishMarker"), reelProgress: $("#reelProgress"),
  catchModal: $("#catchModal"), catchRarity: $("#catchRarity"), catchName: $("#catchName"), catchTraits: $("#catchTraits"),
  catchWeight: $("#catchWeight"), catchValue: $("#catchValue"), catchXp: $("#catchXp"), toastStack: $("#toastStack")
};

const ctx = ui.canvas.getContext("2d", { alpha: false });

const G = {
  session: null, profile: null, world: null,
  regions: [], fish: [], rods: [], baits: [], boats: [],
  others: new Map(), channels: [], panel: null,
  pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, keys: new Set(),
  camera: { x: 0, y: 0 }, currentRegion: "harbor_haven", targetRegion: "harbor_haven",
  last: performance.now(), stars: [], ripples: [], running: false, booting: false,
  joystick: { active: false, x: 0, y: 0, id: null },
  fishing: { busy: false, charging: false, charge: 0, chargeDir: 1, challenge: null, shakeBoost: 0, reelRAF: null },
  presenceTimer: null, worldTimer: null
};

const rarityOrder = ["Common","Uncommon","Rare","Legendary","Mythical","Special","Secret"];
const weatherIcon = { Clear:"☀", Rain:"☂", Wind:"≈", Foggy:"≋", Storm:"ϟ", Snow:"✦", Aurora:"✧" };
const regionSymbols = { harbor_haven:"⚓", open_ocean:"≈", ember_cay:"▲", frostwake:"✦", mirefen:"♣", coral_reach:"✺", abyssal_rift:"◉" };

function toast(text, type="") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = text;
  ui.toastStack.appendChild(el);
  setTimeout(() => el.remove(), 3300);
}
function authMsg(text, ok=false) {
  const el = $("#authMessage"); el.textContent = text; el.className = "auth-message" + (ok ? " ok" : "");
}
function escapeHtml(v="") {
  return String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}
function rarityClass(r) { return "r-" + (rarityOrder.includes(r) ? r : "Common"); }
function getRegion(id) { return G.regions.find(r => r.id === id) || G.regions[0]; }
function getRod(id) { return G.rods.find(r => r.id === id); }
function getBait(id) { return G.baits.find(r => r.id === id); }
function getBoat(id) { return G.boats.find(r => r.id === id); }
function owned(map, id) { return Number((map || {})[id] || 0) > 0; }

async function game(action, payload={}) {
  const { data, error } = await sb.functions.invoke("mare-game", { body: { action, payload } });
  if (error) {
    let msg = error.message || "Erro no servidor";
    try {
      const body = await error.context?.json?.();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function fetchCatalogs() {
  const requests = [
    sb.from("mare_regions").select("*").order("level_required"),
    sb.from("mare_fish_catalog").select("*").order("rarity_weight", { ascending:false }),
    sb.from("mare_rod_catalog").select("*").order("price"),
    sb.from("mare_bait_catalog").select("*").order("price"),
    sb.from("mare_boat_catalog").select("*").order("price")
  ];
  const results = await Promise.all(requests);
  const fail = results.find(r => r.error);
  if (fail) throw fail.error;
  [G.regions,G.fish,G.rods,G.baits,G.boats] = results.map(r => r.data || []);
}

async function refreshState() {
  const data = await game("state");
  G.profile = data.profile; G.world = data.world;
  syncHud();
  return data;
}

function syncHud() {
  if (!G.profile) return;
  ui.level.textContent = G.profile.level;
  ui.money.textContent = fmt.format(G.profile.money);
  const reg = getRegion(G.currentRegion || G.profile.active_region);
  ui.region.textContent = reg?.name || "Open Ocean";
  if (G.world) {
    ui.weather.textContent = G.world.weather;
    ui.weatherIcon.textContent = weatherIcon[G.world.weather] || "≈";
    ui.world.textContent = G.world.season + " · " + G.world.time_of_day;
    if (G.world.event_name) { ui.event.textContent = "EVENTO GLOBAL · " + G.world.event_name.toUpperCase(); ui.event.classList.remove("hidden"); }
    else ui.event.classList.add("hidden");
  }
  if (G.panel) renderPanel(G.panel);
}
