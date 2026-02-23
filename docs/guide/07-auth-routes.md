# Step 7 — Auth Routes (Login / Register)

> 🎯 **Analogy:** Token คือ "บัตรผ่านประตู" — Login เหมือนไปแลกบัตรที่เคาน์เตอร์ ทุกครั้งที่เข้าประตูต้องแตะบัตร ไม่ต้องพิมพ์รหัสใหม่ทุกครั้ง

## ระบบ Authentication ในโปรเจ็คนี้

```
1. User ส่ง username + password มา
2. Server ตรวจสอบกับ DB → ถ้าถูก → สร้าง Token (MD5 ของ username)
3. บันทึก token ลง DB → ส่ง token กลับให้ client
4. ทุก request ถัดไปที่ต้อง login → ส่ง token มาใน Header: X-Authorization
5. Server หา token ใน DB → เจอ = login อยู่ / ไม่เจอ = ไม่ได้ login
```

## รู้จัก HTTP Headers

**Headers** คือข้อมูลเพิ่มเติมที่ส่งไปพร้อม request/response เหมือน "ป้ายแปะบนซอง"

| Header | หน้าที่ | ตัวอย่าง |
|:-------|:-------|:--------|
| `Content-Type` | บอกรูปแบบ body | `application/json` |
| `X-Authorization` | ส่ง token ยืนยันตัวตน | `24c9e15e52af...` |

::: tip 💡 ทำไม `X-Authorization` ไม่ใช่ `Authorization`?
`Authorization` เป็น standard header ที่มักใช้กับ Bearer token แต่โปรเจ็คนี้ใช้ custom header `X-Authorization` ตามข้อกำหนดของ Module C (prefix `X-` หมายถึง custom header)
:::

## form-data กับ multer

Postman ส่งข้อมูล Login เป็น **form-data** (ไม่ใช่ JSON) — `express.json()` parse ไม่ได้ ต้องใช้ `multer` ช่วย

ติดตั้ง multer และ bcryptjs:

```bash
npm install multer bcryptjs
```

**multer** — รับ `multipart/form-data` (ใช้กับ form-data ใน Postman)
**bcryptjs** — Hash และ Verify password อย่างปลอดภัย

## Regular Expression (Regex) คืออะไร?

**Regex** คือ pattern สำหรับตรวจรูปแบบของ string — ใช้ใน Register เพื่อตรวจว่า email ถูกรูปแบบไหม

```js
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
emailRegex.test('user@example.com')   // → true  ✅
emailRegex.test('not-an-email')       // → false ❌
emailRegex.test('a@b')               // → false ❌
emailRegex.test('a b@c.com')         // → false ❌ (มีช่องว่าง)
```

**แกะ Pattern ทีละส่วน:**

```
/  ^  [^\s@]+  @  [^\s@]+  \.  [^\s@]+  $  /
   │  │       │  │         │   │         │
   │  │       │  │         │   │         └── ต้องจบที่นี่ (end of string)
   │  │       │  │         │   └──────────── [^\s@]+ = ตัวอักษรที่ไม่ใช่ space หรือ @
   │  │       │  │         └────────────── \. = จุด (.) จริงๆ (ต้อง escape)
   │  │       │  └──────────────────────── @ ตัวนี้เลย
   │  │       └─────────────────────────── [^\s@]+ = ชื่อ email (ก่อน @)
   │  └─────────────────────────────────── ต้องเริ่มจากนี้ (start of string)
   └────────────────────────────────────── เปิด regex (แทน / ... /)
```

**รู้จัก Syntax พื้นฐาน:**

| Symbol | ความหมาย | ตัวอย่าง |
|:-------|:---------|:--------|
| `^` | ต้องขึ้นต้นด้วย | `^abc` matches "abc..." |
| `$` | ต้องลงท้ายด้วย | `abc$` matches "...abc" |
| `+` | 1 ตัวขึ้นไป | `a+` matches "a", "aa", "aaa" |
| `*` | 0 ตัวขึ้นไป | `a*` matches "", "a", "aa" |
| `[...]` | ตัวอักษรในกลุ่มนี้ | `[aeiou]` matches สระ |
| `[^...]` | ตัวอักษรที่ **ไม่ใช่** กลุ่มนี้ | `[^0-9]` matches ไม่ใช่ตัวเลข |
| `\s` | whitespace (space, tab, newline) | `\s` matches " " |
| `\.` | จุด literal (`.` ปกติ = any char) | `\.` matches "." จริงๆ |
| `\d` | ตัวเลข 0-9 | `\d+` matches "123" |
| `\d{4}` | ตัวเลขพอดี 4 ตัว | matches "2024" |

