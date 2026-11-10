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
		const DELETE_ROUTE = '/dsh-toolbox/delete';
		const RESTORE_ROUTE = '/dsh-toolbox/restore';
		const PURGE_ROUTE = '/dsh-toolbox/purge';
		/** How long the refresh spinner stays up at minimum, in milliseconds. */
		const MIN_SPIN_MS = 1000;

		// ── copy ────────────────────────────────────────────────────────────
		const STRINGS = {
			zh: {
				workspacesSection: '工作区',
				trashSection: '回收站',
				nav: '会话管理',
				title: '会话管理',
				subtitle: '按工作区分组列出会话；删除的会话先进入回收站，可以恢复，彻底删除不可撤销。',
				refresh: '刷新',
				loading: '加载中…',
				loadFailed: '读取会话数据失败',
				empty: '没有会话。',
				trashEmpty: '回收站是空的。',
				trashGroup: (n, limit) => `回收站（${n}/${limit}）`,
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
				del: '删除',
				restore: '恢复',
				purge: '彻底删除',
				confirmDelete: (title) => `删除会话「${title}」？它会移入回收站，可以恢复。`,
				confirmPurge: (title) => `彻底删除「${title}」？日志文件会被永久清除，无法恢复。`,
				deleteFailed: '删除失败',
				runningRefused: '会话正在运行，无法删除',
				menuDelete: '删除会话',
				menuRunning: '运行中，无法删除',
				emptyGroup: '（该工作区暂无会话）',
			},
			en: {
				workspacesSection: 'Workspaces',
				trashSection: 'Trash',
				nav: 'Sessions',
				title: 'Session cleanup',
				subtitle: 'Sessions grouped by workspace. Deleted sessions go to the trash first and can be restored; purging is permanent.',
				refresh: 'Refresh',
				loading: 'Loading…',
				loadFailed: 'Failed to read session data',
				empty: 'No sessions.',
				trashEmpty: 'The trash is empty.',
				trashGroup: (n, limit) => `Trash (${n}/${limit})`,
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
				del: 'Delete',
				restore: 'Restore',
				purge: 'Purge',
				confirmDelete: (title) => `Delete "${title}"? It moves to the trash and can be restored.`,
				confirmPurge: (title) => `Permanently delete "${title}"? Its log files cannot be recovered.`,
				deleteFailed: 'Delete failed',
				runningRefused: 'The session is running and cannot be deleted',
				menuDelete: 'Delete session',
				menuRunning: 'Running — cannot delete',
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

		function formatTime(ms) {
			if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
			const d = new Date(ms);
			const pad = (n) => String(n).padStart(2, '0');
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
		}

		async function post(route, payload) {
			const response = await fetch(route, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body.ok !== true) throw new Error(body.error || `HTTP ${response.status}`);
			return body;
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

		// ── one row ─────────────────────────────────────────────────────────
		function SessionRow(props) {
			const { row, s, busy, mode, onDelete, onRestore, onPurge, isChild } = props;
			const title = row.title || s.unknownTitle;
			const meta = [];
			meta.push(row.cwd || s.noCwd);
			const size = formatBytes(row.sizeBytes);
			meta.push(size === null ? s.sizeUnknown : size);
			if (mode === 'trash' && row.deletedAt) meta.push(formatTime(row.deletedAt));

			const tags = [];
			if (row.running) tags.push(h('span', { key: 'live', className: 'dsh-toolbox__tag dsh-toolbox__tag--live' }, s.live));
			if (row.archived && mode !== 'trash') tags.push(h('span', { key: 'arch', className: 'dsh-toolbox__tag dsh-toolbox__tag--arch' }, s.archived));
			if (row.blank) tags.push(h('span', { key: 'blank', className: 'dsh-toolbox__tag dsh-toolbox__tag--blank' }, s.blank));
			if (row.isSubagent) tags.push(h('span', { key: 'sub', className: 'dsh-toolbox__tag dsh-toolbox__tag--sub' }, 'subagent'));
			if (row.orphan) tags.push(h('span', { key: 'orphan', className: 'dsh-toolbox__tag dsh-toolbox__tag--orphan' }, s.orphan));
			if (Array.isArray(row.subagents) && row.subagents.length > 0) {
				tags.push(h('span', { key: 'kids', className: 'dsh-toolbox__tag dsh-toolbox__tag--sub' }, s.subagents(row.subagents.length)));
			}

			const actions = mode === 'trash'
				? [
					h('button', {
						key: 'restore',
						type: 'button',
						className: 'dsh-toolbox__btn',
						disabled: busy,
						onClick: onRestore,
					}, s.restore),
					h('button', {
						key: 'purge',
						type: 'button',
						className: 'dsh-toolbox__btn dsh-toolbox__btn--danger',
						disabled: busy || row.running,
						title: row.running ? s.runningRefused : undefined,
						onClick: onPurge,
					}, s.purge),
				]
				: [
					h('button', {
						key: 'delete',
						type: 'button',
						className: 'dsh-toolbox__btn dsh-toolbox__btn--danger',
						disabled: busy || row.running,
						title: row.running ? s.runningRefused : undefined,
						onClick: onDelete,
					}, s.del),
				];

			return h('li', {
				className: 'dsh-toolbox__row',
				'data-dim': row.archived || mode === 'trash' ? '' : undefined,
				'data-child': isChild ? '' : undefined,
			},
				h('div', { className: 'dsh-toolbox__main' },
					h('div', { className: 'dsh-toolbox__name', title }, title, ...tags),
					h('div', { className: 'dsh-toolbox__meta' }, meta.join(' · ')),
				),
				h('div', { className: 'dsh-toolbox__actions' }, ...actions),
			);
		}

		// ── the settings page ───────────────────────────────────────────────
		function SessionPanel(props) {
			const s = useLocaleStrings();
			const [state, setState] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [busyId, setBusyId] = React.useState(null);
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

			const withBusy = async (sessionId, run) => {
				setBusyId(sessionId);
				try {
					await run();
					await reload();
				} catch (failure) {
					const code = failure instanceof Error ? failure.message : '';
					window.alert(code === 'session-running' ? s.runningRefused : code);
				} finally {
					setBusyId(null);
				}
			};

			const groups = state === null ? [] : state.groups;
			const orphans = state === null ? [] : state.orphans;
			const entries = state === null ? [] : state.entries;
			const limit = state === null ? 20 : state.limit;
			const totalBytes = state === null ? 0 : state.totalBytes;
			const sessionCount = groups.reduce((sum, group) => sum + group.sessions.length, 0);

			const toggle = (key, group) => {
				setView((prev) => ({
					...prev,
					groups: { ...prev.groups, [key]: !resolveGroupOpen(prev.groups, key, group) },
				}));
			};

			const askDelete = (row) => {
				if (!window.confirm(s.confirmDelete(row.title || s.unknownTitle))) return;
				void withBusy(row.id, () => post(DELETE_ROUTE, { sessionId: row.id, title: row.title }));
			};

			const renderRow = (row, mode, isChild) => h(SessionRow, {
				key: row.id,
				row,
				s,
				mode,
				isChild,
				busy: busyId === row.id,
				onDelete: () => askDelete(row),
				onRestore: () => {
					void withBusy(row.id, () => post(RESTORE_ROUTE, { sessionId: row.id }));
				},
				onPurge: () => {
					if (!window.confirm(s.confirmPurge(row.title || s.unknownTitle))) return;
					void withBusy(row.id, () => post(PURGE_ROUTE, { sessionId: row.id }));
				},
			});

			const renderGroup = (group, index) => {
				const key = group.workspaceId || '__ungrouped__';
				const isOpen = resolveGroupOpen(groupOpen, key, group);
				const label = group.title === null ? s.ungrouped : group.title;
				const rows = [];
				for (const row of group.sessions) {
					rows.push(renderRow(row, 'active', false));
					for (const child of row.subagents || []) rows.push(renderRow(child, 'active', true));
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

			const trashRows = entries.map((entry) => ({
				id: entry.sessionId,
				title: entry.title,
				cwd: entry.cwd,
				archived: true,
				running: false,
				isSubagent: entry.isSubagent === true,
				deletedAt: entry.deletedAt,
			}));

			return h('div', { className: 'dsh-toolbox', 'data-dsh-toolbox': '' },
				h('header', { className: 'dsh-toolbox__head' },
					h('h2', { className: 'dsh-toolbox__title' }, s.title),
					h('p', { className: 'dsh-toolbox__sub' }, s.subtitle),
				),
				error === null ? null : h('div', { className: 'dsh-toolbox__error' }, `${s.loadFailed}: ${error}`),

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

				// ── section 2: trash ───────────────────────────────────────
				h('div', { className: 'dsh-toolbox__section' },
					h('div', { className: 'dsh-toolbox__sectionHead' },
						h('span', { className: 'dsh-toolbox__sectionTitle' }, s.trashSection),
						h('span', { className: 'dsh-toolbox__sectionCount' }, `${trashRows.length} / ${limit}`),
						orphans.length === 0 ? null : h('button', {
							type: 'button',
							className: 'dsh-toolbox__btn dsh-toolbox__sectionAction',
							'aria-expanded': orphanOpen ? 'true' : 'false',
							onClick: () => setView((prev) => ({ ...prev, orphans: !prev.orphans })),
						}, s.orphanGroup(orphans.length)),
					),
					orphans.length === 0 ? null : (orphanOpen
						? h('ul', { className: 'dsh-toolbox__list' },
							...orphans.map((row) => renderRow({ ...row, orphan: true }, 'active', true)))
						: null),
					trashRows.length === 0
						? h('div', { className: 'dsh-toolbox__empty' }, s.trashEmpty)
						: h('ul', { className: 'dsh-toolbox__list' },
							...trashRows.map((row) => renderRow(row, 'trash', false))),
				),
			);
		}

		// ── the session-row menu item ───────────────────────────────────────
		function DeleteMenuItem(props) {
			const s = useLocaleStrings();
			const sessionId = props.sessionId;
			const displayTitle = props.displayTitle;
			const useMenuOpenState = props.useMenuOpenState;
			const setMenuOpen = useMenuOpenState()[1];
			const [busy, setBusy] = React.useState(false);
			const [running, setRunning] = React.useState(false);

			React.useEffect(() => {
				let cancelled = false;
				void (async () => {
					try {
						const state = await fetchState();
						if (cancelled) return;
						for (const group of state.groups) {
							for (const row of group.sessions) {
								if (row.id === sessionId) {
									setRunning(row.running === true);
									return;
								}
								for (const child of row.subagents || []) {
									if (child.id === sessionId) {
										setRunning(child.running === true);
										return;
									}
								}
							}
						}
					} catch {
						// Leave it enabled; the host refuses a running session anyway.
					}
				})();
				return () => {
					cancelled = true;
				};
			}, [sessionId]);

			const onClick = () => {
				if (busy) return;
				setMenuOpen(false);
				if (!window.confirm(s.confirmDelete(displayTitle || s.unknownTitle))) return;
				setBusy(true);
				void (async () => {
					try {
						await post(DELETE_ROUTE, { sessionId, title: displayTitle });
					} catch (failure) {
						const code = failure instanceof Error ? failure.message : '';
						window.alert(code === 'session-running' ? s.runningRefused : `${s.deleteFailed}: ${code}`);
					} finally {
						setBusy(false);
					}
				})();
			};

			return h('button', {
				type: 'button',
				role: 'menuitem',
				disabled: busy || running,
				title: running ? s.menuRunning : undefined,
				onClick,
				style: { color: running ? undefined : '#dc2626' },
			}, s.menuDelete);
		}

		// ── plugin entry ────────────────────────────────────────────────────
		exports.name = 'dsh-toolbox/client';
		exports.inject = ['slots', 'locale'];

		function apply(ctx) {
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

			ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
				name: 'sidebar.workspaces.session.menu.item',
				id: 'dsh-toolbox-delete-session',
				order: 400,
				label: () => strings().menuDelete,
			}, DeleteMenuItem));
		}

		exports.apply = apply;
		exports.NS = NS;
		return module.exports;
	}
});
