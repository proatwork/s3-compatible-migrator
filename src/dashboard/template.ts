import type { DashboardData } from './api';

export function renderDashboard(data: DashboardData): string {
	const { migrations, tableRows, summary, cronEnabled, cronLastRan, discoveryComplete } = data;

	const gridCells = migrations.map(m => {
		const statusClass = m.status === 'completed' ? 'completed' : m.status === 'failed' ? 'failed' : 'in-progress';
		return `<div class="grid-cell ${statusClass}" data-key="${escapeHtml(m.key)}" data-status="${m.status}" data-progress="${m.chunks_done}/${m.total_chunks}" data-size="${m.file_size}" data-created="${m.created_at}" data-completed="${m.completed_at || ''}" data-retry="${m.retry_count}"></div>`;
	}).join('');

	const rows = renderTableRows(tableRows);
	const lastRanText = formatLastRan(cronLastRan);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>S3 Migration Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e1e4e8; padding: 24px; }
h1 { font-size: 1.4rem; font-weight: 600; color: #f0f3f6; }
h2 { font-size: 1rem; font-weight: 600; color: #f0f3f6; margin-bottom: 12px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.header-left { display: flex; align-items: center; gap: 16px; }
.cron-last-ran { font-size: 0.75rem; color: #8b949e; }
.cron-toggle { display: flex; align-items: center; gap: 8px; }
.cron-toggle label { font-size: 0.75rem; color: #8b949e; cursor: pointer; user-select: none; }
.toggle-switch { position: relative; width: 36px; height: 20px; cursor: pointer; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: #3d1114; border-radius: 10px; transition: background 0.2s; }
.toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; bottom: 3px; background: #e1e4e8; border-radius: 50%; transition: transform 0.2s; }
.toggle-switch input:checked + .toggle-slider { background: #0d3520; }
.toggle-switch input:checked + .toggle-slider::before { transform: translateX(16px); }
.header-right { display: flex; align-items: center; gap: 16px; }
.refresh-indicator { font-size: 0.7rem; color: #8b949e; display: flex; align-items: center; gap: 6px; }
.refresh-dot { width: 8px; height: 8px; border-radius: 50%; background: #30363d; border: 1px solid #484f58; transition: background 0.2s, border-color 0.2s; }
.refresh-dot.active { background: #3fb950; border-color: #3fb950; }
.summary { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
.card { background: #1c1f26; border: 1px solid #2d333b; border-radius: 8px; padding: 16px 20px; min-width: 140px; }
.card .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; margin-bottom: 4px; }
.card .value { font-size: 1.5rem; font-weight: 700; }
.card.completed .value { color: #3fb950; }
.card.in-progress .value { color: #d29922; }
.card.failed .value { color: #f85149; }
.grid-section { margin-bottom: 24px; }
.migration-grid { display: flex; flex-wrap: wrap; gap: 2px; background: #1c1f26; border: 1px solid #2d333b; border-radius: 8px; padding: 8px; }
.grid-cell { width: 15px; height: 15px; border-radius: 2px; cursor: pointer; transition: transform 0.1s, box-shadow 0.1s; flex-shrink: 0; }
.grid-cell:hover { transform: scale(1.8); z-index: 1; box-shadow: 0 0 6px rgba(255,255,255,0.2); }
.grid-cell.completed { background: #238636; }
.grid-cell.in-progress { background: #9e6a03; animation: pulse 2s ease-in-out infinite; }
.grid-cell.failed { background: #da3633; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.tooltip { position: fixed; background: #161b22; border: 1px solid #484f58; border-radius: 6px; padding: 10px 14px; font-size: 0.8rem; color: #e1e4e8; pointer-events: none; z-index: 100; display: none; max-width: 400px; line-height: 1.5; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
.tooltip .tt-key { font-family: monospace; font-size: 0.75rem; color: #8b949e; word-break: break-all; margin-bottom: 4px; }
.tooltip .tt-row { display: flex; gap: 12px; font-size: 0.75rem; }
.tooltip .tt-label { color: #8b949e; }
table { width: 100%; border-collapse: collapse; background: #1c1f26; border-radius: 8px 8px 0 0; overflow: hidden; border: 1px solid #2d333b; border-bottom: none; }
th { text-align: left; padding: 10px 14px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; background: #161b22; border-bottom: 1px solid #2d333b; }
td { padding: 10px 14px; font-size: 0.85rem; border-bottom: 1px solid #21262d; }
tr:last-child td { border-bottom: none; }
tr:hover { background: #21262d; }
.key { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 0.8rem; }
.badge { padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
.badge.completed { background: #0d3520; color: #3fb950; }
.badge.in-progress { background: #3d2e00; color: #d29922; }
.badge.failed { background: #3d1114; color: #f85149; }
.progress-cell { display: flex; align-items: center; gap: 8px; }
.progress-bar { width: 80px; height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: #3fb950; border-radius: 3px; transition: width 0.3s; }
.progress-text { font-size: 0.75rem; color: #8b949e; white-space: nowrap; }
.retry-count { font-size: 0.65rem; color: #d29922; }
.empty { text-align: center; padding: 40px; color: #8b949e; }
.table-footer { text-align: center; padding: 14px; color: #8b949e; font-size: 0.85rem; background: #1c1f26; border: 1px solid #2d333b; border-top: none; border-radius: 0 0 8px 8px; }
.retry-btn, .abort-btn { border-radius: 6px; padding: 6px 14px; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: background 0.2s; border: 1px solid; }
.retry-btn { background: #3d1114; color: #f85149; border-color: #f8514933; }
.retry-btn:hover { background: #5a1a1e; }
.abort-btn { background: #3d2e00; color: #d29922; border-color: #d2992233; }
.abort-btn:hover { background: #5a4400; }
.retry-btn:disabled, .abort-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.abort-row-btn { background: none; border: 1px solid #d2992233; color: #d29922; border-radius: 4px; padding: 2px 8px; font-size: 0.7rem; cursor: pointer; transition: background 0.2s; }
.abort-row-btn:hover { background: #3d2e00; }
.abort-row-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.discovery-status { font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
.discovery-status.complete { background: #0d3520; color: #3fb950; }
.discovery-status.scanning { background: #3d2e00; color: #d29922; }
</style>
</head>
<body>
<div class="header">
<div class="header-left">
	<h1>S3 Migration Dashboard</h1>
	<span class="cron-last-ran" id="cron-last-ran">Cron last ran ${lastRanText}</span>
	<span class="discovery-status ${discoveryComplete ? 'complete' : 'scanning'}" id="discovery-status">${discoveryComplete ? 'Discovery complete' : 'Scanning source'}</span>
</div>
<div class="header-right">
	<div class="cron-toggle">
		<label class="toggle-switch">
			<input type="checkbox" id="cron-toggle" ${cronEnabled ? 'checked' : ''}>
			<span class="toggle-slider"></span>
		</label>
		<label for="cron-toggle">Auto-processing</label>
	</div>
	<div class="refresh-indicator"><div class="refresh-dot" id="refresh-dot"></div>Auto-refreshing every 2.5s</div>
</div>
</div>
<div class="summary" id="summary">
	<div class="card"><div class="label">Total</div><div class="value">${summary.total}</div></div>
	<div class="card completed"><div class="label">Completed</div><div class="value">${summary.completed}</div></div>
	<div class="card in-progress"><div class="label">In Progress</div><div class="value">${summary.inProgress}</div>${summary.inProgress > 0 ? '<button class="abort-btn" id="abort-all-btn" style="margin-top:8px">Abort All</button>' : ''}</div>
	<div class="card failed"><div class="label">Failed</div><div class="value">${summary.failed}</div>${summary.failed > 0 ? '<button class="retry-btn" id="retry-failed-btn" style="margin-top:8px">Retry All Failed</button>' : ''}</div>
	<div class="card"><div class="label">Data Migrated</div><div class="value">${formatBytes(summary.completedBytes)}</div></div>
</div>
<div class="grid-section">
<div class="migration-grid" id="migration-grid">${gridCells}</div>
</div>
<h2>Activity</h2>
<table>
<thead><tr><th>File Key</th><th>Status</th><th>Progress</th><th>Size</th><th>Created</th><th>Completed</th><th>Duration</th><th></th></tr></thead>
<tbody id="migrations-tbody">${rows || '<tr><td colspan="8" class="empty">No migrations yet</td></tr>'}</tbody>
</table>
<div class="tooltip" id="tooltip"></div>
<script>
function formatBytes(bytes) {
	if (bytes === 0) return '0 B';
	var units = ['B', 'KB', 'MB', 'GB', 'TB'];
	var i = Math.floor(Math.log(bytes) / Math.log(1024));
	return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}
function escapeHtml(s) {
	return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function truncateKey(key) {
	return key.length > 60 ? '...' + key.slice(-57) : key;
}
function formatTimestamp(epochSeconds) {
	if (!epochSeconds) return '\\u2014';
	return new Date(epochSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}
function formatDuration(seconds) {
	if (seconds < 0) return '\\u2014';
	var h = Math.floor(seconds / 3600);
	var m = Math.floor((seconds % 3600) / 60);
	var s = seconds % 60;
	if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
	if (m > 0) return m + 'm ' + s + 's';
	return s + 's';
}
function formatLastRan(epochSeconds) {
	if (!epochSeconds) return 'never';
	var seconds = Math.floor(Date.now() / 1000) - epochSeconds;
	if (seconds < 60) return seconds + 's ago';
	var m = Math.floor(seconds / 60);
	if (m < 60) return m + 'm ago';
	var h = Math.floor(m / 60);
	return h + 'h ' + (m % 60) + 'm ago';
}
function renderSummary(s) {
	var retryBtn = s.failed > 0 ? '<button class="retry-btn" id="retry-failed-btn" style="margin-top:8px">Retry All Failed</button>' : '';
	var abortBtn = s.inProgress > 0 ? '<button class="abort-btn" id="abort-all-btn" style="margin-top:8px">Abort All</button>' : '';
	return '<div class="card"><div class="label">Total</div><div class="value">' + s.total + '</div></div>'
		+ '<div class="card completed"><div class="label">Completed</div><div class="value">' + s.completed + '</div></div>'
		+ '<div class="card in-progress"><div class="label">In Progress</div><div class="value">' + s.inProgress + '</div>' + abortBtn + '</div>'
		+ '<div class="card failed"><div class="label">Failed</div><div class="value">' + s.failed + '</div>' + retryBtn + '</div>'
		+ '<div class="card"><div class="label">Data Migrated</div><div class="value">' + formatBytes(s.completedBytes) + '</div></div>';
}
function renderGrid(migrations) {
	return migrations.map(function(m) {
		var statusClass = m.status === 'completed' ? 'completed' : m.status === 'failed' ? 'failed' : 'in-progress';
		return '<div class="grid-cell ' + statusClass + '" data-key="' + escapeHtml(m.key) + '" data-status="' + m.status + '" data-progress="' + m.chunks_done + '/' + m.total_chunks + '" data-size="' + m.file_size + '" data-created="' + m.created_at + '" data-completed="' + (m.completed_at || '') + '" data-retry="' + m.retry_count + '"></div>';
	}).join('');
}
function renderRows(tableRows) {
	if (!tableRows.length) return '<tr><td colspan="8" class="empty">No migrations yet</td></tr>';
	return tableRows.map(function(m) {
		var progress = m.total_chunks > 0 ? Math.round((m.chunks_done / m.total_chunks) * 100) : (m.status === 'completed' ? 100 : 0);
		var statusClass = m.status === 'completed' ? 'completed' : m.status === 'failed' ? 'failed' : 'in-progress';
		var statusLabel = m.status === 'in_progress' ? 'in progress' : m.status;
		var retryInfo = m.retry_count > 0 ? ' <span class="retry-count">(retry ' + m.retry_count + '/3)</span>' : '';
		var created = formatTimestamp(Number(m.created_at));
		var completed = m.completed_at ? formatTimestamp(Number(m.completed_at)) : '\\u2014';
		var duration = m.completed_at ? formatDuration(Number(m.completed_at) - Number(m.created_at)) : '\\u2014';
		var actions = m.status === 'in_progress' ? '<button class="abort-row-btn" data-abort-key="' + escapeHtml(m.key) + '">Abort</button>' : '';
		return '<tr>'
			+ '<td class="key" title="' + escapeHtml(m.key) + '">' + escapeHtml(truncateKey(m.key)) + '</td>'
			+ '<td><span class="badge ' + statusClass + '">' + statusLabel + '</span>' + retryInfo + '</td>'
			+ '<td><div class="progress-cell"><div class="progress-bar"><div class="progress-fill" style="width:' + progress + '%"></div></div><span class="progress-text">' + m.chunks_done + '/' + m.total_chunks + '</span></div></td>'
			+ '<td>' + formatBytes(m.file_size) + '</td>'
			+ '<td>' + created + '</td>'
			+ '<td>' + completed + '</td>'
			+ '<td>' + duration + '</td>'
			+ '<td>' + actions + '</td>'
			+ '</tr>';
	}).join('');
}

var dot = document.getElementById('refresh-dot');
var cronToggle = document.getElementById('cron-toggle');
var cronLastRanEl = document.getElementById('cron-last-ran');
var gridEl = document.getElementById('migration-grid');
var tooltip = document.getElementById('tooltip');

cronToggle.addEventListener('change', function() {
	var value = cronToggle.checked ? 'true' : 'false';
	fetch('/api/settings', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ key: 'cron_enabled', value: value })
	});
});

document.addEventListener('click', function(e) {
	var retryBtn = e.target.closest('#retry-failed-btn');
	if (retryBtn) {
		retryBtn.disabled = true;
		retryBtn.textContent = 'Retrying...';
		fetch('/api/retry-failed', { method: 'POST' })
			.then(function(r) { return r.json(); })
			.then(function(data) { retryBtn.textContent = 'Retried ' + data.retried + ' jobs'; })
			.catch(function() { retryBtn.textContent = 'Error'; })
			.finally(function() { setTimeout(function() { retryBtn.disabled = false; retryBtn.textContent = 'Retry All Failed'; }, 3000); });
		return;
	}

	var abortAllBtn = e.target.closest('#abort-all-btn');
	if (abortAllBtn) {
		abortAllBtn.disabled = true;
		abortAllBtn.textContent = 'Aborting...';
		fetch('/api/abort-all', { method: 'POST' })
			.then(function(r) { return r.json(); })
			.then(function(data) { abortAllBtn.textContent = 'Aborted ' + data.aborted + ' jobs'; })
			.catch(function() { abortAllBtn.textContent = 'Error'; })
			.finally(function() { setTimeout(function() { abortAllBtn.disabled = false; abortAllBtn.textContent = 'Abort All'; }, 3000); });
		return;
	}

	var abortRowBtn = e.target.closest('.abort-row-btn');
	if (abortRowBtn) {
		var key = abortRowBtn.getAttribute('data-abort-key');
		abortRowBtn.disabled = true;
		abortRowBtn.textContent = '...';
		fetch('/api/abort-job', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ key: key })
		})
			.then(function(r) { return r.json(); })
			.then(function(data) { abortRowBtn.textContent = data.aborted ? 'Aborted' : 'Error'; })
			.catch(function() { abortRowBtn.textContent = 'Error'; });
		return;
	}
});

gridEl.addEventListener('mouseover', function(e) {
	var cell = e.target.closest('.grid-cell');
	if (!cell) return;
	var key = cell.getAttribute('data-key');
	var status = cell.getAttribute('data-status');
	var progress = cell.getAttribute('data-progress');
	var size = formatBytes(Number(cell.getAttribute('data-size')));
	var created = formatTimestamp(Number(cell.getAttribute('data-created')));
	var completedEpoch = cell.getAttribute('data-completed');
	var completed = completedEpoch ? formatTimestamp(Number(completedEpoch)) : '\\u2014';
	var duration = completedEpoch ? formatDuration(Number(completedEpoch) - Number(cell.getAttribute('data-created'))) : '\\u2014';
	var retry = Number(cell.getAttribute('data-retry'));
	var statusLabel = status === 'in_progress' ? 'in progress' : status;

	tooltip.innerHTML = '<div class="tt-key">' + escapeHtml(key) + '</div>'
		+ '<div class="tt-row"><span class="tt-label">Status:</span> ' + statusLabel + (retry > 0 ? ' (retry ' + retry + '/3)' : '') + '</div>'
		+ '<div class="tt-row"><span class="tt-label">Progress:</span> ' + progress + '</div>'
		+ '<div class="tt-row"><span class="tt-label">Size:</span> ' + size + '</div>'
		+ '<div class="tt-row"><span class="tt-label">Created:</span> ' + created + '</div>'
		+ '<div class="tt-row"><span class="tt-label">Completed:</span> ' + completed + '</div>'
		+ '<div class="tt-row"><span class="tt-label">Duration:</span> ' + duration + '</div>';
	tooltip.style.display = 'block';

	var rect = cell.getBoundingClientRect();
	var ttRect = tooltip.getBoundingClientRect();
	var left = rect.left + rect.width / 2 - ttRect.width / 2;
	var top = rect.top - ttRect.height - 8;
	if (top < 4) top = rect.bottom + 8;
	if (left < 4) left = 4;
	if (left + ttRect.width > window.innerWidth - 4) left = window.innerWidth - ttRect.width - 4;
	tooltip.style.left = left + 'px';
	tooltip.style.top = top + 'px';
});

gridEl.addEventListener('mouseout', function(e) {
	var cell = e.target.closest('.grid-cell');
	if (!cell) return;
	if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.grid-cell') === cell) return;
	tooltip.style.display = 'none';
});

setInterval(function() {
	dot.classList.add('active');
	fetch('/api/migrations').then(function(r) { return r.json(); }).then(function(data) {
		document.getElementById('summary').innerHTML = renderSummary(data.summary);
		gridEl.innerHTML = renderGrid(data.migrations);
		document.getElementById('migrations-tbody').innerHTML = renderRows(data.tableRows);
		cronToggle.checked = data.cronEnabled;
		cronLastRanEl.textContent = 'Cron last ran ' + formatLastRan(data.cronLastRan);
		var dsEl = document.getElementById('discovery-status');
		dsEl.textContent = data.discoveryComplete ? 'Discovery complete' : 'Scanning source';
		dsEl.className = 'discovery-status ' + (data.discoveryComplete ? 'complete' : 'scanning');
	}).catch(function() {}).finally(function() {
		setTimeout(function() { dot.classList.remove('active'); }, 1000);
	});
}, 2500);
</script>
</body>
</html>`;
}

function renderTableRows(tableRows: DashboardData['tableRows']): string {
	return tableRows.map(m => {
		const progress = m.total_chunks > 0
			? Math.round((m.chunks_done / m.total_chunks) * 100)
			: m.status === 'completed' ? 100 : 0;
		const size = formatBytes(m.file_size);
		const statusClass = m.status === 'completed' ? 'completed' : m.status === 'failed' ? 'failed' : 'in-progress';
		const statusLabel = m.status === 'in_progress' ? 'in progress' : m.status;
		const retryInfo = m.retry_count > 0 ? ` <span class="retry-count">(retry ${m.retry_count}/3)</span>` : '';
		const createdAt = formatTimestamp(Number(m.created_at));
		const completedAt = m.completed_at ? formatTimestamp(Number(m.completed_at)) : '—';
		const duration = m.completed_at ? formatDuration(Number(m.completed_at) - Number(m.created_at)) : '—';

		const actions = m.status === 'in_progress' ? `<button class="abort-row-btn" data-abort-key="${escapeHtml(m.key)}">Abort</button>` : '';

		return `<tr>
			<td class="key" title="${escapeHtml(m.key)}">${escapeHtml(truncateKey(m.key))}</td>
			<td><span class="badge ${statusClass}">${statusLabel}</span>${retryInfo}</td>
			<td>
				<div class="progress-cell">
					<div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
					<span class="progress-text">${m.chunks_done}/${m.total_chunks}</span>
				</div>
			</td>
			<td>${size}</td>
			<td>${createdAt}</td>
			<td>${completedAt}</td>
			<td>${duration}</td>
			<td>${actions}</td>
		</tr>`;
	}).join('');
}

function formatLastRan(epochSeconds: number): string {
	if (!epochSeconds) return 'never';
	const seconds = Math.floor(Date.now() / 1000) - epochSeconds;
	if (seconds < 60) return `${seconds}s ago`;
	const m = Math.floor(seconds / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m ago`;
}

function formatTimestamp(epochSeconds: number): string {
	if (!epochSeconds) return '—';
	return new Date(epochSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function formatDuration(seconds: number): string {
	if (seconds < 0) return '—';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncateKey(key: string): string {
	return key.length > 60 ? '...' + key.slice(-57) : key;
}
