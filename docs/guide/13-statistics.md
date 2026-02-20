# Step 13 — Statistics

> 🎯 **Analogy:** Statistics endpoint คือ "แดชบอร์ด" ของร้านเพลง — ดูได้ว่าเพลงไหนถูกดูมากสุด album ไหนยอดนิยม label ไหนมีคนฟังเยอะ — ข้อมูลทั้งหมดจัดอันดับตาม view count

## Aggregate Functions ใน SQL 

Statistics ทำได้โดยใช้ **Aggregate Functions** ของ MySQL:

| Function | ความหมาย | ตัวอย่าง |
|:---------|:---------|:--------|
| `COUNT(*)` | นับจำนวนแถว | นับ view logs ของแต่ละเพลง |
| `SUM(...)` | รวมค่า | รวม view count ของทุกเพลงใน album |
| `GROUP BY` | จัดกลุ่มแถวตาม column | จัดกลุ่มตาม song_id |
| `ORDER BY ... DESC` | เรียงมากไปน้อย | เรียง view count จากมากสุด |
| `COALESCE(val, 0)` | แทน NULL ด้วยค่า default | ถ้า album ไม่มีเพลง ให้ total = 0 |

## 3 Metrics ที่รองรับ

| metrics | คำอธิบาย | เรียงตาม |
|:--------|:---------|:--------|
| `song` | รายการเพลงทั้งหมด พร้อม view_count | view_count DESC |
| `album` | รายการ album พร้อม total_view_count | total_view_count DESC |
| `label` | แต่ละ label พร้อมเพลงใน label + total_view_count | total_view_count DESC |

::: tip Optional Filter สำหรับ metrics=song และ metrics=label
ส่ง query parameter `?labels=<ชื่อ label>` เพื่อกรองเฉพาะ label นั้น
- `GET /api/statistics?metrics=song&labels=Pop`
- `GET /api/statistics?metrics=label&labels=Rock`
:::

## Helper Function: `reshapeSong`

ทั้ง `metrics=song` และ `metrics=label` ต้องการข้อมูลเพลงในรูปแบบเดียวกัน จึงสร้าง helper ขึ้นมาใช้ร่วมกัน:

```js
function reshapeSong(s) {
  const item = {
    id: s.song_id,
    album_id: s.album_id,
    title: s.title,
    duration_seconds: s.duration_seconds,
    order: s.track_order,
    label: s.labels ? s.labels.split(',') : [],  // string → array
    view_count: Number(s.view_count) || 0,
    is_cover: s.is_cover === 1 || s.is_cover === true,  // int → boolean
    lyrics: s.lyrics,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
  if (s.cover_image_path) {
    item.cover_image_url = `/api/songs/${s.song_id}/cover`;
  }
  return item;
}
```

**ทำไมต้อง reshape:**
- `labels` จาก `GROUP_CONCAT` ได้เป็น string เช่น `"Pop,Rock"` → ต้องแยกเป็น `["Pop", "Rock"]`
- `is_cover` ใน DB เก็บเป็น `0/1` → ต้องแปลงเป็น `false/true`
- `view_count` อาจเป็น string จาก DB → แปลงด้วย `Number()`
- `cover_image_url` เพิ่มเฉพาะเมื่อมีไฟล์ภาพจริง

## สร้างไฟล์ `routes/statistics.js`

