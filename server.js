const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const crypto = require("crypto");

const app = express();
const port = 3112;
const database = mysql.createPool({
  host: "10.200.210.117",
  port: 3306,
  user: "std12",
  password: "std12",
  database: "db_std12",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  dateStrings: true,
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(session({
  name: "market.sid",
  secret: "classroom-project-session-secret-change-before-public-deployment",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 604800000 },
}));
app.use(express.static("public"));

class ApiError extends Error {
  constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
}
function respond(res, data, status = 200, meta = {}) {
  return res.status(status).json({ data, meta: { ...meta, requestId: res.req.requestId } });
}
function errorResponse(res, error) {
  const status = error instanceof ApiError ? error.status : 500;
  if (status === 500) console.error(`[${res.req.requestId}]`, error.message);
  return res.status(status).json({ error: { code: error.code || "INTERNAL_ERROR", message: error instanceof ApiError ? error.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง", ...(error.fields ? { fields: error.fields } : {}), requestId: res.req.requestId } });
}
function route(fn) { return (req, res) => Promise.resolve(fn(req, res)).catch((e) => errorResponse(res, e)); }
function value(input, max, field, required = false) {
  if (typeof input !== "string") {
    if (required) throw new ApiError(400, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูลที่กรอก", { [field]: "จำเป็นต้องกรอกข้อมูล" });
    return null;
  }
  const result = input.trim();
  if (required && !result) throw new ApiError(400, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูลที่กรอก", { [field]: "จำเป็นต้องกรอกข้อมูล" });
  if (result.length > max) throw new ApiError(400, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูลที่กรอก", { [field]: `ต้องมีความยาวไม่เกิน ${max} ตัวอักษร` });
  return result || null;
}
function paging(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
function requireShop(req, _res, next) {
  if (!req.session.user || req.session.user.role !== "shop") return next(new ApiError(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบก่อนใช้งาน"));
  next();
}

async function initializeSchema() {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, role VARCHAR(20) NOT NULL, display_name VARCHAR(120) NOT NULL, email VARCHAR(254) NULL UNIQUE, phone VARCHAR(30) NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT chk_users_contact CHECK (email IS NOT NULL OR phone IS NOT NULL)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS markets (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL, slug VARCHAR(180) NOT NULL UNIQUE, description TEXT NULL, address VARCHAR(500) NULL, timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Bangkok', status VARCHAR(20) NOT NULL DEFAULT 'active', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS shops (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL UNIQUE, name VARCHAR(160) NOT NULL, category VARCHAR(100) NULL, description TEXT NULL, contact_phone VARCHAR(30) NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_shops_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS market_sessions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, market_id BIGINT UNSIGNED NOT NULL, session_date DATE NOT NULL, starts_at TIME NULL, ends_at TIME NULL, booking_opens_at DATETIME NULL, booking_closes_at DATETIME NULL, status VARCHAR(20) NOT NULL DEFAULT 'open', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_market_session_date (market_id, session_date), CONSTRAINT fk_sessions_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS booths (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, market_id BIGINT UNSIGNED NOT NULL, booth_code VARCHAR(40) NOT NULL, label VARCHAR(100) NULL, zone VARCHAR(80) NULL, map_x DECIMAL(8,5) NULL, map_y DECIMAL(8,5) NULL, width DECIMAL(8,5) NULL, height DECIMAL(8,5) NULL, price DECIMAL(10,2) NOT NULL DEFAULT 0.00, status VARCHAR(20) NOT NULL DEFAULT 'active', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_market_booth_code (market_id, booth_code), KEY idx_booths_market_status (market_id, status), CONSTRAINT fk_booths_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS bookings (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, booking_ref VARCHAR(32) NOT NULL UNIQUE, session_id BIGINT UNSIGNED NOT NULL, booth_id BIGINT UNSIGNED NOT NULL, shop_id BIGINT UNSIGNED NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'confirmed', price_at_booking DECIMAL(10,2) NOT NULL, booked_at DATETIME NOT NULL, cancelled_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_booking_session_booth (session_id, booth_id), KEY idx_bookings_shop_date (shop_id, booked_at), KEY idx_bookings_session_status (session_id, status), CONSTRAINT fk_bookings_session FOREIGN KEY (session_id) REFERENCES market_sessions(id) ON DELETE RESTRICT, CONSTRAINT fk_bookings_booth FOREIGN KEY (booth_id) REFERENCES booths(id) ON DELETE RESTRICT, CONSTRAINT fk_bookings_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS parking_movements (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, market_id BIGINT UNSIGNED NOT NULL, plate_number VARCHAR(20) NOT NULL, vehicle_type VARCHAR(40) NOT NULL, driver_name VARCHAR(120) NULL, movement_type VARCHAR(10) NOT NULL, gate_name VARCHAR(80) NOT NULL DEFAULT 'ประตูหลัก', moved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, note VARCHAR(255) NULL, KEY idx_parking_market_time (market_id, moved_at), CONSTRAINT fk_parking_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];
  for (const sql of ddl) await database.query(sql);
  await seedDemoMarket();
}

async function seedDemoMarket() {
  const conn = await database.getConnection();
  try {
    await conn.beginTransaction();
    const [existingMarkets] = await conn.execute("SELECT id FROM markets WHERE slug='talat-nat-ward' LIMIT 1");
    let marketId = existingMarkets[0]?.id;
    if (!marketId) {
      const [market] = await conn.execute("INSERT INTO markets (name,slug,description,address,timezone) VALUES (?,?,?,?,?)", ["ตลาดนัดชุมชนริมปิง", "talat-nat-ward", "ตลาดเย็นบรรยากาศอบอุ่น รวมอาหารเหนือ ของสด และงานฝีมือจากคนในชุมชน", "ลานกิจกรรมชุมชน ถนนริมปิง อำเภอเมือง จังหวัดเชียงใหม่", "Asia/Bangkok"]);
      marketId = market.insertId;
    }
    const sessions = [];
    for (let day = 1; day <= 7; day += 1) {
      const [rows] = await conn.execute("SELECT id FROM market_sessions WHERE market_id=? AND session_date=DATE_ADD(CURDATE(), INTERVAL ? DAY) LIMIT 1", [marketId,day]);
      if (rows[0]) sessions.push(rows[0].id);
      else {
        const [session] = await conn.execute("INSERT INTO market_sessions (market_id,session_date,starts_at,ends_at,booking_opens_at,booking_closes_at,status) VALUES (?,DATE_ADD(CURDATE(), INTERVAL ? DAY),'16:00:00','21:00:00',DATE_SUB(NOW(),INTERVAL 30 DAY),DATE_ADD(DATE_ADD(CURDATE(), INTERVAL ? DAY),INTERVAL 15 HOUR),'open')", [marketId,day,day]);
        sessions.push(session.insertId);
      }
    }
    const stallRows = [
      ["A01","ข้าวซอยลุงคำ","อาหารเหนือ","ข้าวซอยไก่และน้ำเงี้ยวสูตรครอบครัว","0812345601","A",0.19,0.31,180],
      ["A02","ไส้อั่วเตาถ่าน","ของย่าง","ไส้อั่วสมุนไพรย่างใหม่ทุกวัน","0812345602","A",0.34,0.31,150],
      ["A03","ครัวข้าวจี่","อาหารทานเล่น","ข้าวจี่ไข่และน้ำพริกหนุ่ม","0812345603","A",0.49,0.31,120],
      ["B01","ผลไม้สวนป้าแดง","ผักผลไม้","ผลไม้ตามฤดูกาลจากสวนท้องถิ่น","0812345604","B",0.20,0.55,100],
      ["B02","ชื่นใจน้ำสมุนไพร","เครื่องดื่ม","น้ำอัญชันมะนาวและเก๊กฮวยต้มสด","0812345605","B",0.36,0.55,100],
      ["B03","ขนมครกเตาถ่าน","ขนมหวาน","ขนมครกกะทิสดทำร้อน ๆ","0812345606","B",0.51,0.55,120],
      ["C01","ผ้าทอริมปิง","งานทำมือ","กระเป๋าผ้าทอและของฝากทำมือ","0812345607","C",0.69,0.34,130],
      ["C02","ดอกไม้ริมทาง","ดอกไม้","ช่อดอกไม้และไม้กระถางจากชุมชน","0812345608","C",0.80,0.54,130],
      ["C03","กาแฟดริปบ้านสวน","เครื่องดื่ม","กาแฟคั่วกลางจากแหล่งปลูกภาคเหนือ","0812345609","C",0.67,0.70,150],
      ["D01",null,null,null,null,"D",0.39,0.78,90], ["D02",null,null,null,null,"D",0.55,0.79,90], ["D03",null,null,null,null,"D",0.76,0.79,90],
    ];
    const boothIds = {};
    for (const [code,name,category,description,phone,zone,x,y,price] of stallRows) {
      const [existingBooths] = await conn.execute("SELECT id FROM booths WHERE market_id=? AND booth_code=? LIMIT 1", [marketId,code]);
      let boothId = existingBooths[0]?.id;
      if (!boothId) {
        const [booth] = await conn.execute("INSERT INTO booths (market_id,booth_code,label,zone,map_x,map_y,width,height,price) VALUES (?,?,?,?,?,?,0.08,0.08,?)", [marketId,code,name||`แผงโซน ${zone}`,`โซน ${zone}`,x,y,price]);
        boothId = booth.insertId;
      }
      boothIds[code] = boothId;
      if (!name) continue;
      const email = `demo${code.toLowerCase()}@talat-nat.local`;
      const [existingUsers] = await conn.execute("SELECT u.id,s.id AS shop_id FROM users u LEFT JOIN shops s ON s.user_id=u.id WHERE u.email=? LIMIT 1", [email]);
      let shopId = existingUsers[0]?.shop_id;
      if (!shopId) {
        let userId = existingUsers[0]?.id;
        if (!userId) {
          const [user] = await conn.execute("INSERT INTO users (role,display_name,email,password_hash) VALUES ('shop',?,?,?)", [name,email,await bcrypt.hash(crypto.randomBytes(24).toString("hex"),10)]);
          userId = user.insertId;
        }
        const [shop] = await conn.execute("INSERT INTO shops (user_id,name,category,description,contact_phone) VALUES (?,?,?,?,?)", [userId,name,category,description,phone]);
        shopId = shop.insertId;
      }
      for (const sessionId of sessions) {
        const [existingBooking] = await conn.execute("SELECT id FROM bookings WHERE session_id=? AND booth_id=? AND status IN ('pending','confirmed') LIMIT 1", [sessionId,boothId]);
        if (!existingBooking.length) {
          const ref = `DEMO-${code}-${String(sessionId)}`;
          await conn.execute("INSERT INTO bookings (booking_ref,session_id,booth_id,shop_id,status,price_at_booking,booked_at) VALUES (?,?,?,?,'confirmed',?,NOW())", [ref,sessionId,boothId,shopId,price]);
        }
      }
    }
    const [[parkingCount]] = await conn.execute("SELECT COUNT(*) AS total FROM parking_movements WHERE market_id=?", [marketId]);
    if (!Number(parkingCount.total)) {
      const traffic = [["กข 4821","รถกระบะ","เข้า","ประตูหลัก",-95],["งจ 7610","รถจักรยานยนต์","เข้า","ประตูตลาดเหนือ",-74],["เชียงใหม่ 3กท 915","รถยนต์","เข้า","ประตูหลัก",-52],["ขม 2084","รถจักรยานยนต์","ออก","ประตูตลาดเหนือ",-34],["ผผ 6342","รถยนต์","เข้า","ประตูหลัก",-18],["กท 519","รถจักรยานยนต์","เข้า","ประตูตลาดใต้",-7]];
      for (const [plate,type,movement,gate,minutes] of traffic) await conn.execute("INSERT INTO parking_movements (market_id,plate_number,vehicle_type,movement_type,gate_name,moved_at) VALUES (?,?,?,?,?,DATE_SUB(NOW(),INTERVAL ? MINUTE))", [marketId,plate,type,movement,gate,minutes]);
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

app.get("/api/health", route(async (_req, res) => { await database.query("SELECT 1"); respond(res, { status: "ok", database: "connected" }); }));
app.get("/api/v1/health", route(async (_req, res) => { await database.query("SELECT 1"); respond(res, { status: "ok", database: "connected" }); }));

app.post("/api/v1/auth/register", route(async (req, res) => {
  const displayName = value(req.body.displayName, 120, "displayName", true);
  const email = value(req.body.email, 254, "email")?.toLowerCase() || null;
  const phone = value(req.body.phone, 30, "phone") || null;
  const password = value(req.body.password, 200, "password", true);
  const shop = req.body.shop || {};
  const shopName = value(shop.name, 160, "shop.name", true);
  if (!email && !phone) throw new ApiError(400, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูลที่กรอก", { email: "กรอกอีเมลหรือเบอร์โทรศัพท์อย่างน้อยหนึ่งรายการ" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูลที่กรอก", { email: "รูปแบบอีเมลไม่ถูกต้อง" });
  if (password.length < 8) throw new ApiError(400, "VALIDATION_ERROR", "กรุณาตรวจสอบข้อมูลที่กรอก", { password: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
  const conn = await database.getConnection();
  try {
    await conn.beginTransaction();
    const [user] = await conn.execute("INSERT INTO users (role, display_name, email, phone, password_hash) VALUES ('shop', ?, ?, ?, ?)", [displayName, email, phone, await bcrypt.hash(password, 12)]);
    const [shopRow] = await conn.execute("INSERT INTO shops (user_id, name, category, description, contact_phone) VALUES (?, ?, ?, ?, ?)", [user.insertId, shopName, value(shop.category, 100, "shop.category"), value(shop.description, 5000, "shop.description"), value(shop.contactPhone, 30, "shop.contactPhone")]);
    await conn.commit();
    req.session.user = { id: String(user.insertId), role: "shop", shopId: String(shopRow.insertId) };
    respond(res, { user: { id: String(user.insertId), role: "shop", displayName, email, phone }, shop: { id: String(shopRow.insertId), name: shopName } }, 201);
  } catch (e) { await conn.rollback(); if (e.code === "ER_DUP_ENTRY") throw new ApiError(409, "ACCOUNT_EXISTS", "อีเมลหรือเบอร์โทรศัพท์นี้มีบัญชีแล้ว"); throw e; }
  finally { conn.release(); }
}));
app.post("/api/v1/auth/login", route(async (req, res) => {
  const identifier = value(req.body.identifier, 254, "identifier", true);
  const password = value(req.body.password, 200, "password", true);
  const [rows] = await database.execute("SELECT u.id,u.role,u.display_name,u.email,u.phone,u.password_hash,u.status,s.id AS shop_id,s.name AS shop_name FROM users u LEFT JOIN shops s ON s.user_id=u.id WHERE u.email=? OR u.phone=? LIMIT 1", [identifier.toLowerCase(), identifier]);
  const u = rows[0];
  if (!u || u.status !== "active" || !(await bcrypt.compare(password, u.password_hash))) throw new ApiError(401, "INVALID_CREDENTIALS", "อีเมล/เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง");
  if (u.role !== "shop" || !u.shop_id) throw new ApiError(403, "SHOP_ACCOUNT_REQUIRED", "บัญชีนี้ไม่สามารถใช้ส่วนร้านค้าได้");
  req.session.regenerate((e) => {
    if (e) return errorResponse(res, e);
    req.session.user = { id: String(u.id), role: u.role, shopId: String(u.shop_id) };
    respond(res, { user: { id: String(u.id), role: u.role, displayName: u.display_name, email: u.email, phone: u.phone }, shop: { id: String(u.shop_id), name: u.shop_name } });
  });
}));
app.post("/api/v1/auth/logout", requireShop, route(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy((e) => e ? reject(e) : resolve()));
  res.clearCookie("market.sid", { httpOnly: true, sameSite: "lax" }); res.status(204).end();
}));
app.get("/api/v1/auth/me", requireShop, route(async (req, res) => {
  const [rows] = await database.execute("SELECT u.id,u.role,u.display_name,u.email,u.phone,s.id AS shop_id,s.name AS shop_name FROM users u JOIN shops s ON s.user_id=u.id WHERE u.id=? AND u.status='active'", [req.session.user.id]);
  if (!rows[0]) throw new ApiError(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบใหม่");
  const u = rows[0]; respond(res, { user: { id: String(u.id), role: u.role, displayName: u.display_name, email: u.email, phone: u.phone }, shop: { id: String(u.shop_id), name: u.shop_name } });
}));

app.get("/api/v1/markets", route(async (req, res) => {
  const p = paging(req); const [[count]] = await database.query("SELECT COUNT(*) total FROM markets WHERE status='active'");
  const [rows] = await database.execute("SELECT id,name,slug,description,address,timezone FROM markets WHERE status='active' ORDER BY name LIMIT ? OFFSET ?", [p.limit,p.offset]);
  respond(res, rows, 200, { page:p.page, limit:p.limit, total:count.total });
}));
app.get("/api/v1/markets/:marketId/sessions", route(async (req, res) => {
  const p = paging(req); const status = value(req.query.status || "open", 20, "status", true);
  const [rows] = await database.execute("SELECT id,session_date AS sessionDate,starts_at AS startsAt,ends_at AS endsAt,booking_opens_at AS bookingOpensAt,booking_closes_at AS bookingClosesAt,status FROM market_sessions WHERE market_id=? AND status=? ORDER BY session_date LIMIT ? OFFSET ?", [req.params.marketId,status,p.limit,p.offset]);
  respond(res, rows, 200, { page:p.page, limit:p.limit });
}));
app.get("/api/v1/markets/:marketId/sessions/:sessionId/booths", requireShop, route(async (req, res) => {
  const p = paging(req); const zone = value(req.query.zone,80,"zone");
  const [sessions] = await database.execute("SELECT id FROM market_sessions WHERE id=? AND market_id=?", [req.params.sessionId,req.params.marketId]);
  if (!sessions.length) throw new ApiError(404,"SESSION_NOT_FOUND","ไม่พบรอบตลาด");
  const availability = req.query.availability === "available" ? "available" : "all";
  const [rows] = await database.execute(`SELECT b.id,b.booth_code AS boothCode,b.label,b.zone,b.map_x AS mapX,b.map_y AS mapY,b.width,b.height,b.price,b.status,CASE WHEN b.status<>'active' THEN 'inactive' WHEN bk.id IS NOT NULL THEN 'booked' ELSE 'available' END AS availability FROM booths b LEFT JOIN bookings bk ON bk.booth_id=b.id AND bk.session_id=? AND bk.status IN ('pending','confirmed') WHERE b.market_id=? AND (? IS NULL OR b.zone=?) AND (?='all' OR (b.status='active' AND bk.id IS NULL)) ORDER BY b.zone,b.booth_code LIMIT ? OFFSET ?`, [req.params.sessionId,req.params.marketId,zone,zone,availability,p.limit,p.offset]);
  respond(res, rows, 200, { page:p.page, limit:p.limit });
}));

app.post("/api/v1/bookings", requireShop, route(async (req,res) => {
  const sessionId=Number(req.body.sessionId), boothId=Number(req.body.boothId);
  if(!Number.isSafeInteger(sessionId)||!Number.isSafeInteger(boothId)) throw new ApiError(400,"VALIDATION_ERROR","กรุณาระบุรอบตลาดและแผงให้ถูกต้อง");
  const conn=await database.getConnection();
  try {
    await conn.beginTransaction();
    const [sessions]=await conn.execute("SELECT ms.*,m.name AS market_name FROM market_sessions ms JOIN markets m ON m.id=ms.market_id WHERE ms.id=? AND ms.status='open' FOR UPDATE",[sessionId]);
    if(!sessions.length) throw new ApiError(422,"SESSION_CLOSED","รอบตลาดนี้ไม่เปิดรับจอง");
    const s=sessions[0];
    const [booths]=await conn.execute("SELECT * FROM booths WHERE id=? AND market_id=? AND status='active' FOR UPDATE",[boothId,s.market_id]);
    if(!booths.length) throw new ApiError(422,"BOOTH_UNAVAILABLE","ไม่พบแผงหรือแผงนี้ไม่เปิดให้จอง");
    const [shops]=await conn.execute("SELECT id FROM shops WHERE id=? AND status='active'",[req.session.user.shopId]);
    if(!shops.length) throw new ApiError(403,"SHOP_INACTIVE","บัญชีร้านค้านี้ไม่พร้อมใช้งาน");
    const [existing]=await conn.execute("SELECT id FROM bookings WHERE session_id=? AND booth_id=? AND status IN ('pending','confirmed') FOR UPDATE",[sessionId,boothId]);
    if(existing.length) throw new ApiError(409,"BOOTH_UNAVAILABLE","แผงนี้ถูกจองแล้ว กรุณาเลือกแผงอื่น");
    const now=new Date().toISOString().slice(0,19).replace("T"," ");
    if((s.booking_opens_at&&now<s.booking_opens_at)||(s.booking_closes_at&&now>s.booking_closes_at)) throw new ApiError(422,"BOOKING_CLOSED","ขณะนี้อยู่นอกเวลารับจอง");
    const ref=`BK-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    await conn.execute("INSERT INTO bookings (booking_ref,session_id,booth_id,shop_id,status,price_at_booking,booked_at) VALUES (?,?,?,?,'confirmed',?,UTC_TIMESTAMP())",[ref,sessionId,boothId,req.session.user.shopId,booths[0].price]);
    await conn.commit();
    respond(res,{bookingRef:ref,status:"confirmed",price:String(booths[0].price),session:{id:String(sessionId),date:s.session_date,marketName:s.market_name},booth:{id:String(boothId),code:booths[0].booth_code}},201);
  } catch(e) { await conn.rollback(); if(e.code==="ER_DUP_ENTRY") throw new ApiError(409,"BOOTH_UNAVAILABLE","แผงนี้ถูกจองแล้ว กรุณาเลือกแผงอื่น"); throw e; }
  finally { conn.release(); }
}));

const bookingSql=`SELECT b.id,b.booking_ref AS bookingRef,b.status,b.price_at_booking AS price,b.booked_at AS bookedAt,ms.session_date AS sessionDate,m.name AS marketName,bo.booth_code AS boothCode,ms.booking_closes_at AS bookingClosesAt FROM bookings b JOIN market_sessions ms ON ms.id=b.session_id JOIN markets m ON m.id=ms.market_id JOIN booths bo ON bo.id=b.booth_id`;
app.get("/api/v1/bookings",requireShop,route(async(req,res)=>{
  const p=paging(req), where=["b.shop_id=?"], args=[req.session.user.shopId];
  const status=value(req.query.status,20,"status"); if(status){where.push("b.status=?");args.push(status);}
  if(req.query.period==="upcoming")where.push("ms.session_date>=CURDATE()"); if(req.query.period==="past")where.push("ms.session_date<CURDATE()");
  const [rows]=await database.execute(`${bookingSql} WHERE ${where.join(" AND ")} ORDER BY ms.session_date ${req.query.period==="past"?"DESC":"ASC"} LIMIT ? OFFSET ?`,[...args,p.limit,p.offset]); respond(res,rows,200,{page:p.page,limit:p.limit});
}));
app.get("/api/v1/bookings/:bookingRef",requireShop,route(async(req,res)=>{
  const [rows]=await database.execute(`${bookingSql} WHERE b.shop_id=? AND b.booking_ref=? LIMIT 1`,[req.session.user.shopId,req.params.bookingRef]); if(!rows.length)throw new ApiError(404,"BOOKING_NOT_FOUND","ไม่พบรายการจอง"); respond(res,rows[0]);
}));
app.post("/api/v1/bookings/:bookingRef/cancel",requireShop,route(async(req,res)=>{
  const conn=await database.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.execute(`${bookingSql} WHERE b.shop_id=? AND b.booking_ref=? FOR UPDATE`,[req.session.user.shopId,req.params.bookingRef]);const b=rows[0];if(!b)throw new ApiError(404,"BOOKING_NOT_FOUND","ไม่พบรายการจอง");if(b.status==="cancelled"){await conn.commit();return respond(res,b);}const now=new Date().toISOString().slice(0,19).replace("T"," ");if(!["pending","confirmed"].includes(b.status)||(b.bookingClosesAt&&now>=b.bookingClosesAt))throw new ApiError(422,"BOOKING_NOT_CANCELLABLE","ไม่สามารถยกเลิกรายการนี้ได้แล้ว");await conn.execute("UPDATE bookings SET status='cancelled',cancelled_at=UTC_TIMESTAMP() WHERE id=?",[b.id]);await conn.commit();respond(res,{...b,status:"cancelled"});}catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));
app.get("/api/v1/shop/dashboard",requireShop,route(async(req,res)=>{
  const [shops]=await database.execute("SELECT id,name,category,description,contact_phone AS contactPhone FROM shops WHERE id=?",[req.session.user.shopId]);
  const [rows]=await database.execute(`${bookingSql} WHERE b.shop_id=? ORDER BY ms.session_date ASC`,[req.session.user.shopId]);
  const upcoming=rows.find(r=>r.status!=="cancelled"&&r.sessionDate>=new Date().toISOString().slice(0,10))||null;respond(res,{shop:shops[0]||null,upcomingBooking:upcoming,recentBookings:rows.slice(0,5)});
}));
async function profile(shopId){const [rows]=await database.execute("SELECT u.id AS userId,u.display_name AS displayName,u.email,u.phone,s.id AS shopId,s.name,s.category,s.description,s.contact_phone AS contactPhone FROM users u JOIN shops s ON s.user_id=u.id WHERE s.id=?",[shopId]);return rows[0];}
app.get("/api/v1/shop/profile",requireShop,route(async(req,res)=>respond(res,await profile(req.session.user.shopId))));
app.patch("/api/v1/shop/profile",requireShop,route(async(req,res)=>{
  const u={},s={}; if(Object.hasOwn(req.body,"displayName"))u.display_name=value(req.body.displayName,120,"displayName",true);if(Object.hasOwn(req.body,"phone"))u.phone=value(req.body.phone,30,"phone");if(Object.hasOwn(req.body,"name"))s.name=value(req.body.name,160,"name",true);if(Object.hasOwn(req.body,"category"))s.category=value(req.body.category,100,"category");if(Object.hasOwn(req.body,"description"))s.description=value(req.body.description,5000,"description");if(Object.hasOwn(req.body,"contactPhone"))s.contact_phone=value(req.body.contactPhone,30,"contactPhone");if(!Object.keys(u).length&&!Object.keys(s).length)throw new ApiError(400,"VALIDATION_ERROR","ไม่มีข้อมูลที่ต้องการแก้ไข");
  const conn=await database.getConnection();try{await conn.beginTransaction();for(const [table,fields,id] of [["users",u,req.session.user.id],["shops",s,req.session.user.shopId]]){const keys=Object.keys(fields);if(keys.length)await conn.execute(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(",")} WHERE id=?`,[...Object.values(fields),id]);}await conn.commit();}catch(e){await conn.rollback();if(e.code==="ER_DUP_ENTRY")throw new ApiError(409,"CONTACT_EXISTS","เบอร์โทรศัพท์นี้ถูกใช้แล้ว");throw e;}finally{conn.release();}respond(res,await profile(req.session.user.shopId));
}));

app.get("/api/v1/public/markets/:slug",route(async(req,res)=>{const [rows]=await database.execute("SELECT id,name,slug,description,address,timezone FROM markets WHERE slug=? AND status='active' LIMIT 1",[req.params.slug]);if(!rows.length)throw new ApiError(404,"MARKET_NOT_FOUND","ไม่พบตลาดนี้");respond(res,rows[0]);}));
app.get("/api/v1/public/markets/:slug/sessions",route(async(req,res)=>{const [rows]=await database.execute("SELECT ms.id,ms.session_date AS sessionDate,ms.starts_at AS startsAt,ms.ends_at AS endsAt,ms.status FROM market_sessions ms JOIN markets m ON m.id=ms.market_id WHERE m.slug=? AND m.status='active' AND ms.status IN ('open','closed') ORDER BY ms.session_date DESC LIMIT 100",[req.params.slug]);respond(res,rows);}));
app.get("/api/v1/public/markets/:slug/sessions/:sessionId/map",route(async(req,res)=>{
  const [ss]=await database.execute("SELECT ms.id FROM market_sessions ms JOIN markets m ON m.id=ms.market_id WHERE m.slug=? AND m.status='active' AND ms.id=? AND ms.status IN ('open','closed')",[req.params.slug,req.params.sessionId]);if(!ss.length)throw new ApiError(404,"SESSION_NOT_FOUND","ไม่พบรอบตลาด");const p=paging(req),q=value(req.query.q,120,"q"),cat=value(req.query.category,100,"category"),search=q?`%${q}%`:null;
  const [rows]=await database.execute(`SELECT bo.id,bo.booth_code AS boothCode,bo.label,bo.zone,bo.map_x AS mapX,bo.map_y AS mapY,bo.width,bo.height,CASE WHEN bo.status<>'active' THEN 'inactive' WHEN bk.id IS NOT NULL THEN 'booked' ELSE 'available' END AS availability,CASE WHEN bk.id IS NULL THEN NULL ELSE JSON_OBJECT('id',s.id,'name',s.name,'category',s.category,'description',s.description,'contactPhone',s.contact_phone) END AS shop FROM booths bo LEFT JOIN bookings bk ON bk.booth_id=bo.id AND bk.session_id=? AND bk.status='confirmed' LEFT JOIN shops s ON s.id=bk.shop_id AND s.status='active' WHERE bo.market_id=(SELECT id FROM markets WHERE slug=? AND status='active') AND (? IS NULL OR s.name LIKE ? OR s.category LIKE ?) AND (? IS NULL OR s.category=?) ORDER BY bo.zone,bo.booth_code LIMIT ? OFFSET ?`,[req.params.sessionId,req.params.slug,search,search,search,cat,cat,p.limit,p.offset]);respond(res,rows,200,{page:p.page,limit:p.limit});
}));
app.get("/api/v1/public/markets/:slug/sessions/:sessionId/shops/:shopId",route(async(req,res)=>{const [rows]=await database.execute("SELECT s.id,s.name,s.category,s.description,s.contact_phone AS contactPhone,bo.booth_code AS boothCode,bo.label,bo.zone,bo.map_x AS mapX,bo.map_y AS mapY FROM markets m JOIN market_sessions ms ON ms.market_id=m.id JOIN bookings bk ON bk.session_id=ms.id AND bk.status='confirmed' JOIN shops s ON s.id=bk.shop_id AND s.status='active' JOIN booths bo ON bo.id=bk.booth_id WHERE m.slug=? AND m.status='active' AND ms.id=? AND s.id=? LIMIT 1",[req.params.slug,req.params.sessionId,req.params.shopId]);if(!rows.length)throw new ApiError(404,"SHOP_NOT_FOUND","ไม่พบร้านค้าในรอบตลาดนี้");respond(res,rows[0]);}));
app.get("/api/v1/public/markets/:slug/sessions/:sessionId/bookings",route(async(req,res)=>{const [rows]=await database.execute("SELECT bk.booking_ref AS bookingRef,bk.status,bk.booked_at AS bookedAt,bo.booth_code AS boothCode,bo.zone,s.name AS shopName,s.category FROM bookings bk JOIN market_sessions ms ON ms.id=bk.session_id JOIN markets m ON m.id=ms.market_id JOIN booths bo ON bo.id=bk.booth_id JOIN shops s ON s.id=bk.shop_id WHERE m.slug=? AND ms.id=? AND bk.status='confirmed' ORDER BY bo.booth_code",[req.params.slug,req.params.sessionId]);respond(res,rows);}));
app.get("/api/v1/public/markets/:slug/parking",route(async(req,res)=>{const [market]=await database.execute("SELECT id FROM markets WHERE slug=? AND status='active' LIMIT 1",[req.params.slug]);if(!market.length)throw new ApiError(404,"MARKET_NOT_FOUND","ไม่พบตลาดนี้");const [rows]=await database.execute("SELECT plate_number AS plateNumber,vehicle_type AS vehicleType,movement_type AS movementType,gate_name AS gateName,moved_at AS movedAt,note FROM parking_movements WHERE market_id=? AND moved_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR) ORDER BY moved_at DESC LIMIT 30",[market[0].id]);const [[summary]]=await database.execute("SELECT COUNT(*) AS movements,COUNT(DISTINCT CASE WHEN movement_type='เข้า' THEN plate_number END)-COUNT(DISTINCT CASE WHEN movement_type='ออก' THEN plate_number END) AS parkedNow FROM parking_movements WHERE market_id=? AND moved_at>=CURDATE()",[market[0].id]);respond(res,{movements:rows,summary});}));

app.use((err,_req,res,_next)=>errorResponse(res,err instanceof SyntaxError?new ApiError(400,"INVALID_JSON","รูปแบบ JSON ไม่ถูกต้อง"):err));
app.use("/api",(_req,res)=>errorResponse(res,new ApiError(404,"NOT_FOUND","ไม่พบ API ที่ร้องขอ")));
async function start(){await initializeSchema();await database.query("SELECT 1");app.listen(port,()=>console.log(`Server listening at http://localhost:${port}; MariaDB connected`));}
start().catch((e)=>{console.error("Unable to start server or initialize MariaDB schema:",e.message);process.exitCode=1;});
