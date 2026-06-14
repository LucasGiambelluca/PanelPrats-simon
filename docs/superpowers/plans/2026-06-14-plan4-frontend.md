# Plan 4 — Frontend (Auth + Accounts + Inbox + Bot Builder) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar el frontend genérico (login Supabase Auth, gestión de cuentas WhatsApp con QR, inbox de conversaciones en tiempo real, bot builder visual) al `client/` nuevo, scoped por cuenta seleccionada y sin lógica de comercio.

**Architecture:** React 19 + Vite + Tailwind + ReactFlow 11. Una `AccountContext` mantiene la cuenta WhatsApp activa; todas las queries (`flows`, `whatsapp_conversations`) filtran por `account_id`. El bot builder porta los 24 nodos genéricos (se descartan los 12 de comercio). El inbox usa Supabase Realtime filtrado por cuenta y envía mensajes manuales vía la API del backend (`/api/messages/send`). El connect muestra el QR que sirve el backend (`/api/accounts/:id/qr`), solo flujo Baileys.

**Tech Stack:** React 19, Vite 7, TypeScript, Tailwind 3.4, reactflow 11.11, @supabase/supabase-js 2, react-router-dom 7, lucide-react, sonner. Depende de Plan 1 (scaffold client) y Plan 3 (API backend).

**Origen:** `C:/Users/Lucas/Desktop/Sotcksystem/client/src`
**Destino:** `client/src`
**Spec:** `docs/superpowers/specs/2026-06-14-panel-whatsapp-multicuenta-design.md`

> **Convención de copia:** "Copiar SRC→DST" = Read origen + Write destino idéntico salvo edits listados.

---

## Estructura de archivos (este plan)

```
client/src/
├── context/
│   ├── AuthContext.tsx          # port verbatim
│   └── AccountContext.tsx       # NUEVO: cuenta WA activa
├── components/
│   ├── ProtectedRoute.tsx       # NUEVO (mínimo)
│   ├── Layout.tsx               # NUEVO (sidebar simple)
│   └── bot-builder/             # port 24 nodos genéricos + Sidebar + MobileNodeSelector
├── pages/
│   ├── Login.tsx                # port
│   ├── Accounts.tsx             # NUEVO (lista + crear + conectar)
│   ├── WhatsAppConnect.tsx      # port reducido (solo Baileys QR vía backend)
│   ├── WhatsAppInbox.tsx        # port reducido (sin convert-to-order)
│   └── BotBuilder.tsx           # port reducido (sin nodos comercio)
├── hooks/useWhatsAppInbox.ts    # port reducido
├── services/whatsappService.ts  # NUEVO reducido (Baileys-via-backend + realtime)
├── types/index.ts               # NUEVO reducido (interfaces genéricas)
├── App.tsx                      # NUEVO (rutas mínimas)
└── lib/api.ts                   # NUEVO (base URL + fetch helper)
```

---

### Task 1: Tipos genéricos + helper de API + AuthContext

**Files:**
- Create: `client/src/types/index.ts`
- Create: `client/src/lib/api.ts`
- Create: `client/src/context/AuthContext.tsx`

- [ ] **Step 1: Escribir `types/index.ts`** (solo interfaces genéricas)

```ts
export interface Account {
  id: string;
  user_id: string;
  name: string;
  phone_number: string | null;
  status: 'disconnected' | 'connecting' | 'qr' | 'connected';
  created_at: string;
}

export interface Flow {
  id: string;
  account_id: string;
  name: string;
  trigger_word: string | null;
  nodes: any[];
  edges: any[];
  is_active: boolean;
  created_at?: string;
}

export interface WhatsAppConversation {
  id: string;
  account_id: string;
  phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  status: 'BOT' | 'HANDOVER';
}

export type WaMessageDirection = 'INBOUND' | 'OUTBOUND';

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  direction: WaMessageDirection;
  content: string | null;
  media_url: string | null;
  message_type: string;
  timestamp: string;
}
```

- [ ] **Step 2: Escribir `lib/api.ts`**

```ts
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const apiBase = BASE;
```

