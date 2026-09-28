# Deploy to Kubernetes (K3s)

Runs EventScrape on a single-node K3s cluster with a self-hosted Convex
backend. This is the successor to [deploy-proxmox.md](./deploy-proxmox.md),
which describes the Docker-in-LXC deployment.

Images are built on the cluster node and imported directly into containerd —
nothing is pushed to a registry.

Last verified: 2026-09-15, migrating 2,973 events and 5,745 runs from the LXC
deployment.

## Services

| Service | Image | Notes |
|---|---|---|
| `eventscrape-convex` | `ghcr.io/get-convex/convex-backend` | The entire dataset — SQLite + a `storage/` tree |
| `eventscrape-admin` | built from `apps/admin/Dockerfile` | SPA; `VITE_CONVEX_URL` baked in at build time |
| `eventscrape-worker` | built from `worker/Dockerfile` | Playwright/Chromium scrapers, 19 modules |
| `eventscrape-convex-dashboard` | `ghcr.io/get-convex/convex-dashboard` | Deployed without an Ingress |

```
events.k8s.overtheedgepaper.ca         -> admin SPA
convex-events.k8s.overtheedgepaper.ca  -> Convex backend (the BROWSER calls this)
```

## The admin SPA calls Convex from the browser

This is the constraint that shapes everything else. `VITE_CONVEX_URL` is baked
into the admin bundle at **build time** and must equal the URL the **browser**
uses — not an in-cluster Service name. Convex also uses it to mint file URLs.

So Convex needs its own publicly-resolvable hostname and its own Ingress, and
**changing that hostname means rebuilding the admin image**. The worker is
server-side and uses the internal Service address (`http://eventscrape-convex:3210`)
instead.

## Everyday development loop

```sh
./scripts/eventscrape-deploy.sh      # in the infrastructure repo
```

Builds both images on the node from the current working tree — uncommitted
changes included — rolls them out together, records the previous images for
`--rollback`, and prunes old dev images so the node disk does not fill.

### Deploying Convex functions

The image deployment script does **not** deploy `convex/` functions. Backend-only
changes must be pushed to the existing Convex service separately; they do not
require rebuilding images or restarting pods.

From the EventScrape repository, run the backend checks:

```sh
pnpm exec tsc --noEmit -p convex/tsconfig.json
pnpm exec tsx --test scripts/tests/schedules.test.ts
```

Then deploy using the existing instance credentials, keeping the key out of
command output and files:

```sh
(
  export CONVEX_SELF_HOSTED_URL=https://convex-events.k8s.overtheedgepaper.ca
  export CONVEX_SELF_HOSTED_ADMIN_KEY="$(
    kubectl --kubeconfig "$HOME/.kube/ote-k3s.yaml" -n eventscrape \
      exec deploy/eventscrape-convex -- ./generate_admin_key.sh
  )"
  pnpm exec convex deploy -y --typecheck enable --codegen disable
)
```

Add `--dry-run` to inspect a deployment before applying it.

### Scheduler read-limit incident (2026-09-28)

The dispatcher continued ticking, but daily runs stopped after September 17.
Two WordPress export selections together read approximately 16.9 MB in a single
`schedules.runDue` transaction, exceeding Convex's 16 MiB read limit. The failure
rolled back the exports and all six website scrape jobs in the same transaction.
Healthy pods and an idle worker queue did not reveal this failure.

`runDue` now only schedules independent `runScheduled` mutations and records
`lastRunAt` atomically with that dispatch. Each schedule has its own read budget
and transaction. A failing export cannot roll back another schedule's scraping
jobs. `lastRunAt` records dispatch, not successful scraping; inspect run history
and Convex scheduled-function failures to confirm completion. Each individual
export must still fit within Convex's limits.

Deployed and verified on September 28: a real cron tick dispatched the library
source, `runScheduled` created its worker job, and the scrape completed
successfully in 54 seconds (3 events reported). The library's temporary test
cadence was restored to `0 6 * * *` in `America/Vancouver`.

Source activation and scheduling are separate: syncing a new source does not
create a schedule. Restoring the dispatcher does not schedule the eleven newer
website sources or enable the disabled Instagram schedule.

## Build fixes required for the k8s build

Three problems had to be fixed before the images would build at all. All three
also affect anyone building today with a current toolchain:

**1. pnpm was unpinned.** The Dockerfiles ran `npm install -g pnpm`, which now
installs pnpm 12, while `pnpm-lock.yaml` is `lockfileVersion: 9.0`. pnpm 10+
*errors* on ignored build scripts rather than warning:

```
ERR_PNPM_IGNORED_BUILDS
  Ignored build scripts: better-sqlite3, es5-ext, esbuild, msgpackr-extract
```

Fixed by pinning `packageManager: pnpm@9.15.9` in `package.json` and using
`npm install -g pnpm@9.15.9` in all three Dockerfiles.

**2. `pnpm-workspace.yaml` had placeholder text.** It carried an `allowBuilds:`
block whose values were the literal string `set this to true or false`, which
configured nothing. Replaced with a real `onlyBuiltDependencies` list, so the
build also works if the pin is later raised to pnpm 10+.

**3. The admin Dockerfile lost its workspace dependencies.** Its builder stage
copied only the root `node_modules`, but pnpm workspaces keep each package's
dependencies in that package's own `node_modules`. The build failed with:

```
error TS2688: Cannot find type definition file for 'vite/client'
```

Fixed by also copying `apps/admin/node_modules`. The worker Dockerfile avoids
the problem differently, by installing with `--shamefully-hoist`.

## Migrating data from the LXC deployment

The dataset is one Docker volume, `eventscrape_convex_data` — a `db.sqlite3`
plus a `storage/` tree. **Stop the backend and worker before copying it**: a
SQLite file copied while being written can be inconsistent. The checksum
changes between a running and a stopped snapshot, so this is not theoretical.

```sh
# on the LXC host
cd /opt/eventscrape
docker compose -f docker-compose.server.yml stop worker backend   # expect Exited (0)
cd /var/lib/docker/volumes/eventscrape_convex_data/_data
tar czf /tmp/es-convex.tgz .
md5sum db.sqlite3            # record this and verify it at the destination
```

Extract into the cluster PVC with the Convex deployment scaled to 0, then scale
back up. Verify with `dashboard:stats`, which returns event and run counts.

Reuse `CONVEX_INSTANCE_NAME` and `CONVEX_INSTANCE_SECRET` from the old `.env`:
the migrated database carries that instance identity, and a mismatch prevents
the backend opening it.

> The compose file supports offloading file storage to MinIO via `S3_*` vars,
> but in the LXC deployment those were all empty, so storage is local and moves
> with the volume. Check before assuming otherwise.

## Storage durability

The Convex PVC uses `local-path`, not a network StorageClass: Convex stores data
in SQLite, which needs real filesystem locking, and SQLite over NFS risks
corruption. **The dataset therefore lives on the cluster node's disk and does not
survive a node rebuild.** Back it up.
