# Step 11 — Songs Routes

> 🎯 **Analogy:** Songs เป็น "nested resource" ภายใต้ Albums — เหมือนไฟล์ในโฟลเดอร์ ลบโฟลเดอร์ไม่ได้แค่กด Delete ธรรมดา ต้องจัดการไฟล์ข้างในด้วย

## Nested Resources ใน REST

เพลงอยู่ภายใต้อัลบั้ม path จึงสะท้อนความสัมพันธ์นี้:

```
POST   /api/albums/:albumId/songs              → เพิ่มเพลงในอัลบั้ม
POST   /api/albums/:albumId/songs/:songId      → แก้ไขเพลง
PUT    /api/albums/:albumId/songs/order        → จัดลำดับเพลง
DELETE /api/albums/:albumId/songs/:songId      → ลบเพลง (Soft Delete)
GET    /api/songs                              → รายการเพลงทั้งหมด
GET    /api/songs/:id                          → รายละเอียดเพลง + บันทึก view
GET    /api/songs/:id/cover                    → รูปปกเพลง (image file)
```

## Soft Delete คืออะไร?

**Hard Delete** — ลบออกจาก DB จริงๆ ข้อมูลหายไปถาวร

**Soft Delete** — ไม่ลบจริง แค่บันทึกเวลาลบใน `deleted_at` column แล้วกรองออกจาก query ด้วย `WHERE deleted_at IS NULL`

```
ทำไมต้องใช้ Soft Delete?
- กู้คืนข้อมูลได้ถ้าลบผิด
- เก็บประวัติการใช้งาน
- ป้องกัน Foreign Key error (user_view_logs ยังอ้างอิง song อยู่)
```

---

## สร้างไฟล์ `routes/songs.js`

### 1. Imports + Helper Function (syncLabels)

`syncLabels` — helper สำหรับจัดการ labels ของเพลง: ลบ labels เดิมทั้งหมดออก แล้ว insert ใหม่ตาม comma-separated string ที่รับมา (เช่น `"Pop,Rock"`) ทำให้ update labels ง่ายโดยไม่ต้อง diff เอง

```js
const express = require('express')
const router = express.Router()
const db = require('../config/database')
const path = require('path')
const fs = require('fs')
const upload = require('../middleware/upload')        // สร้างใน Step 10
const { authenticate, publisherOrAdmin } = require('../middleware/auth')

// ─── Helper: sync labels ───────────────────────────────────
// ลบ labels เดิม แล้วเพิ่มใหม่ตาม labelString (comma-separated)
async function syncLabels(songId, labelString) {
  await db.query('DELETE FROM song_labels WHERE song_id = ?', [songId])
  if (!labelString) return

  const labelNames = labelString.split(',').map(l => l.trim()).filter(l => l)
  for (const name of labelNames) {
    const [labels] = await db.query('SELECT label_id FROM labels WHERE name = ?', [name])
    if (labels.length > 0) {
      await db.query(
        'INSERT INTO song_labels (song_id, label_id) VALUES (?, ?)',
        [songId, labels[0].label_id]
      )
    }
  }
}
```

---

### 2. GET /songs — รายการทั้งหมด + Search

รองรับ `limit`, `cursor` (Cursor Pagination แบบเดียวกับ albums) และ `keyword` สำหรับค้นหาใน `title`

::: tip 💡 `filter[keyword]` คืออะไร?
Spec กำหนดให้ส่ง keyword ในรูป `?filter[keyword]=love` — Express (qs parser) จะ parse เป็น `req.query.filter.keyword` อัตโนมัติ
code รองรับทั้ง 2 รูปแบบ: `?keyword=love` และ `?filter[keyword]=love`
:::

**Response format ตาม spec:**
- `{ success: true, data, meta }` — มี `prev_cursor` และ `next_cursor` ใน `meta`
- แต่ละ song: `id`, `album_id`, `title`, `label` (array), `duration_seconds`, `album_title`, `cover_image_url` (เฉพาะมีรูป)

