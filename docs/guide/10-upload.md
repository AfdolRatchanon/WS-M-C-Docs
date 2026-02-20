# Step 10 — Upload รูปภาพด้วย Multer

> 🎯 **Analogy:** Multer คือ "พนักงานรับสัมภาระ" ที่คอยรับไฟล์จาก client ตรวจสอบว่าเป็นรูปภาพจริงไหม แล้วนำไปวางในที่ที่กำหนด

## multipart/form-data คืออะไร?

การส่งไฟล์ผ่าน HTTP ต้องใช้ Content-Type: `multipart/form-data` ซึ่งแบ่งข้อมูลออกเป็น "parts" — แต่ละ part คือ field หนึ่ง (text หรือ file)

```
Content-Type: multipart/form-data; boundary=----FormBoundary

------FormBoundary
Content-Disposition: form-data; name="title"

My Song
------FormBoundary
Content-Disposition: form-data; name="cover_image"; filename="cover.jpg"
Content-Type: image/jpeg

<binary data ของรูปภาพ>
------FormBoundary--
```

`express.json()` และ `express.urlencoded()` parse รูปแบบนี้ไม่ได้ — ต้องใช้ **Multer**

## สร้างไฟล์ `middleware/upload.js`

```js
const multer = require('multer')
const path = require('path')
const fs = require('fs')

// สร้างโฟลเดอร์ uploads ถ้ายังไม่มี
const uploadDir = path.join(__dirname, '..', 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

// กำหนดว่าจะบันทึกไฟล์ไว้ที่ไหน และตั้งชื่อยังไง
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)  // บันทึกในโฟลเดอร์ uploads/
  },
  filename: (req, file, cb) => {
    // ชื่อไฟล์ = timestamp + random number + extension เดิม
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    const ext = path.extname(file.originalname)
    cb(null, uniqueSuffix + ext)  // เช่น "1704067200000-123456789.jpg"
  }
})

// กรองประเภทไฟล์ — รับแค่รูปภาพ
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif']
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true)   // อนุญาต
  } else {
    cb(new Error('Only image files (jpg, png, gif) are allowed.'), false)  // ปฏิเสธ
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }  // จำกัดขนาดไม่เกิน 5MB
})

module.exports = upload
```

**คำอธิบายสำคัญ:**

`diskStorage` — กำหนดว่าจะบันทึกไฟล์บน disk (เทียบกับ `memoryStorage` ที่เก็บใน RAM ชั่วคราว)

`cb(null, value)` — callback ของ multer รูปแบบ Node.js: argument แรกคือ error (null = ไม่มี error), argument ที่สองคือค่า

`uniqueSuffix` — ชื่อไฟล์ไม่ซ้ำกัน ป้องกันกรณีอัปโหลดไฟล์ชื่อเดียวกัน 2 ครั้ง

`limits.fileSize` — 5 * 1024 * 1024 = 5MB (5 × 1024 bytes × 1024 bytes)

## วิธีใช้ใน Routes

`upload.single('cover_image')` — ใช้เป็น middleware รับไฟล์ 1 ไฟล์จาก field ชื่อ `cover_image`

หลังจาก middleware นี้รัน ไฟล์จะอยู่ใน `req.file`:

```js
router.post('/albums/:albumId/songs', authenticate, publisherOrAdmin,
  upload.single('cover_image'),   // ← middleware รับไฟล์
  async (req, res) => {
    // req.file จะมีข้อมูลถ้ามีการ upload ไฟล์มา
    // req.file จะเป็น undefined ถ้าไม่ได้ส่งไฟล์มา
    const coverImagePath = req.file ? req.file.filename : null

    // บันทึก filename ลง DB
    await db.query(
      'INSERT INTO songs (..., cover_image_path) VALUES (?, ..., ?)',
      [..., coverImagePath]
    )
  }
)
```

**req.file object มีข้อมูล:**
```js
{
  fieldname: 'cover_image',      // ชื่อ field ใน form
  originalname: 'cover.jpg',     // ชื่อไฟล์เดิม
  mimetype: 'image/jpeg',        // ประเภทไฟล์
  filename: '1704067200000-123456789.jpg',  // ชื่อที่บันทึกจริง
  path: 'C:\\...\\uploads\\1704067200000-123456789.jpg',
  size: 102400                   // ขนาดไฟล์ (bytes)
}
```

## Serve ไฟล์รูปภาพ

ใน `app.js` มี middleware นี้แล้ว (Step 6):

```js
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
```

ทำให้ไฟล์ที่ upload ขึ้นมาเข้าถึงได้ผ่าน URL:

```
http://localhost:3000/uploads/1704067200000-123456789.jpg
```

## จัดการ Error ใน `app.js`

เพิ่ม Error Handling Middleware ที่ท้าย `app.js` (ก่อน `app.listen`):

```js
// Error handling middleware — ต้องมี 4 parameters เสมอ
app.use((err, req, res, next) => {
  console.error(err.stack)
  if (err.message && err.message.includes('Only image files')) {
    return res.status(400).json({ success: false, message: 'Invalid file type' })
  }
  res.status(500).json({ success: false, message: 'Internal server error.' })
})
```

::: tip 💡 ทำไม Error Middleware ต้องมี 4 parameters?
Express รู้จัก error middleware จากจำนวน parameter — ถ้ามีแค่ 3 `(req, res, next)` จะถือว่าเป็น middleware ปกติ ต้องมี `(err, req, res, next)` ครบ 4 ตัวเสมอ
:::

## ทดสอบด้วย Postman

### Upload รูปภาพพร้อมสร้างเพลง

1. Login ด้วย admin → ได้ token
2. `POST http://localhost:3000/api/albums/1/songs`
3. Headers: `X-Authorization: <admin_token>`
4. Body → **form-data**:

| Key | Type | Value |
|:----|:-----|:------|
| `title` | Text | `Song with Cover` |
| `duration_seconds` | Text | `200` |
| `cover_image` | **File** | เลือกไฟล์รูปภาพ .jpg/.png |

5. กด **Send**

::: details ✅ ผลลัพธ์ (201 Created)
```json
{
  "success": true,
  "data": {
    "id": 21,
    "album_id": 1,
    "title": "Song with Cover",
    "duration_seconds": 200,
    "lyrics": null,
    "order": 3,
    "view_count": 0,
    "label": [],
    "is_cover": false,
    "cover_image_url": "/api/songs/21/cover",
    "created_at": "2025-11-20T10:00:00.000Z",
    "updated_at": "2025-11-20T10:00:00.000Z"
  }
}
```
:::

### ดูรูปภาพ

เปิด Browser: `http://localhost:3000/uploads/1704067200000-987654321.jpg`

### Upload ไฟล์ที่ไม่ใช่รูปภาพ

ลองส่งไฟล์ `.pdf` → ควรได้ **400 Bad Request**:
```json
{ "success": false, "message": "Invalid file type" }
```

## Glossary

| คำศัพท์ | ความหมาย |
|:--------|:---------|
| **multipart/form-data** | รูปแบบการส่งข้อมูลที่รองรับไฟล์ |
| **multer** | Middleware ของ Express สำหรับรับ multipart/form-data |
| **diskStorage** | บันทึกไฟล์บน disk (hard drive) |
| **mimetype** | ประเภทของไฟล์ เช่น `image/jpeg`, `application/pdf` |
| **static files** | ไฟล์ที่ serve โดยตรง ไม่ผ่าน route handler |
| **Error Middleware** | Middleware พิเศษที่รับ error จาก middleware อื่น |