```js
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Helper: reshape song row → spec format (shared by song + label metrics)
function reshapeSong(s) {
  const item = {
    id: s.song_id,
    album_id: s.album_id,
    title: s.title,
    duration_seconds: s.duration_seconds,
    order: s.track_order,
    label: s.labels ? s.labels.split(',') : [],
    view_count: Number(s.view_count) || 0,
    is_cover: s.is_cover === 1 || s.is_cover === true,
    lyrics: s.lyrics,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
  if (s.cover_image_path) {
    item.cover_image_url = `/api/songs/${s.song_id}/cover`;
  }
  return item;
}

// GET /statistics?metrics=song|album|label&labels=<optional>
router.get('/', async (req, res) => {
  try {
    const metrics = req.query.metrics;
    const labelsFilter = req.query.labels; // optional: filter by label name

    if (!metrics || !['song', 'album', 'label'].includes(metrics)) {
      return res.status(400).json({ success: false, message: 'Validation failed' });
    }

    let data;

    // ─── metrics=song ───────────────────────────────────────
    if (metrics === 'song') {
      let conditions = ['s.deleted_at IS NULL'];
      let params = [];

      if (labelsFilter) {
        conditions.push(
          `s.song_id IN (
             SELECT sl2.song_id FROM song_labels sl2
             JOIN labels l2 ON sl2.label_id = l2.label_id
             WHERE l2.name = ?
           )`
        );
        params.push(labelsFilter);
      }

      const whereClause = 'WHERE ' + conditions.join(' AND ');
      const [rows] = await db.query(
        `SELECT s.song_id, s.album_id, s.title, s.duration_seconds,
                s.track_order, s.is_cover, s.cover_image_path, s.lyrics,
                s.created_at, s.updated_at,
                GROUP_CONCAT(DISTINCT l.name) AS labels,
                (SELECT COUNT(*) FROM user_view_logs WHERE song_id = s.song_id) AS view_count
         FROM songs s
         LEFT JOIN song_labels sl ON s.song_id = sl.song_id
         LEFT JOIN labels l ON sl.label_id = l.label_id
         ${whereClause}
         GROUP BY s.song_id
         ORDER BY view_count DESC`,
        params
      );

      data = rows.map(reshapeSong);
    }

    // ─── metrics=album ──────────────────────────────────────
    else if (metrics === 'album') {
      const [rows] = await db.query(
        `SELECT a.album_id, a.title, a.artist, a.release_year, a.genre, a.description,
                a.created_at, a.updated_at,
                u.user_id AS pub_id, u.username AS pub_username, u.email AS pub_email,
                COALESCE(SUM(vc.vc), 0) AS total_view_count
         FROM albums a
         LEFT JOIN users u ON a.publisher_id = u.user_id
         LEFT JOIN songs s ON a.album_id = s.album_id AND s.deleted_at IS NULL
         LEFT JOIN (
           SELECT song_id, COUNT(*) AS vc
           FROM user_view_logs
           GROUP BY song_id
         ) vc ON s.song_id = vc.song_id
         GROUP BY a.album_id
         ORDER BY total_view_count DESC`
      );

      data = rows.map(a => ({
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
        total_view_count: Number(a.total_view_count),
      }));
    }

    // ─── metrics=label ──────────────────────────────────────
    else if (metrics === 'label') {
      let labelQuery = 'SELECT label_id, name FROM labels';
      let labelParams = [];
      if (labelsFilter) {
        labelQuery += ' WHERE name = ?';
        labelParams.push(labelsFilter);
      }
      const [labels] = await db.query(labelQuery, labelParams);

      data = [];
      for (const label of labels) {
        const [songs] = await db.query(
          `SELECT s.song_id, s.album_id, s.title, s.duration_seconds,
                  s.track_order, s.is_cover, s.cover_image_path, s.lyrics,
                  s.created_at, s.updated_at,
                  (SELECT COUNT(*) FROM user_view_logs WHERE song_id = s.song_id) AS view_count,
                  (SELECT GROUP_CONCAT(l2.name)
                   FROM song_labels sl2 JOIN labels l2 ON sl2.label_id = l2.label_id
                   WHERE sl2.song_id = s.song_id) AS labels
           FROM songs s
           JOIN song_labels sl ON s.song_id = sl.song_id
           WHERE sl.label_id = ? AND s.deleted_at IS NULL
           ORDER BY view_count DESC`,
          [label.label_id]
        );

        const total_view_count = songs.reduce((sum, s) => sum + Number(s.view_count), 0);
        data.push({
          total_view_count,
          label: label.name,
          songs: songs.map(reshapeSong),
        });
      }
      // Sort labels by total_view_count DESC
      data.sort((a, b) => b.total_view_count - a.total_view_count);
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
```

## ลงทะเบียนใน `app.js`

```js
const statisticsRoutes = require('./routes/statistics')
app.use('/api/statistics', statisticsRoutes)
```

## ทำความเข้าใจ Query แต่ละ Metrics

### metrics=song — Correlated Subquery สำหรับ view_count