**ใน Project นี้ Regex ถูกใช้ 2 ที่:**

```js
// 1. ตรวจ email format (routes/auth.js — Register)
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!emailRegex.test(email)) { ... }

// 2. ตรวจ year format (routes/albums.js — GET /albums?year=)
/^\d{4}$/.test('2023')           // → true  (ปี 4 หลัก)
/^\d{4}$/.test('20')             // → false
/^\d{4}$/.test('abc')            // → false
```

::: tip 💡 `.test()` vs `.match()`
- `.test(string)` → คืน `true/false` — ใช้เมื่อต้องการแค่รู้ว่าตรงหรือไม่
- `.match(regex)` เรียกบน string → คืน array ของส่วนที่ match หรือ `null`
:::

## bcrypt คืออะไร?

Password ต้องไม่เก็บแบบ plain text ในฐานข้อมูล — ถ้าข้อมูลหลุด ทุกคน password จะรู้ทันที

**bcrypt** คือ hashing algorithm ที่:
1. เพิ่ม **salt** (random string) เข้าไปก่อน hash — ทำให้ password เดียวกัน hash ได้ผลต่างกันทุกครั้ง
2. **ช้าโดยตั้งใจ** — ทำให้ brute force ทำได้ยาก (Salt rounds = 12 → hash ใช้เวลานิดหน่อย)

```js
const bcrypt = require('bcryptjs')

const password = 'hello123'
const hash = await bcrypt.hash(password, 12)      // → '$2a$12$...' (string ยาว)
const isMatch = await bcrypt.compare('hello123', hash)  // → true
const isFail  = await bcrypt.compare('wrong', hash)     // → false
```

---

## Express Router คืออะไร?

ถ้าใส่ทุก route ไว้ใน `app.js` ไฟล์เดียว จะยาวและจัดการยาก — **Router** คือ "mini-app" แยกไฟล์ที่รวม route ที่เกี่ยวข้องกันไว้ด้วยกัน

```js
// แทนที่จะเขียนใน app.js:
app.post('/api/login', ...)
app.post('/api/register', ...)
app.post('/api/logout', ...)

// แยกไปไว้ใน routes/auth.js ด้วย Router:
const router = express.Router()
router.post('/login', ...)      // path สัมพัทธ์ (ไม่มี /api)
router.post('/register', ...)
router.post('/logout', ...)

// แล้ว mount ใน app.js:
app.use('/api', router)         // /api + /login → /api/login
```

### โครงสร้าง Route

```
router.METHOD(PATH, [MIDDLEWARE...], HANDLER)
       │       │     │               │
       │       │     │               └─ async (req, res) => { ... }
       │       │     └─── authenticate, publisherOrAdmin ฯลฯ
       │       └──── '/login', '/:id', '/' ฯลฯ
       └──── .get(), .post(), .put(), .delete()
```

**ตัวอย่างทุกรูปแบบ path:**
```js
router.get('/', ...)             // /api/albums
router.get('/:id', ...)          // /api/albums/5  → req.params.id = "5"
router.get('/:id/songs', ...)    // /api/albums/5/songs
router.post('/', ...)            // POST /api/albums
```

### req และ res คืออะไร?

**`req` (Request)** — ข้อมูลที่ client ส่งมา:

| Property | มาจากไหน | ตัวอย่าง |
|:---------|:---------|:--------|
| `req.body` | Request body (ต้องผ่าน parser) | `{ username: 'admin' }` |
| `req.params` | URL parameters (`:id`) | `req.params.id = "5"` |
| `req.query` | Query string (`?key=val`) | `req.query.limit = "10"` |
| `req.headers` | HTTP Headers | `req.headers['x-authorization']` |
| `req.user` | แนบโดย authenticate middleware | `req.user.role = "admin"` |

**`res` (Response)** — สิ่งที่ส่งกลับให้ client:

| Method | ความหมาย | ตัวอย่าง |
|:-------|:---------|:--------|
| `res.status(n)` | กำหนด HTTP status code | `res.status(404)` |
| `res.json(obj)` | ส่ง JSON + ตั้ง Content-Type | `res.json({ success: true })` |
| `res.sendFile(path)` | ส่งไฟล์โดยตรง (รูปภาพ) | `res.sendFile('/uploads/img.jpg')` |

::: tip 💡 `return res.json()` ทำไมต้อง return?
```js
if (!username) {
  return res.status(400).json({ ... })  // ✅ return หยุด function ทันที
}
// ถ้าไม่ return → โค้ดด้านล่างยังทำงานต่อ → อาจส่ง response 2 ครั้ง → Error
```
:::

