#!/bin/sh
set -eu

usage() {
	cat <<'USAGE'
Usage:
  modify-user.sh CONFIG CLIENT_ID [options]

Options:
  --new-id CLIENT_ID       Rename the client.
  --location-name NAME     Set name for all client locations.
  --key KEY                Set endpoint.key for all client locations.
  --room-prefix PREFIX     Rewrite endpoint.room_id to PREFIX-1, PREFIX-2, ...
  --carrier CARRIER        Set carrier for all client locations.
  --transport TRANSPORT    Set transport.type for all client locations and clear payload.
  --dns DNS                Set dns for all client locations.
  --proxy-addr ADDR        Set upstream SOCKS5 proxy host for all client locations.
  --proxy-port PORT        Set upstream SOCKS5 proxy port.
  --proxy-user USER        Set upstream SOCKS5 username.
  --proxy-pass PASS        Set upstream SOCKS5 password.
  --clear-proxy            Remove upstream SOCKS5 proxy settings.
  --reload URL             POST URL after saving, for example http://127.0.0.1:8888/-/reload.
  -h, --help               Show this help.
USAGE
}

die() {
	printf '%s\n' "$*" >&2
	exit 1
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

new_id=
location_name=
key=
room_prefix=
carrier=
transport=
dns=
proxy_addr=
proxy_port=
proxy_user=
proxy_pass=
clear_proxy=0
reload_url=

while [ "$#" -gt 0 ]; do
	case "$1" in
		--new-id)
			[ "$#" -ge 2 ] || die "--new-id requires CLIENT_ID"
			new_id=$2
			shift 2
			;;
		--location-name)
			[ "$#" -ge 2 ] || die "--location-name requires NAME"
			location_name=$2
			shift 2
			;;
		--key)
			[ "$#" -ge 2 ] || die "--key requires KEY"
			key=$2
			shift 2
			;;
		--room-prefix)
			[ "$#" -ge 2 ] || die "--room-prefix requires PREFIX"
			room_prefix=$2
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
		--clear-proxy)
			clear_proxy=1
			shift
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

if [ -z "$new_id$location_name$key$room_prefix$carrier$transport$dns$proxy_addr$proxy_port$proxy_user$proxy_pass" ] && [ "$clear_proxy" -eq 0 ]; then
	die "nothing to change"
fi

tmp=$(mktemp "${config}.tmp.XXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM

python3 - "$config" "$tmp" "$client_id" "$new_id" "$location_name" "$key" "$room_prefix" "$carrier" "$transport" "$dns" "$proxy_addr" "$proxy_port" "$proxy_user" "$proxy_pass" "$clear_proxy" <<'PY'
import json
import sys

config_path, tmp_path, client_id, new_id, location_name, key, room_prefix, carrier, transport, dns, proxy_addr, proxy_port, proxy_user, proxy_pass, clear_proxy = sys.argv[1:]

with open(config_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

def update_locations(locations, set_client_id=False):
    for i, loc in enumerate(locations, 1):
        if new_id and (set_client_id or "client-id" in loc):
            loc["client-id"] = new_id
        if location_name:
            loc["name"] = location_name
        if key:
            loc.setdefault("endpoint", {})["key"] = key
        if room_prefix:
            loc.setdefault("endpoint", {})["room_id"] = f"{room_prefix}-{i}"
        if carrier:
            loc["carrier"] = carrier
        if transport:
            loc["transport"] = {"type": transport}
        if dns:
            loc["dns"] = dns
        if clear_proxy == "1":
            loc.pop("proxy", None)
        elif proxy_addr or proxy_port or proxy_user or proxy_pass:
            proxy = loc.setdefault("proxy", {})
            if proxy_addr:
                proxy["addr"] = proxy_addr
            if proxy_port:
                proxy["port"] = int(proxy_port)
            if proxy_user:
                proxy["user"] = proxy_user
            if proxy_pass:
                proxy["pass"] = proxy_pass

clients = cfg.get("clients")
if clients is None:
    locations = [loc for loc in cfg.get("locations", []) if loc.get("client-id") == client_id]
    if not locations:
        raise SystemExit(f"client not found: {client_id}")
    if new_id and any(loc.get("client-id") == new_id for loc in cfg.get("locations", [])):
        raise SystemExit(f"client already exists: {new_id}")
    update_locations(locations, set_client_id=True)
else:
    client = next((c for c in clients if c.get("client-id") == client_id), None)
    if client is None:
        raise SystemExit(f"client not found: {client_id}")
    if new_id and any(c.get("client-id") == new_id for c in clients):
        raise SystemExit(f"client already exists: {new_id}")
    if new_id:
        client["client-id"] = new_id
    update_locations(client.get("locations", []), set_client_id=False)

with open(tmp_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

mv "$tmp" "$config"
trap - EXIT HUP INT TERM

if [ -n "$reload_url" ]; then
	curl -fsS -X POST "$reload_url" >/dev/null
fi

printf 'modified client %s in %s\n' "$client_id" "$config"
