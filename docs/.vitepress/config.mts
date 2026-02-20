import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/ModuleC-Docs/',
  title: 'Module C — RESTful API',
  description: 'คู่มือสร้าง Music Album RESTful API ด้วย Node.js + Express + MySQL ตั้งแต่ศูนย์',
  lang: 'th',

  themeConfig: {
    nav: [
      { text: 'คู่มือ', link: '/guide/00-overview' },
      { text: 'API Reference', link: '/reference/api-endpoints' },
    ],

    sidebar: [
      {
        text: 'เริ่มต้น',
        items: [
          { text: 'ภาพรวม Module C', link: '/guide/00-overview' },
        ],
      },
      {
        text: 'สร้าง API ทีละ Step',
        items: [
          { text: 'Step 1 — ตั้งค่าฐานข้อมูล MySQL', link: '/guide/01-database' },
          { text: 'Step 2 — สร้างโปรเจ็ค Node.js + Express', link: '/guide/02-project' },
          { text: 'Step 3 — nodemon (Auto-restart)', link: '/guide/03-nodemon' },
          { text: 'Step 4 — dotenv (Environment Variables)', link: '/guide/04-dotenv' },
          { text: 'Step 5 — เชื่อมต่อ MySQL ด้วย mysql2', link: '/guide/05-mysql2' },
          { text: 'Step 6 — Middleware พื้นฐาน', link: '/guide/06-middleware' },
          { text: 'Step 7 — Auth Routes (Login / Register)', link: '/guide/07-auth-routes' },
          { text: 'Step 8 — Auth Middleware + Logout', link: '/guide/08-auth-middleware' },
          { text: 'Step 9 — Albums Routes (CRUD)', link: '/guide/09-albums' },
          { text: 'Step 10 — Upload รูปภาพด้วย Multer', link: '/guide/10-upload' },
          { text: 'Step 11 — Songs Routes', link: '/guide/11-songs' },
          { text: 'Step 12 — Users Management (Admin)', link: '/guide/12-users' },
          { text: 'Step 13 — Statistics', link: '/guide/13-statistics' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API Endpoints ทั้งหมด', link: '/reference/api-endpoints' },
          { text: 'Database Schema', link: '/reference/database-schema' },
        ],
      },
    ],

    docFooter: {
      prev: '← ย้อนกลับ',
      next: 'ถัดไป →',
    },

    footer: {
      message: 'WSA2025 — Module C: RESTful API',
    },

    search: {
      provider: 'local',
    },
  },
})
