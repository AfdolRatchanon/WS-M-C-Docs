# Step 9 — Albums Routes (CRUD)

> 🎯 **Analogy:** CRUD คือ 4 การกระทำหลักกับข้อมูล — Create (สร้าง), Read (อ่าน), Update (แก้ไข), Delete (ลบ) เหมือนการจัดการไฟล์: สร้างไฟล์ใหม่, เปิดอ่าน, แก้ไข, ลบทิ้ง

## RESTful Convention สำหรับ Albums

| Method | Path | คำอธิบาย | Auth |
|:-------|:-----|:---------|:-----|
| `GET` | `/api/albums` | ดูรายการทั้งหมด | ไม่ต้อง |
| `GET` | `/api/albums/:id` | ดูรายละเอียด + เพลง | ไม่ต้อง |
| `GET` | `/api/albums/:id/songs` | ดูรายการเพลงในอัลบั้ม | ไม่ต้อง |
| `GET` | `/api/albums/:id/cover` | รูปปกอัลบั้ม (image file) | ไม่ต้อง |
| `POST` | `/api/albums` | สร้างอัลบั้มใหม่ | publisher/admin |
| `PUT` | `/api/albums/:id` | แก้ไขอัลบั้ม | เจ้าของ/admin |
| `DELETE` | `/api/albums/:id` | ลบอัลบั้ม | เจ้าของ/admin |

## Cursor Pagination คืออะไร?

เมื่อมีข้อมูลหลายพัน records การส่งทั้งหมดกลับครั้งเดียวช้ามาก — ต้องใช้ Pagination

**Cursor Pagination** ใช้ ID ล่าสุดของหน้าปัจจุบันเป็น "bookmark" แทนหมายเลขหน้า:

```
ครั้งที่ 1: GET /api/albums?limit=5
            → คืน 5 albums (id: 1-5) + next_cursor = "eyJpZCI6NX0="

ครั้งที่ 2: GET /api/albums?limit=5&cursor=eyJpZCI6NX0=
            → คืน 5 albums ถัดไป (id: 6-10) + next_cursor ใหม่
```

cursor คือ Base64 ของ `{"id": 5}` — ปลอดภัยกว่าส่ง ID ตรงๆ

---

## สร้างไฟล์ `routes/albums.js`

### 1. Imports + Helper Functions

Helper 2 ตัวช่วยจัดการ cursor:
- `parseCursor` — รับ Base64 string → แปลงกลับเป็น `{ id: N }`
- `encodeCursor` — รับ id → แปลงเป็น Base64 string สำหรับส่งกลับ client

```js
const express = require('express')
const router = express.Router()
const db = require('../config/database')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const { authenticate, publisherOrAdmin } = require('../middleware/auth')

const formData = multer().none()  // parse multipart/form-data ที่มีแค่ text fields

// แปลง cursor string (base64) → object { id }
function parseCursor(cursorStr) {
  try {
    const decoded = Buffer.from(cursorStr, 'base64').toString('utf-8')
    const parsed = JSON.parse(decoded)
    if (parsed && typeof parsed.id === 'number') return parsed
    return null
  } catch { return null }
}

// แปลง id → cursor string (base64)
function encodeCursor(id) {
  return Buffer.from(JSON.stringify({ id })).toString('base64')
}

// ป้องกัน query param ซ้ำ (เช่น ?limit=5&limit=10)
function getLastParam(value) {
  if (Array.isArray(value)) return value[value.length - 1]
  return value
}
```

---

### 2. GET /albums — รายการทั้งหมด

Route นี้รองรับ 4 query parameters:
- `limit` — จำนวน records ต่อหน้า (default 10)
- `cursor` — bookmark ของหน้าก่อนหน้า
- `year` — กรองตามปี เช่น `1980` หรือ `1980-2000`
- `capital` — กรองตามตัวอักษรแรกของชื่ออัลบั้ม เช่น `A`

