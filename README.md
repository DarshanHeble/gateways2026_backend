# Gateways 2026 Backend

Standalone backend service for Gateways — our CS department's flagship fest website and companion mobile app.

Built with **Fastify** + **MySQL** (via **Drizzle ORM**), replacing mock localStorage-backed data layers with a robust, production-grade API for both the website and mobile app.

---

## 🛠️ Environment & Database Setup

This project supports separate database configurations for **Development**, **Preproduction**, and **Production**.

### Environment Files

- **Local Development**: `.env` (copied from `.env.example`)
- **Preproduction**: `.env.preproduction` (copied from `.env.preproduction.example`)
- **Production**: `.env.production` (copied from `.env.production.example`)

> **Note for Developers**: For normal daily local development, you only need to work with `.env`. The app defaults to `NODE_ENV=development` and reads `.env`.

---

## 🚀 Running the Project

| Command | Script | Target Environment / DB |
| :--- | :--- | :--- |
| **Local Dev (Default)** | `npm run dev` | `.env` (`NODE_ENV=development`) |
| **Preproduction Dev** | `npm run dev:preprod` | `.env.preproduction` (`NODE_ENV=preproduction`) |
| **Production Dev Test** | `npm run dev:prod` | `.env.production` (`NODE_ENV=production`) |
| **Start Build (Preprod)** | `npm run start:preprod` | `.env.preproduction` |
| **Start Build (Prod)** | `npm run start:prod` | `.env.production` |

---

## 📦 Project Architecture Overview

- **`src/config/env.ts`**: Environment variable validation and multi-environment `.env` loader.
- **`src/db/`**: Drizzle ORM configuration and database connection pooling (supports dual pools: Standard DB & Privileged Writer DB).
- **`src/app.ts`**: Fastify application entry point.
