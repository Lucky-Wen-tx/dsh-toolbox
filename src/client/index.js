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
				msgs: (n) => `${n} 条消息`,
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
				msgs: (n) => `${n} messages`,
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

		// ── styles ──────────────────────────────────────────────────────────
		const STYLE = `
.dsh-toolbox { display:flex; flex-direction:column; gap:32px; color:var(--dsw-alias-label-primary,#111827); }
.dsh-toolbox__head { display:flex; flex-direction:column; gap:4px; }
.dsh-toolbox__title { margin:0; font-size:20px; font-weight:500; line-height:28px; }
.dsh-toolbox__sub { color:var(--dsw-alias-label-secondary,#6b7280); font-size:13px; line-height:20px; margin:0; }
.dsh-toolbox__section { display:flex; flex-direction:column; gap:12px; }
.dsh-toolbox__sectionHead { align-items:baseline; display:flex; gap:10px; }
.dsh-toolbox__sectionTitle { margin:0; font-size:14px; font-weight:500; line-height:20px; }
.dsh-toolbox__sectionCount { color:var(--dsw-alias-label-secondary,#6b7280); font-size:12px; line-height:18px; }
.dsh-toolbox__sectionAction { margin-left:auto; }
.dsh-toolbox__btn { appearance:none; background:transparent; border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28)); border-radius:var(--dsw-radius-sm,6px); color:inherit; cursor:pointer; font:inherit; font-size:12px; line-height:18px; padding:3px 10px; white-space:nowrap; }
.dsh-toolbox__btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1)); }
.dsh-toolbox__btn:disabled { cursor:default; opacity:.45; }
.dsh-toolbox__btn--danger { border-color:var(--dsw-alias-state-error-primary,rgba(220,38,38,.45)); color:var(--dsw-alias-state-error-primary,#dc2626); }
.dsh-toolbox__btn--danger:hover:not(:disabled) { background:rgba(239,68,68,.1); }
.dsh-toolbox__group { display:flex; flex-direction:column; gap:10px; }
.dsh-toolbox__group + .dsh-toolbox__group { margin-top:20px; }
.dsh-toolbox__groupHead { align-items:center; background:transparent; border:0; color:var(--dsw-alias-label-tertiary,#9ca3af); cursor:pointer; display:flex; font:inherit; font-size:12px; font-weight:600; gap:8px; letter-spacing:.06em; line-height:18px; margin:0; padding:0; text-transform:uppercase; width:100%; }
.dsh-toolbox__groupHead:hover { color:var(--dsw-alias-label-secondary,#6b7280); }
.dsh-toolbox__groupName { flex:1 1 auto; min-width:0; overflow:hidden; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
.dsh-toolbox__groupPath { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:11px; font-weight:400; letter-spacing:0; margin-left:8px; text-transform:none; }
.dsh-toolbox__groupCount { color:var(--dsw-alias-label-tertiary,#9ca3af); flex:none; font-size:12px; font-weight:400; letter-spacing:0; }
.dsh-toolbox__list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.dsh-toolbox__row { align-items:center; background:var(--dsw-alias-settings-card-fill,transparent); border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2,rgba(127,127,127,.22))); border-radius:var(--dsw-radius-xl,12px); display:flex; gap:14px; padding:12px 14px; transition:background .16s,border-color .16s; }
@media (hover:hover) { .dsh-toolbox__row:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06)); } }
.dsh-toolbox__row[data-dim] { opacity:.7; }
.dsh-toolbox__row[data-child] { margin-left:20px; border-style:dashed; }
.dsh-toolbox__main { display:flex; flex-direction:column; flex:1 1 auto; gap:4px; min-width:0; }
.dsh-toolbox__name { font-size:14px; font-weight:500; line-height:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-toolbox__meta { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:13px; line-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-toolbox__tag { border-radius:999px; display:inline-block; font-size:11px; font-weight:500; line-height:17px; margin-left:6px; padding:1px 8px; vertical-align:middle; }
.dsh-toolbox__tag--live { background:rgba(34,197,94,.14); color:#15803d; }
.dsh-toolbox__tag--arch { background:var(--dsw-alias-fill-tsp-secondary,rgba(127,127,127,.16)); }
.dsh-toolbox__tag--blank { background:var(--dsw-alias-fill-tsp-secondary,rgba(127,127,127,.1)); }
.dsh-toolbox__tag--orphan { background:rgba(245,158,11,.16); color:#b45309; }
.dsh-toolbox__tag--sub { background:rgba(77,107,254,.12); color:#3b5bdb; }
.dsh-toolbox__actions { display:flex; flex:none; gap:8px; }
.dsh-toolbox__empty { color:var(--dsw-alias-label-tertiary,#9ca3af); font-size:13px; line-height:20px; margin:0; }
.dsh-toolbox__error { background:rgba(239,68,68,.12); border-radius:var(--dsw-radius-sm,6px); font-size:13px; line-height:20px; padding:6px 10px; }
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
			const { row, s, busy, mode, onDelete, onRestore, onPurge, isChild } = props;
			const title = row.title || s.unknownTitle;
			const meta = [];
			meta.push(row.cwd || s.noCwd);
			const size = formatBytes(row.sizeBytes);
			meta.push(size === null ? s.sizeUnknown : size);
			if (typeof row.eventCount === 'number') meta.push(s.msgs(row.eventCount));
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
			const [collapsed, setCollapsed] = React.useState({});
			const [orphanOpen, setOrphanOpen] = React.useState(false);
			const [tick, setTick] = React.useState(0);

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

			const toggle = (key) => setCollapsed((prev) => ({ ...prev, [key]: prev[key] !== true }));

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
				const isOpen = collapsed[key] !== true;
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
						onClick: () => toggle(key),
					},
						h('span', { className: 'dsh-toolbox__groupName' },
							label,
							group.path === null ? null : h('span', { className: 'dsh-toolbox__groupPath' }, group.path),
						),
						h('span', { className: 'dsh-toolbox__groupCount' }, `${group.sessions.length} ${isOpen ? '▾' : '▸'}`),
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
				h('div', { className: 'dsh-toolbox__head' },
					h('div', { className: 'dsh-toolbox__title' }, s.title),
					h('div', { className: 'dsh-toolbox__sub' }, s.subtitle),
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
							className: 'dsh-toolbox__btn dsh-toolbox__sectionAction',
							onClick: () => setTick((n) => n + 1),
						}, s.refresh),
					),
					groups.length === 0
						? h('div', { className: 'dsh-toolbox__empty' }, state === null ? s.loading : s.empty)
						: h('div', null, ...groups.map(renderGroup)),
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
							onClick: () => setOrphanOpen((open) => !open),
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
