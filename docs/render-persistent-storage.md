# Render persistent storage for Qingchen Canvas

Qingchen Canvas stores the project database, canvas documents, uploads, generated outputs, thumbnails, collaboration evidence, and settings below one runtime root. The Render Blueprint fixes that root at `/var/data/t8` through `T8PC_DEV_DATA_ROOT`.

## Current safety boundary

Render Free web services have an ephemeral filesystem. `/var/data/t8` is therefore **not persistent on the Free plan**: a deploy, restart, or idle spin-down can remove its contents. Do not report durable canvases or generated artifacts while `/api/status` returns:

```json
{"storage":{"persistence":"unknown"}}
```

## Enable persistence in the Render dashboard

1. Upgrade `qingchen-atlascloud-canvas` from Free to a paid web-service instance.
2. Open the service's **Disks** page and attach a persistent disk with mount path `/var/data`.
3. Choose disk capacity for the expected SQLite database, uploads, generated images/videos, completion manifests, and temporary download headroom. Render disks can be increased later but not reduced.
4. Add environment variable `T8_PERSISTENT_DISK_CONFIGURED=1` only after the disk is attached at `/var/data`.
5. Deploy the latest `main` commit and wait for `/api/status` to report the exact commit, `phase=ready`, and `storage.persistence=configured`.

Only paths below the disk mount survive deploys. Do not change `T8PC_DEV_DATA_ROOT` away from `/var/data/t8` for the public service.

## Durability acceptance

After the disk-backed deploy is ready:

1. Create a uniquely named acceptance canvas and upload a small image with one stable `Idempotency-Key`.
2. Record the canvas ID, uploaded file URL, and `/api/status` commit without recording credentials or local paths.
3. Trigger one normal service restart or deploy of the same commit from Render.
4. Confirm the same canvas and file are readable after `phase=ready`.
5. Delete only the acceptance canvas/file created for this check.

Attaching a disk prevents zero-downtime deploys and limits the service to one instance. Brief unavailability during deploys is expected; durable Run recovery and stable Provider submission identity must handle the interruption without creating a second paid task.

Official references: [Render persistent disks](https://render.com/docs/disks) and [Render Free service limitations](https://render.com/docs/free).
