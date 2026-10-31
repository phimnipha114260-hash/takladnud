const API = "/api/v1";
const state = { markets: [], sessions: [], market: null, session: null, shops: [], bookings: [], authMode: "login", user: null, profile: null, view: "customer", debounce: null };
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
function dateLabel(date, options = { day: "numeric", month: "short", weekday: "short" }) { return new Intl.DateTimeFormat("th-TH", options).format(new Date(`${String(date).slice(0,10)}T12:00:00`)); }
function money(amount) { return `${Number(amount || 0).toLocaleString("th-TH")} บาท`; }
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
  history.replaceState(null, "", `#market=${encodeURIComponent(state.market.slug)}`);
  state.sessions = await api(`/public/markets/${encodeURIComponent(state.market.slug)}/sessions`);
  renderSessions();
  if (state.sessions.length) await loadMap(state.sessions[0].id);
  else { state.session = null; $("#session-switcher").innerHTML = ""; $("#market-map").innerHTML = "<div class='empty-state'>ยังไม่มีวันตลาดที่เผยแพร่</div>"; $("#shop-list").innerHTML = "<div class='empty-copy'>ยังไม่มีร้านค้าในตลาดนี้</div>"; }
  await loadParking();
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
function renderMap() {
  const rows = state.shops;
  const categories = [...new Set(rows.map((row) => row.shop?.category).filter(Boolean))].sort();
  const selectedCategory = $("#category-filter").value;
  $("#category-filter").innerHTML = `<option value="">ทั้งหมด</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  if (categories.includes(selectedCategory)) $("#category-filter").value = selectedCategory;
  const visible = rows.filter((row) => !selectedCategory || row.shop?.category === selectedCategory);
  $("#map-count").textContent = `${visible.length} พื้นที่ · ${state.session ? dateLabel(state.session.sessionDate) : ""}`;
  $("#shop-total").textContent = rows.filter((row) => row.shop).length;
  const availableCount = rows.filter((row) => row.availability === "available").length;
  $("#market-around").textContent = `${rows.filter((row) => row.shop).length} ร้าน · ${availableCount} แผงว่าง · ${state.session ? dateLabel(state.session.sessionDate) : ""}`;
  $("#shop-list").innerHTML = rows.filter((row) => row.shop).map((row) => `<button class="shop-row" data-shop-id="${row.shop.id}"><span class="shop-avatar">${escapeHtml(row.shop.name.slice(0,1))}</span><span><strong>${escapeHtml(row.shop.name)}</strong><small>${escapeHtml(row.shop.category || "ร้านค้า")}</small></span><span class="booth-tag">${escapeHtml(row.boothCode)}</span></button>`).join("") || "<div class='empty-copy'>ยังไม่มีร้านที่จองในวันนี้ ลองเลือกวันอื่น</div>";
  const nodes = visible.map((row, index) => {
    const x = Number(row.mapX) > 0 ? Number(row.mapX) * 100 : 15 + ((index * 23) % 72);
    const y = Number(row.mapY) > 0 ? Number(row.mapY) * 100 : 23 + ((index * 29) % 62);
    const owner = row.shop ? ` data-shop-id="${row.shop.id}"` : "";
    return `<button class="map-booth ${row.availability}" style="left:${x}%;top:${y}%" data-booth-id="${row.id}"${owner} aria-label="แผง ${escapeHtml(row.boothCode)} ${row.shop ? escapeHtml(row.shop.name) : row.availability}">${escapeHtml(row.boothCode)}</button>`;
  }).join("");
  $("#market-map").innerHTML = nodes ? `<span class="map-label north">ทางเข้าตลาด</span>${nodes}<span class="map-label south">ลานกลางตลาด</span>` : "<div class='empty-state'>ยังไม่มีแผงในผัง</div>";
}
async function refreshShop() {
  try {
    const me = await api("/auth/me");
    state.user = me;
    $("#auth-card").classList.add("hidden"); $("#dashboard").classList.remove("hidden"); $("#account-button").textContent = me.shop.name;
    $("#shop-greeting").textContent = `สวัสดี ${me.shop.name}`;
    const [dashboard, bookings, profile] = await Promise.all([api("/shop/dashboard"), api("/bookings?period=all"), api("/shop/profile")]);
    state.bookings = bookings; state.profile = profile;
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
$("#session-switcher").addEventListener("click", (event) => { const button = event.target.closest("[data-session-id]"); if (button) loadMap(button.dataset.sessionId, $("#shop-search").value); });
$("#shop-search").addEventListener("input", () => { clearTimeout(state.debounce); state.debounce = setTimeout(() => state.session && loadMap(state.session.id, $("#shop-search").value), 280); });
$("#category-filter").addEventListener("change", renderMap);
$("#market-map").addEventListener("click", (event) => { const booth = event.target.closest("[data-shop-id]"); if (booth) $("#shop-list").querySelector(`[data-shop-id="${booth.dataset.shopId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); });
$("#shop-list").addEventListener("click", async (event) => { const row = event.target.closest("[data-shop-id]"); if (!row || !state.session) return; try { const detail = await api(`/public/markets/${encodeURIComponent(state.market.slug)}/sessions/${state.session.id}/shops/${row.dataset.shopId}`); toast(`${detail.name} · แผง ${detail.boothCode}${detail.contactPhone ? ` · โทร ${detail.contactPhone}` : ""}`); } catch (error) { toast(error.message); } });
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

checkServer(); loadMarkets();

