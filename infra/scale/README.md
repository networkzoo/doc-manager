# Scale HC3: connector host provisioning

Provisions a connector VM at a firm's own site — Linux instead of the
plan's default Windows/UNC deployment (docs/PLAN.md "Filesystem access
from the connector" covers this as the explicit non-Windows option). Use
this when the site has no convenient Windows Server to install the
connector directly onto, or (as here) when standing one up quickly on
existing Scale hardware is faster than getting a Windows install ready.

Unlike [`infra/proxmox`](../proxmox/README.md)'s portal VM, this is
**not a Proxmox VM** — it targets Scale Computing's HC3 hypervisor, which
supports cloud-init natively via a **Cloud-Init** tab in the VM
creation/edit dialog (paste user-data directly — no snippet file or ISO
injection needed, unlike Proxmox). Exact menu wording may vary by HC3
version; look for "Cloud-Init" or "User Data" when creating or editing a
VM.

## 1. Fill in the placeholders

Copy [`cloud-init/connector-user-data.yaml`](cloud-init/connector-user-data.yaml)
and replace every `REPLACE_ME_*`:

| Placeholder | Value |
|---|---|
| `REPLACE_ME_HOSTNAME` | e.g. `porrelli-law-connector` |
| `REPLACE_ME_SSH_PUBLIC_KEY` | your admin SSH public key |
| `REPLACE_ME_SMB_USERNAME` / `_PASSWORD` / `_DOMAIN` | the service account for the file share (docs/PLAN.md "Permissions Model": a dedicated account scoped to just this share, not a personal admin login) |
| `REPLACE_ME_FILE_SERVER_HOST` | the file server's hostname or IP |
| `REPLACE_ME_SHARE_NAME` | the SMB share name |
| `REPLACE_ME_CONNECTOR_ID` / `REPLACE_ME_CONNECTOR_TOKEN` | from `pnpm --filter @law-portal/db enroll-connector` (see `infra/deploy/README.md` "Enrolling a connector") — shown once, so enroll first and paste the values in here |

**Never commit a copy with real values filled in** — keep the filled-in
version local only, same as `infra/proxmox/cloud-init/user-data.yaml`'s
SSH key placeholder.

## 2. Create the VM in Scale HC3

Ubuntu Server LTS (24.04/"noble" or newer), minimal spec is fine — this
is a lightweight Go binary, not a database or web server. Paste the
filled-in YAML into the Cloud-Init/User Data field when creating the VM
(or attach a cloud image the same way the Proxmox flow does, if HC3's
creation flow expects one). Boot it.

## 3. Confirm provisioning succeeded

```bash
ssh opsadmin@<vm-ip>
systemctl status law-portal-connector    # will be crash-looping — expected, no binary yet
mount | grep connector-docroot           # confirms the CIFS mount succeeded
ls /srv/connector-docroot                # should show the real file share's contents
```

If the mount failed, `cloud-init status --long` and `journalctl -u
systemd-mount` on the VM will show why — wrong credentials, an SMB
version mismatch (`vers=3.0` in the mount options may need dropping to
`2.1` for an older server), or the share path being wrong are the usual
culprits.

## 4. Deploy the connector binary — the one manual step left

Cloud-init sets up everything except the binary itself (no private-repo
access baked in, deliberately — same reasoning as
`infra/deploy/README.md`'s deploy-key step, just not worth automating
for a single static binary). From a machine with the repo cloned and Go
installed (or cross-compile: `GOOS=linux GOARCH=amd64 go build`):

```bash
cd apps/connector
GOOS=linux GOARCH=amd64 go build -o connector ./cmd/connector
scp connector opsadmin@<vm-ip>:/opt/law-portal-connector/connector
ssh opsadmin@<vm-ip> "chmod +x /opt/law-portal-connector/connector && sudo systemctl restart law-portal-connector"
ssh opsadmin@<vm-ip> "sudo systemctl status law-portal-connector --no-pager -l"
```

`Restart=always` means it would have picked the binary up on its next
retry regardless — the explicit restart above just skips the wait.

## Not covered here

- **Updating the binary later** — repeat step 4's scp + restart. No
  auto-update mechanism yet (docs/PLAN.md Risk R4 flags this as needed
  before a real multi-firm fleet, not before).
- **NTFS ACL import / drift detection** (docs/PLAN.md "Permissions
  Model") — not built yet at all, Linux or Windows.