```js
// ─── GET /songs ───────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let limit = parseInt(getLastParam(req.query.limit)) || 10
    const cursorStr = getLastParam(req.query.cursor)
    // รองรับทั้ง ?keyword=love และ ?filter[keyword]=love
    const keyword = getLastParam(req.query.keyword) || req.query.filter?.keyword

    let conditions = ['s.deleted_at IS NULL']  // กรอง soft-deleted ออกเสมอ
    let params = []

    if (cursorStr) {
      const cursor = parseCursor(cursorStr)
      if (cursor) {
        conditions.push('s.song_id > ?')
        params.push(cursor.id)
      }
    }

    if (keyword) {
      conditions.push('s.title LIKE ?')
      params.push(`%${keyword}%`)
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ')
    params.push(limit + 1)

    const [rows] = await db.query(
      `SELECT s.song_id, s.album_id, s.title, s.duration_seconds, s.cover_image_path,
              a.title AS album_title,
              GROUP_CONCAT(l.name) AS labels
       FROM songs s
       LEFT JOIN albums a ON s.album_id = a.album_id
       LEFT JOIN song_labels sl ON s.song_id = sl.song_id
       LEFT JOIN labels l ON sl.label_id = l.label_id
       ${whereClause}
       GROUP BY s.song_id ORDER BY s.song_id ASC LIMIT ?`,
      params
    )

    let hasMore = false
    if (rows.length > limit) { hasMore = true; rows.pop() }

    const data = rows.map(s => {
      const item = {
        id: s.song_id,
        album_id: s.album_id,
        title: s.title,
        label: s.labels ? s.labels.split(',') : [],
        duration_seconds: s.duration_seconds,
        album_title: s.album_title,
      }
      if (s.cover_image_path) {
        item.cover_image_url = `/api/songs/${s.song_id}/cover`
      }
      return item
    })

    const meta = {}
    if (cursorStr) meta.prev_cursor = cursorStr
    if (hasMore && rows.length > 0) meta.next_cursor = encodeCursor(rows[rows.length - 1].song_id)

    return res.status(200).json({ success: true, data, meta })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})
```

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 102,
      "album_id": 12,
      "title": "Something",
      "label": ["Rock"],
      "duration_seconds": 182,
      "album_title": "Abbey Road",
      "cover_image_url": "/api/songs/102/cover"
    }
  ],
  "meta": {
    "next_cursor": "eyJpZCI6MTAyfQ=="
  }
}
```
:::

---

### 3. GET /songs/:id — รายละเอียด + บันทึก View

Route นี้ทำ 2 อย่างในคราวเดียว: ดึงข้อมูลเพลง และ **บันทึก view log** ถ้า request มี token

การบันทึก view เป็นแบบ "ถ้ามีก็บันทึก ถ้าไม่มีก็ข้าม" — ไม่บังคับ login เพื่อดูข้อมูล แต่ถ้า login อยู่จะบันทึกประวัติการดูใน `user_view_logs`

::: tip 💡 ลำดับสำคัญ: Log view ก่อน แล้วค่อย SELECT
บันทึก view log **ก่อน** query ข้อมูล เพื่อให้ `view_count` ใน response รวม view ปัจจุบันด้วย
:::

**Response ตาม spec** — SELECT เฉพาะ field ที่ต้องการ + Correlated Subquery นับ `view_count`:
```sql
(SELECT COUNT(*) FROM user_view_logs WHERE song_id = s.song_id) AS view_count
```

```js
// ─── GET /songs/:id ───────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    // บันทึก view ก่อน SELECT (เพื่อให้ view_count รวม view นี้ด้วย)
    const raw = req.headers['x-authorization']
    const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw
    if (token) {
      const [users] = await db.query('SELECT user_id FROM users WHERE token = ?', [token])
      if (users.length > 0) {
        await db.query(
          'INSERT INTO user_view_logs (user_id, song_id) VALUES (?, ?)',
          [users[0].user_id, req.params.id]
        )
      }
    }

    const [songs] = await db.query(
      `SELECT s.song_id, s.album_id, s.title, s.duration_seconds,
              s.track_order, s.is_cover, s.cover_image_path, s.lyrics,
              s.created_at, s.updated_at,
              GROUP_CONCAT(l.name) AS labels,
              (SELECT COUNT(*) FROM user_view_logs WHERE song_id = s.song_id) AS view_count
       FROM songs s
       LEFT JOIN song_labels sl ON s.song_id = sl.song_id
       LEFT JOIN labels l ON sl.label_id = l.label_id
       WHERE s.song_id = ? AND s.deleted_at IS NULL
       GROUP BY s.song_id`,
      [req.params.id]
    )
    if (songs.length === 0) return res.status(404).json({ error: 'Song not found.' })

    const s = songs[0]
    const data = {
      id: s.song_id,
      album_id: s.album_id,
      title: s.title,
      duration_seconds: s.duration_seconds,
      order: s.track_order,
      label: s.labels ? s.labels.split(',') : [],
      view_count: s.view_count,
      is_cover: s.is_cover === 1 || s.is_cover === true,
      lyrics: s.lyrics,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }
    if (s.cover_image_path) {
      data.cover_image_url = `/api/songs/${s.song_id}/cover`
    }

    return res.status(200).json({ success: true, data })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})
