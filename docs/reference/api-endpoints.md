# API Endpoints ทั้งหมด

> Quick reference สำหรับทุก endpoint ใน Module C RESTful API

**Base URL:** `http://localhost:3000`

**Auth Header:** `X-Authorization: Bearer <token>` (ได้จาก `/api/login`)

::: tip 💡 Bearer vs ไม่มี Bearer
Server รองรับทั้ง `X-Authorization: Bearer <token>` และ `X-Authorization: <token>` ตรงๆ — แต่แนะนำใช้รูปแบบ Bearer ซึ่งเป็น standard
:::

## Authentication

| Method | Path | คำอธิบาย | Auth | Body (form-data) |
|:-------|:-----|:---------|:----:|:----------------|
| `POST` | `/api/login` | เข้าสู่ระบบ | ❌ | `username`, `password` |
| `POST` | `/api/register` | สมัครสมาชิก | ❌ | `username`, `email`, `password` |
| `POST` | `/api/logout` | ออกจากระบบ | ✅ | — |

::: details ตัวอย่าง Response — Login (200 OK)
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
      "created_at": "2025-10-23T14:30:00.000Z",
      "updated_at": "2025-10-23T14:30:00.000Z"
    }
  }
}
```
:::

::: details ตัวอย่าง Response — Register (201 Created)
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 5,
      "username": "user4",
      "email": "user4@web.com",
      "role": "user",
      "created_at": "2025-10-24T10:00:00.000Z",
      "updated_at": "2025-10-24T10:00:00.000Z"
    }
  }
}
```
:::

## Albums

| Method | Path | คำอธิบาย | Auth | Body |
|:-------|:-----|:---------|:----:|:-----|
| `GET` | `/api/albums` | รายการอัลบั้มทั้งหมด | ❌ | — |
| `GET` | `/api/albums/:id` | รายละเอียดอัลบั้ม | ❌ | — |
| `GET` | `/api/albums/:id/songs` | รายการเพลงในอัลบั้ม | ❌ | — |
| `GET` | `/api/albums/:id/cover` | รูปปกอัลบั้ม (image file) | ❌ | — |
| `POST` | `/api/albums` | สร้างอัลบั้มใหม่ | publisher/admin | **form-data** |
| `PUT` | `/api/albums/:id` | แก้ไขอัลบั้ม | เจ้าของ/admin | JSON body |
| `DELETE` | `/api/albums/:id` | ลบอัลบั้ม | เจ้าของ/admin | — |

**GET /api/albums — Query Params:**

| Param | Type | คำอธิบาย |
|:------|:-----|:---------|
| `limit` | number | จำนวนผลลัพธ์ต่อหน้า (1–100, default: 10) |
| `cursor` | string | Cursor สำหรับหน้าถัดไป |
| `year` | string | กรองตามปี เช่น `2023` หรือ `2020-2023` |
| `capital` | string | กรองอัลบั้มที่ชื่อขึ้นต้นด้วยตัวอักษรนั้น |

**POST /api/albums — Body (form-data):**

| Field | Required | คำอธิบาย |
|:------|:--------:|:---------|
| `title` | ✅ | ชื่ออัลบั้ม |
| `artist` | ✅ | ชื่อศิลปิน |
| `release_year` | ❌ | ปีที่ออก |
| `genre` | ❌ | แนวเพลง |
| `description` | ❌ | คำอธิบาย |

::: details ตัวอย่าง Response — GET /api/albums (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Morning Vibes",
      "artist": "Luna Waves",
      "release_year": 2023,
      "publisher": {
        "id": 1,
        "username": "admin",
        "email": "admin@web.wsa"
      }
    }
  ],
  "meta": {
    "next_cursor": "eyJpZCI6MX0="
  }
}
```
:::

::: details ตัวอย่าง Response — GET /api/albums/:id (200 OK)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "Morning Vibes",
    "artist": "Luna Waves",
    "release_year": 2023,
    "genre": "Pop",
    "description": "A relaxing album",
    "created_at": "2025-10-20T09:00:00.000Z",
    "updated_at": "2025-10-20T09:00:00.000Z",
    "publisher": {
      "id": 1,
      "username": "admin",
      "email": "admin@web.wsa"
    }
  }
}
```
:::

## Songs

| Method | Path | คำอธิบาย | Auth | Body |
|:-------|:-----|:---------|:----:|:-----|
| `GET` | `/api/songs` | รายการเพลงทั้งหมด | ❌ | — |
| `GET` | `/api/songs/:id` | รายละเอียดเพลง + บันทึก view | ❌ | — |
| `GET` | `/api/songs/:id/cover` | รูปปกเพลง (image file) | ❌ | — |
| `POST` | `/api/albums/:id/songs` | เพิ่มเพลงในอัลบั้ม | publisher/admin | **form-data** |
| `POST` | `/api/albums/:id/songs/:songId` | แก้ไขเพลง | publisher/admin | **form-data** |
| `PUT` | `/api/albums/:id/songs/order` | จัดลำดับเพลง | publisher/admin | JSON body |
| `DELETE` | `/api/albums/:id/songs/:songId` | ลบเพลง (Soft Delete) | publisher/admin | — |

