window.__ModuleLoader__.load({
	id: 'dsh-toolbox',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const React = require('react');
		const h = React.createElement;

		const NS = 'dsh-toolbox';
		const STATE_ROUTE = '/dsh-toolbox/state';
		const ARCHIVE_ROUTE = '/dsh-toolbox/archive';
		const UNARCHIVE_ROUTE = '/dsh-toolbox/unarchive';
		const PREVIEW_ROUTE = '/dsh-toolbox/preview';
		const PURGE_ROUTE = '/dsh-toolbox/purge';
		/** How long the refresh spinner stays up at minimum, in milliseconds. */
		const MIN_SPIN_MS = 1000;
		/** How long a failure notice stays up, in milliseconds. */
		const NOTICE_MS = 4000;

		/**
		 * The client root, captured in `apply` so the official session service
		 * can be resolved at call time.
		 *
		 * Resolved lazily and through `ctx.get`, never injected: a plugin that
		 * injected `sessions` would not mount at all on a build without it, and
		 * this is only used to drop a destroyed row from the sidebar immediately
		 * instead of waiting for the next list refresh.
		 */
		let clientContext = null;

		function forgetInOfficialList(sessionId) {
			let target = null;
			try {
				target = clientContext?.get?.('sessions') ?? null;
			} catch {
				target = null;
			}
			if (target === null) return;
			try {
				if (typeof target.handleSessionRemoved === 'function') target.handleSessionRemoved(sessionId);
				if (typeof target.refresh === 'function') {
					const refreshed = target.refresh();
					if (refreshed !== null && typeof refreshed === 'object' && typeof refreshed.catch === 'function') {
						refreshed.catch(() => {});
					}
				}
			} catch {
				// Purely cosmetic: the list refreshes on its own.
			}
		}

		// ── copy ────────────────────────────────────────────────────────────
		const STRINGS = {
			zh: {
				workspacesSection: '工作区',
				nav: '会话管理',
				title: '会话管理',
				subtitle: '按工作区分组列出会话；归档是隐藏会话的可逆步骤，彻底删除不可撤销。',
				refresh: '刷新',
				loading: '加载中…',
				loadFailed: '读取会话数据失败',
				empty: '没有会话。',
				orphanGroup: (n) => `孤儿子会话（${n}）`,
				ungrouped: '未分组',
				summary: (groups, n, size) => `${groups} 个工作区 · ${n} 个会话 · ${size}`,
				unknownTitle: '(无标题)',
				noCwd: '(未知工作目录)',
				sizeUnknown: '大小未知',
				live: '运行中',
				archived: '已归档',
				blank: '空白',
				subagents: (n) => `${n} 个子代理`,
				orphan: '父会话已删除',
				archive: '归档',
				unarchive: '取消归档',
				purge: '彻底删除',
				confirmPurge: (title, kids) => kids > 0
					? `彻底删除「${title}」及其 ${kids} 个子代理？日志、缓存和登记记录都会被永久清除，无法恢复。`
					: `彻底删除「${title}」？日志、缓存和登记记录都会被永久清除，无法恢复。`,
				confirmPurgeDetailed: (title, kids, dirs, size, cache, workspaces, pinned) => {
					const lines = [`彻底删除「${title}」？此操作不可撤销。`];
					if (kids > 0) lines.push(`同时删除其 ${kids} 个子代理会话。`);
					lines.push(`将删除 ${dirs} 个日志目录（共 ${size}）和 ${cache} 条投影缓存记录。`);
					if (workspaces > 0) lines.push(`并从 ${workspaces} 个工作区移除登记。`);
					if (pinned > 0) lines.push(`其中 ${pinned} 个已置顶，会一并取消。`);
					return lines.join('\n');
				},
				archivedNotice: '已归档',
				unarchivedNotice: '已取消归档',
				purgedNotice: (removed, dirs) => `已删除 ${removed} 个会话、${dirs} 个日志目录`,
				purgePartial: (failed, removed) => `已删除 ${removed} 个，${failed} 个日志目录被占用，请关闭占用后重试`,
				sessionActive: (labels) => `会话仍有活动（${labels}），请先停止再删除`,
				forbiddenOrigin: '请求来源不被允许（仅限本页面）',
				mustArchiveFirst: '先归档，才能彻底删除',
				runningRefused: '会话正在运行，请稍后再试',
				sessionInUse: '会话仍被当前进程持有，重启后再试',
				artifactMissing: '找不到这会话的日志目录，未删除任何东西（插件与 DSH 版本可能不一致）',
				actionFailed: '操作失败',
				emptyGroup: '（该工作区暂无会话）',
			},
			en: {
				workspacesSection: 'Workspaces',
				nav: 'Sessions',
				title: 'Session cleanup',
				subtitle: 'Sessions grouped by workspace. Archiving is the reversible way to hide one; destroying is permanent.',
				refresh: 'Refresh',
				loading: 'Loading…',
				loadFailed: 'Failed to read session data',
				empty: 'No sessions.',
				orphanGroup: (n) => `Orphaned subagents (${n})`,
				ungrouped: 'Ungrouped',
				summary: (groups, n, size) => `${groups} workspaces · ${n} sessions · ${size}`,
				unknownTitle: '(untitled)',
				noCwd: '(unknown working directory)',
				sizeUnknown: 'unknown size',
				live: 'running',
				archived: 'archived',
				blank: 'blank',
				subagents: (n) => `${n} subagents`,
				orphan: 'parent deleted',
				archive: 'Archive',
				unarchive: 'Unarchive',
				purge: 'Destroy',
				confirmPurge: (title, kids) => kids > 0
					? `Destroy "${title}" and its ${kids} subagent sessions? Their logs, cache and registry entries are removed permanently.`
					: `Destroy "${title}"? Its logs, cache and registry entries are removed permanently.`,
				confirmPurgeDetailed: (title, kids, dirs, size, cache, workspaces, pinned) => {
					const lines = [`Destroy "${title}"? This cannot be undone.`];
					if (kids > 0) lines.push(`Its ${kids} subagent sessions go with it.`);
					lines.push(`Removes ${dirs} log directories (${size}) and ${cache} projection-cache records.`);
					if (workspaces > 0) lines.push(`Detaches it from ${workspaces} workspaces.`);
					if (pinned > 0) lines.push(`${pinned} of them pinned — the pins are dropped too.`);
					return lines.join('\n');
				},
				archivedNotice: 'Archived',
				unarchivedNotice: 'Unarchived',
				purgedNotice: (removed, dirs) => `Removed ${removed} sessions and ${dirs} log directories`,
				purgePartial: (failed, removed) => `Removed ${removed}; ${failed} log directories were in use — close them and retry`,
				sessionActive: (labels) => `The session is still active (${labels}) — stop it first`,
				forbiddenOrigin: 'This page is not allowed to make that request',
				mustArchiveFirst: 'Archive it first, then it can be destroyed',
				runningRefused: 'The session is running — try again later',
				sessionInUse: 'This process still holds the session open — try again after a restart',
				artifactMissing: 'Could not find this session\'s log directory, so nothing was deleted (the plugin and DSH versions may differ)',
				actionFailed: 'Action failed',
				emptyGroup: '(no sessions in this workspace)',
			},
		};

		let locale = 'en';
		const localeListeners = new Set();
		function setLocale(next) {
			const normalized = String(next || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
			if (normalized === locale) return;
			locale = normalized;
			for (const listener of [...localeListeners]) listener();
		}
		function strings() {
			return STRINGS[locale];
		}
		function useLocaleStrings() {
			const [, force] = React.useState(0);
			React.useEffect(() => {
				const listener = () => force((n) => n + 1);
				localeListeners.add(listener);
				return () => {
					localeListeners.delete(listener);
				};
			}, []);
			return strings();
		}

		// ── icons ───────────────────────────────────────────────────────────
		// One downward chevron, rotated by CSS when the group is collapsed —
		// the same affordance the plugin inventory's group toggle uses.
		const CHEVRON = h('svg', {
			width: 14,
			height: 14,
			viewBox: '0 0 16 16',
			fill: 'none',
			stroke: 'currentColor',
			strokeWidth: 1.5,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
		},
			h('path', { d: 'M4 6.5 8 10.5 12 6.5' }),
		);

		// The loading spinner: a light grey hollow ring with one darker arc that
		// rotates around it at a constant speed. The arc is a quarter of the
		// circumference with a round cap, so the head reads as a moving segment
		// rather than a blinking dot.
		const SPINNER = h('svg', {
			className: 'dsh-toolbox__spinner',
			width: 14,
			height: 14,
			viewBox: '0 0 16 16',
			fill: 'none',
			strokeWidth: 1.75,
			strokeLinecap: 'round',
			'aria-hidden': 'true',
			focusable: 'false',
		},
			// The pale track the dark arc travels along.
			h('circle', {
				cx: 8, cy: 8, r: 6,
				stroke: 'var(--dsw-alias-label-tertiary,#9ca3af)',
				opacity: 0.28,
			}),
			// The darker quarter that spins.
			h('path', {
				d: 'M8 2a6 6 0 0 1 6 6',
				stroke: 'var(--dsw-alias-label-secondary,#6b7280)',
				opacity: 1,
			}),
		);

		// ── styles ──────────────────────────────────────────────────────────
		// The header block restates the built-in plugins page (ui-settings-plugins:
		// `.section{gap:12px}`, `.heading{18px/600, margin:0}`,
		// `.intro{13px, label-tertiary, margin:0}`) line for line, including
		// leaving both line heights to the browser: that is what makes the
		// heading-to-intro distance match the official pages rather than
		// approximate them. The rest of the column keeps explicit line heights
		// so its rhythm does not drift with the font stack.
		const STYLE = `
.dsh-toolbox { display:flex; flex-direction:column; gap:16px; max-width:760px; color:var(--dsw-alias-label-primary,#111827); }
.dsh-toolbox__head { display:flex; flex-direction:column; flex:none; gap:12px; }
.dsh-toolbox__title { color:var(--dsw-alias-label-primary,#111827); font-size:18px; font-weight:600; margin:0; }
.dsh-toolbox__sub { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:13px; margin:0; }
.dsh-toolbox__section { display:flex; flex-direction:column; gap:12px; }
.dsh-toolbox__section + .dsh-toolbox__section { border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22)); padding-top:16px; }
.dsh-toolbox__sectionHead { align-items:center; display:flex; gap:8px; min-height:24px; }
.dsh-toolbox__sectionTitle { margin:0; color:var(--dsw-alias-label-primary,#111827); font-size:14px; font-weight:600; line-height:22px; }
.dsh-toolbox__sectionCount { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:12px; font-variant-numeric:tabular-nums; line-height:18px; }
.dsh-toolbox__sectionAction { margin-left:auto; }
.dsh-toolbox__btn { appearance:none; background:transparent; border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2,rgba(127,127,127,.3))); border-radius:var(--dsw-radius-sm,6px); color:var(--dsw-alias-label-primary,inherit); cursor:pointer; font:inherit; font-size:12px; line-height:18px; padding:4px 10px; white-space:nowrap; }
.dsh-toolbox__btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1)); }
.dsh-toolbox__btn:active:not(:disabled) { background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.16)); }
.dsh-toolbox__btn:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe)); outline-offset:2px; }
.dsh-toolbox__btn:disabled { cursor:default; opacity:.45; }
/*
 * The refresh button keeps its label in the DOM while loading, merely hidden,
 * and centres the spinner over the same box. The label therefore keeps
 * measuring exactly what it measured before, so the button width is identical
 * in both states and the section header never shifts — for any language and
 * any font, without hard-coding a width per translation.
 */
.dsh-toolbox__btn--refresh { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; position:relative; }
.dsh-toolbox__label { display:block; }
.dsh-toolbox__btn--busy .dsh-toolbox__label { visibility:hidden; }
/* The spinner gets its own full-bleed layer so its rotation transform stays its own. */
.dsh-toolbox__spinnerLayer { align-items:center; display:flex; inset:0; justify-content:center; position:absolute; }
/* A busy button keeps full opacity: the spinner must stay legible. */
.dsh-toolbox__btn--busy:disabled { cursor:default; opacity:1; }
.dsh-toolbox__spinner { display:block; flex:none; }
@media (prefers-reduced-motion:no-preference) { .dsh-toolbox__spinner { animation:dsh-toolbox-spin .8s linear infinite; } }
@keyframes dsh-toolbox-spin { to { transform:rotate(360deg); } }
.dsh-toolbox__btn--danger { border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#dc2626) 45%, transparent); color:var(--dsw-alias-state-error-primary,#dc2626); }
.dsh-toolbox__btn--danger:hover:not(:disabled) { background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#dc2626) 10%, transparent); }
.dsh-toolbox__groups { display:flex; flex-direction:column; }
.dsh-toolbox__group { display:flex; flex-direction:column; gap:8px; }
.dsh-toolbox__group + .dsh-toolbox__group { border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22)); margin-top:12px; padding-top:12px; }
.dsh-toolbox__groupHead { align-items:flex-start; background:transparent; border:0; border-radius:var(--dsw-radius-sm,6px); color:inherit; cursor:pointer; display:flex; font:inherit; gap:6px; margin:0; padding:0; text-align:left; width:100%; }
.dsh-toolbox__groupHead:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe)); outline-offset:2px; }
.dsh-toolbox__chevron { color:var(--dsw-alias-label-tertiary,#9ca3af); display:inline-flex; flex:none; margin-top:4px; transition:transform .14s ease; }
.dsh-toolbox__groupHead[aria-expanded="false"] .dsh-toolbox__chevron { transform:rotate(-90deg); }
.dsh-toolbox__groupText { display:flex; flex:1 1 auto; flex-direction:column; gap:1px; min-width:0; }
.dsh-toolbox__groupName { color:var(--dsw-alias-label-primary,#111827); font-size:13px; font-weight:600; line-height:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-toolbox__groupPath { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:12px; line-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-toolbox__groupCount { color:var(--dsw-alias-label-tertiary,#9ca3af); flex:none; font-size:12px; font-variant-numeric:tabular-nums; line-height:18px; margin-top:1px; }
.dsh-toolbox__list { display:flex; flex-direction:column; gap:8px; list-style:none; margin:0; padding:0; }
.dsh-toolbox__row { align-items:center; background:var(--dsw-alias-settings-card-fill,transparent); border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2,rgba(127,127,127,.22))); border-radius:var(--dsw-radius-xl,20px); box-sizing:border-box; display:flex; gap:12px; min-height:52px; padding:11px 14px; transition:background .16s,border-color .16s; }
@media (hover:hover) { .dsh-toolbox__row:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06)); } }
.dsh-toolbox__row[data-dim] { opacity:.72; }
.dsh-toolbox__row[data-child] { border-style:dashed; margin-left:20px; }
.dsh-toolbox__main { display:flex; flex:1 1 auto; flex-direction:column; gap:2px; min-width:0; }
.dsh-toolbox__name { color:var(--dsw-alias-label-primary,#111827); font-size:14px; font-weight:500; line-height:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-toolbox__meta { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:12px; font-variant-numeric:tabular-nums; line-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-toolbox__tag { background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.1)); border-radius:999px; color:var(--dsw-alias-label-secondary,#6b7280); display:inline-block; font-size:11px; font-weight:500; line-height:17px; margin-left:6px; padding:0 7px; vertical-align:middle; }
.dsh-toolbox__tag--live { background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#16a34a) 14%, transparent); color:var(--dsw-alias-state-success-primary,#15803d); }
.dsh-toolbox__tag--arch { background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.12)); color:var(--dsw-alias-label-tertiary,#9ca3af); }
.dsh-toolbox__tag--blank { background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.1)); color:var(--dsw-alias-label-tertiary,#9ca3af); }
.dsh-toolbox__tag--orphan { background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d97706) 16%, transparent); color:var(--dsw-alias-state-warn-primary,#b45309); }
.dsh-toolbox__tag--sub { background:color-mix(in srgb, var(--dsw-alias-state-business-primary,#4d6bfe) 12%, transparent); color:var(--dsw-alias-state-business-primary,#3b5bdb); }
.dsh-toolbox__actions { display:flex; flex:none; gap:8px; }
.dsh-toolbox__empty { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:13px; line-height:20px; margin:0; }
.dsh-toolbox__error { background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#dc2626) 8%, transparent); border-radius:var(--dsw-radius-lg,10px); color:var(--dsw-alias-state-error-primary,#dc2626); font-size:12px; line-height:18px; margin:0; padding:8px 10px; }
`;

		let styleEl = null;
		function ensureStyle() {
			if (styleEl !== null) return;
			styleEl = document.createElement('style');
			styleEl.setAttribute('data-plugin', 'dsh-toolbox');
			styleEl.setAttribute('data-plugin-css', 'dsh-toolbox');
			styleEl.textContent = STYLE;
			document.head.append(styleEl);
		}
		function removeStyle() {
			if (styleEl !== null) styleEl.remove();
			styleEl = null;
		}

		// ── helpers ─────────────────────────────────────────────────────────
		function formatBytes(bytes) {
			if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
			const units = ['B', 'KB', 'MB', 'GB'];
			let value = bytes;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
		}

		async function post(route, payload) {
			const response = await fetch(route, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body.ok !== true) {
				// Keep the structured answer: a partial destroy names the ids that
				// survived, and the caller needs them to say something useful.
				const failure = new Error(body.error || `HTTP ${response.status}`);
				failure.status = response.status;
				failure.body = body;
				throw failure;
			}
			return body;
		}

		/** Readable labels for the activity a refusal named, bounded to a line. */
		function activityLabels(body) {
			const groups = Array.isArray(body?.activity) ? body.activity : [];
			const labels = [];
			for (const group of groups) {
				for (const entry of Array.isArray(group?.activity) ? group.activity : []) {
					labels.push(entry?.label || entry?.kind || 'active');
				}
			}
			const unique = [...new Set(labels)].slice(0, 3);
			return unique.length === 0 ? 'active' : unique.join(', ');
		}

		async function fetchState() {
			const response = await fetch(STATE_ROUTE);
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body.ok !== true) throw new Error(body.error || `HTTP ${response.status}`);
			return body;
		}

		// ── remembered view state ───────────────────────────────────────────
		/**
		 * Where the panel stores which sections the user opened or closed.
		 *
		 * A namespaced `localStorage` key, read and written defensively, is the
		 * pattern the built-in client plugins use for view state
		 * (ui-sidebar-right stores its layout the same way): it survives a
		 * reload and a restart without a Host round trip, and a browser that
		 * blocks storage just means the panel forgets, never that it breaks.
		 */
		const VIEW_STATE_KEY = 'dsh-toolbox:view-state'

		function emptyViewState() {
			return { groups: {}, orphans: false }
		}

		/**
		 * Read the remembered choices.
		 *
		 * Only explicit booleans are kept. Anything else — a truncated write, a
		 * hand-edited value, a schema from a future version — is dropped rather
		 * than trusted, so one bad entry cannot wedge the panel.
		 */
		function loadViewState() {
			try {
				const raw = window.localStorage.getItem(VIEW_STATE_KEY)
				if (raw === null) return emptyViewState()
				const parsed = JSON.parse(raw)
				if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyViewState()
				const state = emptyViewState()
				const groups = parsed.groups
				if (groups !== null && typeof groups === 'object' && !Array.isArray(groups)) {
					for (const [key, value] of Object.entries(groups)) {
						if (typeof value === 'boolean') state.groups[key] = value
					}
				}
				state.orphans = parsed.orphans === true
				return state
			} catch {
				return emptyViewState()
			}
		}

		function saveViewState(state) {
			try {
				window.localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state))
			} catch {
				// Storage disabled or full: remembered choices are a convenience,
				// so failing to write one is not a reason to disturb the panel.
			}
		}

		/** Whether any session in this group — parent or child — is running. */
		function groupHasRunning(group) {
			return group.sessions.some((row) => row.running === true
				|| (Array.isArray(row.subagents) && row.subagents.some((child) => child.running === true)))
		}

		/**
		 * Resolve one group's expansion.
		 *
		 * An explicit choice always wins. Without one, a group holding a running
		 * session starts open so the user can see the work, and every other
		 * group starts closed — with many workspaces, an all-open list buries
		 * the thing that is actually happening.
		 */
		function resolveGroupOpen(choices, key, group) {
			const chosen = choices[key]
			if (typeof chosen === 'boolean') return chosen
			return groupHasRunning(group)
		}

		/** How many subagent sessions sit below this card, at any depth. */
		function countSubtree(row) {
			let total = 0;
			for (const child of row.subagents || []) total += 1 + countSubtree(child);
			return total;
		}

		// ── one row ─────────────────────────────────────────────────────────
		/**
		 * One session card.
		 *
		 * The archive toggle sits on the left and is the reversible step; the
		 * destroy button sits on the right and stays disabled until the session
		 * is archived. So the destructive click is always the second one, and
		 * the card never hides which state it is in.
		 *
		 * A subagent child has no sidebar row and therefore no archive flag:
		 * nested children are read-only (they leave together with their parent),
		 * and an orphaned child (its parent is gone) can be destroyed directly —
		 * otherwise nothing could ever clean it up.
		 */
		function SessionRow(props) {
			const { row, s, busy, isChild, onArchive, onUnarchive, onPurge } = props;
			const title = row.title || s.unknownTitle;
			const meta = [];
			meta.push(row.cwd || s.noCwd);
			const size = formatBytes(row.sizeBytes);
			meta.push(size === null ? s.sizeUnknown : size);

			const tags = [];
			if (row.running) tags.push(h('span', { key: 'live', className: 'dsh-toolbox__tag dsh-toolbox__tag--live' }, s.live));
			if (row.archived) tags.push(h('span', { key: 'arch', className: 'dsh-toolbox__tag dsh-toolbox__tag--arch' }, s.archived));
			if (row.blank) tags.push(h('span', { key: 'blank', className: 'dsh-toolbox__tag dsh-toolbox__tag--blank' }, s.blank));
			if (row.isSubagent) tags.push(h('span', { key: 'sub', className: 'dsh-toolbox__tag dsh-toolbox__tag--sub' }, 'subagent'));
			if (row.orphan) tags.push(h('span', { key: 'orphan', className: 'dsh-toolbox__tag dsh-toolbox__tag--orphan' }, s.orphan));
			if (Array.isArray(row.subagents) && row.subagents.length > 0) {
				tags.push(h('span', { key: 'kids', className: 'dsh-toolbox__tag dsh-toolbox__tag--sub' }, s.subagents(row.subagents.length)));
			}

			const actions = [];
			if (!isChild) {
				actions.push(h('button', {
					key: 'archive',
					type: 'button',
					className: 'dsh-toolbox__btn',
					disabled: busy || row.running,
					title: row.running ? s.runningRefused : undefined,
					onClick: row.archived ? onUnarchive : onArchive,
				}, row.archived ? s.unarchive : s.archive));
			}
			if (!isChild || row.orphan) {
				const destroyable = row.orphan === true || row.archived === true;
				const blocked = row.running ? s.runningRefused
					: (row.agentAvailable ? s.sessionInUse
						: (destroyable ? undefined : s.mustArchiveFirst));
				actions.push(h('button', {
					key: 'purge',
					type: 'button',
					className: 'dsh-toolbox__btn dsh-toolbox__btn--danger',
					disabled: busy || !destroyable || row.running || row.agentAvailable,
					title: blocked,
					onClick: onPurge,
				}, s.purge));
			}

			return h('li', {
				className: 'dsh-toolbox__row',
				'data-dim': row.archived ? '' : undefined,
				'data-child': isChild ? '' : undefined,
			},
				h('div', { className: 'dsh-toolbox__main' },
					h('div', { className: 'dsh-toolbox__name', title }, title, ...tags),
					h('div', { className: 'dsh-toolbox__meta' }, meta.join(' · ')),
				),
				actions.length === 0 ? null : h('div', { className: 'dsh-toolbox__actions' }, ...actions),
			);
		}

		// ── the settings page ───────────────────────────────────────────────
		function SessionPanel(props) {
			const s = useLocaleStrings();
			const [state, setState] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [busyIds, setBusyIds] = React.useState(() => new Set());
			const [notice, setNotice] = React.useState(null);
			const noticeTimer = React.useRef(null);
			// Explicit open/closed choices, loaded once from storage so a reload
			// and a restart both restore what the user last did.
			const [view, setView] = React.useState(loadViewState);
			const groupOpen = view.groups;
			const orphanOpen = view.orphans;
			const [tick, setTick] = React.useState(0);
			// The in-flight read, shared by the poll and every manual refresh.
			const inFlight = React.useRef(null);
			// What the spinner reflects: a read the user asked for by hand, so a
			// background poll never flickers the button.
			const [manualLoading, setManualLoading] = React.useState(false);

			const reload = React.useCallback(async () => {
				// One read at a time: the 5s poll and a manual refresh can overlap,
				// and on a slow disk the older response could land last and paint
				// stale rows over fresh ones.
				if (inFlight.current !== null) return inFlight.current;
				const run = (async () => {
					try {
						const next = await fetchState();
						setState(next);
						setError(null);
					} catch (failure) {
						setError(failure instanceof Error ? failure.message : 'state-failed');
					} finally {
						inFlight.current = null;
					}
				})();
				inFlight.current = run;
				return run;
			}, []);

			React.useEffect(() => {
				void reload();
			}, [reload, tick]);

			React.useEffect(() => {
				const timer = window.setInterval(() => {
					void reload();
				}, 5000);
				return () => window.clearInterval(timer);
			}, [reload]);

			// Persist the choices, bounded to the groups that still exist.
			// Writing before the first read lands would erase the remembered map
			// (there are no groups yet), so the state-null case is skipped.
			React.useEffect(() => {
				if (state === null) return;
				const live = new Set(state.groups.map((group) => group.workspaceId || '__ungrouped__'));
				const groups = {};
				for (const [key, value] of Object.entries(groupOpen)) {
					if (live.has(key)) groups[key] = value;
				}
				saveViewState({ groups, orphans: orphanOpen });
			}, [groupOpen, orphanOpen, state]);

			/**
			 * The refresh button: wait for the current read, then read again.
			 *
			 * `reload()` collapses overlapping calls into the in-flight one, which
			 * would swallow a click that lands mid-poll — the user would see the
			 * pre-click data and believe the button did nothing. Awaiting the
			 * in-flight read first means every click ends in a read that started
			 * after it, and rapid clicks share one follow-up instead of stacking.
			 */
			const requestRefresh = React.useCallback(async () => {
				if (manualLoading) return;
				setManualLoading(true);
				// Hold the spinner for at least MIN_SPIN_MS: a local read settles in
				// a few milliseconds, and a flash of motion reads as a glitch
				// rather than as feedback. The remaining time is measured from the
				// click, so the total is `max(MIN_SPIN_MS, request time)` — a slow
				// read is shown for exactly as long as it takes, never padded twice.
				const startedAt = Date.now();
				try {
					if (inFlight.current !== null) await inFlight.current;
					await reload();
				} finally {
					const remaining = MIN_SPIN_MS - (Date.now() - startedAt);
					if (remaining > 0) {
						await new Promise((resolve) => {
							window.setTimeout(resolve, remaining);
						});
					}
					setManualLoading(false);
				}
			}, [manualLoading, reload]);

			/**
			 * Show one failure at a time, above the list.
			 *
			 * A blocking `alert` would freeze the poll and the spinner, and two
			 * quick failures would stack modal dialogs; a notice that replaces
			 * itself and expires keeps the page responsive. The timer is the
			 * newest one only, so a second message restarts the countdown.
			 */
			const showNotice = React.useCallback((text) => {
				if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
				setNotice(text);
				noticeTimer.current = window.setTimeout(() => {
					noticeTimer.current = null;
					setNotice(null);
				}, NOTICE_MS);
			}, []);

			React.useEffect(() => () => {
				if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
			}, []);

			const markBusy = (sessionId, busy) => {
				setBusyIds((previous) => {
					const next = new Set(previous);
					if (busy) next.add(sessionId);
					else next.delete(sessionId);
					return next;
				});
			};

			const withBusy = async (sessionId, run) => {
				markBusy(sessionId, true);
				setNotice(null);
				try {
					const message = await run();
					if (typeof message === 'string' && message !== '') showNotice(message);
				} catch (failure) {
					const code = failure instanceof Error ? failure.message : '';
					if (code === 'session-running') showNotice(s.runningRefused);
					else if (code === 'session-in-use') showNotice(s.sessionInUse);
					else if (code === 'session-active') showNotice(s.sessionActive(activityLabels(failure.body)));
					else if (code === 'artifact-not-located') showNotice(s.artifactMissing);
					else if (code === 'forbidden-origin') showNotice(s.forbiddenOrigin);
					else if (code === 'purge-partial') {
						const failed = Array.isArray(failure.body?.failed) ? failure.body.failed.length : 0;
						showNotice(s.purgePartial(failed, failure.body?.removed ?? 0));
					} else showNotice(`${s.actionFailed}: ${code}`);
				} finally {
					// Refresh even after a failure: a partial destroy already removed
					// some files, and the rows must stop claiming otherwise.
					await reload();
					markBusy(sessionId, false);
				}
			};

			const groups = state === null ? [] : state.groups;
			const orphans = state === null ? [] : state.orphans;
			const totalBytes = state === null ? 0 : state.totalBytes;
			const sessionCount = groups.reduce((sum, group) => sum + group.sessions.length, 0);

			const toggle = (key, group) => {
				setView((prev) => ({
					...prev,
					groups: { ...prev.groups, [key]: !resolveGroupOpen(prev.groups, key, group) },
				}));
			};

			// The archive toggle is the reversible step; the destroy button only
			// fires once the card is archived, and always through a confirmation
			// that names how much of the subagent subtree goes with it.
			const archiveToggle = (row) => {
				const route = row.archived ? UNARCHIVE_ROUTE : ARCHIVE_ROUTE;
				void withBusy(row.id, async () => {
					await post(route, { sessionId: row.id });
					return row.archived ? s.unarchivedNotice : s.archivedNotice;
				});
			};

			/**
			 * Ask the Host what a destroy would remove, then ask the user.
			 *
			 * The preview is what turns the confirmation from a title into the
			 * actual footprint. A refusal it already knows (not archived, running,
			 * still active work) is reported instead of asking a question the
			 * destroy would refuse; an unexpected preview failure falls back to the
			 * plain confirmation rather than blocking the action.
			 */
			const askPurge = async (row) => {
				if (busyIds.has(row.id)) return;
				const kids = countSubtree(row);
				let preview = null;
				try {
					preview = await post(PREVIEW_ROUTE, { sessionId: row.id });
				} catch (failure) {
					const code = failure instanceof Error ? failure.message : '';
					if (code === 'session-not-archived') return showNotice(s.mustArchiveFirst);
					if (code === 'session-running') return showNotice(s.runningRefused);
					if (code === 'session-in-use') return showNotice(s.sessionInUse);
					if (code === 'session-active') return showNotice(s.sessionActive(activityLabels(failure.body)));
					if (code === 'artifact-not-located') return showNotice(s.artifactMissing);
					// Anything else (a transport hiccup, a slow probe) must not make
					// the action impossible: fall through to the plain confirmation.
				}

				const title = row.title || s.unknownTitle;
				const confirmed = preview === null
					? window.confirm(s.confirmPurge(title, kids))
					: window.confirm(s.confirmPurgeDetailed(
						title,
						kids,
						preview.directories ?? 0,
						formatBytes(preview.bytes) || '0 B',
						preview.projectionRecords ?? 0,
						Array.isArray(preview.workspaces) ? preview.workspaces.length : 0,
						Array.isArray(preview.pinned) ? preview.pinned.length : 0,
					));
				if (!confirmed) return;

				void withBusy(row.id, async () => {
					const body = await post(PURGE_ROUTE, { sessionId: row.id });
					// The files and registry entries are gone, so the official
					// list should stop naming it now rather than at the next
					// refresh — the sidebar is visible behind this page.
					forgetInOfficialList(row.id);
					return s.purgedNotice(body.removed ?? 0, body.directories ?? 0);
				});
			};

			const renderRow = (row, isChild) => h(SessionRow, {
				key: row.id,
				row,
				s,
				isChild,
				busy: busyIds.has(row.id),
				onArchive: () => archiveToggle(row),
				onUnarchive: () => archiveToggle(row),
				onPurge: () => { void askPurge(row); },
			});

			const renderGroup = (group) => {
				const key = group.workspaceId || '__ungrouped__';
				const isOpen = resolveGroupOpen(groupOpen, key, group);
				const label = group.title === null ? s.ungrouped : group.title;
				const rows = [];
				for (const row of group.sessions) {
					rows.push(renderRow(row, false));
					for (const child of row.subagents || []) rows.push(renderRow(child, true));
				}
				return h('div', { className: 'dsh-toolbox__group', key },
					h('button', {
						type: 'button',
						className: 'dsh-toolbox__groupHead',
						'aria-expanded': isOpen ? 'true' : 'false',
						onClick: () => toggle(key, group),
					},
						h('span', { className: 'dsh-toolbox__chevron', 'aria-hidden': 'true' }, CHEVRON),
						h('span', { className: 'dsh-toolbox__groupText' },
							h('span', { className: 'dsh-toolbox__groupName', title: label }, label),
							group.path === null ? null : h('span', { className: 'dsh-toolbox__groupPath' }, group.path),
						),
						h('span', { className: 'dsh-toolbox__groupCount' }, group.sessions.length),
					),
					isOpen
						? (group.sessions.length === 0
							? h('div', { className: 'dsh-toolbox__empty' }, s.emptyGroup)
							: h('ul', { className: 'dsh-toolbox__list' }, ...rows))
						: null,
				);
			};

			return h('div', { className: 'dsh-toolbox', 'data-dsh-toolbox': '' },
				h('header', { className: 'dsh-toolbox__head' },
					h('h2', { className: 'dsh-toolbox__title' }, s.title),
					h('p', { className: 'dsh-toolbox__sub' }, s.subtitle),
				),
				error === null ? null : h('div', { className: 'dsh-toolbox__error' }, `${s.loadFailed}: ${error}`),
				notice === null ? null : h('div', { className: 'dsh-toolbox__error', role: 'alert' }, notice),

				// ── section 1: workspaces ──────────────────────────────────
				h('div', { className: 'dsh-toolbox__section' },
					h('div', { className: 'dsh-toolbox__sectionHead' },
						h('span', { className: 'dsh-toolbox__sectionTitle' }, s.workspacesSection),
						h('span', { className: 'dsh-toolbox__sectionCount' },
							state === null ? s.loading : s.summary(groups.length, sessionCount, formatBytes(totalBytes) || '0 B'),
						),
						h('button', {
							type: 'button',
							className: manualLoading
								? 'dsh-toolbox__btn dsh-toolbox__btn--refresh dsh-toolbox__btn--busy dsh-toolbox__sectionAction'
								: 'dsh-toolbox__btn dsh-toolbox__btn--refresh dsh-toolbox__sectionAction',
							disabled: manualLoading,
							// The visible label is hidden (not removed) while loading,
							// which takes its text out of the accessibility tree; the
							// explicit name keeps the button announced in both states.
							'aria-label': s.refresh,
							'aria-busy': manualLoading ? 'true' : 'false',
							onClick: requestRefresh,
						},
							h('span', { className: 'dsh-toolbox__label' }, s.refresh),
							manualLoading
								? h('span', { className: 'dsh-toolbox__spinnerLayer' }, SPINNER)
								: null,
						),
					),
					groups.length === 0
						? h('div', { className: 'dsh-toolbox__empty' }, state === null ? s.loading : s.empty)
						: h('div', { className: 'dsh-toolbox__groups' }, ...groups.map(renderGroup)),
				),

				// ── section 2: orphaned subagents (their parent is gone) ───
				orphans.length === 0 ? null : h('div', { className: 'dsh-toolbox__section' },
					h('div', { className: 'dsh-toolbox__sectionHead' },
						h('span', { className: 'dsh-toolbox__sectionTitle' }, s.orphanGroup(orphans.length)),
						h('button', {
							type: 'button',
							className: 'dsh-toolbox__btn dsh-toolbox__sectionAction',
							'aria-expanded': orphanOpen ? 'true' : 'false',
							onClick: () => setView((prev) => ({ ...prev, orphans: !prev.orphans })),
						}, orphanOpen ? '−' : '+'),
					),
					orphanOpen
						? h('ul', { className: 'dsh-toolbox__list' },
							...orphans.map((row) => renderRow({ ...row, orphan: true }, true)))
						: null,
				),
			);
		}

		// ── plugin entry ────────────────────────────────────────────────────
		exports.name = 'dsh-toolbox/client';
		exports.inject = ['slots', 'locale'];

		function apply(ctx) {
			clientContext = ctx;
			ensureStyle();
			// The style lives as long as the plugin fiber, not as long as any one
			// slot registration: an early removal would strip the menu item too.
			ctx.effect(() => () => removeStyle(), 'dsh-toolbox: style');

			setLocale(ctx.locale.getLocale().active);
			ctx.effect(() => {
				const unsubscribe = ctx.locale.subscribe(() => setLocale(ctx.locale.getLocale().active));
				return () => unsubscribe();
			}, 'dsh-toolbox: locale');

			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: 'dsh-toolbox-sessions',
				order: 60,
				label: () => strings().nav,
			}, SessionPanel));
		}

		exports.apply = apply;
		exports.NS = NS;
		return module.exports;
	}
});