```

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": {
    "id": 101,
    "album_id": 12,
    "title": "Come Together",
    "duration_seconds": 259,
    "order": 1,
    "label": ["Rock", "Classic"],
    "view_count": 5,
    "is_cover": false,
    "lyrics": "Here come old flat top...",
    "cover_image_url": "/api/songs/101/cover",
    "created_at": "2025-10-20T10:01:00.000Z",
    "updated_at": "2025-10-20T10:01:00.000Z"
  }
}
```
:::

---

### 4. GET /songs/:id/cover — รูปปกเพลง

ดึง `cover_image_path` จาก DB แล้วส่งไฟล์รูปกลับโดยตรงด้วย `res.sendFile()` — ไม่ใช่ JSON

```js
// ─── GET /songs/:id/cover ─────────────────────────────────
router.get('/:id/cover', async (req, res) => {
  try {
    const [songs] = await db.query(
      'SELECT cover_image_path FROM songs WHERE song_id = ? AND deleted_at IS NULL',
      [req.params.id]
    )
    if (songs.length === 0) return res.status(404).json({ error: 'Song not found.' })
    if (!songs[0].cover_image_path) {
      return res.status(404).json({ error: 'No cover image for this song.' })
    }

    const imagePath = path.join(__dirname, '..', 'uploads', songs[0].cover_image_path)
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Cover image file not found.' })
    }
    return res.sendFile(imagePath)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})
```

---

### 5. POST /albums/:albumId/songs — เพิ่มเพลง

Body ส่งเป็น **form-data** (ไม่ใช่ JSON) เพราะรองรับการแนบไฟล์รูป `cover_image`

`track_order` คำนวณอัตโนมัติจาก `MAX(track_order) + 1` — ไม่ต้องส่งมา

