import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  KeyRound,
  LogOut,
  Lock,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "./index.css";

type LocationState = {
  name: string;
  room_id: string;
  key: string;
  uri: string;
  carrier: string;
  transport: string;
  payload: Record<string, string>;
  link: string;
  dns: string;
  running: boolean;
  runtime: RuntimeState;
};

type RuntimeState = {
  status: string;
  running: boolean;
  pid?: number;
  started_at?: string;
  exited_at?: string;
  exit_error?: string;
  log_count: number;
};

type LogLine = {
  time: string;
  stream: string;
  line: string;
};

type ClientLogGroup = {
  location: LocationState;
  lines: LogLine[];
  error?: string;
};

type ClientState = {
  client_id: string;
  quota: Quota;
  locations: LocationState[];
};

type Quota = {
  speed_mbps?: number;
  traffic_gb?: number;
  used_gb?: number;
  used_bytes?: number;
  expires_at?: string;
};

type State = {
  name: string;
  port: number;
  client_count: number;
  running_count: number;
  clients: ClientState[];
};

type Metrics = {
  go: {
    version: string;
    goroutines: number;
  };
  memory: {
    alloc_bytes: number;
    sys_bytes: number;
    heap_alloc_bytes: number;
  };
  manager: RuntimeState;
  children: Array<{
    client_id: string;
    room_id: string;
    transport: string;
    name: string;
    runtime: RuntimeState;
  }>;
};

type AuditEvent = {
  time: string;
  action: string;
  detail: string;
};

type ClientLocationForm = {
  name: string;
  room_id: string;
  key: string;
  carrier: string;
  transport: string;
  payload: Record<string, string>;
  dns: string;
};

type ClientForm = {
  client_id: string;
  quota: Quota;
  locations: ClientLocationForm[];
};

const carriers = ["wbstream", "jazz", "telemost"];
const transportsByCarrier: Record<string, string[]> = {
  wbstream: ["datachannel", "vp8channel", "seichannel", "videochannel"],
  jazz: ["datachannel", "vp8channel", "seichannel", "videochannel"],
  telemost: ["vp8channel", "videochannel"],
};

const defaultLocationForm: ClientLocationForm = {
  name: "",
  room_id: "",
  key: "",
  carrier: "wbstream",
  transport: "datachannel",
  payload: {},
  dns: "1.1.1.1:53",
};

const defaultForm: ClientForm = {
  client_id: "",
  quota: {},
  locations: [{ ...defaultLocationForm }],
};

const payloadFields: Record<string, Array<{ key: string; label: string; defaultValue: string }>> = {
  datachannel: [],
  vp8channel: [
    { key: "vp8-fps", label: "FPS", defaultValue: "60" },
    { key: "vp8-batch", label: "Batch", defaultValue: "64" },
  ],
  seichannel: [
    { key: "fps", label: "FPS", defaultValue: "60" },
    { key: "batch", label: "Batch", defaultValue: "64" },
    { key: "frag", label: "Fragment bytes", defaultValue: "900" },
    { key: "ack-ms", label: "ACK timeout ms", defaultValue: "2000" },
  ],
  videochannel: [
    { key: "video-w", label: "Width", defaultValue: "1080" },
    { key: "video-h", label: "Height", defaultValue: "1080" },
    { key: "video-fps", label: "FPS", defaultValue: "60" },
    { key: "video-bitrate", label: "Bitrate", defaultValue: "5000k" },
    { key: "video-codec", label: "Codec", defaultValue: "qrcode" },
    { key: "video-hw", label: "Hardware accel", defaultValue: "none" },
  ],
};

async function request(path: string, options?: RequestInit) {
  const res = await fetch(path, options);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("olcrtc-auth-required"));
    throw new Error((await res.text()).trim() || res.statusText);
  }
  return res;
}

function transportOptions(carrier: string) {
  return transportsByCarrier[carrier] ?? transportsByCarrier.wbstream;
}

function normalizeLocationForm(location: ClientLocationForm): ClientLocationForm {
  const options = transportOptions(location.carrier);
  const transport = options.includes(location.transport) ? location.transport : options[0];
  const fields = payloadFields[transport] ?? [];
  const allowed = new Set(fields.map((field) => field.key));
  const payload = Object.fromEntries(Object.entries(location.payload).filter(([key]) => allowed.has(key)));
  for (const field of fields) {
    if (!payload[field.key]?.trim()) payload[field.key] = field.defaultValue;
  }
  return {
    ...location,
    transport,
    payload,
  };
}

function normalizeForm(form: ClientForm): ClientForm {
  return {
    ...form,
    locations: form.locations.length ? form.locations.map(normalizeLocationForm) : [{ ...defaultLocationForm }],
  };
}

function payloadForSubmit(payload: Record<string, string>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value.trim() !== ""));
}

