# Step 5 — เชื่อมต่อ MySQL ด้วย mysql2

> 🎯 **Analogy:** Connection Pool คือ "ช่องรับออเดอร์" ในร้านอาหาร — แทนที่จะมีพนักงานคนเดียวรับทีละออเดอร์ (connection เดี่ยว) → มีหลายช่องรับพร้อมกัน ลูกค้าไม่ต้องรอ

## ทำไมต้องใช้ Connection Pool?

เมื่อ API ได้รับ request ต้องไป query ข้อมูลจาก MySQL การสร้าง **Database Connection** ทุกครั้งที่มี request ใช้เวลาและทรัพยากรมาก

**Connection Pool** แก้ปัญหานี้โดย:
1. สร้าง connection ไว้ล่วงหน้าหลายอัน (default: 10 connections)
2. เมื่อมี request → หยิบ connection ที่ว่างมาใช้
3. ใช้เสร็จแล้ว → คืน connection กลับ pool (ไม่ปิดทิ้ง)

```
Request 1 ──┐
Request 2 ──┤──► Connection Pool (10 connections) ──► MySQL
Request 3 ──┘
```

## ติดตั้ง mysql2

```bash
npm install mysql2
```

::: tip 💡 ทำไมต้อง mysql2 ไม่ใช่ mysql?
`mysql2` เป็น version ใหม่ที่รองรับ **Promise** และ **async/await** ได้ ทำให้เขียนโค้ดได้ง่ายกว่า `mysql` เดิมมาก — ใช้ `mysql2/promise` เสมอ
:::

## สร้างไฟล์ `config/database.js`

สร้างโฟลเดอร์ `config` แล้วสร้างไฟล์ `database.js` ข้างใน:

```js
const mysql = require('mysql2/promise')  // ใช้ /promise สำหรับ async/await
require('dotenv').config()

// สร้าง Connection Pool — เตรียม connection ไว้ล่วงหน้า
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || '04_module_c',
  waitForConnections: true,  // ถ้า pool เต็ม ให้รอ (ไม่ throw error ทันที)
  connectionLimit: 10         // จำนวน connection สูงสุดใน pool
})

module.exports = pool  // export ให้ไฟล์อื่นใช้ได้
```

**คำอธิบายทีละส่วน:**
- `mysql2/promise` — ใช้ Promise API (รองรับ `await`)
- `createPool()` — สร้าง pool แทน connection เดี่ยว
- `waitForConnections: true` — ถ้า connection ทั้ง 10 ถูกใช้อยู่ → ให้รอ ไม่ error
- `connectionLimit: 10` — สูงสุด 10 connection พร้อมกัน
- `module.exports` — ทำให้ไฟล์อื่น `require('./config/database')` แล้วใช้ pool ได้

## ทดสอบการเชื่อมต่อ

เพิ่ม route ทดสอบใน `app.js` ชั่วคราว:

```js
require('dotenv').config()
const express = require('express')
const db = require('./config/database')  // โหลด pool มาใช้

const app = express()
const PORT = process.env.PORT || 3000

// Route ทดสอบ — ลองดึงข้อมูล users จาก DB
app.get('/test-db', async (req, res) => {
  try {
    // db.query() คืน [rows, fields] → เราต้องการแค่ rows
    const [rows] = await db.query('SELECT user_id, username, role FROM users')
    res.json({ success: true, count: rows.length, users: rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
```

**Postman:** `GET http://localhost:3000/test-db`

::: details ✅ ผลลัพธ์ที่ถูกต้อง
```json
{
  "success": true,
  "count": 4,
  "users": [
    { "user_id": 1, "username": "admin", "role": "admin" },
    { "user_id": 2, "username": "user1", "role": "user" },
    { "user_id": 3, "username": "user2", "role": "user" },
    { "user_id": 4, "username": "user3", "role": "user" }
  ]
}
```
:::

::: warning ⚠️ ลบ route ทดสอบออกหลังทดสอบเสร็จ
route `/test-db` เปิดเผยข้อมูล user ให้ทุกคนเห็น — ลบออกจาก `app.js` ก่อนไปขั้นต่อไป
:::

## วิธีใช้ Pool ใน Routes

เมื่อสร้าง route ต่างๆ ให้ `require` pool มาใช้แบบนี้:

```js
const db = require('../config/database')

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM albums')
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: 'Internal server error.' })
  }
})
```

**รูปแบบ try/catch:** ทุก database query ต้องอยู่ใน `try/catch` เสมอ เพราะถ้า query ล้มเหลว (เช่น DB ดาวน์) ต้องตอบ `500` กลับ ไม่ใช่ crash server

## Glossary

| คำศัพท์ | ความหมาย |
|:--------|:---------|
| **Connection Pool** | กลุ่ม database connection ที่เตรียมไว้ล่วงหน้า |
| **async/await** | วิธีเขียน asynchronous code ให้ดูเหมือน synchronous |
| **Promise** | Object ที่แทนผลลัพธ์ที่จะเกิดขึ้นในอนาคต |
| **try/catch** | โครงสร้างจัดการ error — ถ้า try ล้มเหลว → ไป catch |
| **module.exports** | ส่งออก value จากไฟล์ให้ไฟล์อื่น require ได้ |
| **require()** | โหลด module/ไฟล์อื่นมาใช้งาน |