```js
// ─── POST /albums/:albumId/songs — เพิ่มเพลง ─────────────
router.post('/albums/:albumId/songs', authenticate, publisherOrAdmin,
  upload.single('cover_image'),  // รับไฟล์รูป (optional)
  async (req, res) => {
    try {
      const { albumId } = req.params
      const [albums] = await db.query('SELECT * FROM albums WHERE album_id = ?', [albumId])
      if (albums.length === 0) return res.status(404).json({ error: 'Album not found.' })

      const { title, duration_seconds, lyrics, label, is_cover } = req.body
      if (!title) return res.status(400).json({ error: 'Title is required.' })

      // กำหนด track_order อัตโนมัติ (ต่อจาก track ล่าสุด)
      const [maxOrder] = await db.query(
        'SELECT COALESCE(MAX(track_order), 0) AS max_order FROM songs WHERE album_id = ? AND deleted_at IS NULL',
        [albumId]
      )
      const trackOrder = maxOrder[0].max_order + 1

      const coverImagePath = req.file ? req.file.filename : null
      const isCoverValue = (is_cover === 'true' || is_cover === '1') ? 1 : 0

      const [result] = await db.query(
        `INSERT INTO songs (album_id, title, duration_seconds, cover_image_path, is_cover, lyrics, track_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [albumId, title, duration_seconds || null, coverImagePath, isCoverValue, lyrics || null, trackOrder]
      )

      if (label) await syncLabels(result.insertId, label)

      const [newSong] = await db.query(
        `SELECT s.song_id, s.album_id, s.title, s.duration_seconds,
                s.track_order, s.is_cover, s.cover_image_path, s.lyrics,
                s.created_at, s.updated_at,
                GROUP_CONCAT(l.name) AS labels
         FROM songs s
         LEFT JOIN song_labels sl ON s.song_id = sl.song_id
         LEFT JOIN labels l ON sl.label_id = l.label_id
         WHERE s.song_id = ? GROUP BY s.song_id`,
        [result.insertId]
      )
      const s = newSong[0]
      const data = {
        id: s.song_id,
        album_id: s.album_id,
        title: s.title,
        duration_seconds: s.duration_seconds,
        lyrics: s.lyrics,
        order: s.track_order,
        view_count: 0,                                          // เพลงใหม่ ยังไม่มี view
        label: s.labels ? s.labels.split(',') : [],
        is_cover: s.is_cover === 1 || s.is_cover === true,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }
      if (s.cover_image_path) {
        data.cover_image_url = `/api/songs/${s.song_id}/cover`
      }
      return res.status(201).json({ success: true, data })
    } catch (err) {
      console.error(err)
      return res.status(500).json({ error: 'Internal server error.' })
    }
  }
)
```

---

### 6. POST /albums/:albumId/songs/:songId — แก้ไขเพลง

ใช้ `POST` แทน `PUT` เพราะรองรับ `multipart/form-data` (แนบรูปได้) — HTTP spec อนุญาตให้ใช้ `POST` สำหรับ update ในกรณีนี้

ถ้ามีการส่งรูปใหม่มา จะ **ลบไฟล์รูปเก่าออกจาก server ก่อน** แล้วค่อยบันทึกรูปใหม่

```js
// ─── POST /albums/:albumId/songs/:songId — แก้ไขเพลง ─────
router.post('/albums/:albumId/songs/:songId', authenticate, publisherOrAdmin,
  upload.single('cover_image'),
  async (req, res) => {
    try {
      const { albumId, songId } = req.params
      const [songs] = await db.query(
        'SELECT * FROM songs WHERE song_id = ? AND album_id = ? AND deleted_at IS NULL',
        [songId, albumId]
      )
      if (songs.length === 0) return res.status(404).json({ error: 'Song not found in this album.' })

      const { title, duration_seconds, lyrics, label, is_cover } = req.body
      const updates = {}
      if (title !== undefined) updates.title = title
      if (duration_seconds !== undefined) updates.duration_seconds = duration_seconds
      if (lyrics !== undefined) updates.lyrics = lyrics
      if (is_cover !== undefined) updates.is_cover = (is_cover === 'true' || is_cover === '1') ? 1 : 0

      if (req.file) {
        // ลบรูปเก่าก่อนบันทึกรูปใหม่
        if (songs[0].cover_image_path) {
          const oldPath = path.join(__dirname, '..', 'uploads', songs[0].cover_image_path)
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
        }
        updates.cover_image_path = req.file.filename
      }

      if (Object.keys(updates).length > 0) {
        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ')
        await db.query(`UPDATE songs SET ${setClauses} WHERE song_id = ?`,
          [...Object.values(updates), songId])
      }

      if (label !== undefined) await syncLabels(songId, label)

      const [updated] = await db.query(
        `SELECT s.song_id, s.album_id, s.title, s.duration_seconds,
                s.track_order, s.is_cover, s.cover_image_path, s.lyrics,
                s.created_at, s.updated_at,
                GROUP_CONCAT(l.name) AS labels,
                (SELECT COUNT(*) FROM user_view_logs WHERE song_id = s.song_id) AS view_count
         FROM songs s LEFT JOIN song_labels sl ON s.song_id = sl.song_id
         LEFT JOIN labels l ON sl.label_id = l.label_id
         WHERE s.song_id = ? GROUP BY s.song_id`,
        [songId]
      )
      const s = updated[0]
      const data = {
        id: s.song_id,
        album_id: s.album_id,
        title: s.title,
        duration_seconds: s.duration_seconds,
        lyrics: s.lyrics,
        order: s.track_order,
        view_count: s.view_count,                               // ดึงจาก DB จริง (ไม่ใช่ 0)
        label: s.labels ? s.labels.split(',') : [],
        is_cover: s.is_cover === 1 || s.is_cover === true,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }
      if (s.cover_image_path) {
        data.cover_image_url = `/api/songs/${s.song_id}/cover`
      }
      return res.status(200).json({ success: true, data })
    } catch (err) {
      console.error(err)
      return res.status(500).json({ error: 'Internal server error.' })
    }
  }
)
```

---

### 7. PUT /albums/:albumId/songs/order — จัดลำดับเพลง

รับ `song_ids` เป็น array เรียงตามลำดับที่ต้องการ แล้ว loop อัปเดต `track_order` ตาม index

```json
{ "song_ids": [3, 1, 2] }
```

หมายความว่า: song 3 เป็น track 1, song 1 เป็น track 2, song 2 เป็น track 3

```js
// ─── PUT /albums/:albumId/songs/order — จัดลำดับเพลง ──────
router.put('/albums/:albumId/songs/order', authenticate, publisherOrAdmin, async (req, res) => {
  try {
    const { albumId } = req.params
    const [albums] = await db.query('SELECT * FROM albums WHERE album_id = ?', [albumId])
    if (albums.length === 0) return res.status(404).json({ error: 'Album not found.' })

    const { song_ids } = req.body
    if (!song_ids || !Array.isArray(song_ids)) {
      return res.status(400).json({ error: 'song_ids array is required.' })
    }

    // อัปเดต track_order ตามลำดับใน array
    for (let i = 0; i < song_ids.length; i++) {
      await db.query(
        'UPDATE songs SET track_order = ? WHERE song_id = ? AND album_id = ?',
        [i + 1, song_ids[i], albumId]
      )
    }
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})
```

---

### 8. DELETE /albums/:albumId/songs/:songId — Soft Delete

ไม่ลบจริง — แค่ `UPDATE songs SET deleted_at = NOW()` เพลงยังอยู่ใน DB แต่ทุก query จะกรองออกด้วย `deleted_at IS NULL`

```js
// ─── DELETE /albums/:albumId/songs/:songId — Soft Delete ──
router.delete('/albums/:albumId/songs/:songId', authenticate, publisherOrAdmin, async (req, res) => {
  try {
    const { albumId, songId } = req.params
    const [songs] = await db.query(
      'SELECT * FROM songs WHERE song_id = ? AND album_id = ? AND deleted_at IS NULL',
      [songId, albumId]
    )
    if (songs.length === 0) return res.status(404).json({ error: 'Song not found in this album.' })

    // Soft Delete: บันทึกเวลาลบ ไม่ลบจริง
    await db.query('UPDATE songs SET deleted_at = NOW() WHERE song_id = ?', [songId])
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error.' })
  }
})

module.exports = router
```

---

## ลงทะเบียนใน `app.js`

```js
const songRoutes = require('./routes/songs')

app.use('/api/songs', songRoutes)   // สำหรับ GET /api/songs, GET /api/songs/:id
app.use('/api', songRoutes)         // สำหรับ /api/albums/:id/songs endpoints
```

::: warning ⚠️ ลำดับการ Mount สำคัญ
`app.get('/api', handler)` ต้องอยู่ **ก่อน** `app.use('/api', songRoutes)` เสมอ เพื่อไม่ให้ song router ดักจับ request ของ health check
:::

::: details 📄 app.js ณ จุดนี้ (หลัง Step 11)
```js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const authRoutes = require('./routes/auth')
const albumRoutes = require('./routes/albums')
const songRoutes = require('./routes/songs')

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

// Health check (ต้องอยู่ก่อน app.use('/api', songRoutes))
app.get('/api', (_req, res) => {
  res.json({ message: 'Module C - Music Album RESTful API is running.' })
})

// Mount song routes สำหรับ /api/albums/:id/songs endpoints
app.use('/api', songRoutes)

// ─── Error Handling (จาก Step 10) ─────────────────────────
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

---

## ทดสอบด้วย Postman

### GET รายการเพลง พร้อม Search

`GET http://localhost:3000/api/songs?filter[keyword]=night`

หรือใช้รูปแบบเดิมก็ได้: `GET http://localhost:3000/api/songs?keyword=night`

::: details ✅ ผลลัพธ์
```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "album_id": 1,
      "title": "Midnight Flow",
      "label": ["Jazz"],
      "duration_seconds": 210,
      "album_title": "Morning Vibes",
      "cover_image_url": "/api/songs/3/cover"
    }
  ],
  "meta": {}
}
```
:::

### POST เพิ่มเพลงในอัลบั้ม

1. Login ด้วย admin → ได้ token
2. `POST http://localhost:3000/api/albums/1/songs`
3. Headers: `X-Authorization: Bearer <admin_token>`
4. Body → **form-data**:

| Key | Value |
|:----|:------|
| `title` | `New Song` |
| `duration_seconds` | `180` |
| `lyrics` | `La la la...` |
| `label` | `Pop,Rock` |

::: details ✅ ผลลัพธ์ (201 Created)
```json
{
  "success": true,
  "data": {
    "id": 301,
    "album_id": 1,
    "title": "New Song",
    "duration_seconds": 180,
    "lyrics": "La la la...",
    "order": 3,
    "view_count": 0,
    "label": ["Pop", "Rock"],
    "is_cover": false,
    "created_at": "2025-10-23T16:10:00.000Z",
    "updated_at": "2025-10-23T16:10:00.000Z"
  }
}
```
:::

### POST แก้ไขเพลง

`POST http://localhost:3000/api/albums/1/songs/301`
Headers: `X-Authorization: Bearer <admin_token>`
Body → **form-data**:

| Key | Value |
|:----|:------|
| `title` | `New Song (Remix)` |
| `label` | `Pop,Rock,Remix` |

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": {
    "id": 301,
    "album_id": 1,
    "title": "New Song (Remix)",
    "duration_seconds": 180,
    "lyrics": "La la la...",
    "order": 3,
    "view_count": 2,
    "label": ["Pop", "Rock", "Remix"],
    "is_cover": false,
    "created_at": "2025-10-23T16:10:00.000Z",
    "updated_at": "2025-10-23T16:15:00.000Z"
  }
}
```
:::

### PUT จัดลำดับเพลง

`PUT http://localhost:3000/api/albums/1/songs/order`
Headers: `X-Authorization: Bearer <admin_token>`
Body → **JSON**:

```json
{ "song_ids": [301, 302, 303] }
```

::: details ✅ ผลลัพธ์ (200 OK)
```json
{ "success": true }
```
song 301 → track 1, song 302 → track 2, song 303 → track 3
:::

### DELETE เพลง (Soft Delete)

`DELETE http://localhost:3000/api/albums/1/songs/301`
Headers: `X-Authorization: Bearer <admin_token>`

::: details ✅ ผลลัพธ์ (200 OK)
```json
{ "success": true }
```
เพลงยังอยู่ใน DB แต่ `deleted_at` มีค่า → ไม่แสดงใน GET อีกต่อไป
:::

---

## Glossary

| คำศัพท์ | ความหมาย |
|:--------|:---------|
| **Soft Delete** | ทำเครื่องหมายว่าลบแล้ว แต่ข้อมูลยังอยู่ใน DB |
| **Nested Resource** | Resource ที่อยู่ภายใต้ resource อื่น เช่น songs ภายใต้ albums |
| **track_order** | ลำดับของเพลงในอัลบั้ม |
| **COALESCE** | MySQL function คืนค่าแรกที่ไม่ใช่ NULL |
| **GROUP_CONCAT** | รวม multiple rows เป็น comma-separated string |
| **syncLabels** | ฟังก์ชัน helper ลบ labels เดิมแล้วเพิ่มใหม่ |
| **fs.unlinkSync** | ลบไฟล์ออกจาก disk โดยตรง (synchronous) |
