# MASTER PROMPT — SOLEMATE SHOES CLEAN
## Order Ticketing, WhatsApp Bot & Notifications, Operational Reports (Standalone System)

This version replaces the earlier master prompt. It follows the "Spesifikasi Kebutuhan Sistem Solemate" (requirement gathering from the prototype-review interview with the owner). Requirement IDs (FR-xx, NFR-xx) refer to that document. If anything here conflicts with the requirement document, the requirement document wins.

---

## 1. ROLE AND CONTEXT

Act as a senior full-stack engineer, database engineer, and UI/UX designer.

Build a working web system for **Solemate Shoes Clean** (shoe laundry, Bojongsoang, Indonesia). The business name is **Solemate**. Do not use any other brand name.

- UI and customer-facing language: Indonesian.
- Currency: IDR (format `Rp 25.000`). Timezone: Asia/Jakarta.
- Budget: target Rp0 in licenses and recurring costs. Prefer free and open-source tools.
- A web prototype already exists. Inspect it first and extend it rather than rewriting working parts.

This is a real software project, not a mockup. Create working code and configuration, and never claim something works unless you actually ran and verified it.

## 2. WHAT THE SYSTEM IS

A **standalone** system with two web roles (**owner** and **kasir**) plus customers who interact only through WhatsApp.

Owner's main goals:
1. Order status and automatic customer notifications.
2. Daily and monthly reports viewable on the web, so the cashier no longer sends report photos through WhatsApp.

Key decisions from the interview:
- Standalone: no integration or reconciliation with Olsera.
- Only two roles: owner and kasir. No admin or technician role.
- Online orders arrive via WhatsApp in a fixed format; walk-in orders are created by the cashier on the web.
- The system only **records** payments. It does not process online payments.
- Free or unofficial WhatsApp gateway is acceptable for the demo (risk of number ban). Design the gateway so it is easy to replace with an official one.
- If a feature is too hard, it may be cut or postponed. Build Must first, then Should, then Could.

