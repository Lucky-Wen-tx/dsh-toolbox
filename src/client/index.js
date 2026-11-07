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

		// ── copy ────────────────────────────────────────────────────────────
		const STRINGS = {
			zh: {
				nav: '会话管理',
				title: '会话管理',
				subtitle: '删除的会话先进入回收站，可以恢复；彻底删除不可撤销。',
				refresh: '刷新',
				loading: '加载中…',
				loadFailed: '读取会话数据失败',
				empty: '没有会话。',
				trashEmpty: '回收站是空的。',
				trashGroup: (n, limit) => `回收站（${n}/${limit}）`,
				archivedGroup: (n) => `已归档（${n}）`,
				summary: (n, size) => `${n} 个会话 · ${size}`,
				unknownTitle: '(无标题)',
				noCwd: '(未知工作目录)',
				sizeUnknown: '大小未知',
				msgs: (n) => `${n} 条消息`,
				live: '运行中',
				archived: '已归档',
				orphan: '孤儿子会话',
				del: '删除',
				restore: '恢复',
				purge: '彻底删除',
				confirmDelete: (title) => `删除会话「${title}」？它会移入回收站，可以恢复。`,
				confirmPurge: (title) => `彻底删除「${title}」？日志文件会被永久清除，无法恢复。`,
				deleteFailed: '删除失败',
				liveRefused: '会话正在运行，无法删除',
				menuDelete: '删除会话',
				menuRunning: '运行中，无法删除',
			},
			en: {
				nav: 'Sessions',
				title: 'Session cleanup',
				subtitle: 'Deleted sessions go to the trash first and can be restored; purging is permanent.',
				refresh: 'Refresh',
				loading: 'Loading…',
				loadFailed: 'Failed to read session data',
				empty: 'No sessions.',
				trashEmpty: 'The trash is empty.',
				trashGroup: (n, limit) => `Trash (${n}/${limit})`,
				archivedGroup: (n) => `Archived (${n})`,
				summary: (n, size) => `${n} sessions · ${size}`,
				unknownTitle: '(untitled)',
				noCwd: '(unknown working directory)',
				sizeUnknown: 'unknown size',
				msgs: (n) => `${n} messages`,
				live: 'running',
				archived: 'archived',
				orphan: 'orphaned child',
				del: 'Delete',
				restore: 'Restore',
				purge: 'Purge',
				confirmDelete: (title) => `Delete "${title}"? It moves to the trash and can be restored.`,
				confirmPurge: (title) => `Permanently delete "${title}"? Its log files cannot be recovered.`,
				deleteFailed: 'Delete failed',
				liveRefused: 'The session is running and cannot be deleted',
				menuDelete: 'Delete session',
				menuRunning: 'Running — cannot delete',
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

		// ── styles ──────────────────────────────────────────────────────────
		const STYLE = `
.dsh-toolbox { display:flex; flex-direction:column; gap:12px; color:var(--dsw-alias-label-primary,#111827); font-size:13px; }
.dsh-toolbox__title { font-size:15px; font-weight:600; }
.dsh-toolbox__sub { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:12px; line-height:1.5; }
.dsh-toolbox__bar { display:flex; align-items:center; gap:8px; }
.dsh-toolbox__count { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:12px; flex:1 1 auto; }
.dsh-toolbox__btn { appearance:none; background:transparent; border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28)); border-radius:8px; color:inherit; cursor:pointer; font:inherit; font-size:12px; padding:4px 10px; white-space:nowrap; }
.dsh-toolbox__btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1)); }
.dsh-toolbox__btn:disabled { cursor:default; opacity:.45; }
.dsh-toolbox__btn--danger { border-color:rgba(220,38,38,.45); color:#dc2626; }
.dsh-toolbox__btn--danger:hover:not(:disabled) { background:rgba(239,68,68,.1); }
.dsh-toolbox__list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
.dsh-toolbox__row { display:flex; align-items:center; gap:10px; border:1px solid var(--dsw-alias-line-border,rgba(127,127,127,.18)); border-radius:10px; padding:8px 10px; }
.dsh-toolbox__row[data-dim] { opacity:.72; }
.dsh-toolbox__main { flex:1 1 auto; min-width:0; }
.dsh-toolbox__name { font-size:13px; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-toolbox__meta { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:11px; line-height:1.5; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-toolbox__tag { display:inline-block; border-radius:6px; font-size:10px; line-height:16px; margin-left:6px; padding:0 6px; vertical-align:middle; }
.dsh-toolbox__tag--live { background:rgba(34,197,94,.14); color:#15803d; }
.dsh-toolbox__tag--arch { background:rgba(127,127,127,.16); }
.dsh-toolbox__tag--orphan { background:rgba(245,158,11,.16); color:#b45309; }
.dsh-toolbox__actions { display:flex; gap:6px; flex:none; }
.dsh-toolbox__group { border-top:1px solid var(--dsw-alias-line-border,rgba(127,127,127,.14)); margin-top:8px; padding-top:10px; }
.dsh-toolbox__groupHead { align-items:center; background:transparent; border:0; color:var(--dsw-alias-label-secondary,#6b7280); cursor:pointer; display:flex; font:inherit; font-size:12px; font-weight:600; justify-content:space-between; padding:4px 2px; width:100%; }
.dsh-toolbox__empty { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:12px; padding:6px 2px; }
.dsh-toolbox__error { background:rgba(239,68,68,.12); border-radius:8px; font-size:12px; padding:6px 10px; }
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

		// ── one row ─────────────────────────────────────────────────────────
		function SessionRow(props) {
			const { row, s, busy, inTrash, onDelete, onRestore, onPurge } = props;
			const title = row.title || s.unknownTitle;
			const meta = [];
			meta.push(row.cwd || s.noCwd);
			const size = formatBytes(row.sizeBytes);
			meta.push(size === null ? s.sizeUnknown : size);
			if (typeof row.eventCount === 'number') meta.push(s.msgs(row.eventCount));
			if (inTrash && row.deletedAt) meta.push(formatTime(row.deletedAt));

			const tags = [];
			if (row.live) tags.push(h('span', { key: 'live', className: 'dsh-toolbox__tag dsh-toolbox__tag--live' }, s.live));
			if (row.archived && !inTrash) tags.push(h('span', { key: 'arch', className: 'dsh-toolbox__tag dsh-toolbox__tag--arch' }, s.archived));
			if (row.orphan) tags.push(h('span', { key: 'orphan', className: 'dsh-toolbox__tag dsh-toolbox__tag--orphan' }, s.orphan));

			const actions = inTrash
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
						disabled: busy || row.live,
						title: row.live ? s.liveRefused : undefined,
						onClick: onPurge,
					}, s.purge),
				]
				: [
					h('button', {
						key: 'delete',
						type: 'button',
						className: 'dsh-toolbox__btn dsh-toolbox__btn--danger',
						disabled: busy || row.live,
						title: row.live ? s.liveRefused : undefined,
						onClick: onDelete,
					}, s.del),
				];

			return h('li', { className: 'dsh-toolbox__row', 'data-dim': row.archived || inTrash ? '' : undefined },
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
			const useSessions = props.useSessions;
			// Unconditional hook call: the standard prop is always present on a
			// settings section, and the store is the shell's own session list.
			const list = useSessions((snapshot) => snapshot);
			const [state, setState] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [busyId, setBusyId] = React.useState(null);
			const [trashOpen, setTrashOpen] = React.useState(true);
			const [archivedOpen, setArchivedOpen] = React.useState(false);
			const [tick, setTick] = React.useState(0);

			const titleOf = React.useCallback((sessionId) => {
				const byId = list === null || list === undefined ? undefined : list.byId;
				if (byId === undefined) return undefined;
				const summary = byId[sessionId];
				if (summary === undefined) return undefined;
				return summary.displayTitle || summary.title || undefined;
			}, [list]);

			const reload = React.useCallback(async () => {
				try {
					const next = await fetchState();
					setState(next);
					setError(null);
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : 'state-failed');
				}
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

			const withBusy = async (sessionId, run) => {
				setBusyId(sessionId);
				try {
					await run();
					await reload();
				} catch (failure) {
					const code = failure instanceof Error ? failure.message : '';
					window.alert(code === 'session-live' ? s.liveRefused : code);
				} finally {
					setBusyId(null);
				}
			};

			const rows = state === null ? [] : state.sessions;
			const entries = state === null ? [] : state.entries;
			const limit = state === null ? 20 : state.limit;
			const ids = new Set(rows.map((row) => row.id));
			const decorated = rows.map((row) => ({
				...row,
				title: titleOf(row.id),
				orphan: typeof row.parentSession === 'string' && !ids.has(row.parentSession),
			}));
			const active = decorated.filter((row) => !row.archived);
			const archived = decorated.filter((row) => row.archived);
			const trashRows = entries.map((entry) => {
				const known = decorated.find((row) => row.id === entry.sessionId);
				return {
					id: entry.sessionId,
					title: known === undefined ? entry.title : known.title,
					cwd: entry.cwd,
					archived: true,
					live: known === undefined ? false : known.live,
					deletedAt: entry.deletedAt,
				};
			});
			const totalBytes = decorated.reduce((sum, row) => sum + (row.sizeBytes || 0), 0);

			const askDelete = (row) => {
				if (!window.confirm(s.confirmDelete(row.title || s.unknownTitle))) return;
				void withBusy(row.id, () => post(DELETE_ROUTE, { sessionId: row.id, title: row.title }));
			};

			return h('div', { className: 'dsh-toolbox', 'data-dsh-toolbox': '' },
				h('div', { className: 'dsh-toolbox__title' }, s.title),
				h('div', { className: 'dsh-toolbox__sub' }, s.subtitle),
				h('div', { className: 'dsh-toolbox__bar' },
					h('span', { className: 'dsh-toolbox__count' },
						state === null ? s.loading : s.summary(active.length, formatBytes(totalBytes) || '0 B'),
					),
					h('button', {
						type: 'button',
						className: 'dsh-toolbox__btn',
						onClick: () => setTick((n) => n + 1),
					}, s.refresh),
				),
				error === null ? null : h('div', { className: 'dsh-toolbox__error' }, `${s.loadFailed}: ${error}`),

				active.length === 0
					? h('div', { className: 'dsh-toolbox__empty' }, state === null ? s.loading : s.empty)
					: h('ul', { className: 'dsh-toolbox__list' },
						...active.map((row) => h(SessionRow, {
							key: row.id,
							row,
							s,
							busy: busyId === row.id,
							inTrash: false,
							onDelete: () => askDelete(row),
						})),
					),

				archived.length === 0 ? null : h('div', { className: 'dsh-toolbox__group' },
					h('button', {
						type: 'button',
						className: 'dsh-toolbox__groupHead',
						'aria-expanded': archivedOpen ? 'true' : 'false',
						onClick: () => setArchivedOpen((open) => !open),
					}, s.archivedGroup(archived.length), archivedOpen ? '▾' : '▸'),
					archivedOpen
						? h('ul', { className: 'dsh-toolbox__list' },
							...archived.map((row) => h(SessionRow, {
								key: row.id,
								row,
								s,
								busy: busyId === row.id,
								inTrash: false,
								onDelete: () => askDelete(row),
							})),
						)
						: null,
				),

				h('div', { className: 'dsh-toolbox__group' },
					h('button', {
						type: 'button',
						className: 'dsh-toolbox__groupHead',
						'aria-expanded': trashOpen ? 'true' : 'false',
						onClick: () => setTrashOpen((open) => !open),
					}, s.trashGroup(trashRows.length, limit), trashOpen ? '▾' : '▸'),
					trashOpen
						? (trashRows.length === 0
							? h('div', { className: 'dsh-toolbox__empty' }, s.trashEmpty)
							: h('ul', { className: 'dsh-toolbox__list' },
								...trashRows.map((row) => h(SessionRow, {
									key: row.id,
									row,
									s,
									busy: busyId === row.id,
									inTrash: true,
									onRestore: () => {
										void withBusy(row.id, () => post(RESTORE_ROUTE, { sessionId: row.id }));
									},
									onPurge: () => {
										if (!window.confirm(s.confirmPurge(row.title || s.unknownTitle))) return;
										void withBusy(row.id, () => post(PURGE_ROUTE, { sessionId: row.id }));
									},
								})),
							))
						: null,
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
						const row = state.sessions.find((candidate) => candidate.id === sessionId);
						setRunning(row !== undefined && row.live === true);
					} catch {
						// Leave it enabled; the host refuses a live session anyway.
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
						window.alert(code === 'session-live' ? s.liveRefused : `${s.deleteFailed}: ${code}`);
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