- [ ] **Step 3: Copiar AuthContext** — Read `client/src/context/AuthContext.tsx` → Write destino (verbatim; usa `../supabaseClient` que ya existe de Plan 1).

- [ ] **Step 4: Verificar build**

Run: `cd client && npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add client/src/types/index.ts client/src/lib/api.ts client/src/context/AuthContext.tsx
git commit -m "feat(client): tipos genéricos + helper API + AuthContext"
```

---

### Task 2: Login + ProtectedRoute + Layout + AccountContext

**Files:**
- Create: `client/src/pages/Login.tsx`
- Create: `client/src/components/ProtectedRoute.tsx`
- Create: `client/src/components/Layout.tsx`
- Create: `client/src/context/AccountContext.tsx`

- [ ] **Step 1: Copiar Login** — Read `client/src/pages/Login.tsx` → Write destino. Quitar imports/branding de rotisería (logo específico) si rompen; dejar el form email/password que llama `useAuth().signIn`. Redirige a `/` en éxito.

- [ ] **Step 2: Escribir `ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8">Cargando…</div>;
  return session ? <Outlet /> : <Navigate to="/login" replace />;
}
```

- [ ] **Step 3: Escribir `AccountContext.tsx`** (cuenta WA activa + lista)

```tsx
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './AuthContext';
import type { Account } from '../types';

interface AccountCtx {
  accounts: Account[];
  activeAccountId: string | null;
  setActiveAccountId: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<AccountCtx>({ accounts: [], activeAccountId: null, setActiveAccountId: () => {}, reload: async () => {} });
export const useAccounts = () => useContext(Ctx);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  const reload = async () => {
    if (!user) return;
    const { data } = await supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at');
    const list = (data as Account[]) || [];
    setAccounts(list);
    setActiveAccountId((cur) => cur ?? list[0]?.id ?? null);
  };

  useEffect(() => { reload(); }, [user]);

  return <Ctx.Provider value={{ accounts, activeAccountId, setActiveAccountId, reload }}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 4: Escribir `Layout.tsx`** (nav simple + selector de cuenta)

```tsx
import { Link, Outlet } from 'react-router-dom';
import { useAccounts } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { accounts, activeAccountId, setActiveAccountId } = useAccounts();
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-gray-900 text-white p-4 space-y-3">
        <h1 className="font-bold text-lg">Panel WA</h1>
        <select className="w-full text-black rounded px-2 py-1" value={activeAccountId ?? ''} onChange={(e) => setActiveAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <nav className="flex flex-col gap-2 pt-4">
          <Link to="/accounts">Cuentas</Link>
          <Link to="/inbox">Inbox</Link>
          <Link to="/builder">Bot Builder</Link>
        </nav>
        <button onClick={signOut} className="text-sm text-gray-400 pt-6">Salir</button>
      </aside>
      <main className="flex-1"><Outlet /></main>
    </div>
  );
}
```

- [ ] **Step 5: Build + commit**

Run: `cd client && npm run build`
Expected: OK.

```bash
git add client/src/pages/Login.tsx client/src/components/ProtectedRoute.tsx client/src/components/Layout.tsx client/src/context/AccountContext.tsx
git commit -m "feat(client): login + ProtectedRoute + Layout + AccountContext"
```

---

### Task 3: App.tsx con rutas mínimas

**Files:**
- Create: `client/src/App.tsx`

- [ ] **Step 1: Escribir `App.tsx`**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AccountProvider } from './context/AccountContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Accounts from './pages/Accounts';
import WhatsAppConnect from './pages/WhatsAppConnect';
import WhatsAppInbox from './pages/WhatsAppInbox';
import BotBuilder from './pages/BotBuilder';

export default function App() {
  return (
    <AuthProvider>
      <AccountProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/accounts" replace />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/accounts/:id/connect" element={<WhatsAppConnect />} />
                <Route path="/inbox" element={<WhatsAppInbox />} />
                <Route path="/builder" element={<BotBuilder />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AccountProvider>
    </AuthProvider>
  );
}
```