### Explicitly OUT of scope (do not build)
- Olsera integration or matching.
- QRIS, bank transfer, payment gateways, payment confirmation, and payment-verification queues.
- Business settings for QRIS, bank accounts, admin WhatsApp number, or price-list images (the bot's price list comes from the service catalog).
- PDF and Excel export.
- Admin, technician, courier, or washer accounts.
- Opening/closing cash per shift.
- Physical deletion of tickets.

## 3. TECHNOLOGY STACK

- **Frontend/backend:** Next.js (App Router), TypeScript, Tailwind CSS, Route Handlers or server actions. Responsive for desktop, tablet (cashier), and phone (owner).
- **Database:** PostgreSQL with versioned SQL migrations, foreign keys, check constraints, indexes, and transactions. Never expose database credentials to the browser.
- **WhatsApp:** WAHA (free gateway for the demo) and n8n for orchestration of incoming messages. All business logic (parsing the order format, creating tickets, looking up status) lives in the Next.js backend behind an internal API, and n8n/WAHA only relay messages. Put the sender behind a small gateway adapter interface so WAHA can be swapped for an official provider (NFR-05).
- **Infrastructure:** Docker and Docker Compose, persistent volumes, environment variables for secrets, health checks, restart policies. Do not expose PostgreSQL publicly.
- Verify current versions, endpoints, and payload formats in the official docs before implementing WAHA or n8n integrations. Do not invent endpoints. Pin versions; avoid `latest`.

## 4. FIRST TASK: INSPECT THE EXISTING PROJECT

Before writing code:
1. Inspect the repository, the existing prototype, `docker-compose.yml`, `.env.example`, SQL files, n8n exports, and README.
2. Identify what already works and what differs from this document (especially roles, statuses, page names, and fields).
3. Use the prototype's existing order-status list. Do not invent a different one (the full list is still an open question; keep it in one configurable place).
4. State a short implementation plan, then implement. Do not stop after planning.

Preserve working functionality. Do not delete data or drop tables without a safe migration. If the repository is empty, create the structure from scratch.

## 5. ROLES AND PERMISSIONS

| Role | Allowed | Not allowed |
|---|---|---|
| Owner | Login with PIN; dashboard; ticket list and filters (view only); daily operational report; monthly recap; add, edit, and deactivate services and prices; employee list; attendance recap | Create new tickets; edit reports |
| Kasir | Login; create tickets; ticket list (today, yesterday, a few days ago, date range); change order status and payment status; "Belum bayar" filter; open WhatsApp chat or send notification; own attendance with personal PIN | Edit catalog; open the daily operational report or recap; see other employees' data and attendance |
| Customer | WhatsApp only: menu, order format, check progress | No web account |

Enforce permissions **on the server** for every route and API endpoint (FR-02, FR-03). Hiding menu items is not enough. Assumption to keep configurable: owner only views tickets and does not change statuses.

## 6. FUNCTIONAL REQUIREMENTS

Priority: **Must** = required for demo and first version, **Should** = if time allows, **Could** = optional.

### 6.1 Authentication and access
- FR-01 (Must): login required. Owner access protected by PIN or equivalent credential. PIN stored hashed.
- FR-02 (Must): menus and data restricted by role, enforced server-side.
- FR-03 (Must): kasir cannot open owner-only pages (daily report, recap, catalog, employee data).

### 6.2 Order tickets
- FR-10 (Must): kasir creates a ticket for a walk-in order: customer (name, WhatsApp number), one or more items with a service from the catalog, entry date, estimated completion, order status, payment status.
- FR-11 (Must): one ticket can hold multiple items. Reports count **per pair/item**, not per person or per ticket.
- FR-12 (Must): "Daftar Tiket Pesanan" shows all tickets from all statuses.
- FR-13 (Must): filter by date: today, yesterday, a few days ago, or a date range.
- FR-14 (Must): "Belum bayar" button shows unpaid tickets at the top as a reminder to contact customers (especially finished shoes not yet paid or collected).
- FR-15 (Must): kasir changes order status and payment status directly from the list without searching again (this was the owner's complaint about Olsera).
- FR-16 (Must): tickets cannot be deleted. Every change (status, payment, data) is written to an audit log with who and when. Cancellation is a status with a mandatory reason.
- FR-17 (Should): tickets left uncollected for a long time stay easy to see (for example a badge like "2 hari belum diambil").

### 6.3 WhatsApp
- FR-20 (Must): bot shows a menu when a customer makes contact: (1) service info and price list, (2) order format, (3) check progress. The price list is read from the catalog.
- FR-21 (Must): a message matching the fixed format is parsed and automatically becomes a ticket on the web, with initial payment status "belum bayar". A message that does not match gets a reply explaining how to fix it.
- FR-22 (Should): customer can ask for order status through the bot, answered from ticket data (for example "sedang dicuci", "siap diambil").
- FR-23 (Must): a click-to-chat button on each ticket opens WhatsApp with the customer and a prefilled message according to status (for example order finished). The number does not need to be stored manually. This is also the fallback for FR-24.
- FR-24 (Should): when kasir marks an order finished, the system automatically sends a WhatsApp notification. If it cannot be done reliably, do not force it; FR-23 is the fallback.
- FR-25 (Should): for walk-in customers the WhatsApp number is required on the ticket so the online receipt and notifications can be sent.

Always provide a text fallback in the bot (the customer can type `1`, `2`, `3`, or `MENU`). The bot must not depend on interactive buttons working. Proposed order format (confirm with the owner): name, WhatsApp number, service, number of pairs, item description, pickup or drop-off. Store the incoming message id for deduplication so a retried webhook never creates a second ticket.

### 6.4 Dashboard
- FR-30 (Must): show the 5 newest tickets. If there are more than 5 orders that day, still show 5 with a link to the full ticket list.
- FR-31 (Should): 7-day order trend (owner only). It is a trend, not a daily report.
- FR-32 (Should): today's summary numbers (order count, unpaid count).

### 6.5 Daily operational report (owner only)
- FR-40 (Must): visible only to the owner and not editable at all. Numbers are computed from ticket data, never typed.
- FR-41 (Must): period options: today, yesterday, or date range.
- FR-42 (Must): compact content with no per-ticket names: number of pairs/items received, number paid, number and value unpaid (debt), total amount.
- FR-43 (Should): breakdown of cash vs non-cash totals.
- FR-44 (Must): this report replaces the cashier sending closing-report photos via WhatsApp.

### 6.6 Monthly recap (owner only)
- FR-50 (Should): free date range (for example 1 to 31 October).
- FR-51 (Should): best-selling services and total per payment method.
- FR-52 (Could): profit and loss. It needs expense data that does not exist yet. Show it as "belum tersedia" until the owner decides the data source (open question).

### 6.7 Service catalog and prices (owner only)
- FR-60 (Must): owner adds, edits, and deactivates services (name, price, estimated duration). Kasir only selects a service when creating a ticket. Services are deactivated, not deleted.
- FR-61 (Must): a price change must not alter existing tickets. The price is copied to the ticket item at creation time (`harga_saat_transaksi`).

### 6.8 Employees and attendance
- FR-70 (Should): owner manages the employee list.
- FR-71 (Should): clock-in and clock-out: the employee selects their own name and enters a personal PIN only they know, so attendance cannot be faked. The system records arrival and departure times.
- FR-72 (Should): owner can view attendance recap.

### 6.9 Payments and receipts
- FR-80 (Must): payment status at minimum "Belum bayar" and "Lunas" (the prototype already has this).
- FR-81 (Should): payment method recorded as at least cash or non-cash. Do not force a detailed non-cash breakdown.
- FR-82 (Must): the system only records payments. It never processes them.
- FR-83 (Could): print a receipt from the system. Confirm with the owner whether it must come from the system.

## 7. NON-FUNCTIONAL REQUIREMENTS

- NFR-01: PINs hashed; permissions checked on the server; tickets never deleted, only cancelled with a reason.
- NFR-02: important changes audited; the audit log cannot be edited or deleted through the interface and is append-only.
- NFR-03: usability: cashier work should be "tinggal klik" with few steps.
- NFR-04: low cost: minimal hosting and gateway cost.
- NFR-05: WhatsApp risk: an unofficial gateway risks number bans; an official one is paid. Keep the gateway replaceable.
- NFR-06: personal data (customer name, WhatsApp number) collected only as needed and access limited by role.
- NFR-07: availability during store hours; the owner is not always in the store, so reports must open remotely and work well on a phone.

## 8. DATABASE DESIGN

Adapt to the existing prototype schema using safe migrations.

- `users`: id, nama, peran (owner or kasir), pin_hash, aktif.
- `employees`: id, nama, pin_hash, aktif, optional user_id (used for attendance; may be merged with `users` if the prototype already does so).
- `customers`: id, nama, nomor_wa (unique).
- `orders`: id, kode_tiket (stable, unique), customer_id, sumber (wa or toko), dibuat_oleh, tanggal_masuk, estimasi_selesai, status_pesanan, status_bayar, metode_bayar, tanggal_bayar, total, alasan_batal. No physical delete.
- `order_items`: id, order_id, service_id, deskripsi_barang, jumlah, harga_saat_transaksi.
- `services`: id, nama, harga, estimasi_hari, aktif. The single source for the web price list and the bot price list.
- `attendance`: id, employee_id, tanggal, clock_in, clock_out.
- `audit_logs`: id, entitas, entitas_id, aksi, nilai_lama, nilai_baru, user_id, waktu. Append-only.
- `wa_messages` (optional): id, customer_id, arah, isi, waktu, plus the provider message id for deduplication.
- Bot conversation state per customer, if the menu flow needs it.

Data rules:
- Daily reports and recaps are computed from `orders` and `order_items`. They are never stored as editable data.
- The number of shoes is counted from `order_items` (per item/pair), not from the number of tickets.
- `status_pesanan` and `status_bayar` are separate columns.
- Tickets created from WhatsApp start with the prototype's initial order status and payment status "belum bayar".

## 9. WEB PAGES

Build these pages (details are in the PRD):

1. Login (choose user, enter PIN).
2. Dashboard (5 newest tickets, today's summary, owner-only 7-day trend).
3. Daftar Tiket Pesanan (date filters, Belum bayar filter, inline status changes, click-to-chat button, long-uncollected indicator).
4. Buat Tiket Baru (kasir only; multi-item).
5. Detail Tiket (items, audit history, cancel with reason).
6. Resi Tiket print view (Could).
7. Laporan Harian Operasional (owner only, read-only).
8. Rekap Bulanan (owner only).
9. Katalog Layanan dan Harga (owner only).
10. Karyawan (owner only).
11. Absensi (clock-in/clock-out with personal PIN).
12. Rekap Absensi (owner only).

Sidebar differs per role. Every page needs loading, empty, and error states. UI is responsive; the report pages must be comfortable on a phone.

## 10. BUSINESS RULES

- Every item that comes in must have a ticket. Washing without a receipt is free, announced by a sticker on the shoes.
- Online orders come via WhatsApp in the fixed format. Walk-in orders are created by the cashier on the web.
- Pickup and drop-off happen about once or twice a day (around 11:00 and 16:00 to 17:00) and are verified by the cashier. Couriers do not use the system.
- Cash stays in the store and is collected by the owner monthly. The cashier records cash manually; there is no opening or closing cash input.
- Only the owner can add catalog entries and see the daily operational report and employee data.
- The system narrows the gap for off-system transactions but cannot fully control human behavior.

## 11. SECURITY

- Hash PINs with a proper password hashing algorithm (bcrypt or argon2). Rate-limit login attempts.
- Secure session cookies (HttpOnly, SameSite, Secure in production). Validate all input on the server.
- Authorization check on every protected route and API endpoint, including the internal bot API (shared secret or signed requests).
- Parameterized queries only. No secrets in source control; provide `.env.example`.
- Audit log is append-only. Customer data access limited by role.

## 12. TESTING

- Database: migrations apply on an existing database without data loss; ticket delete is impossible; audit log cannot be updated or deleted.
- Authorization: kasir gets 403 on every owner-only route and API; owner cannot create tickets.
- Tickets: multi-item totals, price copied at creation, price change does not affect old tickets, status and payment edits write audit entries, cancellation requires a reason.
- Bot: valid format creates exactly one ticket (also under duplicate webhook delivery); invalid format returns help; menu works via text fallback; price list matches the catalog; status reply matches ticket data.
- Reports: item counts are per pair, unpaid count and value are correct, cash/non-cash split is correct, report totals match the database for today, yesterday, and a date range.
- Attendance: wrong PIN rejected, duplicate clock-in blocked, clock-out requires a prior clock-in.

Run the tests and report the real results.

## 13. DELIVERABLES AND PHASES

Deliverables: Next.js source, migrations and optional safe seed data, Docker Compose and Dockerfile, `.env.example`, `.gitignore`, n8n workflow exports (where practical), bot flow documentation, API and database documentation, automated tests, `README.md` with local setup for macOS and VS Code, a backup and restore guide, and a checklist of implemented, tested, and remaining items.

Work in this order and finish each phase before the next:
1. Inspect the prototype and stabilize infrastructure.
2. Database and migrations (users, customers, orders, order_items, services, audit_logs, plus attendance if reached).
3. Authentication, roles, and server-side authorization.
4. Service catalog (needed for tickets and the bot price list).
5. Tickets: create, list, filters, inline status and payment changes, detail, audit, cancellation.
6. Click-to-chat (FR-23) and the WhatsApp bot: menu, order format parsing, ticket creation, replies.
7. Dashboard and daily operational report.
8. Should items: automatic notification on completion, bot progress check, 7-day trend, monthly recap, cash/non-cash split, employees and attendance, long-uncollected indicator.
9. Could items if time allows: receipt print view, profit and loss.
10. Integration test of the full flow and documentation.

Full-flow check: customer sends the order format on WhatsApp, a ticket appears on the web as "belum bayar", the cashier changes the status, the customer receives a notification (or the cashier uses click-to-chat), the cashier marks it paid, and the owner sees the updated daily report.

## 14. ACCEPTANCE CRITERIA

- [ ] Login works for owner and kasir; permissions are enforced on the server.
- [ ] Kasir cannot open or call owner-only pages and APIs.
- [ ] Kasir can create a ticket with multiple items; prices are copied at creation.
- [ ] Ticket list shows all statuses with date filters and the "Belum bayar" filter.
- [ ] Order and payment status change directly from the list.
- [ ] Tickets cannot be deleted; every change is in the audit log; cancellation needs a reason.
- [ ] The bot shows the three-item menu and a text fallback.
- [ ] A correctly formatted WhatsApp message creates exactly one ticket; a wrong format gets a help reply.
- [ ] The bot price list matches the catalog.
- [ ] Click-to-chat opens WhatsApp with a status-appropriate prefilled message.
- [ ] Dashboard shows the 5 newest tickets with a link to the full list.
- [ ] Daily report works for today, yesterday, and a date range, is read-only, and counts per pair.
- [ ] Report numbers match the database.
- [ ] Owner can add, edit, and deactivate services; old tickets keep their old prices.
- [ ] The system does not process online payments and contains no QRIS, bank transfer, or payment-verification features.
- [ ] The gateway is replaceable through an adapter.
- [ ] No secrets are committed; setup instructions work on the target machine.
- [ ] Tests were run and their actual results are documented.

## 15. HOW YOU MUST WORK

1. Inspect the real project first, then state a concise plan.
2. Implement files directly when tool access allows; work in small, verifiable phases.
3. Run build, lint, migration, and test commands after meaningful changes, and fix real failures.
4. Never claim a feature works because the code was written. Separate implemented, tested, untested, and blocked.
5. Do not add features outside this document. Do not build anything listed under "out of scope".
6. Do not invent business details (real prices, owner number, expenses). Use configurable placeholders and document where to fill them in.
7. Prefer simple, well-supported solutions. Avoid unnecessary dependencies and rewrites.
8. Unclear requirements are listed as open questions in the document; handle them with a configurable default and mention the assumption instead of stopping.

Open questions (use defaults, keep configurable): full list of order statuses; whether Olsera is fully retired; source of expense data for profit and loss; non-cash payment types; whether couriers or washers need accounts; whether receipts must be printed from the system; final WhatsApp gateway; details of a "finished" button in the WhatsApp flow; whether the completion estimate auto-fills from service duration; exact report columns.

At the end of each phase, report: files created or modified, features implemented, commands run, real test and build results, blockers, and the exact next step.

## FINAL GOAL

A working, standalone, low-cost system for Solemate Shoes Clean in which WhatsApp orders become tickets on the web automatically, the cashier can update statuses with a click and notify customers, and the owner can open the web (even from a phone) to see accurate daily and monthly numbers without receiving report photos. Prioritize data accuracy, simplicity for the cashier, security, and realistic operating cost over visual extras.
