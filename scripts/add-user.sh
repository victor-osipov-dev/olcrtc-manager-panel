#!/bin/sh
set -eu

usage() {
	cat <<'USAGE'
Usage:
  add-user.sh CONFIG CLIENT_ID [options]

Options:
  --from CLIENT_ID          Copy locations from an existing client.
  --key KEY                Endpoint key for a generated default location.
  --name NAME              Location name for a generated default location.
  --room ROOM_ID           Room id for a generated default location.
  --carrier CARRIER        Provider for a generated default location (default: jitsi).
  --transport TRANSPORT    Transport for a generated default location (default: datachannel).
  --dns DNS                DNS for a generated default location (default: 1.1.1.1:53).
  --proxy-addr ADDR        Upstream SOCKS5 proxy host for the server side.
  --proxy-port PORT        Upstream SOCKS5 proxy port.
  --proxy-user USER        Optional upstream SOCKS5 username.
  --proxy-pass PASS        Optional upstream SOCKS5 password.
  --reload URL             POST URL after saving, for example http://127.0.0.1:8888/-/reload.
  -h, --help               Show this help.

If room_id is not set explicitly with --room, only jitsi rooms are generated
locally. WBStream and Telemost rooms must be created manually on the provider
site and passed with --room.
USAGE
}

die() {
	printf '%s\n' "$*" >&2
	exit 1
}

random_hex() {
	openssl rand -hex 32
}

[ "$#" -ge 1 ] || {
	usage
	exit 2
}

case "${1:-}" in
	-h|--help)
		usage
		exit 0
		;;
esac

[ "$#" -ge 2 ] || die "CONFIG and CLIENT_ID are required"

config=$1
client_id=$2
shift 2

from_client=
key=
location_name="Default"
room_id=
carrier="jitsi"
transport="datachannel"
dns="1.1.1.1:53"
proxy_addr=
proxy_port=
proxy_user=
proxy_pass=
reload_url=

while [ "$#" -gt 0 ]; do
	case "$1" in
		--from)
			[ "$#" -ge 2 ] || die "--from requires CLIENT_ID"
			from_client=$2
			shift 2
			;;
		--key)
			[ "$#" -ge 2 ] || die "--key requires KEY"
			key=$2
			shift 2
			;;
		--name)
			[ "$#" -ge 2 ] || die "--name requires NAME"
			location_name=$2
			shift 2
			;;
		--room)
			[ "$#" -ge 2 ] || die "--room requires ROOM_ID"
			room_id=$2
			shift 2
			;;
		--carrier)
			[ "$#" -ge 2 ] || die "--carrier requires CARRIER"
			carrier=$2
			shift 2
			;;
		--transport)
			[ "$#" -ge 2 ] || die "--transport requires TRANSPORT"
			transport=$2
			shift 2
			;;
		--dns)
			[ "$#" -ge 2 ] || die "--dns requires DNS"
			dns=$2
			shift 2
			;;
		--proxy-addr)
			[ "$#" -ge 2 ] || die "--proxy-addr requires ADDR"
			proxy_addr=$2
			shift 2
			;;
		--proxy-port)
			[ "$#" -ge 2 ] || die "--proxy-port requires PORT"
			proxy_port=$2
			shift 2
			;;
		--proxy-user)
			[ "$#" -ge 2 ] || die "--proxy-user requires USER"
			proxy_user=$2
			shift 2
			;;
		--proxy-pass)
			[ "$#" -ge 2 ] || die "--proxy-pass requires PASS"
			proxy_pass=$2
			shift 2
			;;
		--reload)
			[ "$#" -ge 2 ] || die "--reload requires URL"
			reload_url=$2
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "unknown option: $1"
			;;
	esac
done

[ -f "$config" ] || die "config does not exist: $config"

if [ -z "$key" ]; then
	key=$(random_hex)
fi

tmp=$(mktemp "${config}.tmp.XXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM

python3 - "$config" "$tmp" "$client_id" "$from_client" "$key" "$location_name" "$room_id" "$carrier" "$transport" "$dns" "$proxy_addr" "$proxy_port" "$proxy_user" "$proxy_pass" <<'PY'
import copy
import json
import subprocess
import sys
import uuid

config_path, tmp_path, client_id, from_client, key, location_name, room_id, carrier, transport, dns, proxy_addr, proxy_port, proxy_user, proxy_pass = sys.argv[1:]

with open(config_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

def new_key():
    return subprocess.check_output(["openssl", "rand", "-hex", "32"], text=True).strip()

def jitsi_base(current_room):
    current_room = (current_room or "").strip()
    if "/" in current_room:
        base = current_room.rsplit("/", 1)[0].rstrip("/")
        if base:
            return base
    return "https://meet.handyweb.org"

def new_room_id(room_carrier, current_room=""):
    room_carrier = (room_carrier or "").strip()
    if room_carrier == "jitsi":
        return f"{jitsi_base(current_room)}/{uuid.uuid4()}"
    raise SystemExit(
        f"{room_carrier} room generation is not supported by current olcrtc; "
        "create a room manually and pass --room"
    )

clients = cfg.get("clients")
legacy_locations = cfg.get("locations", [])
if clients is None:
    if any(loc.get("client-id") == client_id for loc in legacy_locations):
        raise SystemExit(f"client already exists: {client_id}")
else:
    if any(c.get("client-id") == client_id for c in clients):
        raise SystemExit(f"client already exists: {client_id}")

if from_client:
    if clients is None:
        locations = [copy.deepcopy(loc) for loc in legacy_locations if loc.get("client-id") == from_client]
    else:
        template = next((c for c in clients if c.get("client-id") == from_client), None)
        if template is None:
            raise SystemExit(f"template client not found: {from_client}")
        locations = copy.deepcopy(template.get("locations", []))
    if not locations:
        raise SystemExit(f"template client has no locations: {from_client}")
    for i, loc in enumerate(locations, 1):
        loc.pop("client-id", None)
        endpoint = loc.setdefault("endpoint", {})
        endpoint["room_id"] = new_room_id(loc.get("carrier", carrier), endpoint.get("room_id", ""))
        endpoint["key"] = new_key()
else:
    location = {
        "name": location_name,
        "endpoint": {
            "room_id": room_id or new_room_id(carrier),
            "key": key,
        },
        "carrier": carrier,
        "transport": {
            "type": transport,
        },
        "link": "direct",
        "data": "data",
        "dns": dns,
    }
    if proxy_addr or proxy_port or proxy_user or proxy_pass:
        location["proxy"] = {
            "addr": proxy_addr,
            "port": int(proxy_port or "0"),
            "user": proxy_user,
            "pass": proxy_pass,
        }
    locations = [location]

if clients is None:
    for loc in locations:
        loc["client-id"] = client_id
    cfg["locations"] = legacy_locations + locations
else:
    clients.append({
        "client-id": client_id,
        "locations": locations,
    })

with open(tmp_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

mv "$tmp" "$config"
trap - EXIT HUP INT TERM

if [ -n "$reload_url" ]; then
	curl -fsS -X POST "$reload_url" >/dev/null
fi

printf 'added client %s to %s\n' "$client_id" "$config"
