# Step 12 — Users Management (Admin)

> 🎯 **Analogy:** RBAC คือ "ระบบ Badge สำนักงาน" — badge แต่ละสีเข้าได้คนละห้อง admin badge เข้าได้ทุกที่ รวมถึงห้อง server ที่ไม่ใช่ทุกคนเข้าได้

## Role-Based Access Control (RBAC)

ระบบมี 3 role แต่ละ role มีสิทธิ์ต่างกัน:

```
admin
  ├── ทำทุกอย่างที่ publisher ทำได้
  ├── ดูรายชื่อ user ทั้งหมด
  ├── เปลี่ยน role ของ user
  ├── ban / unban user
  └── แก้ไข/ลบอัลบั้มของ user คนอื่น

publisher
  ├── สร้าง / แก้ไข / ลบ อัลบั้มของตัวเอง
  └── เพิ่ม / แก้ไข / ลบ เพลงในอัลบั้มตัวเอง

user
  └── ดูข้อมูล albums, songs เท่านั้น
```

| Endpoint | admin | publisher | user |
|:---------|:-----:|:---------:|:----:|
| GET /api/albums | ✅ | ✅ | ✅ |
| POST /api/albums | ✅ | ✅ | ❌ |
| DELETE /api/albums/:id (เจ้าของ) | ✅ | ✅ | ❌ |
| DELETE /api/albums/:id (คนอื่น) | ✅ | ❌ | ❌ |
| GET /api/users | ✅ | ❌ | ❌ |
| PUT /api/users/:id/ban | ✅ | ❌ | ❌ |

## สร้างไฟล์ `routes/users.js`