**GET /api/songs — Query Params:**

| Param | Type | คำอธิบาย |
|:------|:-----|:---------|
| `limit` | number | จำนวนผลลัพธ์ต่อหน้า (1–100, default: 10) |
| `cursor` | string | Cursor สำหรับหน้าถัดไป |
| `keyword` หรือ `filter[keyword]` | string | ค้นหาใน title |

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

::: details ตัวอย่าง Response — POST /api/albums/1/songs (201 Created)
```json
{
  "success": true,
  "data": {
    "id": 21,
    "album_id": 1,
    "title": "New Song",
    "duration_seconds": 180,
    "lyrics": null,
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

## Users (Admin Only)

| Method | Path | คำอธิบาย | Auth |
|:-------|:-----|:---------|:----:|
| `GET` | `/api/users` | รายชื่อ user ทั้งหมด | admin |
| `PUT` | `/api/users/:id` | เปลี่ยน role | admin |
| `PUT` | `/api/users/:id/ban` | แบนผู้ใช้ | admin |
| `PUT` | `/api/users/:id/unban` | ปลดแบนผู้ใช้ | admin |

**GET /api/users — Query Params:**

| Param | Type | คำอธิบาย |
|:------|:-----|:---------|
| `limit` | number | จำนวน user ต่อหน้า (1–100, default: 10) |
| `cursor` | string | Cursor สำหรับหน้าถัดไป |

**PUT /api/users/:id — Body (JSON):**
```json
{ "role": "admin | publisher | user" }
```

## Statistics

| Method | Path | คำอธิบาย | Auth |
|:-------|:-----|:---------|:----:|
| `GET` | `/api/statistics?metrics=song` | เพลงทั้งหมดเรียงตาม view_count | ❌ |
| `GET` | `/api/statistics?metrics=album` | อัลบั้มพร้อม total_view_count | ❌ |
| `GET` | `/api/statistics?metrics=label` | แต่ละ label พร้อมเพลงและ total_view_count | ❌ |

**Optional filter** (ใช้ได้กับ `metrics=song` และ `metrics=label`):
```
?metrics=song&labels=Pop
?metrics=label&labels=Rock
```

::: details ตัวอย่าง Response — metrics=song (200 OK)
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
    }
  ]
}
```
:::

::: details ตัวอย่าง Response — metrics=album (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Morning Vibes",
      "artist": "Luna Waves",
      "release_year": 2023,
      "genre": "Pop",
      "description": null,
      "publisher": { "id": 1, "username": "admin", "email": "admin@web.wsa" },
      "created_at": "2025-01-10T09:00:00.000Z",
      "updated_at": "2025-01-10T09:00:00.000Z",
      "total_view_count": 12
    }
  ]
}
```
:::

::: details ตัวอย่าง Response — metrics=label (200 OK)
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
          "title": "Midnight Rain",
          "label": ["Pop", "Chill"],
          "view_count": 5,
          "is_cover": false
        }
      ]
    }
  ]
}
```
:::

## Error Responses

| Status | เกิดเมื่อ | ตัวอย่าง response |
|:-------|:---------|:----------------|
| `400` | ข้อมูลไม่ครบ / ไม่ถูกต้อง | `{ "success": false, "message": "Validation failed" }` |
| `400` | parameter ไม่ถูกต้อง | `{ "success": false, "message": "Invalid parameter" }` |
| `401` | ไม่มี token | `{ "success": false, "message": "Access Token is required" }` |
| `401` | token ผิด | `{ "success": false, "message": "Invalid Access Token" }` |
| `403` | ถูก ban | `{ "success": false, "message": "User is banned" }` |
| `403` | role ไม่มีสิทธิ์ | `{ "success": false, "message": "Admin access required" }` |
| `404` | ไม่พบข้อมูล | `{ "success": false, "message": "Not Found" }` |
| `404` | ไม่พบรูปปก | `{ "success": false, "message": "Cover Not Found" }` |
| `409` | ข้อมูลซ้ำ | `{ "success": false, "message": "Username already taken" }` |
| `500` | Server error | `{ "success": false, "message": "Internal server error." }` |

## ข้อมูลทดสอบ (Test Accounts)

| username | password | role | is_banned |
|:---------|:---------|:----:|:---------:|
| `admin` | `adminpass` | admin | ❌ |
| `user1` | `user1pass` | user | ❌ |
| `user2` | `user2pass` | user | ❌ |
| `user3` | `user3pass` | user | ✅ (banned) |