**เทคนิค limit+1:** ดึง `limit+1` records — ถ้าได้กลับมาครบ `limit+1` แสดงว่ายังมีหน้าถัดไป แล้ว `pop()` record สุดท้ายออกก่อนส่งกลับ

**Response format** ตาม spec:
- `success: true`
- `data: [...]` — array ของ album แต่ละตัวมี nested `publisher` object
- `meta.prev_cursor` — cursor ของหน้าปัจจุบัน (ใช้ย้อนกลับ)
- `meta.next_cursor` — cursor สำหรับหน้าถัดไป

```js
// ─── GET /albums ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const limitRaw = getLastParam(req.query.limit)
    const cursorStr = getLastParam(req.query.cursor)
    const yearFilter = getLastParam(req.query.year)
    const capital = getLastParam(req.query.capital)

    // ตรวจ limit (1-100)
    if (limitRaw !== undefined) {
      const n = Number(limitRaw)
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return res.status(400).json({ success: false, message: 'Invalid parameter' })
      }
    }
    const limit = parseInt(limitRaw) || 10

    // ตรวจ cursor format
    if (cursorStr) {
      const cursor = parseCursor(cursorStr)
      if (!cursor) {
        return res.status(400).json({ success: false, message: 'Invalid cursor' })
      }
    }

    // ตรวจ year format (YYYY หรือ YYYY-YYYY)
    if (yearFilter) {
      if (yearFilter.includes('-')) {
        const parts = yearFilter.split('-')
        const [s, e] = parts.map(p => p.trim())
        if (!/^\d{4}$/.test(s) || !/^\d{4}$/.test(e) || parseInt(s) > parseInt(e)) {
          return res.status(400).json({ success: false, message: 'Invalid year format' })
        }
      } else {
        if (!/^\d{4}$/.test(yearFilter.trim())) {
          return res.status(400).json({ success: false, message: 'Invalid year format' })
        }
      }
    }

    let conditions = []
    let params = []

    // Cursor: ดึง records ที่มี album_id มากกว่า cursor
    if (cursorStr) {
      const cursor = parseCursor(cursorStr)
      if (cursor) {
        conditions.push('a.album_id > ?')
        params.push(cursor.id)
      }
    }

    // Year Filter: กรองตามปี รองรับ range เช่น "1980-2000"
    if (yearFilter) {
      if (yearFilter.includes('-')) {
        const [start, end] = yearFilter.split('-')
        conditions.push('a.release_year >= ? AND a.release_year <= ?')
        params.push(start.trim(), end.trim())
      } else {
        conditions.push('a.release_year = ?')
        params.push(yearFilter.trim())
      }
    }

    // Capital Filter: กรองอัลบั้มที่ชื่อขึ้นต้นด้วยตัวอักษรที่กำหนด
    if (capital) {
      conditions.push('a.title LIKE ?')
      params.push(`${capital}%`)
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    params.push(limit + 1) // ดึง limit+1 เพื่อรู้ว่ายังมีข้อมูลเพิ่มอีกไหม
    const [rows] = await db.query(`
      SELECT a.album_id, a.title, a.artist, a.release_year,
             u.user_id AS pub_id, u.username AS pub_username, u.email AS pub_email
      FROM albums a
      LEFT JOIN users u ON a.publisher_id = u.user_id
      ${whereClause}
      ORDER BY a.album_id ASC
      LIMIT ?
    `, params)

    let hasMore = false
    if (rows.length > limit) {
      hasMore = true
      rows.pop()
    }

    // Reshape: nested publisher object, id แทน album_id
    // ข้อมูล publisher มาจาก JOIN แต่ต้องรวมเป็น nested object ใน response
    const data = rows.map(a => ({
      id: a.album_id,
      title: a.title,
      artist: a.artist,
      release_year: a.release_year,
      publisher: {
        id: a.pub_id,        // alias จาก SELECT u.user_id AS pub_id
        username: a.pub_username,
        email: a.pub_email,
      },
    }))

    const meta = {}
    if (cursorStr) meta.prev_cursor = cursorStr
    if (hasMore && rows.length > 0) meta.next_cursor = encodeCursor(rows[rows.length - 1].album_id)

    return res.status(200).json({ success: true, data, meta })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})
```