> Las páginas `Accounts`, `WhatsAppConnect`, `WhatsAppInbox`, `BotBuilder` se crean en Tasks 4-7. Hasta entonces el build falla por imports — está bien, este task se valida junto al 4.

- [ ] **Step 2: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(client): App con rutas mínimas (accounts/inbox/builder)"
```

---

### Task 4: Página Accounts (crear + conectar)

**Files:**
- Create: `client/src/pages/Accounts.tsx`

- [ ] **Step 1: Escribir `Accounts.tsx`**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccounts } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';

export default function Accounts() {
  const { accounts, reload } = useAccounts();
  const { user } = useAuth();
  const [name, setName] = useState('');

  const create = async () => {
    if (!name || !user) return;
    await supabase.from('accounts').insert({ user_id: user.id, name, status: 'disconnected' });
    setName('');
    await reload();
  };

  return (
    <div className="p-8 space-y-6">
      <h2 className="text-2xl font-bold">Cuentas de WhatsApp</h2>
      <div className="flex gap-2">
        <input className="border rounded px-3 py-2" placeholder="Nombre de la cuenta" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={create} className="bg-green-600 text-white px-4 py-2 rounded">Agregar</button>
      </div>
      <ul className="divide-y border rounded">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between p-4">
            <div>
              <div className="font-medium">{a.name}</div>
              <div className="text-sm text-gray-500">{a.phone_number || 'sin número'} · {a.status}</div>
            </div>
            <Link to={`/accounts/${a.id}/connect`} className="text-blue-600">Conectar</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

Run: `cd client && npm run build`
Expected: aún falla por WhatsAppConnect/Inbox/BotBuilder faltantes. Saltar build hasta Task 7; solo commit.

```bash
git add client/src/pages/Accounts.tsx
git commit -m "feat(client): página de Cuentas (crear + listar + link conectar)"
```

---

### Task 5: WhatsAppConnect (QR Baileys vía backend)

**Files:**
- Create: `client/src/pages/WhatsAppConnect.tsx`

- [ ] **Step 1: Escribir `WhatsAppConnect.tsx`** (pollea el QR del backend hasta conectar)

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';

export default function WhatsAppConnect() {
  const { id } = useParams();
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState('disconnected');

  useEffect(() => {
    if (!id) return;
    let stop = false;
    // dispara la conexión
    api(`/api/accounts/${id}/connect`, { method: 'POST' }).catch(() => {});
    const poll = async () => {
      if (stop) return;
      try {
        const r = await api<{ qr: string | null; status: string }>(`/api/accounts/${id}/qr`);
        setQr(r.qr);
        setStatus(r.status);
        if (r.status === 'connected') return; // listo
      } catch { /* reintenta */ }
      setTimeout(poll, 2500);
    };
    poll();
    return () => { stop = true; };
  }, [id]);

  return (
    <div className="p-8 space-y-4">
      <h2 className="text-2xl font-bold">Conectar WhatsApp</h2>
      <p>Estado: <span className="font-mono">{status}</span></p>
      {status === 'connected' ? (
        <p className="text-green-600 font-medium">✅ Conectado.</p>
      ) : qr ? (
        <img src={qr} alt="QR de WhatsApp" className="w-72 h-72 border rounded" />
      ) : (
        <p>Generando QR…</p>
      )}
      <p className="text-sm text-gray-500">Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo y escaneá el QR.</p>
    </div>
  );
}
```

> El backend devuelve el QR como Data URL (`qrcode.toDataURL`), así que `<img src={qr}>` funciona directo.

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/WhatsAppConnect.tsx
git commit -m "feat(client): WhatsAppConnect con QR Baileys vía backend (polling)"
```

---

### Task 6: whatsappService + useWhatsAppInbox + WhatsAppInbox

**Files:**
- Create: `client/src/services/whatsappService.ts`
- Create: `client/src/hooks/useWhatsAppInbox.ts`
- Create: `client/src/pages/WhatsAppInbox.tsx`

- [ ] **Step 1: Escribir `whatsappService.ts`** (reducido: queries scoped + realtime + send vía backend)

```ts
import { supabase } from '../supabaseClient';
import { api } from '../lib/api';
import type { WhatsAppConversation, WhatsAppMessage } from '../types';