## สร้างไฟล์ `routes/auth.js`

สร้างโฟลเดอร์ `routes` แล้วสร้างไฟล์ `auth.js`

### 1. Imports + Setup

`multer().none()` — parse `multipart/form-data` ที่มีแค่ text fields ไม่มีไฟล์แนบ ทำให้ `req.body` มีข้อมูลจาก form-data ได้

`crypto` — built-in module ของ Node.js ไม่ต้อง `npm install` เพิ่ม ใช้สร้าง MD5 token

```js
const express = require('express')
const router = express.Router()
const crypto = require('crypto')    // built-in Node.js — ไม่ต้องติดตั้งเพิ่ม
const bcrypt = require('bcryptjs')
const multer = require('multer')
const db = require('../config/database')

// parse multipart/form-data ที่มีแค่ text fields (ไม่มีไฟล์)
const formData = multer().none()
```

---

### 2. POST /login

Flow การ Login มี 4 ขั้นตอน:
1. **Validate** — ตรวจว่า username + password ส่งมาครบ
2. **Find user** — หา user ใน DB ถ้าไม่เจอ → 400
3. **Verify password** — ใช้ `bcrypt.compare()` เทียบกับ hash ใน DB ไม่ตรง → 400
4. **Check ban** — ถ้าถูก ban → 403 แล้วสร้าง token + บันทึกลง DB

::: tip 💡 ทำไม error message ของ username ผิดและ password ผิดเป็นข้อความเดียวกัน?
ป้องกัน **User Enumeration** — ถ้าแยก error จะทำให้ attacker รู้ว่า username นั้นมีอยู่จริง
:::

```js
// ─── POST /login ──────────────────────────────────────────
router.post('/login', formData, async (req, res) => {
  try {
    const { username, password } = req.body

    // 1. ตรวจข้อมูลครบไหม
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Validation failed' })
    }

    // 2. หา user จาก DB
    const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username])
    if (users.length === 0) {
      return res.status(400).json({ success: false, message: 'Login failed' })
    }

    const user = users[0]

    // 3. เทียบ password กับ hash ใน DB
    const isMatch = await bcrypt.compare(password, user.password_hash)
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Login failed' })
    }

    // 4. เช็คว่าถูก ban ไหม (ตรวจหลัง password เพื่อป้องกัน timing attack)
    if (user.is_banned) {
      return res.status(403).json({ success: false, message: 'User is banned' })
    }

    // สร้าง token (MD5 ของ username) แล้วบันทึกลง DB
    const token = crypto.createHash('md5').update(username).digest('hex')
    await db.query('UPDATE users SET token = ? WHERE user_id = ?', [token, user.user_id])

    return res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user.user_id,
          username: user.username,
          email: user.email,
          role: user.role,
          created_at: user.created_at,
          updated_at: user.updated_at,
        }
      }
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})
```

---

### 3. POST /register

Flow การ Register:
1. **Validate** — ตรวจว่า username, email, password ส่งมาครบ
2. **Check duplicate** — เช็ค username และ email ว่าซ้ำใน DB ไหม → 409 Conflict
3. **Hash password** — `bcrypt.hash(password, 12)` ก่อน insert เสมอ — **ห้ามเก็บ plain text**
4. **Insert** — บันทึก user ใหม่ด้วย role เริ่มต้นเป็น `'user'`

```js
// ─── POST /register ───────────────────────────────────────
router.post('/register', formData, async (req, res) => {
  try {
    const { username, email, password } = req.body

    // 1. ตรวจข้อมูลครบไหม + ตรวจรูปแบบ email
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'Validation failed' })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Validation failed' })
    }

    // 2. เช็ค username ซ้ำ (แยก query เพื่อให้ error message ต่างกัน)
    const [byUsername] = await db.query('SELECT user_id FROM users WHERE username = ?', [username])
    if (byUsername.length > 0) {
      return res.status(409).json({ success: false, message: 'Username already taken' })
    }

    // 3. เช็ค email ซ้ำ
    const [byEmail] = await db.query('SELECT user_id FROM users WHERE email = ?', [email])
    if (byEmail.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already taken' })
    }

    // 4. hash password ก่อนบันทึกเสมอ
    const salt = await bcrypt.genSalt(12)
    const password_hash = await bcrypt.hash(password, salt)
    const [result] = await db.query(
      'INSERT INTO users (username, password_hash, email, role) VALUES (?, ?, ?, ?)',
      [username, password_hash, email, 'user']
    )

    const [newUser] = await db.query(
      'SELECT user_id, username, email, role, created_at, updated_at FROM users WHERE user_id = ?',
      [result.insertId]
    )

    const u = newUser[0]
    return res.status(201).json({
      success: true,
      data: {
        user: {
          id: u.user_id,
          username: u.username,
          email: u.email,
          role: u.role,
          created_at: u.created_at,
          updated_at: u.updated_at,
        }
      }
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})

module.exports = router
```