::: tip 💡 Nested Object จาก SQL JOIN
ผลลัพธ์ JOIN ได้ตาราง "แบน" (flat) เช่น `pub_id`, `pub_username` — ต้อง reshape ให้เป็น nested object ด้วย JavaScript:

```js
// DB ให้มา (flat)
{ album_id: 1, title: "Morning Vibes", pub_id: 1, pub_username: "admin" }

// reshape เป็น nested object
{ id: 1, title: "Morning Vibes", publisher: { id: 1, username: "admin" } }
```
:::

---

### 3. GET /albums/:id — รายละเอียดอัลบั้ม

ดึงข้อมูลอัลบั้มพร้อม nested `publisher` object — **ไม่มี songs** (ใช้ `/albums/:id/songs` แทน)

SELECT เฉพาะ field ที่ต้องการตาม spec: `id`, `title`, `artist`, `release_year`, `genre`, `description`, `created_at`, `updated_at`, `publisher`

```js
// ─── GET /albums/:id ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.album_id, a.title, a.artist, a.release_year,
              a.genre, a.description, a.created_at, a.updated_at,
              u.user_id AS pub_id, u.username AS pub_username, u.email AS pub_email
       FROM albums a
       LEFT JOIN users u ON a.publisher_id = u.user_id
       WHERE a.album_id = ?`,
      [req.params.id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Not Found' })
    }

    const a = rows[0]
    const data = {
      id: a.album_id,
      title: a.title,
      artist: a.artist,
      release_year: a.release_year,
      genre: a.genre,
      description: a.description,
      created_at: a.created_at,
      updated_at: a.updated_at,
      publisher: {
        id: a.pub_id,
        username: a.pub_username,
        email: a.pub_email,
      },
    }

    return res.status(200).json({ success: true, data })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})
