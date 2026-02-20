# Step 8 — Auth Middleware + Logout

> 🎯 **Analogy:** Middleware `authenticate` คือ "รปภ. ประตูห้อง" — ทุกคนที่จะเข้าต้องแสดงบัตร ถ้าไม่มีบัตร หรือบัตรหมดอายุ → กลับไป ไม่ได้เข้า

## ทำไมต้องมี Auth Middleware?

Route หลายอันต้องการให้ user login ก่อน เช่น สร้างอัลบั้ม, ลบเพลง, จัดการ user

ถ้าเขียนโค้ดตรวจ token ในทุก route handler จะซ้ำซ้อนมาก:

```js
// ❌ ซ้ำในทุก route — ยุ่งยาก บำรุงรักษาลำบาก
router.post('/albums', async (req, res) => {
  const token = req.headers['x-authorization']
  if (!token) return res.status(401).json({ error: '...' })
  const [users] = await db.query('SELECT * FROM users WHERE token = ?', [token])
  if (users.length === 0) return res.status(401).json({ error: '...' })
  // โค้ดจริงๆ...
})
```

**Middleware** แก้ปัญหานี้ — เขียนครั้งเดียว ใช้ได้ทุก route:

```js
// ✅ เขียนครั้งเดียว ใส่หน้า route handler ที่ต้องการ
router.post('/albums', authenticate, async (req, res) => {
  // ถึงตรงนี้ได้ = login แล้ว req.user มีข้อมูล user แน่นอน
})
```

## สร้างไฟล์ `middleware/auth.js`

สร้างโฟลเดอร์ `middleware` แล้วสร้าง `auth.js`:

```js
const db = require('../config/database')

// ─── authenticate — ตรวจว่า login อยู่ไหม ──────────────────
const authenticate = async (req, res, next) => {
  // อ่าน token จาก Header X-Authorization
  // รองรับทั้ง "Bearer <token>" และ "<token>" ตรงๆ
  const raw = req.headers['x-authorization']
  const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw

  // ไม่มี token → 401
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Token is required.' })
  }

  try {
    // ค้นหา user ที่มี token นี้ใน DB
    const [users] = await db.query('SELECT * FROM users WHERE token = ?', [token])

    // ไม่เจอ → token ผิดหรือหมดอายุ
    if (users.length === 0) {
      return res.status(401).json({ error: 'Unauthorized. Invalid token.' })
    }

    const user = users[0]

    // ถูก ban → 403 Forbidden
    if (user.is_banned) {
      return res.status(403).json({ error: 'Your account has been banned.' })
    }

    // ผ่านหมด! แนบข้อมูล user ไว้ใน req.user ให้ route ถัดไปใช้ได้
    req.user = user
    next()  // ← ส่งต่อให้ middleware/route ถัดไป
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' })
  }
}

// ─── adminOnly — ตรวจว่าเป็น admin ────────────────────────
const adminOnly = (req, res, next) => {
  // req.user มาจาก authenticate middleware ที่ต้องรันก่อน
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' })
  }
  next()
}

// ─── publisherOrAdmin — ตรวจว่าเป็น publisher หรือ admin ──
const publisherOrAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== 'publisher' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Forbidden. Publisher or admin access required.' })
  }
  next()
}

module.exports = { authenticate, adminOnly, publisherOrAdmin }
```

**คำอธิบายสำคัญ:**

`next()` — ฟังก์ชัน Express ที่บอกว่า "ด่านนี้ผ่านแล้ว ไปต่อ" ถ้าไม่เรียก `next()` request จะค้างอยู่ตรงนั้น client ไม่ได้รับ response

`req.user = user` — แนบข้อมูล user เข้าไปใน request object เพื่อให้ route handler ถัดไปใช้ `req.user.user_id`, `req.user.role` ได้ทันที

## วิธีใช้ Middleware ร่วมกัน

```js
// ตรวจ token ก่อน แล้วตรวจ role
router.post('/albums', authenticate, publisherOrAdmin, async (req, res) => {
  // req.user พร้อมใช้
  const userId = req.user.user_id
})

// ลำดับ middleware สำคัญมาก!
// authenticate → publisherOrAdmin (ต้องรัน authenticate ก่อนเสมอ)
```

## เพิ่ม Logout ใน `routes/auth.js`

ตอนนี้มี `authenticate` แล้ว กลับไปเพิ่ม logout:

เปิด `routes/auth.js` แล้วเพิ่ม:

```js
const { authenticate } = require('../middleware/auth')  // เพิ่มบรรทัดนี้บนสุด

// ─── POST /logout ─────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  try {
    // ลบ token ออกจาก DB → token เดิมใช้ไม่ได้อีก
    await db.query('UPDATE users SET token = NULL WHERE user_id = ?', [req.user.user_id])
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})
```

## ทดสอบด้วย Postman

### ทดสอบ Logout

1. Login ด้วย `user1` / `user1pass` ก่อน → จด token
2. Method: `POST` | URL: `http://localhost:3000/api/logout`
3. แท็บ **Headers** → เพิ่ม:

| Key | Value |
|:----|:------|
| `X-Authorization` | `Bearer 24c9e15e52afc47c225b757e7bee1f9d` (token จาก login) |

4. กด **Send**

::: details ✅ ผลลัพธ์ที่ถูกต้อง (200 OK)
```json
{ "success": true }
```
:::

### ทดสอบ Logout ไม่มี Token

ลอง logout โดยไม่ส่ง Header → ควรได้ **401 Unauthorized**:
```json
{ "error": "Unauthorized. Token is required." }
```

### ทดสอบ Logout ด้วย Token ผิด

ส่ง Header `X-Authorization: wrongtoken` → ควรได้ **401 Unauthorized**

## Glossary

| คำศัพท์ | ความหมาย |
|:--------|:---------|
| **Middleware chain** | ลำดับ middleware ที่ทำงานต่อกัน |
| **next()** | ฟังก์ชันที่ส่งต่อ request ไปยัง middleware ถัดไป |
| **req.user** | ข้อมูล user ที่แนบเข้า request โดย authenticate middleware |
| **Authorization** | การตรวจสอบว่ามีสิทธิ์ทำสิ่งนั้นไหม (ต่างจาก Authentication) |
| **RBAC** | Role-Based Access Control — ควบคุมสิทธิ์ตาม role |
| **403 Forbidden** | Login แล้วแต่ไม่มีสิทธิ์ (ต่างจาก 401 ที่ยังไม่ login) |