```js
const express = require('express')
const router = express.Router()
const db = require('../config/database')
const { authenticate, adminOnly } = require('../middleware/auth')

function parseCursor(cursorStr) {
  try {
    const decoded = Buffer.from(cursorStr, 'base64').toString('utf-8')
    const parsed = JSON.parse(decoded)
    if (parsed && typeof parsed.id === 'number') return parsed
    return null
  } catch { return null }
}

function encodeCursor(id) {
  return Buffer.from(JSON.stringify({ id })).toString('base64')
}

function getLastParam(value) {
  if (Array.isArray(value)) return value[value.length - 1]
  return value
}

// ─── GET /users — รายชื่อ user ทั้งหมด ─────────────────────
router.get('/', authenticate, adminOnly, async (req, res) => {
  try {
    let limit = parseInt(getLastParam(req.query.limit)) || 10
    const cursorStr = getLastParam(req.query.cursor)

    let conditions = []
    let params = []

    if (cursorStr) {
      const cursor = parseCursor(cursorStr)
      if (cursor) {
        conditions.push('user_id > ?')
        params.push(cursor.id)
      }
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
    params.push(limit + 1)

    // ไม่ select password_hash — ไม่ควรส่งข้อมูลที่ไม่จำเป็นกลับไป
    const [rows] = await db.query(
      `SELECT user_id, username, email, role, is_banned, created_at
       FROM users ${whereClause} ORDER BY user_id ASC LIMIT ?`,
      params
    )

    let hasMore = false
    if (rows.length > limit) { hasMore = true; rows.pop() }

    // Reshape: id แทน user_id, is_banned integer → boolean
    const data = rows.map(u => ({
      id: u.user_id,
      username: u.username,
      email: u.email,
      role: u.role,
      is_banned: u.is_banned === 1 || u.is_banned === true,
      created_at: u.created_at,
    }))

    const meta = {}
    if (cursorStr) meta.prev_cursor = cursorStr  // cursor ที่ใช้ดึงหน้านี้
    if (hasMore && rows.length > 0) meta.next_cursor = encodeCursor(rows[rows.length - 1].user_id)

    return res.status(200).json({ success: true, data, meta })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})

// ─── PUT /users/:id — เปลี่ยน role ─────────────────────────
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const [users] = await db.query('SELECT * FROM users WHERE user_id = ?', [req.params.id])
    if (users.length === 0) return res.status(404).json({ error: 'User not found.' })

    const { role } = req.body
    if (!role || !['admin', 'publisher', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Valid role is required (admin, publisher, user).' })
    }

    await db.query('UPDATE users SET role = ? WHERE user_id = ?', [role, req.params.id])

    const [updated] = await db.query(
      'SELECT user_id, username, email, role, is_banned, created_at, updated_at FROM users WHERE user_id = ?',
      [req.params.id]
    )
    const u = updated[0]
    return res.status(200).json({
      success: true,
      data: {
        id: u.user_id,
        username: u.username,
        email: u.email,
        role: u.role,
        is_banned: u.is_banned === 1 || u.is_banned === true,
        created_at: u.created_at,
        updated_at: u.updated_at,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})

// ─── PUT /users/:id/ban — แบนผู้ใช้ ─────────────────────────
router.put('/:id/ban', authenticate, adminOnly, async (req, res) => {
  try {
    // ป้องกัน admin ban ตัวเอง
    if (req.user.user_id === parseInt(req.params.id)) {
      return res.status(400).json({ error: 'You cannot ban yourself.' })
    }

    const [users] = await db.query('SELECT * FROM users WHERE user_id = ?', [req.params.id])
    if (users.length === 0) return res.status(404).json({ error: 'User not found.' })

    if (users[0].is_banned) {
      return res.status(400).json({ error: 'User is already banned.' })
    }

    // ลบ token ด้วย — user จะถูกบังคับออกจากระบบทันที
    await db.query(
      'UPDATE users SET is_banned = 1, token = NULL WHERE user_id = ?',
      [req.params.id]
    )

    const [updated] = await db.query(
      'SELECT user_id, username, email, role, is_banned, updated_at FROM users WHERE user_id = ?',
      [req.params.id]
    )
    const u = updated[0]
    return res.status(200).json({
      success: true,
      data: {
        id: u.user_id,
        username: u.username,
        email: u.email,
        role: u.role,
        is_banned: u.is_banned === 1 || u.is_banned === true,
        updated_at: u.updated_at,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})

// ─── PUT /users/:id/unban — ปลดแบน ───────────────────────────
router.put('/:id/unban', authenticate, adminOnly, async (req, res) => {
  try {
    const [users] = await db.query('SELECT * FROM users WHERE user_id = ?', [req.params.id])
    if (users.length === 0) return res.status(404).json({ error: 'User not found.' })

    if (!users[0].is_banned) {
      return res.status(400).json({ error: 'User is not banned.' })
    }

    await db.query('UPDATE users SET is_banned = 0 WHERE user_id = ?', [req.params.id])

    const [updated] = await db.query(
      'SELECT user_id, username, email, role, is_banned, updated_at FROM users WHERE user_id = ?',
      [req.params.id]
    )
    const u = updated[0]
    return res.status(200).json({
      success: true,
      data: {
        id: u.user_id,
        username: u.username,
        email: u.email,
        role: u.role,
        is_banned: u.is_banned === 1 || u.is_banned === true,
        updated_at: u.updated_at,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})

module.exports = router
```

## ลงทะเบียนใน `app.js`

```js
const userRoutes = require('./routes/users')
app.use('/api/users', userRoutes)
```

