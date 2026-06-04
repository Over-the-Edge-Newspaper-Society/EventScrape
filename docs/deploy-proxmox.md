# Deploying EventScrape (Convex) to Proxmox

Target: a fresh Debian 13 LXC on the Proxmox host (`10.70.20.10`), running the
whole stack in Docker — self-hosted Convex backend + dashboard + admin SPA +
worker — with **MinIO (S3)** for file storage and **NPM** for `https://…overtheedgepaper.ca`
URLs on the LAN. Postgres/Redis are gone.

Two repos are involved:
- **EventScrape** (this repo): `docker-compose.server.yml`, the app, and
  `install/eventscrape-install.sh` is cloned onto the LXC.
- **proxmox-setup**: `playbooks/90-create-eventscrape-lxc.yml`,
  `playbooks/95-update-eventscrape.yml`, `install/eventscrape-install.sh`, and the
  vault keys in `group_vars/proxmox.yml`.

---

## 1. Prereqs (one-time)

**a) Generate the stable Convex instance secret** (makes the admin key deterministic):
```bash
openssl rand -hex 32
```

**b) MinIO access key/secret** for Convex. In the MinIO console (`http://10.70.20.168:9001`)
create an access key, or reuse the root creds. Buckets are auto-created by the installer
(`eventscrape-convex-files`, `-exports`, `-snapshots`, `-modules`, `-search`).

**c) DNS / NPM hostnames** — add two records in UniFi local DNS pointing at NPM (`10.70.20.104`):
- `eventscrape.overtheedgepaper.ca`   (already exists — currently → old `.139`)
- `convex-eventscrape.overtheedgepaper.ca`  (new)

**d) Fill the vault** (`proxmox-setup/group_vars/proxmox.yml`, edit with
`ansible-vault edit`). See the new `eventscrape_*` block in
`group_vars/proxmox.yml.example` — set:
- `eventscrape_convex_instance_secret`  → the hex from (a)
- `eventscrape_minio_access_key` / `eventscrape_minio_secret_key` → from (b)
- `eventscrape_convex_cloud_origin: "https://convex-eventscrape.overtheedgepaper.ca"`

---

## 2. Create the container + deploy

```bash
cd ~/proxmox-setup
ansible-playbook playbooks/90-create-eventscrape-lxc.yml --ask-vault-pass
```

This creates LXC **206** (`nesting=1,keyctl=1`), installs Docker + Node, clones the
repo, creates MinIO buckets, starts the Convex backend, generates the admin key,
`convex deploy`s the functions, then builds + starts admin/dashboard/worker.

At the end it prints the container IP. Note it (e.g. `10.70.20.206`).

---

## 3. NPM proxy hosts

In Nginx Proxy Manager (`http://10.70.20.104:81`), add/edit two Proxy Hosts (both
Let's Encrypt, like your others):

| Domain | Forward to | Notes |
|---|---|---|
| `convex-eventscrape.overtheedgepaper.ca` | `http` `10.70.20.206` `3210` | **Enable "Websockets Support"** (Convex needs it). Add first. |
| `eventscrape.overtheedgepaper.ca` | `http` `10.70.20.206` `3000` | The admin SPA. Repoint this from old `.139` once verified. |

> The Convex host MUST be reachable before the admin works, since the admin bundle
> was built with `CONVEX_CLOUD_ORIGIN = https://convex-eventscrape.overtheedgepaper.ca`.

---

## 4. Migrate the data (from this laptop's Convex)

On the laptop (where the migrated data + 932 images already live):
```bash
cd ~/github/EventScrape
set -a && source .env.local && set +a
pnpm backup:export                      # -> ./backups/snapshot_*.zip (tables + files)
```
Copy the snapshot to the LXC and import it:
```bash
scp backups/snapshot_*.zip ansible@10.70.20.10:/tmp/
ssh ansible@10.70.20.10 "sudo pct push 206 /tmp/snapshot_*.zip /root/snapshot.zip"
ssh ansible@10.70.20.10 "sudo pct exec 206 -- bash -lc '
  cd /opt/eventscrape && set -a && . .env.local && set +a
  npx convex import --replace /root/snapshot.zip
'"
```
(Or set `ESC_IMPORT_SNAPSHOT=/root/snapshot.zip` before running the installer to do
this automatically.)

---

## 5. Verify, then cut over

- Raw-IP smoke test: `http://10.70.20.206:3000/app` should render with data.
- Via NPM: `https://eventscrape.overtheedgepaper.ca/app` (after repointing the host).
- Convex dashboard: `http://10.70.20.206:6791`.
- Trigger a scrape from the UI and confirm a run completes; confirm Instagram
  images load (served from MinIO via Convex storage).

Keep the old `.139` box running until you're happy — it's the rollback. Repoint the
`eventscrape.overtheedgepaper.ca` NPM host to `10.70.20.206:3000`, retire `.139` later.

---

## 6. Updates later

```bash
cd ~/proxmox-setup
ansible-playbook playbooks/95-update-eventscrape.yml --ask-vault-pass
```
Pulls latest, re-`convex deploy`s functions, rebuilds admin + worker.

---

## Backups

- **Database**: the Convex DB lives in the `convex_data` Docker volume on the LXC.
  Snapshot the LXC in Proxmox, and/or run `pnpm backup:export` on a schedule.
- **Files** (images/exports): already durable in MinIO (and your NAS behind it).

## Notes / things to verify on first deploy
- `worker` reaches the backend at `http://backend:3210` over the compose network —
  no proxy involved. The browser uses the public `convex-eventscrape.*` URL.
- If image uploads from the worker fail, check that the worker container can resolve
  the public Convex hostname (LAN DNS) — or that MinIO presigned URLs are reachable.
- `CONVEX_CLOUD_ORIGIN` is **baked into the admin at build time**. If you change the
  hostname, re-run the update playbook (rebuilds the admin image).
- TLS terminates at NPM; the backend runs plain HTTP with `DO_NOT_REQUIRE_SSL=true`.
