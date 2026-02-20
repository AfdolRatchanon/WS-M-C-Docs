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
