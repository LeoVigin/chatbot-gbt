<template>
	<div class="app">
		<!-- Header -->
		<header>
			<div class="header-left">
				<div class="status-dot" />
				<h1>Chat</h1>
			</div>
			<div class="header-right">
				<span class="model-pill">{{ DEFAULT_MODEL_LABEL }}</span>
				<button class="clear-btn" @click="clearChat">Clear</button>
			</div>
		</header>

		<!-- Messages -->
		<div ref="messagesEl" class="messages">
			<!-- Empty state -->
			<div v-if="messages.length === 0" class="empty">
				<div class="greeting">How can I help?</div>
				<div class="sub">
					Connected to <code>/api/chat</code> · Streaming on
				</div>
				<div class="prompts">
					<button
						v-for="p in promptChips"
						:key="p"
						class="prompt-chip"
						@click="usePrompt(p)">
						{{ p }}
					</button>
				</div>
			</div>

			<!-- Message list -->
			<div v-for="(msg, i) in messages" :key="i" class="msg" :class="msg.role">
				<div class="bubble">{{ msg.content }}</div>
				<div class="msg-time">{{ msg.time }}</div>
			</div>

			<!-- Typing indicator (streaming, no content yet) -->
			<div v-if="isStreaming && streamingContent === ''" class="msg bot">
				<div class="bubble">
					<span class="typing"><span /><span /><span /></span>
				</div>
			</div>

			<!-- Live streaming bubble -->
			<div v-if="isStreaming && streamingContent !== ''" class="msg bot">
				<div class="bubble">{{ streamingContent }}</div>
			</div>
		</div>

		<!-- Input area -->
		<div class="input-area">
			<div class="input-wrap">
				<textarea
					ref="inputEl"
					v-model="inputText"
					placeholder="Message…"
					rows="1"
					@input="resizeTextarea"
					@keydown.enter.exact.prevent="handleSend" />
				<button
					class="send-btn"
					:disabled="isStreaming || !inputText.trim()"
					@click="handleSend"
					title="Send">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
						stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="12" y1="19" x2="12" y2="5" />
						<polyline points="5 12 12 5 19 12" />
					</svg>
				</button>
			</div>
			<div class="input-hint">↵ Send &nbsp;·&nbsp; ⇧↵ New line</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';

useHead({
	link: [
		{ rel: 'preconnect', href: 'https://fonts.googleapis.com' },
		{
			rel: 'stylesheet',
			href: 'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500&family=Instrument+Serif:ital@0;1&display=swap',
		},
	],
});

interface ChatMessage {
	role: 'user' | 'bot';
	content: string;
	time: string;
}

interface HistoryEntry {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

const DEFAULT_MODEL       = 'openai/gpt-5.4-nano';
const DEFAULT_MODEL_LABEL = 'gpt-5.4-nano';

const promptChips = [
	'Explain a complex topic simply',
	'Write a short email for me',
	'Debug my code',
];

const messages         = ref<ChatMessage[]>([]);
const history          = ref<HistoryEntry[]>([
	{ role: 'system', content: 'You are a helpful assistant.' },
]);
const inputText        = ref('');
const isStreaming      = ref(false);
const streamingContent = ref('');

const messagesEl = ref<HTMLElement | null>(null);
const inputEl    = ref<HTMLTextAreaElement | null>(null);

function nowStr() {
	return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function scrollDown() {
	await nextTick();
	if (messagesEl.value)
		messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
}

function resizeTextarea() {
	const el = inputEl.value;
	if (!el) return;
	el.style.height = 'auto';
	el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

function usePrompt(text: string) {
	inputText.value = text;
	inputEl.value?.focus();
}

async function streamResponse(msgs: HistoryEntry[]) {
	isStreaming.value      = true;
	streamingContent.value = '';
	await scrollDown();

	const res = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ messages: msgs, model: DEFAULT_MODEL, stream: true }),
	});

	if (!res.ok || !res.body) {
		messages.value.push({
			role: 'bot',
			content: `Error ${res.status}: ${await res.text()}`,
			time: nowStr(),
		});
		isStreaming.value = false;
		return null;
	}

	const reader  = res.body.getReader();
	const decoder = new TextDecoder();
	let full      = '';

	outer: while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		for (const line of decoder.decode(value, { stream: true }).split('\n')) {
			if (!line.startsWith('data: ')) continue;
			const data = line.slice(6).trim();
			if (data === '[DONE]') break outer;
			try {
				const delta: string = JSON.parse(data)?.choices?.[0]?.delta?.content ?? '';
				if (delta) {
					full                   += delta;
					streamingContent.value  = full;
					await scrollDown();
				}
			} catch { /* skip malformed SSE */ }
		}
	}

	messages.value.push({ role: 'bot', content: full, time: nowStr() });
	streamingContent.value = '';
	isStreaming.value      = false;
	await scrollDown();
	return full;
}

async function handleSend() {
	const text = inputText.value.trim();
	if (!text || isStreaming.value) return;

	inputText.value = '';
	if (inputEl.value) inputEl.value.style.height = 'auto';

	history.value.push({ role: 'user', content: text });
	messages.value.push({ role: 'user', content: text, time: nowStr() });
	await scrollDown();

	try {
		const reply = await streamResponse(history.value);
		if (reply) history.value.push({ role: 'assistant', content: reply });
	} catch (err: any) {
		messages.value.push({ role: 'bot', content: `⚠ ${err.message}`, time: nowStr() });
		isStreaming.value = false;
	}

	await nextTick();
	inputEl.value?.focus();
}