export async function loadConversations(accountId: string): Promise<WhatsAppConversation[]> {
  const { data } = await supabase.from('whatsapp_conversations').select('*').eq('account_id', accountId).order('last_message_at', { ascending: false });
  return (data as WhatsAppConversation[]) || [];
}

export async function getMessages(conversationId: string): Promise<WhatsAppMessage[]> {
  const { data } = await supabase.from('whatsapp_messages').select('*').eq('conversation_id', conversationId).order('timestamp', { ascending: true });
  return (data as WhatsAppMessage[]) || [];
}

export async function sendWhatsAppMessage(accountId: string, phone: string, text: string): Promise<void> {
  await api('/api/messages/send', { method: 'POST', body: JSON.stringify({ account_id: accountId, phone, text }) });
}

export async function setHandover(conversationId: string, resume: boolean): Promise<void> {
  await api(`/api/conversations/${conversationId}/handover`, { method: 'POST', body: JSON.stringify({ resume }) });
}

/** Realtime: notifica nuevos mensajes y cambios de conversación de una cuenta. */
export function subscribeToInbox(accountId: string, onChange: () => void) {
  const channel = supabase
    .channel(`inbox-${accountId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversations', filter: `account_id=eq.${accountId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
```

> Realtime de `whatsapp_messages` no filtra por account_id (no tiene la columna; cuelga de conversation_id). El handler `onChange` recarga la conversación activa, que ya está scoped — suficiente. Si se quiere filtrar, agregar `account_id` denormalizado a `whatsapp_messages` en una migración futura.

- [ ] **Step 2: Escribir `useWhatsAppInbox.ts`** (sin parseOrderFromText ni convert-to-order)

```ts
import { useEffect, useState, useCallback } from 'react';
import { useAccounts } from '../context/AccountContext';
import { loadConversations, getMessages, sendWhatsAppMessage, setHandover, subscribeToInbox } from '../services/whatsappService';
import type { WhatsAppConversation, WhatsAppMessage } from '../types';

export function useWhatsAppInbox() {
  const { activeAccountId } = useAccounts();
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<WhatsAppConversation | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [draft, setDraft] = useState('');

  const refreshConversations = useCallback(async () => {
    if (!activeAccountId) return;
    setConversations(await loadConversations(activeAccountId));
  }, [activeAccountId]);

  useEffect(() => { refreshConversations(); }, [refreshConversations]);

  useEffect(() => {
    if (!activeAccountId) return;
    const unsub = subscribeToInbox(activeAccountId, () => {
      refreshConversations();
      if (activeConvo) getMessages(activeConvo.id).then(setMessages);
    });
    return unsub;
  }, [activeAccountId, activeConvo, refreshConversations]);

  const selectConversation = async (c: WhatsAppConversation) => {
    setActiveConvo(c);
    setMessages(await getMessages(c.id));
  };

  const send = async () => {
    if (!activeConvo || !draft || !activeAccountId) return;
    await sendWhatsAppMessage(activeAccountId, activeConvo.phone, draft);
    setDraft('');
    setMessages(await getMessages(activeConvo.id));
  };

  const toggleHandover = async () => {
    if (!activeConvo) return;
    await setHandover(activeConvo.id, activeConvo.status === 'HANDOVER');
    await refreshConversations();
  };

  return { conversations, activeConvo, messages, draft, setDraft, selectConversation, send, toggleHandover };
}
```

- [ ] **Step 3: Escribir `WhatsAppInbox.tsx`**

```tsx
import { useWhatsAppInbox } from '../hooks/useWhatsAppInbox';

export default function WhatsAppInbox() {
  const { conversations, activeConvo, messages, draft, setDraft, selectConversation, send, toggleHandover } = useWhatsAppInbox();
  return (
    <div className="flex h-screen">
      <div className="w-80 border-r overflow-y-auto">
        {conversations.map((c) => (
          <button key={c.id} onClick={() => selectConversation(c)} className={`w-full text-left p-3 border-b ${activeConvo?.id === c.id ? 'bg-gray-100' : ''}`}>
            <div className="font-medium">{c.contact_name || c.phone}</div>
            <div className="text-sm text-gray-500 truncate">{c.last_message}</div>
            {c.status === 'HANDOVER' && <span className="text-xs text-rose-600">● atención humana</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 flex flex-col">
        {activeConvo ? (
          <>
            <div className="p-3 border-b flex justify-between items-center">
              <span className="font-medium">{activeConvo.contact_name || activeConvo.phone}</span>
              <button onClick={toggleHandover} className="text-sm text-blue-600">
                {activeConvo.status === 'HANDOVER' ? 'Devolver al bot' : 'Tomar conversación'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.map((m) => (
                <div key={m.id} className={`max-w-[70%] p-2 rounded ${m.direction === 'OUTBOUND' ? 'ml-auto bg-green-100' : 'bg-gray-100'}`}>
                  {m.content}
                </div>
              ))}
            </div>
            <div className="p-3 border-t flex gap-2">
              <input className="flex-1 border rounded px-3 py-2" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Escribí un mensaje…" />
              <button onClick={send} className="bg-green-600 text-white px-4 rounded">Enviar</button>
            </div>
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-gray-400">Elegí una conversación</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/services/whatsappService.ts client/src/hooks/useWhatsAppInbox.ts client/src/pages/WhatsAppInbox.tsx
git commit -m "feat(client): inbox realtime scoped por cuenta (sin comercio)"
```

---

### Task 7: Bot Builder + nodos genéricos

**Files:**
- Create: `client/src/components/bot-builder/*` (24 nodos genéricos + Sidebar + MobileNodeSelector)
- Create: `client/src/pages/BotBuilder.tsx`

- [ ] **Step 1: Copiar los 24 componentes de nodo genéricos** — Read cada uno de `client/src/components/bot-builder/` → Write a destino. **Lista a copiar:** `MessageNode, QuestionNode, ConditionNode, PollNode, FlowLinkNode, MediaUploadNode, SendMediaNode, DocumentGeneratorNode, ThreadNode, TimerNode, ReportNode, HandoverNode, GroqNode, AudioTranscriberNode, MediaTypeDetectorNode, IntentResolverNode, KeywordNode, SwitchNode, TextSplitterNode, ArraySwitchNode, WebhookNode, BufferMemoryNode, BusinessHoursNode, AIAgentNode`. **NO copiar** (comercio): `CatalogNode, StockCheckNode, AddToCartNode, OrderSummaryNode, OrderValidatorNode, CreateOrderNode, OrderStatusNode, SendCatalogNode, ProductSearchNode, ClearCartNode, LocationValidatorNode`.

> Si `AIAgentNode`/`BusinessHoursNode` referencian texto de comercio en su UI, editar los labels a algo genérico. Son solo formularios, no rompen.

- [ ] **Step 2: Copiar `MobileNodeSelector.tsx`** — verbatim (importa `nodeItems` de Sidebar).

- [ ] **Step 3: Escribir `Sidebar.tsx`** con el `nodeItems` filtrado (solo genéricos)

```tsx
import { Zap, Mic, Search, GitFork, Database, MessageSquare, HelpCircle, BarChart2, ArrowRightCircle, UploadCloud, FileText, PauseCircle, Clock, AlertTriangle, Image, Brain, Scissors, Spline, Bot, Store } from 'lucide-react';

export const nodeItems = [
  { type: 'webhookNode', icon: Zap, label: 'Hook / Inicio', desc: 'Gatillo de entrada.', bg: 'bg-amber-100', text: 'text-amber-600' },
  { type: 'mediaTypeDetectorNode', icon: Mic, label: 'Detector Media', desc: '¿Audio o Texto?', bg: 'bg-violet-100', text: 'text-violet-600' },
  { type: 'keywordNode', icon: Search, label: 'Keyword Switch', desc: 'Busca palabras clave y ramifica.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
  { type: 'switchNode', icon: GitFork, label: 'Switch Universal', desc: 'Ramifica según valor de variable.', bg: 'bg-amber-100', text: 'text-amber-600' },
  { type: 'bufferMemoryNode', icon: Database, label: 'Pila Memoria', desc: 'Historial de chat para IA.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
  { type: 'aiAgentNode', icon: Bot, label: 'Agente IA', desc: 'IA con memoria conversacional.', bg: 'bg-fuchsia-100', text: 'text-fuchsia-600' },
  { type: 'messageNode', icon: MessageSquare, label: 'Mensaje', desc: 'Envía un texto simple.', bg: 'bg-blue-100', text: 'text-blue-600' },
  { type: 'questionNode', icon: HelpCircle, label: 'Pregunta', desc: 'Espera una respuesta.', bg: 'bg-yellow-100', text: 'text-yellow-600' },
  { type: 'pollNode', icon: BarChart2, label: 'Encuesta', desc: 'Opciones múltiples.', bg: 'bg-purple-100', text: 'text-purple-600' },
  { type: 'conditionNode', icon: GitFork, label: 'Condición', desc: 'Ramifica según variable.', bg: 'bg-orange-100', text: 'text-orange-600' },
  { type: 'flowLinkNode', icon: ArrowRightCircle, label: 'Ir a Flujo', desc: 'Salta a otro flujo.', bg: 'bg-gray-100', text: 'text-gray-600' },
  { type: 'mediaUploadNode', icon: UploadCloud, label: 'Recibir Archivo', desc: 'Pide un archivo.', bg: 'bg-pink-100', text: 'text-pink-600' },
  { type: 'documentNode', icon: FileText, label: 'Enviar PDF', desc: 'Genera comprobante.', bg: 'bg-red-100', text: 'text-red-600' },
  { type: 'threadNode', icon: PauseCircle, label: 'Control Bot', desc: 'Pausa/Reanuda.', bg: 'bg-orange-100', text: 'text-orange-600' },
  { type: 'timerNode', icon: Clock, label: 'Timer / Espera', desc: 'Pausa el flujo.', bg: 'bg-blue-100', text: 'text-blue-600' },
  { type: 'reportNode', icon: AlertTriangle, label: 'Reporte', desc: 'Crea un registro.', bg: 'bg-red-100', text: 'text-red-600' },
  { type: 'handoverNode', icon: HelpCircle, label: 'Asesor Humano', desc: 'Pausa el bot y avisa.', bg: 'bg-rose-100', text: 'text-rose-600' },
  { type: 'businessHoursNode', icon: Store, label: 'Horario Atención', desc: 'Detecta si está en horario.', bg: 'bg-orange-100', text: 'text-orange-600' },
  { type: 'sendMediaNode', icon: Image, label: 'Enviar Multimedia', desc: 'Envía imagen o PDF.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
  { type: 'groqNode', icon: Brain, label: 'Cerebro IA', desc: 'Usa IA (Groq) para responder.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
  { type: 'intentResolverNode', icon: GitFork, label: 'Clasificar Intención', desc: 'Detecta intención y ramifica.', bg: 'bg-fuchsia-100', text: 'text-fuchsia-600' },
  { type: 'audioTranscriberNode', icon: Mic, label: 'Audio → Texto', desc: 'Transcribe notas de voz.', bg: 'bg-violet-100', text: 'text-violet-600' },
  { type: 'textSplitterNode', icon: Scissors, label: 'Split de Texto', desc: 'Texto → array de palabras.', bg: 'bg-stone-100', text: 'text-stone-600' },
  { type: 'arraySwitchNode', icon: Spline, label: 'Switch Array', desc: 'Busca palabra exacta en el split.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
];

export default function Sidebar() {
  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('application/reactflow', type);
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <aside className="w-64 border-r overflow-y-auto p-2 space-y-1">
      {nodeItems.map((it) => (
        <div key={it.type} draggable onDragStart={(e) => onDragStart(e, it.type)} className={`flex items-center gap-2 p-2 rounded cursor-grab ${it.bg}`}>
          <it.icon className={`w-4 h-4 ${it.text}`} />
          <div><div className="text-sm font-medium">{it.label}</div><div className="text-xs text-gray-500">{it.desc}</div></div>
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 4: Copiar `BotBuilder.tsx`** — Read `client/src/pages/BotBuilder.tsx` → Write destino, con estos edits:
  - **nodeTypes:** quitar las 11 entradas de comercio del objeto (`catalogNode, stockCheckNode, addToCartNode, orderSummaryNode, orderValidatorNode, createOrderNode, orderStatusNode, sendCatalogNode, productSearchNode, clearCartNode, locationValidatorNode`) y sus imports.
  - **account_id:** importar `useAccounts`; en `fetchFlows` agregar `.eq('account_id', activeAccountId)`; en `handleSave` agregar `account_id: activeAccountId` al payload del upsert. Si no hay `activeAccountId`, deshabilitar guardar.
  - **defaults genéricos (`addNodeByType`):** reemplazar `systemPrompt: 'Sos un asistente virtual para una rotisería.'` por `systemPrompt: 'Sos un asistente virtual de atención al cliente.'`; quitar defaults de cart/order.
  - Conservar el patrón **strip de callbacks** en save/export y rehidratación en load (intacto).

- [ ] **Step 5: Build completo del frontend**

Run: `cd client && npm run build`
Expected: build OK (ya existen todas las páginas). Resolver imports faltantes (íconos lucide, etc.) hasta que pase.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/bot-builder client/src/pages/BotBuilder.tsx
git commit -m "feat(client): bot builder con 24 nodos genéricos, scoped por cuenta"
```

---

### Task 8: Smoke E2E manual + README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Levantar todo y verificar el camino feliz** (manual, requiere Supabase + Redis + un WhatsApp de prueba):
  1. `cd server && npm run dev` → `:3001`.
  2. `cd client && npm run dev` → abrir el navegador.
  3. Registrar un usuario en Supabase Auth (dashboard) y loguear en el panel.
  4. Crear una cuenta en `/accounts` → Conectar → escanear QR → estado `connected`.
  5. Crear un flujo simple en `/builder` (start → messageNode "hola!" con trigger `hola`), guardar, activar.
  6. Mandar "hola" al número desde otro WhatsApp → recibir "hola!".
  7. Ver la conversación y el mensaje en `/inbox`. Tomar conversación → enviar manual → llega al WhatsApp.

- [ ] **Step 2: Actualizar README** con la sección de uso del panel (los 7 pasos de arriba, resumidos).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: guía de smoke E2E del panel"
```

---

## Self-Review

**Cobertura del spec (Plan 4 = §3.2 frontend):**
- Login + AuthContext Supabase Auth → Tasks 1,2. ✓
- Accounts (crear/listar/conectar) + selector de cuenta activa → Tasks 2,4 + AccountContext. ✓
- WhatsAppConnect QR Baileys vía backend (solo Baileys, sin WAHA/Evolution/Meta) → Task 5. ✓
- Inbox realtime scoped por account_id, handover, envío manual, SIN convert-to-order/parseOrderFromText → Task 6. ✓
- BotBuilder 24 nodos genéricos, account_id en queries, defaults genéricos, strip+rehydrate → Task 7. ✓
- Rutas mínimas sin páginas de comercio → Task 3. ✓

**Placeholders:** ninguno — todas las páginas/contextos/servicios tienen código completo. Los componentes de nodo se copian del origen (paths exactos) y los edits están especificados.

**Consistencia de tipos:** `Account`/`Flow`/`WhatsAppConversation`/`WhatsAppMessage` (Task 1) usados en AccountContext, whatsappService, hook y páginas. `api()` helper (Task 1) usado por whatsappService y WhatsAppConnect. `useAccounts().activeAccountId` (Task 2) consumido por inbox (Task 6) y BotBuilder (Task 7). Endpoints del backend (`/api/accounts/:id/connect|qr`, `/api/messages/send`, `/api/conversations/:id/handover`) coinciden con las rutas definidas en Plan 3 Tasks 5-7.

**Nota de build:** Tasks 3-4 dejan el build roto transitoriamente (páginas aún no creadas); el build verde se valida recién en Task 7 Step 5. Documentado en cada task.
```
