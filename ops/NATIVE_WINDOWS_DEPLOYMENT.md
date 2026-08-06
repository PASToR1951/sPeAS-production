# Native Windows Production Deployment Guide (No Docker)

This guide documents the procedures for operating the **Paulinian Electronic Archiving System (PeAS)** natively on a Windows server without Docker containers.

---

## 1. Quick Start / Installation

Run an elevated PowerShell session as Administrator:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\ops\peas-deploy-native.ps1 install
```

This single command will:
1. Install native prerequisites via `winget` (Deno, Node.js, PostgreSQL 17).
2. Create `%ProgramData%\PeAS\config` and generate encrypted secret files (`db_admin_password`, `db_app_password`, `better_auth_secret`, etc.).
3. Initialize the native PostgreSQL database `peas_db` and configure database roles (`postgres` and `peas_app`).
4. Execute Deno schema migrations (`deno task db:migrate:apply`).
5. Compile frontend production UI static bundles (`npm run build:ui`).

---

## 2. Bootstrapping First Administrator

To create the initial administrator account interactively:

```powershell
.\ops\peas-deploy-native.ps1 bootstrap-admin
```

---

## 3. Starting the System

To launch the web server and background processing workers:

```powershell
.\start-native.ps1
```

The system will start serving traffic on:
`http://localhost:8000`

---

## 4. Diagnostics & Operations CLI

The native operator script `ops/peas-deploy-native.ps1` provides commands for system management:

- **Check System Health**:
  ```powershell
  .\ops\peas-deploy-native.ps1 doctor
  ```

- **Check Running Processes**:
  ```powershell
  .\ops\peas-deploy-native.ps1 status
  ```

- **Re-apply Schema Migrations**:
  ```powershell
  .\ops\peas-deploy-native.ps1 migrate
  ```

- **Re-build Static UI Assets**:
  ```powershell
  .\ops\peas-deploy-native.ps1 build-ui
  ```

- **Stop All Deno Processes**:
  ```powershell
  .\ops\peas-deploy-native.ps1 stop
  ```

---

## 5. Reverse Proxy / Domain Setup (Optional Caddy)

For institutional domain hosting (e.g. HTTPS on port 80/443), install Caddy natively:

```powershell
winget install --id ComputerStuffs.Caddy
caddy run --config ops/Caddyfile
```

---

## 6. Directory Reference

- **Application Configuration**: `%ProgramData%\PeAS\config\peas.env` / `.env`
- **Secrets Directory**: `%ProgramData%\PeAS\config\secrets\`
- **Document & Media Storage**: `%ProgramData%\PeAS\storage\`
- **Application Logs**: `%ProgramData%\PeAS\logs\`