```

---

### 4. GET /albums/:id/songs — รายการเพลงในอัลบั้ม

Endpoint แยกต่างหากสำหรับดูเฉพาะเพลง — ไม่ดึง metadata ของอัลบั้ม เหมาะสำหรับ client ที่มีข้อมูลอัลบั้มอยู่แล้วและต้องการแค่รายการเพลง

**การ Reshape ข้อมูลตาม spec:**
- `song_id` → `id` (เปลี่ยนชื่อ field)
- `track_order` → `order`
- `is_cover` (0/1 integer) → boolean (`=== 1`)
- `GROUP_CONCAT(l.name)` string → array (`.split(',')`)
- `cover_image_url` — เพิ่มเฉพาะเมื่อเพลงมีรูปปก (`cover_image_path IS NOT NULL`)

```js
// ─── GET /albums/:id/songs ────────────────────────────────
router.get('/:id/songs', async (req, res) => {
  try {
    const [albums] = await db.query('SELECT * FROM albums WHERE album_id = ?', [req.params.id])
    if (albums.length === 0) return res.status(404).json({ success: false, message: 'Not Found' })

    const [songs] = await db.query(
      `SELECT s.song_id, s.album_id, s.title, s.duration_seconds,
              s.track_order, s.is_cover, s.cover_image_path,
              GROUP_CONCAT(l.name) AS labels
       FROM songs s
       LEFT JOIN song_labels sl ON s.song_id = sl.song_id
       LEFT JOIN labels l ON sl.label_id = l.label_id
       WHERE s.album_id = ? AND s.deleted_at IS NULL
       GROUP BY s.song_id ORDER BY s.track_order ASC`,
      [req.params.id]
    )

    const data = songs.map(s => {
      const item = {
        id: s.song_id,
        album_id: s.album_id,
        title: s.title,
        label: s.labels ? s.labels.split(',') : [],   // string → array
        duration_seconds: s.duration_seconds,
        order: s.track_order,
        is_cover: s.is_cover === 1 || s.is_cover === true,  // integer → boolean
      }
      if (s.cover_image_path) {
        item.cover_image_url = `/api/songs/${s.song_id}/cover`  // เพิ่มเฉพาะมีรูป
      }
      return item
    })

    return res.status(200).json({ success: true, data })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})
```

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 101,
      "album_id": 12,
      "title": "Come Together",
      "label": ["Rock", "Classic"],
      "duration_seconds": 259,
      "order": 1,
      "is_cover": false,
      "cover_image_url": "/api/songs/101/cover"
    },
    {
      "id": 102,
      "album_id": 12,
      "title": "Something",
      "label": [],
      "duration_seconds": 182,
      "order": 2,
      "is_cover": false
    }
  ]
}
```
เพลงที่ไม่มีรูปปกจะ**ไม่มี** field `cover_image_url` ใน response
:::

---

### 5. GET /albums/:id/cover — รูปปกอัลบั้ม

อัลบั้มในระบบนี้ไม่มี column `cover_image` โดยตรง — รูปปกเก็บอยู่ในตาราง `songs` (column `cover_image_path`)

Route นี้จึงดึงรูปจาก **เพลงแรก** ในอัลบั้มที่มีรูปแนบมา แล้วส่งไฟล์รูปกลับโดยตรงด้วย `res.sendFile()` (ไม่ใช่ JSON)

```js
// ─── GET /albums/:id/cover ────────────────────────────────
router.get('/:id/cover', async (req, res) => {
  try {
    const [albums] = await db.query('SELECT * FROM albums WHERE album_id = ?', [req.params.id])
    if (albums.length === 0) return res.status(404).json({ success: false, message: 'Not Found' })

    // ดึงรูปปกจากเพลงแรกในอัลบั้มที่มี cover_image_path
    const [songs] = await db.query(
      `SELECT cover_image_path FROM songs
       WHERE album_id = ? AND cover_image_path IS NOT NULL AND deleted_at IS NULL
       ORDER BY track_order ASC LIMIT 1`,
      [req.params.id]
    )
    if (songs.length === 0 || !songs[0].cover_image_path) {
      return res.status(404).json({ success: false, message: 'Cover Not Found' })
    }

    const imagePath = path.join(__dirname, '..', 'uploads', songs[0].cover_image_path)
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ success: false, message: 'Cover Not Found' })
    }
    return res.sendFile(imagePath)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})
```

---

### 6. POST /albums — สร้างอัลบั้มใหม่

ต้องการ `authenticate` + `publisherOrAdmin` — เฉพาะ publisher และ admin เท่านั้นที่สร้างได้

`req.user.user_id` มาจาก middleware `authenticate` (ดู Step 8) — ไม่ต้องรับ `publisher_id` จาก body ป้องกันการปลอม publisher

```js
// ─── POST /albums ─────────────────────────────────────────
// formData — parse multipart/form-data เพราะ Postman ส่งเป็น form-data
router.post('/', authenticate, publisherOrAdmin, formData, async (req, res) => {
  try {
    const { title, artist, release_year, genre, description } = req.body
    if (!title || !artist) {
      return res.status(400).json({ success: false, message: 'Validation failed' })
    }

    const [result] = await db.query(
      `INSERT INTO albums (publisher_id, title, artist, release_year, genre, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.user_id, title, artist, release_year || null, genre || null, description || null]
    )

    // JOIN users เพื่อดึง publisher info ใส่ใน response
    const [newAlbum] = await db.query(
      `SELECT a.album_id, a.title, a.artist, a.release_year, a.genre, a.description,
              a.created_at, a.updated_at,
              u.user_id AS pub_id, u.username AS pub_username, u.email AS pub_email
       FROM albums a
       LEFT JOIN users u ON a.publisher_id = u.user_id
       WHERE a.album_id = ?`,
      [result.insertId]
    )

    const a = newAlbum[0]
    return res.status(201).json({
      success: true,
      data: {
        id: a.album_id,
        title: a.title,
        artist: a.artist,
        release_year: a.release_year,
        genre: a.genre,
        description: a.description,
        publisher: {
          id: a.pub_id,
          username: a.pub_username,
          email: a.pub_email,
        },
        created_at: a.created_at,
        updated_at: a.updated_at,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})
```

---

### 7. PUT /albums/:id — แก้ไขอัลบั้ม

**Ownership Check:** ตรวจสอบว่า `publisher_id === req.user.user_id` หรือเป็น admin — ถ้าไม่ใช่ → 403

**Partial Update:** รับเฉพาะ field ที่ส่งมา ถ้าไม่ส่ง field ไหนก็ไม่แตะ field นั้น สร้าง SQL `SET` clause แบบ dynamic จาก object `updates`

```js
// ─── PUT /albums/:id ──────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const [albums] = await db.query('SELECT * FROM albums WHERE album_id = ?', [req.params.id])
    if (albums.length === 0) return res.status(404).json({ success: false, message: 'Not Found' })

    const album = albums[0]
    // เฉพาะเจ้าของหรือ admin เท่านั้น
    if (album.publisher_id !== req.user.user_id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    const { title, artist, release_year, genre, description } = req.body
    const updates = {}
    if (title !== undefined) updates.title = title
    if (artist !== undefined) updates.artist = artist
    if (release_year !== undefined) updates.release_year = release_year
    if (genre !== undefined) updates.genre = genre
    if (description !== undefined) updates.description = description

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'Validation failed' })
    }

    const setClauses = Object.keys(updates).map(key => `${key} = ?`).join(', ')
    const values = [...Object.values(updates), req.params.id]
    await db.query(`UPDATE albums SET ${setClauses} WHERE album_id = ?`, values)

    // JOIN users เพื่อดึง publisher info ใส่ใน response
    const [updated] = await db.query(
      `SELECT a.album_id, a.title, a.artist, a.release_year, a.genre, a.description,
              a.created_at, a.updated_at,
              u.user_id AS pub_id, u.username AS pub_username, u.email AS pub_email
       FROM albums a
       LEFT JOIN users u ON a.publisher_id = u.user_id
       WHERE a.album_id = ?`,
      [req.params.id]
    )

    const a = updated[0]
    return res.status(200).json({
      success: true,
      data: {
        id: a.album_id,
        title: a.title,
        artist: a.artist,
        release_year: a.release_year,
        genre: a.genre,
        description: a.description,
        publisher: {
          id: a.pub_id,
          username: a.pub_username,
          email: a.pub_email,
        },
        created_at: a.created_at,
        updated_at: a.updated_at,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})
```

---

### 8. DELETE /albums/:id — ลบอัลบั้ม

**ปัญหา Foreign Key Constraint:** ลบ `albums` ตรงๆ ไม่ได้ถ้ายังมีเพลงอ้างอิงอยู่ ต้องลบ related data ตามลำดับ:

```
song_labels      (อ้างอิง song_id)
   ↓
user_view_logs   (อ้างอิง song_id)
   ↓
songs            (อ้างอิง album_id)
   ↓
albums           ← ลบสุดท้าย
```

```js
// ─── DELETE /albums/:id ───────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const [albums] = await db.query('SELECT * FROM albums WHERE album_id = ?', [req.params.id])
    if (albums.length === 0) return res.status(404).json({ success: false, message: 'Not Found' })

    const album = albums[0]
    if (album.publisher_id !== req.user.user_id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    // ลบ related data ก่อน (Foreign Key constraint)
    const [songs] = await db.query('SELECT song_id FROM songs WHERE album_id = ?', [req.params.id])
    const songIds = songs.map(s => s.song_id)
    if (songIds.length > 0) {
      await db.query('DELETE FROM song_labels WHERE song_id IN (?)', [songIds])
      await db.query('DELETE FROM user_view_logs WHERE song_id IN (?)', [songIds])
      await db.query('DELETE FROM songs WHERE album_id = ?', [req.params.id])
    }
    await db.query('DELETE FROM albums WHERE album_id = ?', [req.params.id])

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})