---

## ลงทะเบียน Route ใน `app.js`

เพิ่มใน `app.js` (หลัง middleware section):

```js
const authRoutes = require('./routes/auth')
app.use('/api', authRoutes)   // ทุก route ใน auth.js จะมี prefix /api
```

::: details 📄 app.js ณ จุดนี้ (หลัง Step 7)
```js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const authRoutes = require('./routes/auth')

const app = express()
const PORT = process.env.PORT || 3000

// ─── Middleware ───────────────────────────────────────────
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ─── Routes ───────────────────────────────────────────────
app.use('/api', authRoutes)

// ─── Start Server ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
```
:::

ตอนนี้มี endpoint: `POST /api/login` และ `POST /api/register`

---

## ทดสอบด้วย Postman

### ทดสอบ Login

1. Method: `POST` | URL: `http://localhost:3000/api/login`
2. แท็บ **Body** → เลือก **form-data**
3. เพิ่ม 2 rows:

| Key | Value |
|:----|:------|
| `username` | `user1` |
| `password` | `user1pass` |

4. กด **Send**

::: details ✅ ผลลัพธ์ที่ถูกต้อง (200 OK)
```json
{
  "success": true,
  "data": {
    "token": "24c9e15e52afc47c225b757e7bee1f9d",
    "user": {
      "id": 2,
      "username": "user1",
      "email": "user1@web.wsa",
      "role": "user",
      "created_at": "2025-11-13T01:41:32.000Z",
      "updated_at": "2025-11-13T01:56:28.000Z"
    }
  }
}
```
**จดจำ token ไว้!** ใช้ใน Step ถัดๆ ไปสำหรับ endpoint ที่ต้อง login
:::

### ทดสอบ Login ผิด password

เปลี่ยน password เป็น `wrongpass` → ควรได้ **400 Bad Request**:
```json
{ "success": false, "message": "Login failed" }
```

### ทดสอบ Register

1. Method: `POST` | URL: `http://localhost:3000/api/register`
2. Body → form-data:

| Key | Value |
|:----|:------|
| `username` | `user4` |
| `email` | `user4@web.com` |
| `password` | `user4pass` |

::: details ✅ ผลลัพธ์ที่ถูกต้อง (201 Created)
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 5,
      "username": "user4",
      "email": "user4@web.com",
      "role": "user",
      "created_at": "2025-11-20T10:00:00.000Z",
      "updated_at": "2025-11-20T10:00:00.000Z"
    }
  }
}
```
:::

กด Send ซ้ำอีกครั้งด้วยข้อมูลเดิม → ควรได้ **409 Conflict**:
```json
{ "success": false, "message": "Username already taken" }
```

---

## Glossary

| คำศัพท์ | ความหมาย |
|:--------|:---------|
| **Authentication** | การยืนยันตัวตน (ใครเป็นใคน) |
| **Token** | รหัสที่ใช้แทน session — เก็บฝั่ง client |
| **bcrypt** | Algorithm สำหรับ hash password อย่างปลอดภัย |
| **Salt** | ค่า random ที่เพิ่มเข้าไปก่อน hash เพื่อป้องกัน rainbow table |
| **SQL Injection** | การโจมตีโดยใส่ SQL code ใน input เพื่อแก้ไข query |
| **Parameterized Query** | ใช้ `?` แทน string concat เพื่อป้องกัน SQL Injection |
| **MD5** | Hash function ที่ใช้สร้าง token ในโปรเจ็คนี้ |
| **form-data** | รูปแบบการส่งข้อมูลที่รองรับทั้ง text และ file |
| **User Enumeration** | การโจมตีโดยทดสอบว่า username ไหนมีอยู่ในระบบ |
| **multer().none()** | parse form-data ที่มีแค่ text ไม่มีไฟล์แนบ |
| **Express Router** | Mini-app แยกไฟล์สำหรับรวม route ที่เกี่ยวข้องกัน |
| **req.params** | ค่าจาก URL parameter เช่น `/:id` → `req.params.id` |
| **req.query** | ค่าจาก query string เช่น `?limit=10` → `req.query.limit` |
| **Regex** | Regular Expression — pattern สำหรับตรวจรูปแบบ string |
| **`.test()`** | method ของ Regex คืน `true/false` ว่า string ตรง pattern ไหม |
