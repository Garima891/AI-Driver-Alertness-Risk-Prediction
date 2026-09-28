// ═══════════════════════════════════════════════════════════════
// analysis.js — Fully Reactive Feature Impact Analysis
// ═══════════════════════════════════════════════════════════════
// Architecture:
//   1. workingState = mutable copy of snapshot, mutated by slider
//   2. Every slider drag → update workingState → debounced API call
//   3. API call → update ALL components (score, level, explanation,
//      sensitivity, curve, comparison, top factor)
//   4. Feature importance = static (loaded once)
// ═══════════════════════════════════════════════════════════════

const FEATURE_LABELS = {
    overspeeding_severity:       'Overspeeding',
    drunk_driving_severity:      'Drunk Driving',
    traffic_violation_severity:  'Traffic Violations',
    mobile_use_severity:         'Mobile Usage',
    wrong_side_driving_severity: 'Wrong Lane Driving',
    sudden_braking_severity:     'Sudden Braking',
    driver_drowsy_score:         'Driver Drowsiness'
};

const FEATURE_ICONS = {
    overspeeding_severity:       '🚗',
    drunk_driving_severity:      '🍺',
    traffic_violation_severity:  '🚦',
    mobile_use_severity:         '📱',
    wrong_side_driving_severity: '↔️',
    sudden_braking_severity:     '🛑',
    driver_drowsy_score:         '😴'
};

const FEATURE_KEYS = Object.keys(FEATURE_LABELS);

// ── Load snapshot from Page 1 ─────────────────────────────────
let snapshot = {};
try {
    snapshot = JSON.parse(sessionStorage.getItem('driverSnapshot') || '{}');
} catch(e) { snapshot = {}; }

FEATURE_KEYS.forEach(k => { if (snapshot[k] === undefined) snapshot[k] = 0.3; });
if (!snapshot.risk_score)        snapshot.risk_score        = 0;
if (!snapshot.risk_level)        snapshot.risk_level        = 'UNKNOWN';
if (!snapshot.road_type)         snapshot.road_type         = 'Urban';
if (!snapshot.time_of_day)       snapshot.time_of_day       = 'Morning';
if (!snapshot.weather_condition) snapshot.weather_condition  = 'Clear';

// ── Working state: starts as snapshot, mutated by simulation ──
// This is the SINGLE SOURCE OF TRUTH for what gets sent to the API
let workingState = { ...snapshot };

// ── DOM references ────────────────────────────────────────────
const simFeatureEl     = document.getElementById('simFeature');
const simSliderEl      = document.getElementById('simSlider');
const simSliderLbl     = document.getElementById('simSliderLabel');
const summaryScoreEl   = document.getElementById('summaryScore');
const summaryLevelEl   = document.getElementById('summaryLevel');
const summaryTopEl     = document.getElementById('summaryTopFactor');
const summarySimEl     = document.getElementById('summarySimFeature');
const explanationEl    = document.getElementById('explanationText');
const sensitivityList  = document.getElementById('sensitivityList');
const cmpCurrentEl     = document.getElementById('cmpCurrent');
const cmpModifiedEl    = document.getElementById('cmpModified');
const cmpDeltaEl       = document.getElementById('cmpDelta');
const cmpRowEl         = document.getElementById('comparisonRow');

// ── Chart instances ───────────────────────────────────────────
let simulationChart   = null;
let contributionChart = null;
let importanceLoaded  = false;  // static chart only needs to load once

// ── Initialize summary with snapshot values ───────────────────
summaryScoreEl.textContent = snapshot.risk_score.toFixed(2) +
    ' (' + Math.round(snapshot.risk_score * 100) + '%)';
summaryLevelEl.textContent = snapshot.risk_level;
colorizeLevel(summaryLevelEl, snapshot.risk_level);
summarySimEl.textContent = FEATURE_LABELS[simFeatureEl.value] || '—';

function colorizeLevel(el, level) {
    if      (level === 'HIGH')   el.style.color = '#ef4444';
    else if (level === 'MEDIUM') el.style.color = '#eab308';
    else                         el.style.color = '#22c55e';
}

// ═══════════════════════════════════════════════════════════════
//  CHART BUILDERS
// ═══════════════════════════════════════════════════════════════

function buildSimulationChart(curve, featureLabel) {
    const ctx    = document.getElementById('simulationChart').getContext('2d');
    const labels = curve.map(p => p.x.toFixed(2));
    const values = curve.map(p => Math.round(p.y * 100));
    const colors = values.map(v => v > 70 ? '#ef4444' : v > 40 ? '#eab308' : '#22c55e');

    if (simulationChart) simulationChart.destroy();
    simulationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Risk %',
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.06)',
                borderWidth: 3,
                pointBackgroundColor: colors,
                pointBorderColor: colors,
                pointRadius: 4,
                pointHoverRadius: 7,
                fill: true,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: t => featureLabel + ' = ' + t[0].label,
                        label: t => 'Risk: ' + t.raw + '%'
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: featureLabel + '  (0→1)', font: { weight: '600' } },
                    grid:  { color: 'rgba(0,0,0,0.04)' }
                },
                y: {
                    min: 0, max: 100,
                    title: { display: true, text: 'Risk Score (%)', font: { weight: '600' } },
                    grid:  { color: 'rgba(0,0,0,0.04)' },
                    ticks: { callback: v => v + '%' }
                }
            }
        }
    });

    document.getElementById('curveSubtitle').textContent =
        'Risk as ' + featureLabel + ' varies 0→1. All other factors stay at current working values.';
}

