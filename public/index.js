const API = "/api/v1";
const TAK_MARKETS = [
  { name: "ตลาดคุณนาย (ตลาดสดเทศบาล 1)", area: "ถนนตากสิน · อำเภอเมืองตาก", map: "https://share.google/bBXZeWJfhOiwIjLZv" },
  { name: "ตลาดเช้าเมืองตาก", area: "ตำบลระแหง · อำเภอเมืองตาก", map: "https://share.google/rlbtTL5Bk0eUtTg82" },
  { name: "ตลาดสดเทศบาล 2", area: "อำเภอเมืองตาก", map: "https://share.google/aTUxZznwze6K9eZ6P" },
  { name: "ตลาดกลางตากสิน", area: "อำเภอเมืองตาก", map: "https://share.google/1ZLnxgklpcByK3rSy" },
];
const savedFavorites = (() => { try { return JSON.parse(localStorage.getItem("marketFavorites") || "[]"); } catch { return []; } })();
const state = { markets: [], sessions: [], market: null, session: null, shops: [], bookings: [], menuItems: [], member: null, memberMode: "login", favorites: new Set(savedFavorites.map(String)), favoritesOnly: false, authMode: "login", user: null, profile: null, view: "customer", debounce: null };
const visitorKey = (() => { let key = localStorage.getItem("marketVisitorKey"); if (!key) { key = crypto.randomUUID(); localStorage.setItem("marketVisitorKey", key); } return key; })();
const $ = (selector) => document.querySelector(selector);
const statusElement = $("#status");

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error?.message || "เกิดข้อผิดพลาด"), { status: response.status, details: result.error });
  return result.data;
}
function toast(message) { const box = $("#toast"); box.textContent = message; box.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove("show"), 3200); }
async function shareMarket() {
  if (!state.market) return toast("เลือกตลาดก่อนแชร์ลิงก์");
  const shareUrl = new URL(location.href);
  shareUrl.hash = `market=${encodeURIComponent(state.market.slug)}`;
  const shareData = { title: state.market.name, text: `ดูแผนผังและร้านค้าใน${state.market.name}`, url: shareUrl.href };
  try {
    if (navigator.share) { await navigator.share(shareData); return; }
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(shareUrl.href); toast("คัดลอกลิงก์ตลาดแล้ว"); return; }
    window.prompt("คัดลอกลิงก์ตลาดนี้", shareUrl.href);
  } catch (error) {
    if (error.name === "AbortError") return;
    try { await navigator.clipboard.writeText(shareUrl.href); toast("คัดลอกลิงก์ตลาดแล้ว"); }
    catch { window.prompt("คัดลอกลิงก์ตลาดนี้", shareUrl.href); }
  }
}
function dateLabel(date, options = { day: "numeric", month: "short", weekday: "short" }) { return new Intl.DateTimeFormat("th-TH", options).format(new Date(`${String(date).slice(0,10)}T12:00:00`)); }
function money(amount) { return `${Number(amount || 0).toLocaleString("th-TH")} บาท`; }
function locateCustomer() {
  const status = $("#location-status");
  const map = $("#visitor-location-map");
  const mapLink = $("#location-open-map");
  if (!navigator.geolocation) { status.textContent = "เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง"; return; }
  status.textContent = "กำลังค้นหาตำแหน่งของคุณ...";
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    const { latitude, longitude, accuracy } = coords;
    const delta = Math.max(0.004, Math.min(0.03, accuracy / 111000 * 2));
    const bounds = [longitude - delta, latitude - delta, longitude + delta, latitude + delta].map((value) => value.toFixed(6)).join("%2C");
    const point = `${latitude.toFixed(6)}%2C${longitude.toFixed(6)}`;
    map.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bounds}&layer=mapnik&marker=${point}`;
    map.hidden = false;
    mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
    mapLink.classList.remove("hidden");
    status.textContent = `แสดงตำแหน่งโดยประมาณ คลาดเคลื่อนได้ราว ${Math.round(accuracy)} เมตร · ระบบไม่บันทึกพิกัดนี้`;
  }, (error) => {
    status.textContent = error.code === 1 ? "ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์แล้วลองอีกครั้ง" : "ไม่สามารถระบุตำแหน่งได้ กรุณาลองใหม่เมื่อตรวจสอบสัญญาณ GPS แล้ว";
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}
function setView(view) {
  state.view = view;
  $("#customer-view").classList.toggle("hidden", view !== "customer");
  $("#shop-view").classList.toggle("hidden", view !== "shop");
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "shop") refreshShop();
}
function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll(".auth-tab").forEach((button) => button.classList.toggle("selected", button.dataset.auth === mode));
  const registering = mode === "register";
  $("#register-fields").classList.toggle("hidden", !registering);
  $("#register-contact").classList.toggle("hidden", !registering);
  $("#category-field").classList.toggle("hidden", !registering);
  $("#identifier-label").classList.toggle("hidden", registering);
  $("#auth-form [name=identifier]").required = !registering;
  $("#auth-form [name=displayName]").required = registering;
  $("#auth-form [name=shopName]").required = registering;
  $("#auth-form [name=password]").autocomplete = registering ? "new-password" : "current-password";
  $(".auth-submit").innerHTML = registering ? "สมัครและเริ่มขาย <span>→</span>" : "เข้าสู่ระบบ <span>→</span>";
  $("#auth-message").textContent = "";
}
async function loadMarkets() {
  try {
    state.markets = await api("/markets");
    const options = state.markets.map((market) => `<option value="${market.id}">${escapeHtml(market.name)}</option>`).join("");
    $("#market-select").innerHTML = options || "<option value=''>ยังไม่มีตลาดที่เปิดใช้งาน</option>";
    $("#booking-market").innerHTML = `<option value="">เลือกตลาด</option>${options}`;
    if (state.markets.length) {
      const urlSlug = location.hash.startsWith("#market=") ? decodeURIComponent(location.hash.slice(8)) : null;
      state.market = state.markets.find((item) => item.slug === urlSlug) || state.markets[0];
      $("#market-select").value = state.market.id;
      await loadMarket(state.market.id);
    } else $("#market-meta").textContent = "ยังไม่มีข้อมูลตลาด กรุณาติดต่อผู้ดูแล";
  } catch (error) { $("#market-meta").textContent = error.message; toast(error.message); }
}
async function loadMarket(id) {
  state.market = state.markets.find((market) => String(market.id) === String(id));
  if (!state.market) return;
  $("#market-meta").textContent = `${state.market.name} · ${state.market.timezone || "เวลาไทย"}`;
  $("#market-address").textContent = state.market.address || "ติดตามรายละเอียดจากตลาด";
  $("#market-description").textContent = state.market.description || "เดินชมร้านค้าและของดีในชุมชน";
  $("#market-hours").textContent = state.market.openingHours || "ตรวจสอบรอบตลาดด้านล่าง";
  $("#market-summary").textContent = state.market.description || `พบกับร้านค้าและของดีที่ ${state.market.name}`;
  $("#market-around").textContent = state.market.address ? `พิกัดตลาด: ${state.market.address}` : "เลือกวันตลาดเพื่อดูร้านค้าและแผงที่เปิดให้บริการ";
  const mapQuery = state.market.address || state.market.name;
  $("#market-location-address").textContent = state.market.address || state.market.name;
  $("#market-location-map").src = `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`;
  $("#market-open-map").href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
  history.replaceState(null, "", `#market=${encodeURIComponent(state.market.slug)}`);
  await loadRatings();
  state.sessions = await api(`/public/markets/${encodeURIComponent(state.market.slug)}/sessions`);
  renderSessions();
  if (state.sessions.length) await loadMap(state.sessions[0].id);
  else { state.session = null; $("#session-switcher").innerHTML = ""; $("#market-map").innerHTML = "<div class='empty-state'>ยังไม่มีวันตลาดที่เผยแพร่</div>"; $("#shop-list").innerHTML = "<div class='empty-copy'>ยังไม่มีร้านค้าในตลาดนี้</div>"; }
  await loadParking();
}
async function loadRatings() {
  if (!state.market) return;
  const stars = $("#rating-stars");
  try {
    const rating = await api(`/public/markets/${encodeURIComponent(state.market.slug)}/ratings?visitorKey=${encodeURIComponent(visitorKey)}`);
    $("#rating-summary").textContent = rating.count ? `${rating.average} / 5 จาก ${rating.count} ผู้มาเยือน` : "ยังไม่มีคะแนน · เป็นคนแรกที่แบ่งปัน";
    $("#rating-message").textContent = rating.myRating ? `ขอบคุณที่ให้ ${rating.myRating} ดาว!` : "แตะดาวเพื่อแบ่งปันความรู้สึก";
    stars.innerHTML = [1,2,3,4,5].map((n) => `<button type="button" class="rating-star ${n <= (rating.myRating || 0) ? "selected" : ""}" data-rating="${n}" aria-label="ให้ ${n} ดาว" aria-pressed="${n === rating.myRating}">★</button>`).join("");
  } catch (error) { $("#rating-summary").textContent = error.message; stars.innerHTML = ""; }
}
async function saveRating(value) {
  if (!state.market) return;
  try { await api(`/public/markets/${encodeURIComponent(state.market.slug)}/ratings`, { method: "POST", body: JSON.stringify({ visitorKey, rating: value }) }); await loadRatings(); }
  catch (error) { $("#rating-message").textContent = error.message; }
}
async function loadParking() {
  if (!state.market) return;
  const body = $("#parking-rows");
  try {
    const result = await api(`/public/markets/${encodeURIComponent(state.market.slug)}/parking`);
    $("#parking-current").textContent = `${Math.max(0, Number(result.summary?.parkedNow || 0))} คัน`;
    body.innerHTML = result.movements.map((item) => `<tr><td>${new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.movedAt))}</td><td><strong>${escapeHtml(item.plateNumber)}</strong><small>${escapeHtml(item.vehicleType)}</small></td><td>${escapeHtml(item.gateName)}</td><td><span class="traffic-tag ${item.movementType === "เข้า" ? "traffic-in" : "traffic-out"}">${item.movementType === "เข้า" ? "↓ เข้า" : "↑ ออก"}</span></td></tr>`).join("") || "<tr><td colspan='4'>ยังไม่มีรายการรถวันนี้</td></tr>";
  } catch (error) { body.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`; }
}
function renderSessions() {
  $("#session-switcher").innerHTML = state.sessions.map((session) => `<button class="session-chip ${String(state.session?.id) === String(session.id) ? "selected" : ""}" data-session-id="${session.id}">${dateLabel(session.sessionDate, { day: "numeric", month: "short" })}</button>`).join("");
  const current = state.sessions.find((session) => String(session.id) === String(state.session?.id));
  if (current) {
    const hours = [current.opensAt, current.closesAt].filter(Boolean).join("–");
    $("#market-hours").textContent = hours || `รอบตลาด ${dateLabel(current.sessionDate)}`;
    $("#market-summary").textContent = `${state.market?.name || "ตลาด"} · ${dateLabel(current.sessionDate)}${hours ? ` · ${hours} น.` : ""}`;
    $("#market-around").textContent = `มี ${state.shops.length} แผงในผัง · เลือกวันอื่นเพื่อสำรวจรอบตลาด`;
  }
}
async function loadMap(sessionId, search = "") {
  if (!state.market) return;
  state.session = state.sessions.find((session) => String(session.id) === String(sessionId));
  if (!state.session) return;
  renderSessions();
  const params = new URLSearchParams(); if (search) params.set("q", search);
  const endpoint = `/public/markets/${encodeURIComponent(state.market.slug)}/sessions/${sessionId}/map${params.size ? `?${params}` : ""}`;
  try {
    state.shops = await api(endpoint);
    renderMap();
    const bookings = await api(`/public/markets/${encodeURIComponent(state.market.slug)}/sessions/${sessionId}/bookings`);
    $("#booking-total").textContent = bookings.length;
    $("#public-booking-rows").innerHTML = bookings.map((booking) => `<tr><td><strong>${escapeHtml(booking.boothCode)}</strong></td><td>${escapeHtml(booking.zone || "—")}</td><td>${escapeHtml(booking.shopName)}</td><td>${escapeHtml(booking.category || "ร้านค้า")}</td><td><span class="traffic-tag traffic-in">ยืนยันแล้ว</span></td></tr>`).join("") || "<tr><td colspan='5'>ยังไม่มีรายการจองในวันนี้</td></tr>";
  }
  catch (error) { $("#market-map").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; $("#public-booking-rows").innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`; }
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[character]); }
function renderTakMarkets() {
  $("#tak-market-grid").innerHTML = TAK_MARKETS.map((market, index) => `<a class="tak-market-card market-card-${index + 1}" href="${market.map}" target="_blank" rel="noreferrer"><span class="market-card-number">0${index + 1}</span><span class="market-card-pin" aria-hidden="true">⌖</span><strong>${escapeHtml(market.name)}</strong><small>${escapeHtml(market.area)}</small><span class="market-card-link">ดูแผนที่ <b>↗</b></span></a>`).join("");
}
function renderMap() {
  const rows = state.shops;
  const categories = [...new Set(rows.map((row) => row.shop?.category).filter(Boolean))].sort();
  const selectedCategory = $("#category-filter").value;
  $("#category-filter").innerHTML = `<option value="">ทั้งหมด</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  if (categories.includes(selectedCategory)) $("#category-filter").value = selectedCategory;
  const visible = rows.filter((row) => (!selectedCategory || row.shop?.category === selectedCategory) && (!state.favoritesOnly || (row.shop && state.favorites.has(String(row.shop.id)))));
  const listedShops = rows.filter((row) => row.shop && (!state.favoritesOnly || state.favorites.has(String(row.shop.id))));
  $("#favorites-count").textContent = state.favorites.size;
  $("#favorites-toggle").setAttribute("aria-pressed", String(state.favoritesOnly));
  $("#favorites-toggle").classList.toggle("active", state.favoritesOnly);
  $("#map-count").textContent = `${visible.length} พื้นที่${state.favoritesOnly ? " · ร้านโปรด" : ""} · ${state.session ? dateLabel(state.session.sessionDate) : ""}`;
  $("#shop-total").textContent = listedShops.length;
  const availableCount = rows.filter((row) => row.availability === "available").length;
  $("#market-around").textContent = `${rows.filter((row) => row.shop).length} ร้าน · ${availableCount} แผงว่าง · ${state.session ? dateLabel(state.session.sessionDate) : ""}`;
  $("#shop-list").innerHTML = listedShops.map((row) => `<div class="shop-row"><span class="shop-avatar">${escapeHtml(row.shop.name.slice(0,1))}</span><button class="shop-open" data-shop-id="${row.shop.id}"><strong>${escapeHtml(row.shop.name)}</strong><small>${escapeHtml(row.shop.category || "ร้านค้า")}</small></button><span class="booth-tag">${escapeHtml(row.boothCode)}</span><button class="favorite-star ${state.favorites.has(String(row.shop.id)) ? "saved" : ""}" data-favorite="${row.shop.id}" type="button" aria-label="${state.favorites.has(String(row.shop.id)) ? "นำออกจาก" : "เพิ่มใน"}ร้านโปรด" aria-pressed="${state.favorites.has(String(row.shop.id))}">${state.favorites.has(String(row.shop.id)) ? "♥" : "♡"}</button></div>`).join("") || `<div class='empty-copy'>${state.favoritesOnly ? "ยังไม่มีร้านโปรดในรอบนี้ ลองแตะหัวใจที่ร้านที่ชอบ" : "ยังไม่มีร้านที่จองในวันนี้ ลองเลือกวันอื่น"}</div>`;
  const nodes = visible.map((row, index) => {
    const x = Number(row.mapX) > 0 ? Number(row.mapX) * 100 : 15 + ((index * 23) % 72);
    const y = Number(row.mapY) > 0 ? Number(row.mapY) * 100 : 23 + ((index * 29) % 62);
    const owner = row.shop ? ` data-shop-id="${row.shop.id}"` : "";
    return `<button class="map-booth ${row.availability}" style="left:${x}%;top:${y}%" data-booth-id="${row.id}"${owner} aria-label="แผง ${escapeHtml(row.boothCode)} ${row.shop ? escapeHtml(row.shop.name) : row.availability}">${escapeHtml(row.boothCode)}</button>`;
  }).join("");
  $("#market-map").innerHTML = nodes ? `<span class="map-label north">ทางเข้าตลาด</span>${nodes}<span class="map-label south">ลานกลางตลาด</span>` : `<div class='empty-state'>${state.favoritesOnly ? "ยังไม่พบตำแหน่งร้านโปรดในรอบนี้" : "ยังไม่มีแผงในผัง"}</div>`;
}
async function loadManagedMenu() {
  try {
    state.menuItems = await api("/shop/menu-items");
    $("#managed-menu-list").innerHTML = state.menuItems.map((item) => `<article class="managed-menu-item"><div>${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : ""}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${money(item.price)}</small>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}</span></div><button class="quiet-button" data-edit-menu="${item.id}" type="button">แก้ไข</button><button class="quiet-button" data-delete-menu="${item.id}" type="button">ลบ</button></article>`).join("") || "<p class='empty-copy'>ยังไม่มีเมนู เพิ่มเมนูแรกของร้านได้เลย</p>";
  } catch (error) { $("#managed-menu-list").innerHTML = `<p class='empty-copy'>${escapeHtml(error.message)}</p>`; }
}
function renderPublicMenu(payload) {
  const holder = $("#public-shop-menu");
  const categories = [...new Set(payload.items.map((item) => item.category))];
  holder.innerHTML = `<div class="section-heading"><div><p class="eyebrow">MENU · ${escapeHtml(payload.shop.name)}</p><h2>เมนูและหมวดหมู่</h2></div><button id="close-public-menu" class="quiet-button" type="button">ปิด ×</button></div><div class="menu-category-chips"><button class="menu-category selected" data-menu-category="" type="button">ทั้งหมด</button>${categories.map((category) => `<button class="menu-category" data-menu-category="${escapeHtml(category)}" type="button">${escapeHtml(category)}</button>`).join("")}</div><div class="public-menu-grid">${payload.items.map((item) => `<article class="public-menu-card" data-category="${escapeHtml(item.category)}">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy">` : ""}<div><small>${escapeHtml(item.category)}</small><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || "")}</p><strong>${money(item.price)}</strong></div></article>`).join("") || "<p class='empty-copy'>ร้านนี้ยังไม่ได้เพิ่มเมนู</p>"}</div>`;
  holder.classList.remove("hidden"); holder.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function refreshMember() {
  try { state.member = await api("/members/me"); $("#member-auth-card").classList.add("hidden"); $("#member-profile").classList.remove("hidden"); $("#member-profile").innerHTML = `<div><strong>สวัสดี ${escapeHtml(state.member.displayName)}</strong><small>${escapeHtml(state.member.email || state.member.phone || "สมาชิกตลาด")}</small></div><div class="member-points"><b>${Number(state.member.points).toLocaleString("th-TH")}</b><small>คะแนนสะสม</small></div><button id="member-logout" class="quiet-button" type="button">ออกจากระบบ</button>`; }
  catch (error) { if (error.status === 401) { state.member = null; $("#member-auth-card").classList.remove("hidden"); $("#member-profile").classList.add("hidden"); } else $("#member-message").textContent = error.message; }
}
function setMemberMode(mode) {
  state.memberMode = mode; const registering = mode === "register";
  document.querySelectorAll("[data-member-mode]").forEach((button) => button.classList.toggle("selected", button.dataset.memberMode === mode));
  $("#member-name-field").classList.toggle("hidden", !registering); $("#member-contact-fields").classList.toggle("hidden", !registering); $("#member-identifier-field").classList.toggle("hidden", registering);
  $("#member-form [name=displayName]").required = registering; $("#member-form [name=identifier]").required = !registering;
  $("#member-form [name=password]").autocomplete = registering ? "new-password" : "current-password";
  $("#member-form button[type=submit]").innerHTML = registering ? "สมัครสมาชิก <span>→</span>" : "เข้าสู่ระบบ <span>→</span>"; $("#member-message").textContent = "";
}
async function refreshShop() {
  try {
    const me = await api("/auth/me");
    state.user = me;
    $("#auth-card").classList.add("hidden"); $("#dashboard").classList.remove("hidden"); $("#account-button").textContent = me.shop.name;
    $("#shop-greeting").textContent = `สวัสดี ${me.shop.name}`;
    const [dashboard, bookings, profile] = await Promise.all([api("/shop/dashboard"), api("/bookings?period=all"), api("/shop/profile")]);
    state.bookings = bookings; state.profile = profile;
    await loadManagedMenu();
    const next = dashboard.upcomingBooking;
    $("#next-booking-title").textContent = next ? `${next.marketName} · แผง ${next.boothCode}` : "ยังไม่มีรายการจอง";
    $("#next-booking-detail").textContent = next ? `${dateLabel(next.sessionDate)} · ${money(next.price)}` : "เลือกพื้นที่ว่างเพื่อเริ่มต้น";
    $("#profile-name").textContent = profile.name;
    $("#profile-description").textContent = profile.description || profile.category || "เพิ่มข้อมูลร้านให้ลูกค้ารู้จัก";
    $("#booking-list").innerHTML = bookings.map((booking) => `<article class="booking-item"><div><strong>${escapeHtml(booking.marketName)} · แผง ${escapeHtml(booking.boothCode)}</strong><small>${dateLabel(booking.sessionDate)} · ${money(booking.price)} · ${escapeHtml(booking.bookingRef)}</small></div><span class="booking-status ${booking.status === "cancelled" ? "cancelled" : ""}">${booking.status === "cancelled" ? "ยกเลิกแล้ว" : "ยืนยันแล้ว"}</span>${booking.status === "confirmed" ? `<button class="quiet-button" data-cancel="${escapeHtml(booking.bookingRef)}">ยกเลิก</button>` : ""}</article>`).join("") || "<p class='empty-copy'>ยังไม่มีการจอง</p>";
    $("#profile-form").elements.name.value = profile.name || ""; $("#profile-form").elements.category.value = profile.category || ""; $("#profile-form").elements.contactPhone.value = profile.contactPhone || ""; $("#profile-form").elements.description.value = profile.description || ""; $("#profile-form").elements.displayName.value = profile.displayName || ""; $("#profile-form").elements.phone.value = profile.phone || "";
  } catch (error) {
    if (error.status === 401) { state.user = null; $("#auth-card").classList.remove("hidden"); $("#dashboard").classList.add("hidden"); $("#account-button").textContent = "เข้าสู่ระบบร้านค้า ↗"; }
    else toast(error.message);
  }
}
async function loadBookingSessions(marketId) {
  const select = $("#booking-session"); select.disabled = true; select.innerHTML = "<option value=''>กำลังโหลดวันตลาด...</option>"; $("#booking-booths").innerHTML = "";
  if (!marketId) { select.innerHTML = "<option value=''>เลือกวันตลาด</option>"; return; }
  try { const sessions = await api(`/markets/${marketId}/sessions?status=open`); select.innerHTML = `<option value="">เลือกวันตลาด</option>${sessions.map((s) => `<option value="${s.id}">${dateLabel(s.sessionDate)}</option>`).join("")}`; select.disabled = false; }
  catch (error) { select.innerHTML = "<option value=''>โหลดวันตลาดไม่สำเร็จ</option>"; toast(error.message); }
}
async function loadBookingBooths(sessionId) {
  const marketId = $("#booking-market").value; const holder = $("#booking-booths"); if (!marketId || !sessionId) return;
  holder.innerHTML = "<p class='empty-copy'>กำลังโหลดพื้นที่ว่าง...</p>";
  try { const booths = await api(`/markets/${marketId}/sessions/${sessionId}/booths?availability=all&limit=100`); holder.innerHTML = booths.map((booth) => `<button class="booth-card" data-book-booth="${booth.id}" ${booth.availability !== "available" ? "disabled" : ""}><strong>แผง ${escapeHtml(booth.boothCode)}</strong><small>${escapeHtml(booth.zone || "ตลาด")} · ${money(booth.price)}</small><span class="booking-status ${booth.availability === "available" ? "" : "cancelled"}">${booth.availability === "available" ? "ว่าง · เลือกจอง" : booth.availability === "booked" ? "จองแล้ว" : "ปิดใช้งาน"}</span></button>`).join("") || "<p class='empty-copy'>ไม่มีแผงในตลาดนี้</p>"; }
  catch (error) { holder.innerHTML = `<p class='empty-copy'>${escapeHtml(error.message)}</p>`; }
}
function selectShopAction(action) {
  ["booking-tools", "profile-tools"].forEach((id) => $(`#${id}`).classList.add("hidden"));
  if (action === "book") { $("#booking-tools").classList.remove("hidden"); loadBookingSessions($("#booking-market").value); }
  else if (action === "profile") $("#profile-tools").classList.remove("hidden");
  else if (action === "dashboard") window.scrollTo({ top: $("#dashboard").offsetTop, behavior: "smooth" });
}

