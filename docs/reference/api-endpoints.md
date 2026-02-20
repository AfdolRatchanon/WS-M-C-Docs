# API Endpoints ทั้งหมด

> Quick reference สำหรับทุก endpoint ใน Module C RESTful API

**Base URL:** `http://localhost:3000`

**Auth Header:** `X-Authorization: <token>` (ได้จาก `/api/login`)

## Authentication

| Method | Path | คำอธิบาย | Auth | Body (form-data) |
|:-------|:-----|:---------|:----:|:----------------|
| `POST` | `/api/login` | เข้าสู่ระบบ | ❌ | `username`, `password` |
| `POST` | `/api/register` | สมัครสมาชิก | ❌ | `username`, `email`, `password` |
| `POST` | `/api/logout` | ออกจากระบบ | ✅ | — |

::: details ตัวอย่าง Response — Login (200)
```json
{
  "message": "Login successful.",
  "token": "24c9e15e52afc47c225b757e7bee1f9d",
  "user": { "user_id": 2, "username": "user1", "email": "user1@web.wsa", "role": "user" }
}
```
:::

## Albums

| Method | Path | คำอธิบาย | Auth | Query Params |
|:-------|:-----|:---------|:----:|:------------|
| `GET` | `/api/albums` | รายการอัลบั้มทั้งหมด | ❌ | `limit`, `cursor`, `year` |
| `GET` | `/api/albums/:id` | รายละเอียดอัลบั้ม + เพลง | ❌ | — |
| `GET` | `/api/albums/:id/songs` | รายการเพลงในอัลบั้ม | ❌ | — |
| `GET` | `/api/albums/:id/cover` | รูปปกอัลบั้ม (image file) | ❌ | — |
| `POST` | `/api/albums` | สร้างอัลบั้มใหม่ | publisher/admin | JSON body |
| `PUT` | `/api/albums/:id` | แก้ไขอัลบั้ม | เจ้าของ/admin | JSON body |
| `DELETE` | `/api/albums/:id` | ลบอัลบั้ม | เจ้าของ/admin | — |

**POST /api/albums — Body:**
```json
{
  "title": "string (required)",
  "artist": "string (required)",
  "release_year": "number (optional)",
  "genre": "string (optional)",
  "description": "string (optional)"
}
```

::: details ตัวอย่าง Response — GET /api/albums (200)
```json
{
  "data": [
    {
      "album_id": 1, "title": "Morning Vibes", "artist": "The Beatles",
      "release_year": 2024, "genre": "Relax", "publisher_name": "admin"
    }
  ],
  "pagination": { "limit": 10, "has_more": true, "next_cursor": "eyJpZCI6MTB9" }
}
```
:::

## Songs

| Method | Path | คำอธิบาย | Auth | Body |
|:-------|:-----|:---------|:----:|:-----|
| `GET` | `/api/songs` | รายการเพลงทั้งหมด | ❌ | — |
| `GET` | `/api/songs/:id` | รายละเอียดเพลง + บันทึก view | ❌ | — |
| `GET` | `/api/songs/:id/cover` | รูปปกเพลง (image file) | ❌ | — |
| `POST` | `/api/albums/:id/songs` | เพิ่มเพลงในอัลบั้ม | publisher/admin | form-data |
| `POST` | `/api/albums/:id/songs/:songId` | แก้ไขเพลง | publisher/admin | form-data |
| `PUT` | `/api/albums/:id/songs/order` | จัดลำดับเพลง | publisher/admin | JSON body |
| `DELETE` | `/api/albums/:id/songs/:songId` | ลบเพลง (Soft Delete) | publisher/admin | — |

**GET /api/songs — Query Params:**

| Param | Type | คำอธิบาย |
|:------|:-----|:---------|
| `limit` | number | จำนวนผลลัพธ์ต่อหน้า (default: 10) |
| `cursor` | string | Cursor สำหรับหน้าถัดไป |
| `keyword` | string | ค้นหาใน title และ lyrics |

**POST /api/albums/:id/songs — Body (form-data):**

| Field | Type | Required | คำอธิบาย |
|:------|:-----|:--------:|:---------|
| `title` | text | ✅ | ชื่อเพลง |
| `duration_seconds` | text | ❌ | ความยาว (วินาที) |
| `lyrics` | text | ❌ | เนื้อเพลง |
| `label` | text | ❌ | labels คั่นด้วย comma เช่น `Pop,Rock` |
| `is_cover` | text | ❌ | `"true"` หรือ `"1"` |
| `cover_image` | file | ❌ | ไฟล์รูปภาพ (jpg/png/gif, ≤ 5MB) |

**PUT /api/albums/:id/songs/order — Body (JSON):**
```json
{ "song_ids": [3, 1, 2] }
```

::: details ตัวอย่าง Response — POST /api/albums/1/songs (201)
```json
{
  "message": "Song added successfully.",
  "song": {
    "song_id": 21, "album_id": 1, "title": "New Song",
    "duration_seconds": 180, "track_order": 4,
    "cover_image_path": "1704067200000-123456789.jpg",
    "labels": "Pop,Rock"
  }
}
```
:::

## Users (Admin Only)

| Method | Path | คำอธิบาย | Auth |
|:-------|:-----|:---------|:----:|
| `GET` | `/api/users` | รายชื่อ user ทั้งหมด | admin |
| `PUT` | `/api/users/:id` | เปลี่ยน role | admin |
| `PUT` | `/api/users/:id/ban` | แบนผู้ใช้ | admin |
| `PUT` | `/api/users/:id/unban` | ปลดแบนผู้ใช้ | admin |

**PUT /api/users/:id — Body (JSON):**
```json
{ "role": "admin | publisher | user" }
```

## Statistics

| Method | Path | คำอธิบาย | Auth |
|:-------|:-----|:---------|:----:|
| `GET` | `/api/statistics?metrics=label` | นับเพลงตาม label | ❌ |
| `GET` | `/api/statistics?metrics=album` | นับเพลงตาม album | ❌ |
| `GET` | `/api/statistics?metrics=genre` | นับ album ตาม genre | ❌ |
| `GET` | `/api/statistics?metrics=popular` | 10 เพลงยอดนิยม | ❌ |

::: details ตัวอย่าง Response — metrics=popular (200)
```json
{
  "metrics": "popular",
  "data": [
    { "song_id": 10, "title": "Starlight", "album_title": "Master of Puppets", "view_count": 3 },
    { "song_id": 18, "title": "Reflections", "album_title": "Ramones", "view_count": 2 }
  ]
}
```
:::

## Error Responses

| Status | เกิดเมื่อ | ตัวอย่าง response |
|:-------|:---------|:----------------|
| `400` | ข้อมูลไม่ครบ / ไม่ถูกต้อง | `{ "error": "Title and artist are required." }` |
| `401` | ไม่มี token / token ผิด | `{ "error": "Unauthorized. Token is required." }` |
| `403` | role ไม่มีสิทธิ์ / ถูก ban | `{ "error": "Forbidden. Admin access required." }` |
| `404` | ไม่พบข้อมูล | `{ "error": "Album not found." }` |
| `409` | ข้อมูลซ้ำ | `{ "error": "Username or email already exists." }` |
| `500` | Server error | `{ "error": "Internal server error." }` |

## ข้อมูลทดสอบ (Test Accounts)

| username | password | role | is_banned |
|:---------|:---------|:----:|:---------:|
| `admin` | `adminpass` | admin | ❌ |
| `user1` | `user1pass` | user | ❌ |
| `user2` | `user2pass` | user | ❌ |
| `user3` | `user3pass` | user | ✅ (banned) |