function buildImportanceChart(featureImportance) {
    if (importanceLoaded) return;  // only render once — it's static
    importanceLoaded = true;

    const ctx = document.getElementById('contributionChart').getContext('2d');
    const sorted = Object.entries(featureImportance).sort((a,b) => b[1] - a[1]);
    const labels = sorted.map(([k]) => FEATURE_ICONS[k] + '  ' + FEATURE_LABELS[k]);
    const values = sorted.map(([,v]) => v);
    const bg     = values.map(v => v > 30 ? 'rgba(239,68,68,0.7)' : v > 10 ? 'rgba(234,179,8,0.7)' : 'rgba(59,130,246,0.6)');
    const border = values.map(v => v > 30 ? '#ef4444' : v > 10 ? '#eab308' : '#3b82f6');

    contributionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: bg, borderColor: border, borderWidth: 2, borderRadius: 8 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => ' Model weight: ' + c.raw + '%' } }
            },
            scales: {
                x: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => v+'%' } },
                y: { grid: { display: false } }
            }
        }
    });

    // Highlight the currently simulated feature
    highlightImportanceBar(simFeatureEl.value, sorted);
}

function highlightImportanceBar(feat, sorted) {
    if (!contributionChart) return;
    if (!sorted) {
        // Rebuild sorted from chart data
        sorted = contributionChart.data.labels.map((lbl, i) => {
            const key = FEATURE_KEYS.find(k => lbl.includes(FEATURE_LABELS[k]));
            return [key, contributionChart.data.datasets[0].data[i]];
        });
    }
    const idx = sorted.findIndex(([k]) => k === feat);
    if (idx < 0) return;

    const bg = sorted.map(([k], i) => {
        const v = sorted[i][1];
        const base = v > 30 ? 'rgba(239,68,68,' : v > 10 ? 'rgba(234,179,8,' : 'rgba(59,130,246,';
        return k === feat ? base + '1)' : base + '0.45)';
    });
    contributionChart.data.datasets[0].backgroundColor = bg;
    contributionChart.update('none');
}

function buildSensitivityBars(sensitivity) {
    sensitivityList.innerHTML = '';

    const sorted = FEATURE_KEYS
        .map(k => ({ key: k, ...sensitivity[k] }))
        .sort((a,b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));

    const maxDelta = Math.max(...sorted.map(s => Math.abs(s.delta_pct)), 0.1);

    sorted.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'sens-row';
        row.style.animationDelay = (idx * 0.04) + 's';

        const isZero   = Math.abs(item.delta_pct) < 0.05;
        const atMax    = item.current_val >= 0.99;
        const barWidth = isZero ? 2 : Math.max(4, Math.round(Math.abs(item.delta_pct) / maxDelta * 100));
        const barColor = item.delta_pct > 4 ? '#ef4444' : item.delta_pct > 1 ? '#f59e0b' : '#22c55e';

        let label;
        if (atMax)          label = 'Already at maximum';
        else if (isZero)    label = 'No measurable impact';
        else                label = (item.delta_pct >= 0 ? '+' : '') + item.delta_pct.toFixed(1) + '% on +0.1';

        row.innerHTML = `
            <div class="sens-header">
                <span class="sens-name">${FEATURE_ICONS[item.key]} ${FEATURE_LABELS[item.key]} <span style="color:var(--text-secondary);font-size:0.78rem;">(${item.current_val.toFixed(2)})</span></span>
                <span class="sens-delta ${isZero ? 'neutral' : 'positive'}">${label}</span>
            </div>
            <div class="sens-bar-track">
                <div class="sens-bar-fill" style="width:${barWidth}%;background:${barColor};"></div>
            </div>`;
        sensitivityList.appendChild(row);
    });
}

// ═══════════════════════════════════════════════════════════════
//  COMPARISON BOX UPDATE (reads from cached curve — instant)
// ═══════════════════════════════════════════════════════════════

let cachedCurve = [];