module.exports = router
```

---

## ลงทะเบียนใน `app.js`

```js
const albumRoutes = require('./routes/albums')
app.use('/api/albums', albumRoutes)
```

::: details 📄 app.js ณ จุดนี้ (หลัง Step 9)
```js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const authRoutes = require('./routes/auth')
const albumRoutes = require('./routes/albums')

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

// ─── Start Server ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
```
:::

---

## ทดสอบด้วย Postman

### GET รายการอัลบั้ม

`GET http://localhost:3000/api/albums`

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Morning Vibes",
      "artist": "The Beatles",
      "release_year": 1969,
      "publisher": { "id": 1, "username": "admin", "email": "admin@web.wsa" }
    },
    ...
  ],
  "meta": {
    "next_cursor": "eyJpZCI6MTB9"
  }
}
```
:::

### GET กรองตามตัวอักษร + ปี

`GET http://localhost:3000/api/albums?capital=A&year=1960-1980`

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 11,
      "title": "A Night at the Opera",
      "artist": "Queen",
      "release_year": 1975,
      "publisher": { "id": 1, "username": "user1", "email": "user1@web.wsa" }
    }
  ],
  "meta": {}
}
```
:::

### POST สร้างอัลบั้มใหม่

Login ด้วย `admin` (role: admin) ก่อน → ได้ token

1. Method: `POST` | URL: `http://localhost:3000/api/albums`
2. Headers: `X-Authorization: Bearer <admin_token>`
3. Body → **form-data**:

| Key | Value |
|:----|:------|
| `title` | `My New Album` |
| `artist` | `Test Artist` |
| `release_year` | `2024` |
| `genre` | `Pop` |

::: details ✅ ผลลัพธ์ (201 Created)
```json
{
  "success": true,
  "data": {
    "id": 12,
    "title": "My New Album",
    "artist": "Test Artist",
    "release_year": 2024,
    "genre": "Pop",
    "description": null,
    "publisher": { "id": 1, "username": "admin", "email": "admin@web.wsa" },
    "created_at": "2025-10-23T16:00:00.000Z",
    "updated_at": "2025-10-23T16:00:00.000Z"
  }
}
```
:::

### DELETE โดยไม่ใช่เจ้าของ

ลองลบอัลบั้มที่ user1 ไม่ได้สร้าง → ควรได้ **403 Forbidden**

---

## Glossary

| คำศัพท์ | ความหมาย |
|:--------|:---------|
| **CRUD** | Create, Read, Update, Delete — 4 การกระทำหลักกับข้อมูล |
| **Cursor Pagination** | แบ่งหน้าข้อมูลโดยใช้ ID ล่าสุดเป็น bookmark |
| **Base64** | การเข้ารหัสข้อมูลเป็น string ที่ส่งผ่าน URL ได้ปลอดภัย |
| **LEFT JOIN** | ดึงข้อมูลจากหลายตาราง ถ้าไม่มีคู่ → ใช้ NULL |
| **GROUP_CONCAT** | MySQL function รวม values หลายแถวเป็น string เดียว (เช่น labels) |
| **Partial Update** | อัปเดตเฉพาะ field ที่ส่งมา field อื่นไม่เปลี่ยน |
| **Foreign Key Constraint** | ข้อจำกัดที่ป้องกันการลบข้อมูลที่มีตารางอื่นอ้างอิงอยู่ |
| **res.sendFile()** | ส่งไฟล์ (รูป, PDF ฯลฯ) กลับ client แทนที่จะส่ง JSON |