```sql
SELECT s.song_id, ...,
       (SELECT COUNT(*) FROM user_view_logs WHERE song_id = s.song_id) AS view_count
FROM songs s
...
ORDER BY view_count DESC
```

`(SELECT COUNT(*) ...)` คือ **Correlated Subquery** — รันแยกทุกแถว นับ view log ของแต่ละเพลงแล้วใส่เป็น column

### metrics=album — Derived Table สำหรับ total_view_count

```sql
LEFT JOIN (
  SELECT song_id, COUNT(*) AS vc
  FROM user_view_logs
  GROUP BY song_id
) vc ON s.song_id = vc.song_id
```

`COALESCE(SUM(vc.vc), 0)` — รวม view ของทุกเพลงใน album ถ้า album ไม่มีเพลงเลย → ได้ `0` แทน `NULL`

publisher ถูก JOIN มาจาก users table แล้ว nest ใน response เป็น object:

```js
publisher: {
  id: a.pub_id,
  username: a.pub_username,
  email: a.pub_email,
}
```

### metrics=label — N+1 Pattern

```js
for (const label of labels) {
  const [songs] = await db.query('... WHERE sl.label_id = ?', [label.label_id])
  const total_view_count = songs.reduce((sum, s) => sum + Number(s.view_count), 0)
  data.push({ total_view_count, label: label.name, songs: songs.map(reshapeSong) })
}
data.sort((a, b) => b.total_view_count - a.total_view_count)
```

Loop ผ่านแต่ละ label แล้ว query เพลงแยก → สะสมเป็น array → คำนวณ `total_view_count` ด้วย `reduce` → sort ท้ายสุด

## ทดสอบด้วย Postman

### Statistics by Song (All Songs ranked by views)

`GET http://localhost:3000/api/statistics?metrics=song`

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "album_id": 1,
      "title": "Midnight Rain",
      "duration_seconds": 210,
      "order": 3,
      "label": ["Pop", "Chill"],
      "view_count": 5,
      "is_cover": false,
      "lyrics": null,
      "created_at": "2025-01-10T09:00:00.000Z",
      "updated_at": "2025-01-10T09:00:00.000Z",
      "cover_image_url": "/api/songs/3/cover"
    },
    {
      "id": 7,
      "album_id": 2,
      "title": "Starlight",
      "duration_seconds": 185,
      "order": 2,
      "label": ["Rock"],
      "view_count": 3,
      "is_cover": false,
      "lyrics": null,
      "created_at": "2025-01-11T10:00:00.000Z",
      "updated_at": "2025-01-11T10:00:00.000Z"
    }
  ]
}
```
:::

### Statistics by Song + Filter Label

`GET http://localhost:3000/api/statistics?metrics=song&labels=Pop`

::: details ✅ ผลลัพธ์ (200 OK) — เฉพาะเพลงที่มี label "Pop"
```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "album_id": 1,
      "title": "Midnight Rain",
      "label": ["Pop", "Chill"],
      "view_count": 5,
      "is_cover": false,
      ...
    }
  ]
}
```
:::

### Statistics by Album

`GET http://localhost:3000/api/statistics?metrics=album`

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Midnight Dreams",
      "artist": "Luna Waves",
      "release_year": 2023,
      "genre": "Pop",
      "description": "A dreamy pop album",
      "publisher": {
        "id": 2,
        "username": "publisher1",
        "email": "pub1@example.com"
      },
      "created_at": "2025-01-10T09:00:00.000Z",
      "updated_at": "2025-01-10T09:00:00.000Z",
      "total_view_count": 12
    },
    {
      "id": 3,
      "title": "Rock Legends",
      "artist": "Steel Thunder",
      "release_year": 2022,
      "genre": "Rock",
      "description": null,
      "publisher": {
        "id": 2,
        "username": "publisher1",
        "email": "pub1@example.com"
      },
      "created_at": "2025-01-12T11:00:00.000Z",
      "updated_at": "2025-01-12T11:00:00.000Z",
      "total_view_count": 7
    }
  ]
}
```
:::

### Statistics by Label

`GET http://localhost:3000/api/statistics?metrics=label`