function updateComparison() {
    if (!cachedCurve.length) return;
    const sliderVal = parseFloat(simSliderEl.value);
    const closest   = cachedCurve.reduce((p, c) => Math.abs(c.x - sliderVal) < Math.abs(p.x - sliderVal) ? c : p);
    const modRisk   = closest.y;
    const origRisk  = snapshot.risk_score;
    const delta     = Math.round((modRisk - origRisk) * 100);

    cmpCurrentEl.textContent  = Math.round(origRisk * 100) + '%';
    cmpModifiedEl.textContent = Math.round(modRisk  * 100) + '%';

    // Color the modified box
    const modBox = document.querySelector('.comparison-box.modified');
    if (modBox) {
        modBox.style.background = delta > 0 ? 'rgba(239,68,68,0.12)'
            : delta < 0 ? 'rgba(74,222,128,0.12)' : 'rgba(0,0,0,0.04)';
    }

    if (delta > 0)      { cmpDeltaEl.textContent = '+' + delta + '%'; cmpDeltaEl.className = 'comparison-delta up'; }
    else if (delta < 0) { cmpDeltaEl.textContent = delta + '%';       cmpDeltaEl.className = 'comparison-delta down'; }
    else                { cmpDeltaEl.textContent = '±0%';             cmpDeltaEl.className = 'comparison-delta flat'; }
    cmpRowEl.style.display = 'flex';
}

// ═══════════════════════════════════════════════════════════════
//  CENTRAL API CALL — updates EVERYTHING
// ═══════════════════════════════════════════════════════════════

let requestId = 0;  // prevent stale responses

async function refreshAll() {
    const feat = simFeatureEl.value;

    // Update working state with current slider value
    workingState[feat] = parseFloat(simSliderEl.value);

    const thisRequest = ++requestId;

    const payload = {
        overspeeding_severity:       workingState.overspeeding_severity,
        drunk_driving_severity:      workingState.drunk_driving_severity,
        traffic_violation_severity:  workingState.traffic_violation_severity,
        mobile_use_severity:         workingState.mobile_use_severity,
        wrong_side_driving_severity: workingState.wrong_side_driving_severity,
        sudden_braking_severity:     workingState.sudden_braking_severity,
        driver_drowsy_score:         workingState.driver_drowsy_score,
        road_type:                   workingState.road_type         || 'Urban',
        time_of_day:                 workingState.time_of_day       || 'Morning',
        weather_condition:           workingState.weather_condition || 'Clear',
        target_feature:              feat
    };

    try {
        const res  = await fetch('/analyze', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });
        if (thisRequest !== requestId) return;  // stale — discard

        const data = await res.json();
        if (!res.ok) { console.error('API error:', data.error); return; }

        // ── 1. Summary bar ──
        summaryScoreEl.textContent = data.risk_score.toFixed(2) +
            ' (' + Math.round(data.risk_score * 100) + '%)';
        summaryLevelEl.textContent = data.risk_level;
        colorizeLevel(summaryLevelEl, data.risk_level);

        // ── 2. Top factor ──
        if (data.top_factor) {
            summaryTopEl.textContent =
                FEATURE_ICONS[data.top_factor] + '  ' + FEATURE_LABELS[data.top_factor];
        }

        // ── 3. Explanation ──
        if (explanationEl) explanationEl.textContent = data.explanation;

        // ── 4. Sensitivity bars (fully redrawn) ──
        buildSensitivityBars(data.sensitivity);

        // ── 5. Simulation curve (fully redrawn) ──
        cachedCurve = data.simulation_curve;
        buildSimulationChart(data.simulation_curve, FEATURE_LABELS[feat]);

        // ── 6. Comparison box ──
        updateComparison();

        // ── 7. Feature importance (static — only first time) ──
        buildImportanceChart(data.feature_importance);
        highlightImportanceBar(feat);

    } catch(e) {
        console.error('Analysis error:', e);
    }
}

// ═══════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

// ── Dropdown: select parameter to simulate ────────────────────
function onFeatureChange() {
    const feat = simFeatureEl.value;
    summarySimEl.textContent = FEATURE_LABELS[feat];

    // When switching feature, reset slider to that feature's SNAPSHOT value
    // (not working state — let user start from original each time)
    const snapshotVal = snapshot[feat] ?? 0.5;
    simSliderEl.value = snapshotVal;
    simSliderLbl.textContent = parseFloat(snapshotVal).toFixed(2);

    // Reset working state for the previously simulated feature
    // back to snapshot, then set the new one
    FEATURE_KEYS.forEach(k => { workingState[k] = snapshot[k]; });
    workingState[feat] = snapshotVal;

    refreshAll();
}
simFeatureEl.addEventListener('change', onFeatureChange);

// ── Slider: adjust simulated value (debounced → full refresh) ─
let debounceTimer = null;
simSliderEl.addEventListener('input', () => {
    simSliderLbl.textContent = parseFloat(simSliderEl.value).toFixed(2);

    // Instant comparison update from cached curve
    updateComparison();

    // Debounced full refresh (200ms)
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => refreshAll(), 200);
});

// ═══════════════════════════════════════════════════════════════
//  INIT — first load
// ═══════════════════════════════════════════════════════════════
onFeatureChange();
