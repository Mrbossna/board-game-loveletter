# 💌 Love Letter — Multiplayer Web + Discord Activity

เกม Love Letter (คลาสสิก 16 ใบ) เล่นหลายคนพร้อมกันผ่านเว็บ รองรับทั้งมือถือและคอมพิวเตอร์
เล่นแบบสร้างห้อง/เข้าด้วยรหัสได้ และเอาไปฝังใน Discord เป็น **Activity** ได้ด้วย

- 🎴 การ์ดวาดด้วย SVG ทั้งหมด คมชัดทุกขนาด ไม่ต้องโหลดรูปจากภายนอก
- 🧠 กติกาถูกต้อง 100% — ตรรกะเกมอยู่ที่ฝั่งเซิร์ฟเวอร์ (กันโกง), มีชุดเทสต์ครบ
- 📱 Responsive — เล่นได้ทั้งจอมือถือและจอคอม
- 🔌 เล่นบนเว็บปกติก็ได้ / เป็น Discord Activity ก็ได้ (โค้ดชุดเดียว)
- ♻️ ต่อกลับอัตโนมัติเมื่อเน็ตหลุด + ระบบเล่นแทนอัตโนมัติเมื่อผู้เล่นหาย (เกมไม่มีทางค้าง)

---

## โครงสร้างโปรเจกต์

```
love-letter/
├─ server/            # เซิร์ฟเวอร์ Node (Express + Socket.IO)
│  ├─ index.js        #   HTTP + socket + Discord token exchange + serve client
│  ├─ rooms.js        #   จัดการห้อง / เข้าห้อง / เล่นแทนอัตโนมัติ
│  └─ game/           #   เอนจินเกม + เทสต์
│     ├─ cards.js
│     ├─ LoveLetterGame.js
│     └─ LoveLetterGame.test.js
├─ client/            # เว็บ (Vite + vanilla JS)
│  ├─ index.html
│  └─ src/            #   main.js, cards.js (SVG art), styles.css, net.js, discord.js
├─ test/              # เทสต์ end-to-end (บอทเล่นจริงผ่าน socket)
├─ dist/              # ผลลัพธ์ build (สร้างโดย `npm run build`)
└─ package.json
```

---

## เล่นบนเครื่องตัวเอง (Local)

```bash
cd love-letter
npm install
npm run build
npm start
```

เปิด `http://localhost:3000` — สร้างห้อง แล้วเปิดอีกแท็บ/อีกเครื่องในวง LAN เข้าด้วยรหัสห้องได้เลย

> โหมด dev (แก้โค้ดแล้วรีเฟรชอัตโนมัติ): เปิด 2 เทอร์มินัล — `npm run dev:server` และ `npm run dev:client` แล้วเข้าที่พอร์ตของ Vite

รันเทสต์:
```bash
npm test                 # เทสต์กติกาเอนจิน (unit)
node test/integration.mjs # ต้องมีเซิร์ฟเวอร์รันอยู่ที่ :3000 (บอท 2 ตัวเล่นจนจบเกม)
```

---

## Deploy บน VPS Ubuntu

### 1) ติดตั้ง Node.js (แนะนำ v20+)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### 2) เอาโค้ดขึ้นเครื่อง + build

```bash
# อัปโหลด/โคลนโฟลเดอร์ love-letter ไปไว้ที่ /opt/love-letter (หรือที่ไหนก็ได้)
cd /opt/love-letter
npm ci            # หรือ npm install
npm run build
```

สร้างไฟล์ `.env` (คัดลอกจาก `.env.example`) — ใส่ค่า Discord ถ้าจะทำเป็น Activity:
```bash
cp .env.example .env
nano .env
```

### 3) รันให้ค้างตลอดด้วย systemd

สร้าง `/etc/systemd/system/loveletter.service`:
```ini
[Unit]
Description=Love Letter game server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/love-letter
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=PORT=3000
# หรือใช้ไฟล์ .env ที่โค้ดโหลดเองอยู่แล้ว
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now loveletter
sudo systemctl status loveletter
```

> ทางเลือกที่ง่ายกว่า: `npm i -g pm2 && pm2 start server/index.js --name loveletter && pm2 save && pm2 startup`

ตอนนี้เล่นแบบเว็บได้แล้วที่ `http://<IP_VPS>:3000`

### 4) ต้องมี HTTPS (บังคับสำหรับ Discord Activity)

Discord จะโหลด Activity ผ่าน HTTPS เท่านั้น ต้องมี **โดเมน + ใบรับรอง**
วิธีที่ง่ายสุดคือใช้ **Caddy** (ขอ HTTPS อัตโนมัติ):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