function randomHex64() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatBytes(bytes?: number) {
  if (!bytes) return "...";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function subscriptionURL(clientID: string) {
  return `${window.location.origin}/${encodeURIComponent(clientID)}/`;
}

function cleanQuota(quota: Quota): Quota {
  return {
    speed_mbps: quota.speed_mbps || undefined,
    traffic_gb: quota.traffic_gb || undefined,
    used_gb: quota.used_gb || undefined,
    used_bytes: quota.used_bytes || undefined,
    expires_at: quota.expires_at?.trim() || undefined,
  };
}

function locationsForSubmit(locations: ClientLocationForm[]) {
  return locations.map((location) => ({
    name: location.name.trim(),
    room_id: location.room_id.trim(),
    key: location.key.trim(),
    carrier: location.carrier,
    transport: location.transport,
    payload: payloadForSubmit(location.payload),
    dns: location.dns.trim(),
  }));
}

function quotaText(quota?: Quota) {
  if (!quota) return "none";
  const parts = [];
  if (quota.speed_mbps) parts.push(`${quota.speed_mbps} Mbps`);
  if (quota.traffic_gb) {
    const used = quota.used_bytes ? (quota.used_bytes / 1024 / 1024 / 1024).toFixed(2) : `${quota.used_gb ?? 0}`;
    parts.push(`${used}/${quota.traffic_gb} GB`);
  }
  if (quota.expires_at) parts.push(`до ${quota.expires_at}`);
  return parts.length ? parts.join(" · ") : "none";
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-normal">{value}</div>
    </div>
  );
}

function HeaderMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid h-9 min-w-24 content-center rounded-md border border-border bg-card px-3">
      <div className="text-[10px] uppercase leading-3 text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold leading-4">{value}</div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted hover:bg-muted/80"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LoginView({ setupRequired, onLogin }: { setupRequired: boolean; onLogin: () => void }) {
  const [user, setUser] = useState("admin");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (setupRequired && password !== repeat) throw new Error("Пароли не совпадают");
      await request(setupRequired ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-5">
      <form className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-card p-5" onSubmit={submit}>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/15 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-normal">OlcRTC Manager</h1>
            <div className="text-sm text-muted-foreground">{setupRequired ? "Первичная настройка" : "Вход в панель"}</div>
          </div>
        </div>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Логин
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={user}
            onChange={(event) => setUser(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Пароль
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {setupRequired && (
          <label className="grid gap-2 text-sm text-muted-foreground">
            Повтор пароля
            <input
              className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
            />
          </label>
        )}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
          disabled={busy}
        >
          <Lock className="h-4 w-4" />
          {setupRequired ? "Сохранить пароль" : "Войти"}
        </button>
      </form>
    </div>
  );
}

function ClientSettingsFields({
  form,
  setForm,
  includeClientID,
}: {
  form: ClientForm;
  setForm: (form: ClientForm) => void;
  includeClientID: boolean;
}) {
  const set = (patch: Partial<ClientForm>) => setForm(normalizeForm({ ...form, ...patch }));

  return (
    <div className="grid gap-4">
      {includeClientID && (
        <label className="grid gap-2 text-sm text-muted-foreground">
          ID клиента
          <div className="flex gap-2">
            <input
              className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
              value={form.client_id}
              onChange={(event) => set({ client_id: event.target.value })}
              placeholder="client-id"
            />
            <button
              className="inline-flex h-10 items-center rounded-md border border-primary bg-secondary px-3 text-xs font-medium text-primary hover:bg-primary/10"
              type="button"
              onClick={() => {
                const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                const bytes = new Uint8Array(21);
                crypto.getRandomValues(bytes);
                let client_id = "";
                for (let i = 0; i < bytes.length; i++) {
                  client_id += ALPHABET[bytes[i] % 62];
                }
                set({ client_id });
              }}
            >
              Generate
            </button>
          </div>
        </label>
      )}
      <div className="grid gap-3 rounded-md border border-border bg-background p-3">
        <div className="text-sm font-medium text-foreground">Квоты клиента</div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-muted-foreground">
            Скорость, Mbps
            <input
              className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              type="number"
              min="0"
              value={form.quota.speed_mbps ?? ""}
              onChange={(event) => set({ quota: { ...form.quota, speed_mbps: Number(event.target.value) || undefined } })}
              placeholder="без лимита"
            />
          </label>
          <label className="grid gap-2 text-sm text-muted-foreground">
            Трафик, GB
            <input
              className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              type="number"
              min="0"
              value={form.quota.traffic_gb ?? ""}
              onChange={(event) => set({ quota: { ...form.quota, traffic_gb: Number(event.target.value) || undefined } })}
              placeholder="без лимита"
            />
          </label>
          <label className="grid gap-2 text-sm text-muted-foreground">
            Использовано, GB
            <input
              className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              type="number"
              min="0"
              value={form.quota.used_gb ?? ""}
              onChange={(event) => set({ quota: { ...form.quota, used_gb: Number(event.target.value) || undefined, used_bytes: undefined } })}
              placeholder="0"
            />
          </label>
          <label className="grid gap-2 text-sm text-muted-foreground">
            Действует до
            <input
              className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              type="date"
              value={form.quota.expires_at ?? ""}
              onChange={(event) => set({ quota: { ...form.quota, expires_at: event.target.value || undefined } })}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function LocationFormFields({
  location,
  setLocation,
}: {
  location: ClientLocationForm;
  setLocation: (location: ClientLocationForm) => void;
}) {
  const set = (patch: Partial<ClientLocationForm>) => setLocation(normalizeLocationForm({ ...location, ...patch }));
  const fields = payloadFields[location.transport] ?? [];

  return (
    <div className="grid gap-3">
      <label className="grid gap-2 text-sm text-muted-foreground">
        Название локации
        <input
          className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
          value={location.name}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Default location"
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm text-muted-foreground">
          Carrier
          <select
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={location.carrier}
            onChange={(event) => set({ carrier: event.target.value })}
          >
            {carriers.map((carrier) => (
              <option key={carrier} value={carrier}>
                {carrier}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Transport
          <select
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={location.transport}
            onChange={(event) => set({ transport: event.target.value })}
          >
            {transportOptions(location.carrier).map((transport) => (
              <option key={transport} value={transport}>
                {transport}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm text-muted-foreground">
        Room ID
        <input
          className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
          value={location.room_id}
          onChange={(event) => set({ room_id: event.target.value })}
          placeholder="room-id"
        />
      </label>
      <label className="grid gap-2 text-sm text-muted-foreground">
        Key
        <div className="flex gap-2">
          <input
            className="h-10 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-primary"
            value={location.key}
            onChange={(event) => set({ key: event.target.value })}
            placeholder="64 hex chars"
          />
          <button
            className="inline-flex h-10 items-center rounded-md border border-primary bg-secondary px-3 text-xs font-medium text-primary hover:bg-primary/10"
            type="button"
            onClick={() => set({ key: randomHex64() })}
          >
            Generate
          </button>
        </div>
      </label>
      <label className="grid gap-2 text-sm text-muted-foreground">
        DNS
        <input
          className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
          value={location.dns}
          onChange={(event) => set({ dns: event.target.value })}
          placeholder="1.1.1.1:53"
        />
      </label>
      {fields.length > 0 && (
        <div className="grid gap-3 rounded-md border border-border bg-background p-3">
          <div className="text-sm font-medium text-foreground">Параметры транспорта</div>
          <div className="grid gap-3 md:grid-cols-2">
            {fields.map((field) => (
              <label key={field.key} className="grid gap-2 text-sm text-muted-foreground">
                {field.label}
                <input
                  className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                  value={location.payload[field.key] ?? ""}
                  onChange={(event) =>
                    set({
                      payload: {
                        ...location.payload,
                        [field.key]: event.target.value,
                      },
                    })
                  }
                  placeholder={field.defaultValue}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ClientFormFields({
  form,
  setForm,
  includeClientID,
}: {
  form: ClientForm;
  setForm: (form: ClientForm) => void;
  includeClientID: boolean;
}) {
  const set = (patch: Partial<ClientForm>) => setForm(normalizeForm({ ...form, ...patch }));

  const setLocation = (index: number, patch: Partial<ClientLocationForm>) => {
    const locations = form.locations.map((location, current) =>
      current === index ? normalizeLocationForm({ ...location, ...patch }) : location,
    );
    set({ locations });
  };

  const addLocation = () => set({ locations: [...form.locations, { ...defaultLocationForm }] });

  const removeLocation = (index: number) => {
    if (form.locations.length <= 1) return;
    set({ locations: form.locations.filter((_, current) => current !== index) });
  };

  return (
    <div className="grid gap-4">
      {includeClientID && (
        <label className="grid gap-2 text-sm text-muted-foreground">
          ID клиента
          <div className="flex gap-2">
            <input
              className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
              value={form.client_id}
              onChange={(event) => set({ client_id: event.target.value })}
              placeholder="client-id"
            />
            <button
              className="inline-flex h-10 items-center rounded-md border border-primary bg-secondary px-3 text-xs font-medium text-primary hover:bg-primary/10"
              type="button"
              onClick={() => {
                const ALPHABET =
                  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

                const bytes = new Uint8Array(21);
                crypto.getRandomValues(bytes);

                let client_id = "";
                for (let i = 0; i < bytes.length; i++) {
                  client_id += ALPHABET[bytes[i] % 62];
                }

                set({ client_id });
              }}
            >
              Generate
            </button>
          </div>
        </label>
      )}
      <div className="grid gap-3 rounded-md border border-border bg-background p-3">
        <div className="text-sm font-medium text-foreground">Квоты клиента</div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-muted-foreground">
            Скорость, Mbps
            <input
              className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              type="number"
              min="0"
              value={form.quota.speed_mbps ?? ""}
              onChange={(event) => set({ quota: { ...form.quota, speed_mbps: Number(event.target.value) || undefined } })}
              placeholder="без лимита"
            />
          </label>
          <label className="grid gap-2 text-sm text-muted-foreground">
            Трафик, GB
            <input
              className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              type="number"
              min="0"
              value={form.quota.traffic_gb ?? ""}
              onChange={(event) => set({ quota: { ...form.quota, traffic_gb: Number(event.target.value) || undefined } })}
              placeholder="без лимита"
            />
          </label>
          <label className="grid gap-2 text-sm text-muted-foreground">
            Использовано, GB
            <input
              className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              type="number"
              min="0"
              value={form.quota.used_gb ?? ""}
              onChange={(event) => set({ quota: { ...form.quota, used_gb: Number(event.target.value) || undefined, used_bytes: undefined } })}
              placeholder="0"
            />
          </label>
          <label className="grid gap-2 text-sm text-muted-foreground">
            Действует до
            <input
              className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
              type="date"
              value={form.quota.expires_at ?? ""}
              onChange={(event) => set({ quota: { ...form.quota, expires_at: event.target.value || undefined } })}
            />
          </label>
        </div>
      </div>
      {form.locations.map((location, index) => {
        const fields = payloadFields[location.transport] ?? [];
        return (
          <div key={index} className="grid gap-3 rounded-md border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">Комната {index + 1}</div>
              {form.locations.length > 1 && (
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-destructive/40 px-2 text-sm text-destructive hover:bg-destructive/10"
                  type="button"
                  onClick={() => removeLocation(index)}
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </button>
              )}
            </div>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Название локации
              <input
                className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                value={location.name}
                onChange={(event) => setLocation(index, { name: event.target.value })}
                placeholder="Default location"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-muted-foreground">
                Carrier
                <select
                  className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                  value={location.carrier}
                  onChange={(event) => setLocation(index, { carrier: event.target.value })}
                >
                  {carriers.map((carrier) => (
                    <option key={carrier} value={carrier}>
                      {carrier}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm text-muted-foreground">
                Transport
                <select
                  className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                  value={location.transport}
                  onChange={(event) => setLocation(index, { transport: event.target.value })}
                >
                  {transportOptions(location.carrier).map((transport) => (
                    <option key={transport} value={transport}>
                      {transport}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Room ID
              <input
                className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                value={location.room_id}
                onChange={(event) => setLocation(index, { room_id: event.target.value })}
                placeholder="room-id"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Key
              <div className="flex gap-2">
                <input
                  className="h-10 flex-1 rounded-md border border-border bg-card px-3 font-mono text-xs text-foreground outline-none focus:border-primary"
                  value={location.key}
                  onChange={(event) => setLocation(index, { key: event.target.value })}
                  placeholder="64 hex chars"
                />
                <button
                  className="inline-flex h-10 items-center rounded-md border border-primary bg-secondary px-3 text-xs font-medium text-primary hover:bg-primary/10"
                  type="button"
                  onClick={() => setLocation(index, { key: randomHex64() })}
                >
                  Generate
                </button>
              </div>
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              DNS
              <input
                className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                value={location.dns}
                onChange={(event) => setLocation(index, { dns: event.target.value })}
                placeholder="1.1.1.1:53"
              />
            </label>
            {fields.length > 0 && (
              <div className="grid gap-3 rounded-md border border-border bg-card p-3">
                <div className="text-sm font-medium text-foreground">Параметры транспорта</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {fields.map((field) => (
                    <label key={field.key} className="grid gap-2 text-sm text-muted-foreground">
                      {field.label}
                      <input
                        className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
                        value={location.payload[field.key] ?? ""}
                        onChange={(event) =>
                          setLocation(index, {
                            payload: {
                              ...location.payload,
                              [field.key]: event.target.value,
                            },
                          })
                        }
                        placeholder={field.defaultValue}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
        type="button"
        onClick={addLocation}
      >
        <Plus className="h-4 w-4" />
        Добавить комнату
      </button>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<ClientState | null>(null);
  const [createLocationClient, setCreateLocationClient] = useState<ClientState | null>(null);
  const [editLocation, setEditLocation] = useState<{ client: ClientState; location: LocationState; index: number } | null>(null);
  const [logTarget, setLogTarget] = useState<{ clientID: string; location: LocationState } | null>(null);
  const [clientLogTarget, setClientLogTarget] = useState<ClientState | null>(null);
  const [qrTarget, setQrTarget] = useState<{ clientID: string; location: LocationState } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [clientLogs, setClientLogs] = useState<ClientLogGroup[]>([]);
  const [createForm, setCreateForm] = useState<ClientForm>(defaultForm);
  const [editForm, setEditForm] = useState<ClientForm>(defaultForm);
  const [locationForm, setLocationForm] = useState<ClientLocationForm>(defaultLocationForm);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", repeat: "" });
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        try {
          const body = (await res.json()) as { setup_required?: boolean };
          setSetupRequired(Boolean(body.setup_required));
        } catch {
          setSetupRequired(false);
        }
        setAuthenticated(false);
        return;
      }
      const body = (await res.json()) as { setup_required?: boolean };
      setSetupRequired(Boolean(body.setup_required));
      if (body.setup_required) {
        setAuthenticated(false);
        return;
      }
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
    }
  };

  const afterLogin = async () => {
    await checkAuth();
    await Promise.all([loadState(), loadMetrics(), loadAudit()]).catch((err) => setNotice(err.message));
  };

  const loadState = async () => {
    const res = await request("/api/state", { cache: "no-store" });
    setState((await res.json()) as State);
  };

  const loadMetrics = async () => {
    const res = await request("/api/metrics", { cache: "no-store" });
    setMetrics((await res.json()) as Metrics);
  };

  const loadAudit = async () => {
    const res = await request("/api/audit", { cache: "no-store" });
    const body = (await res.json()) as { events: AuditEvent[] };
    setAudit(body.events ?? []);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    const handler = () => setAuthenticated(false);
    window.addEventListener("olcrtc-auth-required", handler);
    return () => window.removeEventListener("olcrtc-auth-required", handler);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    Promise.all([loadState(), loadMetrics(), loadAudit()]).catch((err) => setNotice(err.message));
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    const id = window.setInterval(() => {
      Promise.all([loadState(), loadMetrics()]).catch((err) => setNotice(err.message));
    }, 5000);
    return () => window.clearInterval(id);
  }, [authenticated]);

  const clients = state?.clients ?? [];

  const runAction = async (action: () => Promise<void>, okText: string) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(okText);
      await loadState();
      await loadMetrics();
      await loadAudit();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setCreateForm(normalizeForm({ ...defaultForm, locations: [{ ...defaultLocationForm }] }));
    setCreateOpen(true);
  };

  const openEdit = (client: ClientState) => {
    setEditClient(client);
    setEditForm(
      normalizeForm({
        client_id: client.client_id,
        quota: client.quota ?? {},
        locations: [{ ...defaultLocationForm }],
      }),
    );
  };

  const openCreateLocation = (client: ClientState) => {
    setCreateLocationClient(client);
    setLocationForm({ ...defaultLocationForm });
  };

  const openEditLocation = (client: ClientState, location: LocationState, index: number) => {
    setEditLocation({ client, location, index });
    setLocationForm(
      normalizeLocationForm({
        name: location.name,
        room_id: location.room_id,
        key: location.key,
        carrier: location.carrier,
        transport: location.transport,
        payload: location.payload ?? {},
        dns: location.dns,
      }),
    );
  };

  const addClient = () =>
    runAction(async () => {
      if (!createForm.client_id.trim()) throw new Error("Укажи ID клиента");
      await request("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: createForm.client_id.trim(),
          quota: cleanQuota(createForm.quota),
          locations: locationsForSubmit(createForm.locations),
        }),
      });
      setCreateOpen(false);
    }, "Клиент создан");

  const updateClient = () =>
    runAction(async () => {
      if (!editClient) return;
      if (!editForm.client_id.trim()) throw new Error("Укажи ID клиента");
      await request(`/api/clients/${encodeURIComponent(editClient.client_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: editForm.client_id.trim(),
          quota: cleanQuota(editForm.quota),
        }),
      });
      setEditClient(null);
    }, "Клиент обновлен");

  const addLocation = () =>
    runAction(async () => {
      if (!createLocationClient) return;
      await request(`/api/clients/${encodeURIComponent(createLocationClient.client_id)}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locations: locationsForSubmit([locationForm]),
        }),
      });
      setCreateLocationClient(null);
      setExpandedClients((current) => ({ ...current, [createLocationClient.client_id]: true }));
    }, "Локация создана");

  const updateLocation = () =>
    runAction(async () => {
      if (!editLocation) return;
      const nextLocations = editLocation.client.locations.map((location, index) =>
        index === editLocation.index
          ? locationForm
          : {
              name: location.name,
              room_id: location.room_id,
              key: location.key,
              carrier: location.carrier,
              transport: location.transport,
              payload: location.payload ?? {},
              dns: location.dns,
            },
      );
      await request(`/api/clients/${encodeURIComponent(editLocation.client.client_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: editLocation.client.client_id,
          quota: cleanQuota(editLocation.client.quota),
          locations: locationsForSubmit(nextLocations),
        }),
      });
      setEditLocation(null);
    }, "Локация обновлена");

  const deleteClient = (id: string) =>
    runAction(async () => {
      if (!window.confirm(`Удалить клиента ${id} и все его локации?`)) return;
      await request(`/api/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
    }, "Клиент удален");

  const deleteLocation = (clientID: string, location: LocationState) =>
    runAction(async () => {
      if (!window.confirm(`Удалить локацию ${location.name || location.room_id}?`)) return;
      await request(`/api/clients/${encodeURIComponent(clientID)}/locations/${encodeURIComponent(location.room_id)}`, {
        method: "DELETE",
      });
    }, "Локация удалена");

  const restartLocation = (clientID: string, location: LocationState) =>
    runAction(async () => {
      await request("/api/actions/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientID,
          room_id: location.room_id,
          transport: location.transport,
        }),
      });
    }, `${clientID} перезапущен`);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    setState(null);
    setMetrics(null);
  };

  const changePassword = () =>
    runAction(async () => {
      if (passwordForm.next !== passwordForm.repeat) throw new Error("Новые пароли не совпадают");
      await request("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: passwordForm.current, new_password: passwordForm.next }),
      });
      setPasswordForm({ current: "", next: "", repeat: "" });
      setShowPassword(false);
      setAuthenticated(false);
    }, "Пароль изменен, войди заново");

  const openLogs = async (clientID: string, location: LocationState) => {
    setLogs([]);
    setNotice("");
    try {
      const res = await request(
        `/api/logs/${encodeURIComponent(clientID)}/${encodeURIComponent(location.room_id)}/${encodeURIComponent(
          location.transport,
        )}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as { logs: LogLine[] };
      setLogs(body.logs ?? []);
      setLogTarget({ clientID, location });
    } catch (err) {
      setLogTarget(null);
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const openClientLogs = async (client: ClientState) => {
    setClientLogs([]);
    setNotice("");
    setClientLogTarget(client);
    const groups = await Promise.all(
      client.locations.map(async (location) => {
        try {
          const res = await request(
            `/api/logs/${encodeURIComponent(client.client_id)}/${encodeURIComponent(location.room_id)}/${encodeURIComponent(
              location.transport,
            )}`,
            { cache: "no-store" },
          );
          const body = (await res.json()) as { logs: LogLine[] };
          return { location, lines: body.logs ?? [] };
        } catch (err) {
          return { location, lines: [], error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    setClientLogs(groups);
  };

  const copyLogs = () =>
    runAction(async () => {
      await navigator.clipboard.writeText(
        logs.map((line) => `[${line.time}] ${line.stream}: ${line.line}`).join("\n"),
      );
    }, "Логи скопированы");

  const copyOlcBoxLink = (clientID: string, uri: string) =>
    runAction(async () => {
      if (!uri) throw new Error("OlcBox ссылка не найдена");
      await navigator.clipboard.writeText(uri);
    }, `Ссылка для ${clientID} скопирована`);

  const copySubscription = (clientID: string) =>
    runAction(async () => {
      await navigator.clipboard.writeText(subscriptionURL(clientID));
    }, `Subscription для ${clientID} скопирован`);

  if (authenticated === null) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Загрузка...</div>;
  }

  if (!authenticated) {
    return <LoginView setupRequired={setupRequired} onLogin={afterLogin} />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">OlcRTC Manager</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HeaderMetric label="Panel mem" value={formatBytes(metrics?.memory.heap_alloc_bytes)} />
            <HeaderMetric label="Panel PID" value={metrics?.manager.pid ?? "..."} />
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
              onClick={() => setShowPassword(true)}
            >
              <KeyRound className="h-4 w-4" />
              Пароль
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
              disabled={busy}
              onClick={() =>
                runAction(async () => {
                  await loadState();
                  await loadMetrics();
                }, "Обновлено")
              }
            >
              <RefreshCw className="h-4 w-4" />
              Обновить
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <section className="grid gap-3 md:grid-cols-3">
          <StatCard icon={<Server className="h-4 w-4" />} label="Профиль" value={state?.name ?? "..."} />
          <StatCard icon={<Users className="h-4 w-4" />} label="Клиенты" value={state?.client_count ?? "..."} />
          <StatCard icon={<Activity className="h-4 w-4" />} label="Инстансы" value={state?.running_count ?? "..."} />
        </section>

        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-normal">Клиенты</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90"
                onClick={openCreate}
              >
                <Plus className="h-4 w-4" />
                Создать клиента
              </button>
            </div>
          </div>

          <div className="mt-3 min-h-5 text-sm text-muted-foreground">{notice}</div>

          <div className="mt-4 grid gap-3">
            {clients.map((client) => {
              const expanded = expandedClients[client.client_id] ?? true;
              const running = client.locations.filter((location) => location.runtime.running).length;

              return (
                <div key={client.client_id} className="overflow-hidden rounded-lg border border-border bg-background">
                  <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <button
                      className="flex min-w-0 items-center gap-3 text-left"
                      onClick={() => setExpandedClients((current) => ({ ...current, [client.client_id]: !expanded }))}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{client.client_id}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {client.locations.length} локац. · {running} running · {quotaText(client.quota)}
                        </span>
                      </span>
                    </button>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <button
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                        disabled={busy}
                        onClick={() => copySubscription(client.client_id)}
                      >
                        Sub
                      </button>
                      <button
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                        disabled={busy}
                        onClick={() => openClientLogs(client)}
                      >
                        <Terminal className="h-4 w-4" />
                        Логи
                      </button>
                      <button
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                        disabled={busy}
                        onClick={() => openEdit(client)}
                      >
                        <Edit3 className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-destructive/40 px-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                        disabled={busy}
                        onClick={() => deleteClient(client.client_id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-border/70 p-3">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium text-muted-foreground">Локации</div>
                        <button
                          className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                          disabled={busy}
                          onClick={() => openCreateLocation(client)}
                        >
                          <Plus className="h-4 w-4" />
                          Добавить локацию
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[920px] border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-muted-foreground">
                              <th className="py-2 pr-3 font-medium">Локация</th>
                              <th className="py-2 pr-3 font-medium">Room</th>
                              <th className="py-2 pr-3 font-medium">Carrier</th>
                              <th className="py-2 pr-3 font-medium">Transport</th>
                              <th className="py-2 pr-3 font-medium">DNS</th>
                              <th className="py-2 pr-3 font-medium">Статус</th>
                              <th className="py-2 text-right font-medium">Действия локации</th>
                            </tr>
                          </thead>
                          <tbody>
                            {client.locations.map((loc, index) => (
                              <tr key={`${client.client_id}-${loc.room_id}-${loc.transport}-${index}`} className="border-b border-border/60 last:border-0">
                                <td className="py-3 pr-3 font-medium">{loc.name || "Default"}</td>
                                <td className="max-w-[220px] truncate py-3 pr-3 text-muted-foreground">{loc.room_id}</td>
                                <td className="py-3 pr-3">{loc.carrier}</td>
                                <td className="py-3 pr-3">{loc.transport}</td>
                                <td className="py-3 pr-3 text-muted-foreground">{loc.dns}</td>
                                <td className="py-3 pr-3">
                                  <span
                                    className={`inline-flex rounded-full px-2 py-1 text-xs ${
                                      loc.runtime.running ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
                                    }`}
                                  >
                                    {loc.runtime.status}
                                  </span>
                                </td>
                                <td className="py-3 text-right">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <button
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                                      disabled={busy}
                                      onClick={() => restartLocation(client.client_id, loc)}
                                    >
                                      <RefreshCw className="h-4 w-4" />
                                      Restart
                                    </button>
                                    <button
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                                      disabled={busy}
                                      onClick={() => openLogs(client.client_id, loc)}
                                    >
                                      <Terminal className="h-4 w-4" />
                                      Логи
                                    </button>
                                    <button
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                                      disabled={busy}
                                      onClick={() => copyOlcBoxLink(client.client_id, loc.uri)}
                                    >
                                      <Copy className="h-4 w-4" />
                                      OlcBox
                                    </button>
                                    <button
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                                      disabled={busy}
                                      onClick={() => setQrTarget({ clientID: client.client_id, location: loc })}
                                    >
                                      QR
                                    </button>
                                    <button
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                                      disabled={busy}
                                      onClick={() => openEditLocation(client, loc, index)}
                                    >
                                      <Edit3 className="h-4 w-4" />
                                      Edit
                                    </button>
                                    <button
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-destructive/40 px-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                                      disabled={busy || client.locations.length <= 1}
                                      title={client.locations.length <= 1 ? "Последнюю локацию удалить нельзя" : undefined}
                                      onClick={() => deleteLocation(client.client_id, loc)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      Удалить
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {createOpen && (
        <Modal title="Создать клиента" onClose={() => setCreateOpen(false)}>
          <div className="p-5">
            <ClientFormFields form={createForm} setForm={setCreateForm} includeClientID />
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setCreateOpen(false)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
                disabled={busy}
                onClick={addClient}
              >
                <Plus className="h-4 w-4" />
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editClient && (
        <Modal title={`Редактировать ${editClient.client_id}`} onClose={() => setEditClient(null)}>
          <div className="p-5">
            <ClientSettingsFields form={editForm} setForm={setEditForm} includeClientID />
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setEditClient(null)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
                disabled={busy}
                onClick={updateClient}
              >
                <Edit3 className="h-4 w-4" />
                Сохранить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {createLocationClient && (
        <Modal title={`Добавить локацию ${createLocationClient.client_id}`} onClose={() => setCreateLocationClient(null)}>
          <div className="p-5">
            <LocationFormFields location={locationForm} setLocation={setLocationForm} />
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setCreateLocationClient(null)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
                disabled={busy}
                onClick={addLocation}
              >
                <Plus className="h-4 w-4" />
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editLocation && (
        <Modal title={`Редактировать локацию ${editLocation.location.name || editLocation.location.room_id}`} onClose={() => setEditLocation(null)}>
          <div className="p-5">
            <LocationFormFields location={locationForm} setLocation={setLocationForm} />
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setEditLocation(null)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
                disabled={busy}
                onClick={updateLocation}
              >
                <Edit3 className="h-4 w-4" />
                Сохранить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {qrTarget && (
        <Modal title={`QR ${qrTarget.clientID}`} onClose={() => setQrTarget(null)}>
          <div className="grid justify-items-center gap-4 p-5">
            <img
              className="h-64 w-64 rounded-md bg-white p-2"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrTarget.location.uri)}`}
              alt="QR"
            />
            <div className="max-w-full break-all rounded-md border border-border bg-background p-3 font-mono text-xs text-muted-foreground">
              {qrTarget.location.uri}
            </div>
            <div className="flex gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => copyOlcBoxLink(qrTarget.clientID, qrTarget.location.uri)}
              >
                Копировать URI
              </button>
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => copySubscription(qrTarget.clientID)}
              >
                Копировать Sub
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showPassword && (
        <Modal title="Сменить пароль" onClose={() => setShowPassword(false)}>
          <div className="grid gap-4 p-5">
            <label className="grid gap-2 text-sm text-muted-foreground">
              Текущий пароль
              <input
                className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
                type="password"
                value={passwordForm.current}
                onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })}
                autoComplete="current-password"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Новый пароль
              <input
                className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
                type="password"
                value={passwordForm.next}
                onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })}
                autoComplete="new-password"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Повтор нового пароля
              <input
                className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
                type="password"
                value={passwordForm.repeat}
                onChange={(event) => setPasswordForm({ ...passwordForm, repeat: event.target.value })}
                autoComplete="new-password"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setShowPassword(false)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
                disabled={busy}
                onClick={changePassword}
              >
                <KeyRound className="h-4 w-4" />
                Сохранить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {clientLogTarget && (
        <Modal title={`Логи ${clientLogTarget.client_id}`} onClose={() => setClientLogTarget(null)}>
          <div className="p-5">
            <div className="max-h-[520px] overflow-auto rounded-md border border-border bg-black p-3 font-mono text-xs text-slate-100">
              {clientLogs.length === 0 ? (
                <div className="text-muted-foreground">Загрузка логов...</div>
              ) : (
                clientLogs.map((group) => (
                  <div key={`${group.location.room_id}-${group.location.transport}`} className="mb-5 last:mb-0">
                    <div className="mb-2 text-[11px] uppercase text-muted-foreground">
                      {group.location.name || "Default"} · {group.location.transport} · {group.location.runtime.status}
                    </div>
                    {group.error ? (
                      <div className="text-muted-foreground">Логи недоступны: {group.error}</div>
                    ) : group.lines.length === 0 ? (
                      <div className="text-muted-foreground">Логов пока нет</div>
                    ) : (
                      group.lines.map((line, index) => (
                        <div key={`${line.time}-${index}`} className="whitespace-pre-wrap break-words">
                          <span className={line.stream === "stderr" ? "text-destructive" : "text-primary"}>
                            {line.stream}
                          </span>{" "}
                          <span className="text-muted-foreground">{line.time}</span> {line.line}
                        </div>
                      ))
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => openClientLogs(clientLogTarget)}
              >
                Обновить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {logTarget && (
        <Modal title={`Логи ${logTarget.clientID}`} onClose={() => setLogTarget(null)}>
          <div className="p-5">
            <div className="grid gap-2 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
              <div>Статус: {logTarget.location.runtime.status}</div>
              {logTarget.location.runtime.pid && <div>PID: {logTarget.location.runtime.pid}</div>}
              {logTarget.location.runtime.started_at && <div>Started: {logTarget.location.runtime.started_at}</div>}
              {logTarget.location.runtime.exited_at && <div>Exited: {logTarget.location.runtime.exited_at}</div>}
              {logTarget.location.runtime.exit_error && (
                <div className="text-destructive">Exit: {logTarget.location.runtime.exit_error}</div>
              )}
            </div>

            <div className="mt-4 max-h-[420px] overflow-auto rounded-md border border-border bg-black p-3 font-mono text-xs text-slate-100">
              {logs.length === 0 ? (
                <div className="text-muted-foreground">Логов пока нет</div>
              ) : (
                logs.map((line, index) => (
                  <div key={`${line.time}-${index}`} className="whitespace-pre-wrap break-words">
                    <span className={line.stream === "stderr" ? "text-destructive" : "text-primary"}>
                      {line.stream}
                    </span>{" "}
                    <span className="text-muted-foreground">{line.time}</span> {line.line}
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => openLogs(logTarget.clientID, logTarget.location)}
              >
                Обновить
              </button>
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
                disabled={logs.length === 0 || busy}
                onClick={copyLogs}
              >
                Копировать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