::: details ✅ ผลลัพธ์ (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "total_view_count": 8,
      "label": "Pop",
      "songs": [
        {
          "id": 3,
          "album_id": 1,
          "title": "Midnight Rain",
          "duration_seconds": 210,
          "order": 3,
          "label": ["Pop", "Chill"],
          "view_count": 5,
          "is_cover": false,
          "lyrics": null,
          "created_at": "2025-01-10T09:00:00.000Z",
          "updated_at": "2025-01-10T09:00:00.000Z",
          "cover_image_url": "/api/songs/3/cover"
        }
      ]
    },
    {
      "total_view_count": 3,
      "label": "Rock",
      "songs": [
        {
          "id": 7,
          "album_id": 2,
          "title": "Starlight",
          "label": ["Rock"],
          "view_count": 3,
          "is_cover": false,
          ...
        }
      ]
    }
  ]
}
```
:::

### ทดสอบ metrics ไม่ถูกต้อง

`GET http://localhost:3000/api/statistics?metrics=invalid`

::: details ✅ ผลลัพธ์ (400 Bad Request)
```json
{ "success": false, "message": "Validation failed" }
```
:::

## `app.js` Final — โปรเจ็คสมบูรณ์

::: details 📄 app.js สมบูรณ์ (Final — หลัง Step 13)
```js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const authRoutes = require('./routes/auth')
const albumRoutes = require('./routes/albums')
const songRoutes = require('./routes/songs')
const userRoutes = require('./routes/users')
const statisticsRoutes = require('./routes/statistics')

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
app.use('/api/statistics', statisticsRoutes)

// Health check — ต้องอยู่ก่อน app.use('/api', songRoutes)
app.get('/api', (_req, res) => {
  res.json({ message: 'Module C - Music Album RESTful API is running.' })
})

// Mount song routes สำหรับ /api/albums/:albumId/songs endpoints
app.use('/api', songRoutes)

// ─── 404 Handler ──────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Not Found' })
})

// ─── Error Handling ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack)
  if (err.message && err.message.includes('Only image files')) {
    return res.status(400).json({ success: false, message: 'Invalid file type' })
  }
  res.status(500).json({ success: false, message: 'Internal server error.' })
})

// ─── Start Server ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
```
:::

## สรุปโปรเจ็คทั้งหมด

ตอนนี้โปรเจ็คสมบูรณ์แล้ว! มีทั้งหมด:

- ✅ **Authentication** — Login, Register, Logout ด้วย Token + Bearer prefix
- ✅ **Albums CRUD** — GET, POST, PUT, DELETE + Cursor Pagination
- ✅ **Songs** — Nested resource, Soft Delete, View Logging, File Upload
- ✅ **Users Admin** — List, Change Role, Ban/Unban
- ✅ **Statistics** — 3 metrics (song/album/label) เรียงตาม view_count

## Glossary

| คำศัพท์ | ความหมาย |
|:--------|:---------|
| **Aggregate Function** | ฟังก์ชัน SQL ที่ทำงานกับหลายแถว เช่น COUNT, SUM, AVG |
| **GROUP BY** | จัดกลุ่มผลลัพธ์ตาม column |
| **Correlated Subquery** | Subquery ที่อ้างอิงตารางภายนอก รันแยกทุกแถว เช่น `(SELECT COUNT(*) WHERE song_id = s.song_id)` |
| **Derived Table** | Subquery ใน FROM clause ใช้เป็น virtual table เช่น `(SELECT song_id, COUNT(*) FROM ... GROUP BY song_id) vc` |
| **COALESCE** | คืนค่าแรกที่ไม่ใช่ NULL — `COALESCE(SUM(...), 0)` ป้องกัน NULL |
| **N+1 Pattern** | Loop N รอบ แต่ละรอบ query 1 ครั้ง — ใช้เมื่อต้องการ nested data per group |
| **reshapeSong** | Helper function แปลงแถว DB → object รูปแบบ spec |
| **Query Parameter** | ค่าที่ส่งมาใน URL หลัง `?` เช่น `?metrics=song&labels=Pop` |
| **user_view_logs** | ตารางบันทึก log ว่า user ดูเพลงอะไร เมื่อไหร่ |
| **total_view_count** | ยอด view รวมของทุกเพลงใน album หรือ label |
