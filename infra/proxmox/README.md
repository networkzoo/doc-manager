# Proxmox: portal VM

Builds the Ubuntu Server LTS VM that will host the portal, using
cloud-init instead of clicking through the OS installer. See
[`cloud-init/user-data.yaml`](cloud-init/user-data.yaml) for what actually
gets configured (Docker, Netbird client, patching, SSH hardening, a basic
firewall) — this file is the Proxmox-side walkthrough to get that
user-data attached to a real VM.

Run everything below **on a Proxmox node** (SSH in, or use the node's
Shell in the web UI). `<placeholders>` need your actual values —
`pvesm status` lists your storage names, and Datacenter → your node →
Network in the GUI lists bridge names (usually `vmbr0`).

## 1. Fetch the Ubuntu cloud image

Cloud images are the minimal, cloud-init-ready disk images Canonical
publishes — different from the installer ISO you'd normally use.

```bash
cd /var/lib/vz/template/iso   # or wherever you keep images on this node
wget https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
# "noble" = 24.04 LTS. Swap for the codename of whichever LTS you're targeting.
```

## 2. Create the VM shell

```bash
qm create 9000 \
  --name doc-manager-portal-template \
  --memory 2048 --cores 2 \
  --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-pci \
  --ostype l26
```

`9000` here is a template VM ID — pick any free ID your cluster doesn't
already use.

## 3. Import the cloud image as the VM's disk

```bash
qm importdisk 9000 noble-server-cloudimg-amd64.img <your-storage-id>
qm set 9000 --scsi0 <your-storage-id>:vm-9000-disk-0
qm set 9000 --boot c --bootdisk scsi0
qm set 9000 --ide2 <your-storage-id>:cloudinit
qm set 9000 --serial0 socket --vga serial0
```

`<your-storage-id>` is commonly `local-lvm` or `local-zfs` — check
`pvesm status` if unsure. The serial console line is optional but useful:
cloud images boot without a graphical console by default.

Cloud images ship with a tiny (~2–3GB) disk — grow it before first boot:

```bash
qm resize 9000 scsi0 32G
```

## 4. Attach the custom cloud-init user-data

Proxmox's own cloud-init GUI fields (user/password/SSH key/network) only
cover the basics — this deploy needs real cloud-init (`packages`,
`runcmd`, `write_files`), so it's supplied as a **snippet** instead.

**First**, if you haven't already: enable the "Snippets" content type on
a storage (Datacenter → Storage → `local` → Edit → check *Snippets*),
then copy the file there:

```bash
scp infra/proxmox/cloud-init/user-data.yaml \
  root@<proxmox-node>:/var/lib/vz/snippets/doc-manager-user-data.yaml
```

**Before copying it**, replace the placeholder SSH public key in
`user-data.yaml` with your real one — password auth gets disabled, so a
wrong key here means nobody can log in.

Then point the VM at it:

```bash
qm set 9000 --cicustom "user=local:snippets/doc-manager-user-data.yaml"
qm set 9000 --ipconfig0 ip=dhcp   # or ip=10.x.x.x/24,gw=10.x.x.x for static
```

## 5. Clone the real VM

```bash
qm clone 9000 101 --name doc-manager-portal --full
qm set 101 --memory 8192 --cores 4
qm resize 101 scsi0 64G
```

Adjust memory/cores/disk to what you actually want to give it — 8GB/4
cores/64GB is a reasonable pilot-scale starting point for the portal
container + Postgres (see docs/PLAN.md "Hosting & data residency").

**On NFS-backed storage (e.g. a Synology export), skip `qm template`
entirely — don't run it before the clone above.** Templating tries to
`chattr +i` the base disk to protect it, and NFS doesn't support that
ioctl, so it fails with `command '/usr/bin/chattr +i ...' failed: exit
code 1`. That step only matters for *linked* clones (space-efficient,
share blocks with the template); a `--full` clone works from an ordinary
VM just as well, and NFS with raw disks wouldn't support linked clones
regardless — so on this storage, templating buys nothing. VM 9000 stays
a normal (non-templated) VM and clones from it exactly the same way.

## 6. Boot and connect

```bash
qm start 101
```

Give cloud-init a minute or two to run (it reboots itself once done —
see `power_state` in user-data.yaml), then:

```bash
ssh opsadmin@<vm-ip>
docker --version   # confirms the Docker install step succeeded
```

## Not covered here

This provisions the **OS only**. Deploying the app itself — cloning the
repo onto the VM, real secrets in `.env`, running
`apps/portal/Dockerfile` with `docker compose` — is a separate step, not
yet written. Ask for it once the VM is reachable and you're ready to
deploy onto it.

Also not covered: joining the VM to your Netbird network (`netbird up
--setup-key <key>` — deliberately left as a manual step, see the comment
in user-data.yaml for why) and tightening the firewall rules in
user-data.yaml once your actual LAN/WAF addressing is finalized.