async function checkServer() {
  try {
    const response = await fetch("/api/health"); const result = await response.json(); if (!response.ok) throw new Error("Database unavailable");
    statusElement.textContent = `ระบบพร้อม · ฐานข้อมูล ${result.data?.database || result.database}`;
    $("#db-status").dataset.state = "ok"; $("#db-status").innerHTML = "<span></span> ระบบพร้อมใช้งาน";
  } catch {
    statusElement.textContent = "เซิร์ฟเวอร์ทำงาน แต่ยังเชื่อมต่อฐานข้อมูลไม่ได้";
    $("#db-status").dataset.state = "error"; $("#db-status").innerHTML = "<span></span> ตรวจสอบฐานข้อมูลไม่สำเร็จ";
  }
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$("#account-button").addEventListener("click", () => setView("shop"));
document.querySelectorAll("[data-auth]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.auth)));
$("#market-select").addEventListener("change", (event) => loadMarket(event.target.value).catch((error) => toast(error.message)));
$("#share-market").addEventListener("click", shareMarket);
$("#locate-me").addEventListener("click", locateCustomer);
$("#session-switcher").addEventListener("click", (event) => { const button = event.target.closest("[data-session-id]"); if (button) loadMap(button.dataset.sessionId, $("#shop-search").value); });
$("#shop-search").addEventListener("input", () => { clearTimeout(state.debounce); state.debounce = setTimeout(() => state.session && loadMap(state.session.id, $("#shop-search").value), 280); });
$("#category-filter").addEventListener("change", renderMap);
$("#favorites-toggle").addEventListener("click", () => { state.favoritesOnly = !state.favoritesOnly; renderMap(); });
$("#rating-stars").addEventListener("click", (event) => { const star = event.target.closest("[data-rating]"); if (star) saveRating(Number(star.dataset.rating)); });
$("#market-map").addEventListener("click", (event) => { const booth = event.target.closest("[data-shop-id]"); if (booth) $("#shop-list").querySelector(`[data-shop-id="${booth.dataset.shopId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); });
$("#shop-list").addEventListener("click", async (event) => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    const id = String(favorite.dataset.favorite);
    if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
    localStorage.setItem("marketFavorites", JSON.stringify([...state.favorites]));
    renderMap();
    toast(state.favorites.has(id) ? "บันทึกร้านโปรดแล้ว" : "นำร้านออกจากรายการโปรดแล้ว");
    return;
  }
  const row = event.target.closest("[data-shop-id]");
  if (!row || !state.session) return;
  try {
    const [detail, menu] = await Promise.all([api(`/public/markets/${encodeURIComponent(state.market.slug)}/sessions/${state.session.id}/shops/${row.dataset.shopId}`), api(`/public/markets/${encodeURIComponent(state.market.slug)}/sessions/${state.session.id}/shops/${row.dataset.shopId}/menu`)]);
    renderPublicMenu(menu); toast(`${detail.name} · แผง ${detail.boothCode}${detail.contactPhone ? ` · โทร ${detail.contactPhone}` : ""}`);
  } catch (error) { toast(error.message); }
});
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const message = $("#auth-message"); message.textContent = "กำลังดำเนินการ..."; message.classList.remove("success");
  try {
    let data;
    if (state.authMode === "register") data = await api("/auth/register", { method: "POST", body: JSON.stringify({ displayName: form.get("displayName"), email: form.get("email"), phone: form.get("phone"), password: form.get("password"), shop: { name: form.get("shopName"), category: form.get("category") } }) });
    else data = await api("/auth/login", { method: "POST", body: JSON.stringify({ identifier: form.get("identifier"), password: form.get("password") }) });
    state.user = data; message.textContent = "สำเร็จ กำลังเปิดหน้าร้านของคุณ"; message.classList.add("success"); await refreshShop();
  } catch (error) { message.textContent = error.message; }
});
$("#logout-button").addEventListener("click", async () => { try { await api("/auth/logout", { method: "POST" }); state.user = null; toast("ออกจากระบบแล้ว"); await refreshShop(); } catch (error) { toast(error.message); } });
document.body.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-shop-action]"); if (action) { selectShopAction(action.dataset.shopAction); return; }
  const cancel = event.target.closest("[data-cancel]"); if (cancel && confirm("ยืนยันยกเลิกรายการจองนี้หรือไม่?")) { try { await api(`/bookings/${encodeURIComponent(cancel.dataset.cancel)}/cancel`, { method: "POST", body: JSON.stringify({}) }); toast("ยกเลิกการจองแล้ว"); await refreshShop(); } catch (error) { toast(error.message); } }
  const booth = event.target.closest("[data-book-booth]"); if (booth && confirm("ยืนยันจองแผงนี้หรือไม่?")) { try { await api("/bookings", { method: "POST", body: JSON.stringify({ sessionId: Number($("#booking-session").value), boothId: Number(booth.dataset.bookBooth) }) }); toast("จองพื้นที่สำเร็จ"); await refreshShop(); await loadBookingBooths($("#booking-session").value); } catch (error) { toast(error.message); if (error.status === 409) await loadBookingBooths($("#booking-session").value); } }
});
$("#booking-market").addEventListener("change", (event) => loadBookingSessions(event.target.value));
$("#booking-session").addEventListener("change", (event) => loadBookingBooths(event.target.value));
$("#profile-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const message = $("#profile-message"); try { await api("/shop/profile", { method: "PATCH", body: JSON.stringify(Object.fromEntries(form.entries())) }); message.textContent = "บันทึกข้อมูลแล้ว"; message.classList.add("success"); await refreshShop(); } catch (error) { message.textContent = error.message; message.classList.remove("success"); } });
$("#menu-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget).entries()); const message = $("#menu-message"); try { await api("/shop/menu-items", { method: "POST", body: JSON.stringify(form) }); event.currentTarget.reset(); message.textContent = "เพิ่มเมนูแล้ว"; message.classList.add("success"); await loadManagedMenu(); } catch (error) { message.textContent = error.message; message.classList.remove("success"); } });
$("#managed-menu-list").addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-delete-menu]"); const edit = event.target.closest("[data-edit-menu]");
  try {
    if (remove && confirm("ต้องการลบเมนูนี้หรือไม่?")) { await api(`/shop/menu-items/${remove.dataset.deleteMenu}`, { method: "DELETE" }); await loadManagedMenu(); toast("ลบเมนูแล้ว"); }
    if (edit) { const item = state.menuItems.find((entry) => String(entry.id) === edit.dataset.editMenu); if (!item) return; const name = prompt("ชื่อเมนู", item.name); if (name === null) return; const category = prompt("หมวดหมู่", item.category); if (category === null) return; const price = prompt("ราคา (บาท)", item.price); if (price === null) return; const description = prompt("คำอธิบาย", item.description || ""); if (description === null) return; await api(`/shop/menu-items/${edit.dataset.editMenu}`, { method: "PATCH", body: JSON.stringify({ name, category, price, description }) }); await loadManagedMenu(); toast("บันทึกเมนูแล้ว"); }
  } catch (error) { toast(error.message); }
});
$("#public-shop-menu").addEventListener("click", (event) => {
  if (event.target.closest("#close-public-menu")) { $("#public-shop-menu").classList.add("hidden"); return; }
  const filter = event.target.closest("[data-menu-category]"); if (!filter) return; const category = filter.dataset.menuCategory;
  document.querySelectorAll("[data-menu-category]").forEach((button) => button.classList.toggle("selected", button === filter));
  $("#public-shop-menu").querySelectorAll(".public-menu-card").forEach((card) => card.classList.toggle("hidden", Boolean(category) && card.dataset.category !== category));
});
document.querySelectorAll("[data-member-mode]").forEach((button) => button.addEventListener("click", () => setMemberMode(button.dataset.memberMode)));
$("#member-nav").addEventListener("click", () => $("#member-section").scrollIntoView({ behavior: "smooth", block: "center" }));
$("#member-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); const message = $("#member-message"); message.textContent = "กำลังดำเนินการ...";
  try { state.member = state.memberMode === "register" ? await api("/members/register", { method: "POST", body: JSON.stringify({ displayName: values.displayName, email: values.email, phone: values.phone, password: values.password }) }) : await api("/members/login", { method: "POST", body: JSON.stringify({ identifier: values.identifier, password: values.password }) }); message.textContent = ""; await refreshMember(); toast("ยินดีต้อนรับสู่ชุมชนตลาดริมปิง"); }
  catch (error) { message.textContent = error.message; }
});
$("#member-profile").addEventListener("click", async (event) => { if (!event.target.closest("#member-logout")) return; try { await api("/members/logout", { method: "POST" }); await refreshMember(); toast("ออกจากระบบสมาชิกแล้ว"); } catch (error) { toast(error.message); } });

renderTakMarkets(); refreshMember();
checkServer(); loadMarkets();