::: details 📄 app.js ณ จุดนี้ (หลัง Step 12)
```js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const authRoutes = require('./routes/auth')
const albumRoutes = require('./routes/albums')
const songRoutes = require('./routes/songs')
const userRoutes = require('./routes/users')

const app = express()
const PORT = process.env.PORT || 3000

// ─── Middleware ───────────────────────────────────────────
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ─── Routes ───────────────────────────────────────────────
app.use('/api', authRoutes)
app.use('/api/albums', albumRoutes)
app.use('/api/songs', songRoutes)
app.use('/api/users', userRoutes)

// Health check (ต้องอยู่ก่อน app.use('/api', songRoutes))
app.get('/api', (_req, res) => {
  res.json({ message: 'Module C - Music Album RESTful API is running.' })
})

// Mount song routes สำหรับ /api/albums/:id/songs endpoints
app.use('/api', songRoutes)

// ─── Error Handling ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack)
  if (err.message && err.message.includes('Only image files')) {
    return res.status(400).json({ error: err.message })
  }
  res.status(500).json({ error: 'Internal server error.' })
})

// ─── Start Server ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
```
:::

## ทดสอบด้วย Postman

ทุก endpoint นี้ต้อง login ด้วย **admin** เท่านั้น

### GET รายชื่อ user ทั้งหมด

1. Login ด้วย `admin` / `adminpass` → ได้ token
2. `GET http://localhost:3000/api/users`
3. Headers: `X-Authorization: Bearer <admin_token>`

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": [
    { "id": 1, "username": "admin", "email": "admin@web.wsa", "role": "admin", "is_banned": false, "created_at": "2025-10-23T14:00:00.000Z" },
    { "id": 2, "username": "user1", "email": "user1@web.wsa", "role": "user", "is_banned": false, "created_at": "2025-10-23T14:30:00.000Z" },
    { "id": 3, "username": "user2", "email": "user2@web.wsa", "role": "user", "is_banned": false, "created_at": "2025-10-23T15:00:00.000Z" }
  ],
  "meta": {
    "next_cursor": "e2lkOiAzfQ=="
  }
}
```
:::

### เปลี่ยน Role

1. `PUT http://localhost:3000/api/users/2`
2. Headers: `X-Authorization: Bearer <admin_token>`
3. Body → JSON:
```json
{ "role": "publisher" }
```

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": {
    "id": 2,
    "username": "user1",
    "email": "user1@web.wsa",
    "role": "publisher",
    "is_banned": false,
    "created_at": "2025-10-23T14:30:00.000Z",
    "updated_at": "2025-10-23T16:20:00.000Z"
  }
}
```
:::

### Ban User

`PUT http://localhost:3000/api/users/2/ban` + token ของ admin

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": {
    "id": 2,
    "username": "user1",
    "email": "user1@web.wsa",
    "role": "user",
    "is_banned": true,
    "updated_at": "2025-10-23T16:21:00.000Z"
  }
}
```
user2 จะ logout ทันที token ถูกลบ — ลอง login อีกครั้งด้วย user2 → ได้ 403 Forbidden
:::

### Unban User

`PUT http://localhost:3000/api/users/2/unban` + token ของ admin

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": {
    "id": 2,
    "username": "user1",
    "email": "user1@web.wsa",
    "role": "user",
    "is_banned": false,
    "updated_at": "2025-10-23T16:22:00.000Z"
  }
}
```
:::

### ทดสอบ Self-ban

ลอง ban ตัวเอง: `PUT http://localhost:3000/api/users/<admin_id>/ban` ด้วย token ของ admin นั้น → ควรได้ **400 Bad Request**:
```json
{ "error": "You cannot ban yourself." }
```

### ทดสอบด้วย Non-admin

ลองใช้ token ของ user1 (role: user) เรียก `GET /api/users` → ควรได้ **403 Forbidden**

## Glossary

| คำศัพท์ | ความหมาย |
|:--------|:---------|
| **RBAC** | Role-Based Access Control — ควบคุมสิทธิ์ตาม role |
| **adminOnly** | Middleware ที่อนุญาตเฉพาะ role admin เท่านั้น |
| **Ban** | ระงับการใช้งาน account ชั่วคราว |
| **is_banned** | Column บอกสถานะการ ban (0 = ปกติ, 1 = ถูกแบน) |
| **Principle of Least Privilege** | ให้สิทธิ์เท่าที่จำเป็นเท่านั้น ไม่มากกว่านั้น |
