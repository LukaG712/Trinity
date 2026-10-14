# Troved

A personal, local-first wishlist with a quiet GitHub-inspired interface and a restrained green accent. Organize ideas into nested collections, keep EUR estimates, search and filter your list, and import Markdown or CSV files. Your wishlist stays in your browser or a folder you choose; there is no Troved account or wishlist database.

## Quick start

Requirements: Node.js 22 or newer.

1. Install the frontend dependencies: `cd frontend` then `npm ci`.
2. In that terminal, start the frontend with `npm run dev`.
3. Open the local URL Vite prints (usually `http://127.0.0.1:5173`).

The core wishlist works without a backend. For cloud AI import assistance, start the optional server in a second terminal from the project root with `node server/index.mjs`; configure provider keys as described below.

When the optional server is running, Vite forwards `/api` requests to `127.0.0.1:3000`. To check the production frontend build, run `npm run build` from `frontend/`; to run server endpoint tests, run `npm test` from `server/`.

## Optional AI-assisted import

Troved imports `.md`, `.markdown`, and `.csv` files locally. The deterministic parser detects common headings, list entries, Markdown tables, and wishlist CSV columns. Review the results and select what to import.

For optional AI-assisted Markdown organization, connect either:

- **OpenAI, Anthropic, or Google Gemini** through the Troved server. Their API keys are configured only in the server's private environment.
- **Ollama** running at an address your browser can reach. This is optional and does not download models.

AI assistance only refines Markdown import results; it is not a general chat feature. Only the Markdown text you explicitly choose to improve is sent to the selected model, through the Troved server for cloud providers. Local parsing happens in your browser, CSV files are not sent for AI processing, and nothing is imported until you confirm. Locally detected prices and links are preserved; always review model output.

Cloud model usage may incur charges from the provider. API keys are never entered into the browser or committed to this project.

### Local provider setup

1. Copy `.env.example` to `.env` in the project root.
2. Put the provider key(s) in `.env`, keeping the file private. Add a key only for a provider you intend to use.
3. Run `node server/index.mjs` from the root and `npm run dev` from `frontend/`.
4. In Troved, open **Preferences → Cloud AI models**, refresh models, choose a provider and model, then select **Use for imports**.

The frontend never receives API keys. The server reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` from its environment. Never paste credentials into chat or browser settings.

## Private Proxmox deployment

The included Docker setup is intended for a private home-network/VPN deployment. The server has **no user authentication**: do not expose port 3000 to the public internet, add a router port-forward, or publish it on an untrusted network.

### 1. Create the VM

In Proxmox, create an Ubuntu Server 24.04 LTS VM attached to your trusted LAN bridge (commonly `vmbr0`). For this lightweight app, start with 2 vCPUs, 2 GB RAM, and a 16 GB disk. Give the VM a DHCP reservation in your router so its LAN address remains stable. Do not configure a public IP or router port-forward.

Install Ubuntu updates and Docker Engine with the official [Docker Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). Keep Proxmox and Ubuntu administration accessible only to your trusted LAN/VPN.

### 2. Copy and configure Troved

Copy this project to the VM using a private method such as `scp` over your LAN/VPN. From the project directory on Ubuntu:

```sh
cp .env.example .env
nano .env
```

Add only the cloud provider keys you use. Restrict the environment file to the VM account:

```sh
chmod 600 .env
```

Build and start the app:

```sh
docker compose up -d --build
docker compose logs -f troved
```

The web app and its same-origin AI API are served on port 3000. Visit `http://<VM-LAN-IP>:3000` from a device on your trusted network. No API key is exposed to the browser. The server contacts a configured provider to list available models, and sends Markdown content only when you explicitly choose **Improve** for an import; provider terms and charges apply.

### 3. Restrict network access

On the VM and in the Proxmox/network firewall, allow TCP 3000 only from your actual trusted LAN and VPN address ranges. For example, replace these example subnets with the ranges used by your network:

```sh
sudo ufw default deny incoming
sudo ufw allow from <ADMIN-LAN-CIDR> to any port 22 proto tcp
sudo ufw allow from <HOME-LAN-CIDR> to any port 3000 proto tcp
sudo ufw allow from <VPN-CIDR> to any port 3000 proto tcp
sudo ufw enable
sudo ufw status
```

Ensure the VPN routes clients to the VM's LAN address. Do not add an internet-facing port-forward or public reverse proxy: the server deliberately has no login because the chosen deployment is private-network-only. For remote access, connect to your VPN first.

Docker publishes container ports through its own firewall rules, which may bypass UFW rules on some Ubuntu configurations. Do not rely on UFW alone to restrict the published port: enforce the source-network restriction in the Proxmox firewall or another firewall layer that filters Docker-published traffic, and verify access from both an allowed and a disallowed network before relying on the deployment.

Plain HTTP on a private LAN is used by this setup. Browsers may disable direct folder autosave on a LAN HTTP address because it is not a secure browser context; JSON download/restore backups remain available. If you need folder autosave, use HTTPS with a certificate trusted by your devices while keeping the service private.

### Update the VM

After copying updated source files to the VM:

```sh
docker compose up -d --build
```

Keep `.env` backed up privately, never in source control. To stop the service, run `docker compose down`.

## Your data and backups

Troved stores its working copy in browser storage. In supported browsers such as current Chrome or Edge, **Preferences → Choose folder** can autosave a separate `wishlist.json` where the app is on localhost or HTTPS and you grant permission. If permission expires, reconnect the folder. On browsers or origins without direct folder writing, download JSON after editing and save it yourself.

Choosing a folder that already contains a wishlist merges unique groups and items with the current browser copy; matching items are not duplicated. A malformed folder file is reported and is not overwritten. Disconnecting leaves its file untouched. Use **ZIP backup** for a portable snapshot, or **Restore JSON** to merge a valid backup.

## Import details

Explicit EUR prices are used in totals. Non-EUR or uncertain amounts remain marked as unverified and are excluded. Prices entered in the app are stored as EUR estimates; optional daily reference rates from [Frankfurter](https://www.frankfurter.dev/) convert display totals and item prices.

## Keyboard and accessibility

- `Ctrl/Cmd + K` focuses wishlist search.
- `Ctrl/Cmd + I` opens the add-item form.
- Dialogs support Escape to close, focus restoration, and keyboard focus trapping.
- The interface follows the system's reduced-motion preference and includes light and dark themes.