function clearChat() {
	messages.value         = [];
	history.value          = [{ role: 'system', content: 'You are a helpful assistant.' }];
	streamingContent.value = '';
	isStreaming.value      = false;
}
</script>

<style>
/* ── Reset ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:          #0e0e10;
  --surface:     #16161a;
  --surface-2:   #1c1c21;
  --border:      #252529;
  --border-2:    #36363e;
  --text:        #e2e2e8;
  --muted:       #55555f;
  --muted-2:     #80808c;
  --accent:      #e2e2e8;
  --user-bg:     #e2e2e8;
  --user-text:   #0e0e10;
  --green:       #3dba6f;
  --radius:      16px;
  --font:        "Geist Mono", monospace;
  --serif:       "Instrument Serif", serif;
}

html { color-scheme: dark; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  -webkit-font-smoothing: antialiased;
}

/* ── Layout ── */
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  width: 100%;
  background: var(--bg);
}


/* ── Header ── */
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 28px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  animation: fadeDown .4s ease both;
}

@keyframes fadeDown {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.header-left { display: flex; align-items: center; gap: 10px; }

.status-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 0 2.5px rgba(61,186,111,.15);
}

header h1 {
  font-family: var(--serif);
  font-style: italic;
  font-size: 17px;
  font-weight: 400;
  letter-spacing: .01em;
  color: var(--text);
}

.header-right { display: flex; align-items: center; gap: 8px; }

.model-pill {
  font-family: var(--font);
  font-size: 10px;
  font-weight: 300;
  color: var(--muted-2);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 3px 10px;
  letter-spacing: .05em;
}

.clear-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--muted-2);
  font-family: var(--font);
  font-size: 11px;
  font-weight: 400;
  padding: 4px 12px;
  cursor: pointer;
  letter-spacing: .04em;
  transition: border-color .15s, color .15s;
}
.clear-btn:hover { border-color: var(--border-2); color: var(--text); }

/* ── Messages ── */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 36px 28px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  scroll-behavior: smooth;
}
.messages::-webkit-scrollbar { width: 0; }

/* ── Empty state ── */
.empty {
  margin: auto;
  text-align: center;
  animation: fadeUp .5s .1s ease both;
  opacity: 0;
}

.greeting {
  font-family: var(--serif);
  font-style: italic;
  font-size: 32px;
  font-weight: 400;
  letter-spacing: -.01em;
  color: var(--text);
  margin-bottom: 10px;
}

.sub {
  font-size: 11px;
  font-weight: 300;
  color: var(--muted-2);
  line-height: 2;
  letter-spacing: .04em;
}
.sub code {
  font-family: var(--font);
  font-size: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--text);
}

.prompts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 24px;
  align-items: center;
}

.prompt-chip {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 18px;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--muted-2);
  cursor: pointer;
  font-family: var(--font);
  letter-spacing: .03em;
  transition: border-color .15s, color .15s, background .15s;
}
.prompt-chip:hover {
  border-color: var(--border-2);
  color: var(--text);
  background: var(--surface-2);
}

/* ── Messages ── */
.msg {
  display: flex;
  flex-direction: column;
  animation: fadeUp .2s ease both;
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: translateY(0); }
}

.msg.user { align-items: flex-end; }
.msg.bot  { align-items: flex-start; }

.bubble {
  max-width: min(78%, 680px);
  padding: 10px 15px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  letter-spacing: .01em;
}

.msg.user .bubble {
  background: var(--user-bg);
  color: var(--user-text);
  border-bottom-right-radius: 4px;
}

.msg.bot .bubble {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}

.msg-time {
  font-size: 9.5px;
  color: var(--muted);
  margin-top: 4px;
  padding: 0 4px;
  letter-spacing: .05em;
}

/* Typing dots */
.typing {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 2px;
  min-height: 20px;
}
.typing span {
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--muted-2);
  animation: blink 1.3s ease-in-out infinite;
}
.typing span:nth-child(2) { animation-delay: .2s; }
.typing span:nth-child(3) { animation-delay: .4s; }
@keyframes blink {
  0%, 60%, 100% { opacity: .15; transform: scale(.8); }
  30%            { opacity: 1;   transform: scale(1); }
}

/* ── Input area ── */
.input-area {
  padding: 12px 32px 24px;
  flex-shrink: 0;
  animation: fadeUp .4s .2s ease both;
  opacity: 0;
}

.input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 10px 12px 10px 16px;
  transition: border-color .2s, box-shadow .2s;
}
.input-wrap:focus-within {
  border-color: var(--border-2);
  box-shadow: 0 0 0 3px rgba(255,255,255,.03);
}

textarea {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 400;
  resize: none;
  max-height: 130px;
  line-height: 1.65;
  letter-spacing: .02em;
  padding: 3px 0;
}
textarea::placeholder { color: var(--muted); }

.send-btn {
  background: var(--user-bg);
  border: none;
  border-radius: 9px;
  color: var(--user-text);
  width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity .15s, transform .12s;
}
.send-btn:hover:not(:disabled) { opacity: .82; transform: scale(1.04); }
.send-btn:disabled { opacity: .15; cursor: default; }
.send-btn svg { width: 13px; height: 13px; }

.input-hint {
  margin-top: 8px;
  font-size: 10px;
  color: var(--muted);
  padding-left: 4px;
  letter-spacing: .05em;
}
</style>