`/etc/caddy/Caddyfile`:
```
game.yourdomain.com {
    reverse_proxy localhost:3000
}
```
```bash
sudo systemctl reload caddy
```
ชี้ DNS ของ `game.yourdomain.com` มาที่ IP ของ VPS → ได้ `https://game.yourdomain.com` อัตโนมัติ

<details>
<summary>ทางเลือก: nginx + certbot</summary>

```nginx
server {
    listen 80;
    server_name game.yourdomain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # จำเป็นสำหรับ websocket
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo certbot --nginx -d game.yourdomain.com
```
> **สำคัญ:** ต้องมีบรรทัด `Upgrade`/`Connection "upgrade"` ไม่งั้น Socket.IO (websocket) จะต่อไม่ติด
</details>

---

## ตั้งค่าเป็น Discord Activity

1. ไปที่ https://discord.com/developers/applications → **New Application**
2. หน้า **General Information**: คัดลอก **Application ID** → ใส่เป็น `DISCORD_CLIENT_ID` ใน `.env`
3. หน้า **OAuth2**: คัดลอก **Client Secret** → ใส่เป็น `DISCORD_CLIENT_SECRET`
4. หน้า **Activities** (Embedded App): กด **Enable Activity**
5. ในหน้า Activities → **URL Mappings** เพิ่ม:
   - **Prefix:** `/`  →  **Target:** `game.yourdomain.com`
   (แมพ root ทั้งหมดเข้าเซิร์ฟเวอร์เรา รวม `/socket.io` และ `/api` ผ่าน proxy ของ Discord เอง)
6. รีสตาร์ตเซิร์ฟเวอร์เกมให้โหลดค่า `.env` ใหม่: `sudo systemctl restart loveletter`
7. เพิ่มแอปเข้าเซิร์ฟเวอร์ Discord ของคุณ แล้วเข้าห้องเสียง → กดปุ่ม 🚀 **Activities** → เลือกเกม

> เข้าผ่าน Discord แล้วทุกคนในห้องเสียงเดียวกันจะเข้าห้องเกมเดียวกันอัตโนมัติ (ใช้ instance id ของ Activity เป็นรหัสห้อง) ไม่ต้องพิมพ์รหัส

---

## กติกาย่อ

- เริ่มมีการ์ดคนละ 1 ใบ ในเทิร์นจั่วอีก 1 (มี 2 ใบ) แล้วทิ้ง 1 ใบทำตามผล
- เหลือรอดคนสุดท้าย หรือถือแต้มสูงสุดตอนกองหมด = ชนะรอบ ได้ 1 ตรา
- ครบตราก่อน (2 คน=7, 3 คน=5, 4 คน=4) = ชนะเกม

| แต้ม | การ์ด | จำนวน | ผล |
|---|---|---|---|
| 1 | ทหาร Guard | 5 | ทายการ์ดคนอื่น (ห้ามทายทหาร) ถูก = ตกรอบ |
| 2 | บาทหลวง Priest | 2 | แอบดูมือคนอื่น |
| 3 | ขุนนาง Baron | 2 | เทียบแต้ม คนน้อยกว่าตกรอบ |
| 4 | สาวใช้ Handmaid | 2 | ป้องกันตัวจนถึงเทิร์นหน้า |
| 5 | เจ้าชาย Prince | 2 | บังคับใครก็ได้ (รวมตัวเอง) ทิ้งแล้วจั่วใหม่ |
| 6 | ราชา King | 1 | สลับมือกับคนอื่น |
| 7 | เคาน์เตส Countess | 1 | ต้องทิ้งถ้าถือคู่กับราชา/เจ้าชาย |
| 8 | เจ้าหญิง Princess | 1 | ทิ้งเมื่อไหร่ = ตกรอบทันที |

---

## Troubleshooting

- **Socket.IO ต่อไม่ติดหลังใส่ reverse proxy** → เช็คว่า proxy ส่ง header `Upgrade`/`Connection: upgrade` (Caddy จัดการให้เอง; nginx ต้องเพิ่มเอง)
- **Activity ขึ้นจอขาว/โหลดไม่ได้** → ต้องเป็น HTTPS จริง และตั้ง URL Mapping prefix `/` ให้ชี้โดเมนเราให้ถูก
- **ชื่อผู้เล่นใน Discord ไม่ขึ้น** → ตรวจว่าใส่ `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` ครบ และรีสตาร์ตเซิร์ฟเวอร์แล้ว
- **แก้ UI แล้วไม่เปลี่ยน** → ต้อง `npm run build` ใหม่ทุกครั้ง (เซิร์ฟเวอร์เสิร์ฟจากโฟลเดอร์ `dist/`)
